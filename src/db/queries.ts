import pool from "./client.js";
import { cached } from "./cache.js";
import type {
  LogSessionInput,
  LogEvaluationInput,
  LogComparisonInput,
  LogOutcomeInput,
  ShoppingSessionRow,
  ProductEvaluationRow,
  ComparisonRow,
  OutcomeRow,
} from "../types/index.js";

// Category matching: "electronics" matches "electronics" AND "electronics/headphones", etc.
const CAT_MATCH = `(s.category = $1 OR s.category LIKE $1 || '/%')`;
const CAT_MATCH_BARE = `(category = $1 OR category LIKE $1 || '/%')`;

// ── Inserts ──

export async function insertSession(
  sessionId: string,
  input: LogSessionInput
): Promise<ShoppingSessionRow> {
  const result = await pool.query<ShoppingSessionRow>(
    `INSERT INTO shopping_sessions
       (session_id, agent_platform, raw_query, category, budget_max, budget_currency,
        constraints, exclusions, urgency, gift)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      sessionId,
      input.agent_platform,
      input.raw_query,
      input.category ?? null,
      input.budget_max ?? null,
      input.budget_currency,
      JSON.stringify(input.constraints),
      JSON.stringify(input.exclusions),
      input.urgency,
      input.gift,
    ]
  );
  return result.rows[0];
}

export async function insertEvaluation(
  input: LogEvaluationInput
): Promise<ProductEvaluationRow> {
  const result = await pool.query<ProductEvaluationRow>(
    `INSERT INTO product_evaluations
       (session_id, product_id, merchant_id, price_at_time, in_stock,
        match_score, match_reasons, disposition, rejection_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.session_id,
      input.product_id,
      input.merchant_id ?? null,
      input.price_at_time ?? null,
      input.in_stock,
      input.match_score ?? null,
      JSON.stringify(input.match_reasons),
      input.disposition,
      input.rejection_reason ?? null,
    ]
  );
  return result.rows[0];
}

export async function insertComparison(
  input: LogComparisonInput
): Promise<ComparisonRow> {
  const result = await pool.query<ComparisonRow>(
    `INSERT INTO comparisons
       (session_id, products_compared, dimensions_compared, winner_product_id, deciding_factor)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.session_id,
      JSON.stringify(input.products_compared),
      JSON.stringify(input.dimensions_compared),
      input.winner_product_id,
      input.deciding_factor,
    ]
  );
  return result.rows[0];
}

export async function insertOutcome(
  input: LogOutcomeInput
): Promise<OutcomeRow> {
  const result = await pool.query<OutcomeRow>(
    `INSERT INTO outcomes
       (session_id, outcome_type, product_chosen_id, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      input.session_id,
      input.outcome_type,
      input.product_chosen_id ?? null,
      input.reason ?? null,
    ]
  );
  return result.rows[0];
}

// ── Reads ──

export async function sessionExists(sessionId: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM shopping_sessions WHERE session_id = $1",
    [sessionId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function getSessionSummary(sessionId: string) {
  const [session, evaluations, comparisons, outcome] = await Promise.all([
    pool.query<ShoppingSessionRow>(
      "SELECT * FROM shopping_sessions WHERE session_id = $1",
      [sessionId]
    ),
    pool.query<ProductEvaluationRow>(
      "SELECT * FROM product_evaluations WHERE session_id = $1 ORDER BY created_at",
      [sessionId]
    ),
    pool.query<ComparisonRow>(
      "SELECT * FROM comparisons WHERE session_id = $1 ORDER BY created_at",
      [sessionId]
    ),
    pool.query<OutcomeRow>(
      "SELECT * FROM outcomes WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1",
      [sessionId]
    ),
  ]);

  if (session.rowCount === 0) return null;

  return {
    session: session.rows[0],
    evaluations: evaluations.rows,
    comparisons: comparisons.rows,
    outcome: outcome.rows[0] ?? null,
  };
}

export async function getRecentSessions(limit = 20, offset = 0) {
  const result = await pool.query<ShoppingSessionRow>(
    "SELECT * FROM shopping_sessions ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  return result.rows;
}

// ── Aggregation Queries ──

export async function getProductAggregates(productId: string) {
  const [counts, rejections, lostTo] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS times_considered,
         COUNT(*) FILTER (WHERE disposition = 'shortlisted') AS times_shortlisted,
         COUNT(*) FILTER (WHERE disposition = 'selected') AS times_selected,
         COUNT(*) FILTER (WHERE disposition = 'rejected') AS times_rejected
       FROM product_evaluations
       WHERE product_id = $1`,
      [productId]
    ),
    pool.query(
      `SELECT rejection_reason, COUNT(*) AS count
       FROM product_evaluations
       WHERE product_id = $1 AND disposition = 'rejected' AND rejection_reason IS NOT NULL
       GROUP BY rejection_reason
       ORDER BY count DESC
       LIMIT 10`,
      [productId]
    ),
    pool.query(
      `SELECT c.winner_product_id AS competitor_product_id,
              COUNT(*) AS count,
              MODE() WITHIN GROUP (ORDER BY c.deciding_factor) AS primary_reason
       FROM comparisons c
       WHERE $1 = ANY(
         SELECT jsonb_array_elements_text(c.products_compared)
       )
       AND c.winner_product_id != $1
       GROUP BY c.winner_product_id
       ORDER BY count DESC
       LIMIT 10`,
      [productId]
    ),
  ]);

  const row = counts.rows[0];
  const considered = Number(row.times_considered);
  const selected = Number(row.times_selected);

  return {
    product_id: productId,
    times_considered: considered,
    times_shortlisted: Number(row.times_shortlisted),
    times_selected: selected,
    times_rejected: Number(row.times_rejected),
    top_rejection_reasons: rejections.rows.map((r) => ({
      reason: r.rejection_reason,
      count: Number(r.count),
    })),
    lost_to: lostTo.rows.map((r) => ({
      competitor_product_id: r.competitor_product_id,
      count: Number(r.count),
      primary_reason: r.primary_reason,
    })),
    consideration_to_selection_rate:
      considered > 0 ? selected / considered : 0,
  };
}

export async function getCategoryAggregates(category: string) {
  const [sessions, evalStats, compStats, factors, constraints] =
    await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total,
                AVG(budget_max) AS avg_budget
         FROM shopping_sessions
         WHERE ${CAT_MATCH_BARE}`,
        [category]
      ),
      pool.query(
        `SELECT s.session_id, COUNT(e.id) AS eval_count
         FROM shopping_sessions s
         LEFT JOIN product_evaluations e ON e.session_id = s.session_id
         WHERE ${CAT_MATCH}
         GROUP BY s.session_id`,
        [category]
      ),
      pool.query(
        `SELECT s.session_id, COUNT(c.id) AS comp_count
         FROM shopping_sessions s
         LEFT JOIN comparisons c ON c.session_id = s.session_id
         WHERE ${CAT_MATCH}
         GROUP BY s.session_id`,
        [category]
      ),
      pool.query(
        `SELECT c.deciding_factor AS factor, COUNT(*) AS count
         FROM comparisons c
         JOIN shopping_sessions s ON s.session_id = c.session_id
         WHERE ${CAT_MATCH}
         GROUP BY c.deciding_factor
         ORDER BY count DESC
         LIMIT 10`,
        [category]
      ),
      pool.query(
        `SELECT value, COUNT(*) AS count
         FROM shopping_sessions,
              jsonb_array_elements_text(constraints) AS value
         WHERE ${CAT_MATCH_BARE}
         GROUP BY value
         ORDER BY count DESC
         LIMIT 10`,
        [category]
      ),
    ]);

  const totalSessions = Number(sessions.rows[0]?.total ?? 0);
  const avgEvals =
    evalStats.rows.length > 0
      ? evalStats.rows.reduce((sum, r) => sum + Number(r.eval_count), 0) /
        evalStats.rows.length
      : 0;
  const avgComps =
    compStats.rows.length > 0
      ? compStats.rows.reduce((sum, r) => sum + Number(r.comp_count), 0) /
        compStats.rows.length
      : 0;

  return {
    category,
    total_sessions: totalSessions,
    avg_products_considered: Math.round(avgEvals * 100) / 100,
    avg_comparisons_made: Math.round(avgComps * 100) / 100,
    top_decision_factors: factors.rows.map((r) => ({
      factor: r.factor,
      count: Number(r.count),
    })),
    trending_constraints: constraints.rows.map((r) => ({
      attribute: r.value,
      count: Number(r.count),
    })),
  };
}

export async function getCompetitiveLosses(productId: string) {
  const result = await pool.query(
    `SELECT c.winner_product_id,
            COUNT(*) AS times_lost,
            c.deciding_factor,
            array_agg(DISTINCT d.value) AS dimensions
     FROM comparisons c,
          jsonb_array_elements_text(c.dimensions_compared) AS d(value)
     WHERE $1 = ANY(
       SELECT jsonb_array_elements_text(c.products_compared)
     )
     AND c.winner_product_id != $1
     GROUP BY c.winner_product_id, c.deciding_factor
     ORDER BY times_lost DESC
     LIMIT 20`,
    [productId]
  );

  return result.rows.map((r) => ({
    competitor_product_id: r.winner_product_id,
    times_lost: Number(r.times_lost),
    deciding_factor: r.deciding_factor,
    dimensions: r.dimensions,
  }));
}

// ── Agent Intelligence Queries ──

export async function getProductIntelligence(productId: string) {
  const [stats, rejections, competitors, avgPrice, recentOutcomes] =
    await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS times_considered,
           COUNT(*) FILTER (WHERE disposition = 'selected') AS times_selected,
           COUNT(*) FILTER (WHERE disposition = 'rejected') AS times_rejected,
           COUNT(*) FILTER (WHERE disposition = 'shortlisted') AS times_shortlisted,
           ROUND(AVG(match_score), 2) AS avg_match_score
         FROM product_evaluations
         WHERE product_id = $1`,
        [productId]
      ),
      pool.query(
        `SELECT rejection_reason, COUNT(*) AS count
         FROM product_evaluations
         WHERE product_id = $1 AND disposition = 'rejected' AND rejection_reason IS NOT NULL
         GROUP BY rejection_reason
         ORDER BY count DESC
         LIMIT 5`,
        [productId]
      ),
      pool.query(
        `SELECT c.winner_product_id AS product,
                COUNT(*) AS wins,
                MODE() WITHIN GROUP (ORDER BY c.deciding_factor) AS why
         FROM comparisons c
         WHERE $1 = ANY(SELECT jsonb_array_elements_text(c.products_compared))
           AND c.winner_product_id != $1
         GROUP BY c.winner_product_id
         ORDER BY wins DESC
         LIMIT 5`,
        [productId]
      ),
      pool.query(
        `SELECT ROUND(AVG(price_at_time), 2) AS avg_price,
                MIN(price_at_time) AS min_price,
                MAX(price_at_time) AS max_price
         FROM product_evaluations
         WHERE product_id = $1 AND price_at_time IS NOT NULL`,
        [productId]
      ),
      pool.query(
        `SELECT o.outcome_type, COUNT(*) AS count
         FROM outcomes o
         WHERE o.product_chosen_id = $1
         GROUP BY o.outcome_type
         ORDER BY count DESC`,
        [productId]
      ),
    ]);

  const row = stats.rows[0];
  const considered = Number(row.times_considered);
  const selected = Number(row.times_selected);

  return {
    product_id: productId,
    selection_rate: considered > 0 ? Math.round((selected / considered) * 100) / 100 : null,
    times_considered: considered,
    times_selected: selected,
    times_rejected: Number(row.times_rejected),
    times_shortlisted: Number(row.times_shortlisted),
    avg_match_score: row.avg_match_score ? Number(row.avg_match_score) : null,
    top_rejection_reasons: rejections.rows.map((r) => r.rejection_reason),
    beats_these: competitors.rows.length > 0
      ? competitors.rows.map((r) => `${r.product} (${r.wins}x, reason: ${r.why})`)
      : [],
    price_range: avgPrice.rows[0]?.avg_price
      ? {
          avg: Number(avgPrice.rows[0].avg_price),
          min: Number(avgPrice.rows[0].min_price),
          max: Number(avgPrice.rows[0].max_price),
        }
      : null,
    outcomes_when_chosen: recentOutcomes.rows.map((r) => ({
      type: r.outcome_type,
      count: Number(r.count),
    })),
  };
}

export async function getCategoryRecommendations(category: string, budgetMax?: number) {
  const budgetFilter = budgetMax
    ? `AND e.price_at_time <= ${Number(budgetMax)}`
    : "";

  const [topPicks, decisionFactors, commonConstraints, avgStats] =
    await Promise.all([
      pool.query(
        `SELECT e.product_id,
                COUNT(*) FILTER (WHERE e.disposition = 'selected') AS selections,
                COUNT(*) AS considerations,
                ROUND(AVG(e.match_score), 2) AS avg_score,
                ROUND(AVG(e.price_at_time), 2) AS avg_price
         FROM product_evaluations e
         JOIN shopping_sessions s ON s.session_id = e.session_id
         WHERE ${CAT_MATCH} ${budgetFilter}
         GROUP BY e.product_id
         HAVING COUNT(*) FILTER (WHERE e.disposition = 'selected') > 0
         ORDER BY selections DESC, avg_score DESC
         LIMIT 10`,
        [category]
      ),
      pool.query(
        `SELECT c.deciding_factor, COUNT(*) AS count
         FROM comparisons c
         JOIN shopping_sessions s ON s.session_id = c.session_id
         WHERE ${CAT_MATCH}
         GROUP BY c.deciding_factor
         ORDER BY count DESC
         LIMIT 5`,
        [category]
      ),
      pool.query(
        `SELECT value, COUNT(*) AS count
         FROM shopping_sessions,
              jsonb_array_elements_text(constraints) AS value
         WHERE ${CAT_MATCH_BARE}
         GROUP BY value
         ORDER BY count DESC
         LIMIT 5`,
        [category]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT s.session_id) AS total_sessions,
                ROUND(AVG(s.budget_max), 2) AS avg_budget
         FROM shopping_sessions s
         WHERE ${CAT_MATCH}`,
        [category]
      ),
    ]);

  return {
    category,
    total_sessions: Number(avgStats.rows[0]?.total_sessions ?? 0),
    avg_budget: avgStats.rows[0]?.avg_budget ? Number(avgStats.rows[0].avg_budget) : null,
    top_picks: topPicks.rows.map((r) => ({
      product_id: r.product_id,
      times_selected: Number(r.selections),
      times_considered: Number(r.considerations),
      avg_match_score: r.avg_score ? Number(r.avg_score) : null,
      avg_price: r.avg_price ? Number(r.avg_price) : null,
    })),
    what_matters_most: decisionFactors.rows.map((r) => r.deciding_factor),
    common_requirements: commonConstraints.rows.map((r) => r.value),
  };
}

export async function getMerchantReliability(merchantId: string) {
  const [evalStats, stockAccuracy, outcomeStats, priceStats] =
    await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS total_evaluations,
           COUNT(*) FILTER (WHERE disposition = 'selected') AS times_selected,
           COUNT(*) FILTER (WHERE disposition = 'rejected') AS times_rejected,
           ROUND(AVG(match_score), 2) AS avg_match_score
         FROM product_evaluations
         WHERE merchant_id = $1`,
        [merchantId]
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE in_stock = true) AS in_stock_count,
           COUNT(*) FILTER (WHERE in_stock = false) AS out_of_stock_count
         FROM product_evaluations
         WHERE merchant_id = $1`,
        [merchantId]
      ),
      pool.query(
        `SELECT o.outcome_type, COUNT(*) AS count
         FROM outcomes o
         JOIN product_evaluations e ON e.session_id = o.session_id
           AND e.product_id = o.product_chosen_id
         WHERE e.merchant_id = $1
         GROUP BY o.outcome_type
         ORDER BY count DESC`,
        [merchantId]
      ),
      pool.query(
        `SELECT e.product_id,
                ROUND(AVG(e.price_at_time), 2) AS avg_price,
                COUNT(*) AS listings
         FROM product_evaluations e
         WHERE e.merchant_id = $1 AND e.price_at_time IS NOT NULL
         GROUP BY e.product_id
         ORDER BY listings DESC
         LIMIT 10`,
        [merchantId]
      ),
    ]);

  const row = evalStats.rows[0];
  const total = Number(row.total_evaluations);
  const selected = Number(row.times_selected);
  const stockTotal = Number(stockAccuracy.rows[0]?.total ?? 0);
  const inStock = Number(stockAccuracy.rows[0]?.in_stock_count ?? 0);

  return {
    merchant_id: merchantId,
    total_evaluations: total,
    selection_rate: total > 0 ? Math.round((selected / total) * 100) / 100 : null,
    avg_match_score: row.avg_match_score ? Number(row.avg_match_score) : null,
    stock_reliability: stockTotal > 0 ? Math.round((inStock / stockTotal) * 100) / 100 : null,
    outcomes_from_this_merchant: outcomeStats.rows.map((r) => ({
      type: r.outcome_type,
      count: Number(r.count),
    })),
    top_products: priceStats.rows.map((r) => ({
      product_id: r.product_id,
      avg_price: Number(r.avg_price),
      times_listed: Number(r.listings),
    })),
  };
}

// ── Differentiator Queries ──

/**
 * Cross-agent learning: find sessions with similar category/constraints and
 * return what those agents ended up selecting.
 */
export async function getSimilarSessionOutcomes(
  category: string,
  constraints: string[],
  budgetMax?: number
) {
  // Find sessions in the same category that share at least one constraint
  const constraintFilter = constraints.length > 0
    ? `AND s.constraints ?| $2::text[]`
    : "";
  const budgetFilter = budgetMax
    ? `AND (s.budget_max IS NULL OR s.budget_max <= ${Number(budgetMax)} * 1.2)`
    : "";

  const params: (string | string[])[] = [category];
  if (constraints.length > 0) params.push(constraints);

  const [matchingSessions, topSelections, commonPatterns] = await Promise.all([
    // Count how many similar sessions exist
    pool.query(
      `SELECT COUNT(DISTINCT s.session_id) AS total,
              COUNT(DISTINCT o.session_id) FILTER (WHERE o.outcome_type = 'purchased') AS purchased,
              COUNT(DISTINCT o.session_id) FILTER (WHERE o.outcome_type = 'recommended') AS recommended,
              COUNT(DISTINCT o.session_id) FILTER (WHERE o.outcome_type = 'abandoned') AS abandoned
       FROM shopping_sessions s
       LEFT JOIN outcomes o ON o.session_id = s.session_id
       WHERE ${CAT_MATCH} ${constraintFilter} ${budgetFilter}`,
      params
    ),
    // What products did similar sessions select?
    pool.query(
      `SELECT e.product_id,
              COUNT(*) AS times_selected,
              ROUND(AVG(e.match_score), 2) AS avg_score,
              ROUND(AVG(e.price_at_time), 2) AS avg_price,
              MODE() WITHIN GROUP (ORDER BY e.merchant_id) AS common_merchant
       FROM product_evaluations e
       JOIN shopping_sessions s ON s.session_id = e.session_id
       WHERE ${CAT_MATCH} ${constraintFilter} ${budgetFilter}
         AND e.disposition = 'selected'
       GROUP BY e.product_id
       ORDER BY times_selected DESC
       LIMIT 5`,
      params
    ),
    // What deciding factors mattered in similar sessions?
    pool.query(
      `SELECT c.deciding_factor, COUNT(*) AS count
       FROM comparisons c
       JOIN shopping_sessions s ON s.session_id = c.session_id
       WHERE ${CAT_MATCH} ${constraintFilter} ${budgetFilter}
       GROUP BY c.deciding_factor
       ORDER BY count DESC
       LIMIT 5`,
      params
    ),
  ]);

  const stats = matchingSessions.rows[0];
  return {
    similar_sessions_found: Number(stats?.total ?? 0),
    outcome_distribution: {
      purchased: Number(stats?.purchased ?? 0),
      recommended: Number(stats?.recommended ?? 0),
      abandoned: Number(stats?.abandoned ?? 0),
    },
    what_agents_chose: topSelections.rows.map((r) => ({
      product_id: r.product_id,
      times_selected: Number(r.times_selected),
      avg_match_score: r.avg_score ? Number(r.avg_score) : null,
      avg_price: r.avg_price ? Number(r.avg_price) : null,
      common_merchant: r.common_merchant,
    })),
    deciding_factors: commonPatterns.rows.map((r) => r.deciding_factor),
  };
}

/**
 * Deal detection: compare a given price against historical price data.
 */
export async function detectDeal(productId: string, currentPrice: number) {
  const [priceHistory, merchantPrices] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS total_sightings,
         ROUND(AVG(price_at_time), 2) AS avg_price,
         MIN(price_at_time) AS lowest_seen,
         MAX(price_at_time) AS highest_seen,
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_at_time) AS p25,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_at_time) AS median,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_at_time) AS p75
       FROM product_evaluations
       WHERE product_id = $1 AND price_at_time IS NOT NULL`,
      [productId]
    ),
    pool.query(
      `SELECT merchant_id,
              ROUND(AVG(price_at_time), 2) AS avg_price,
              MIN(price_at_time) AS best_price,
              COUNT(*) AS sightings
       FROM product_evaluations
       WHERE product_id = $1 AND price_at_time IS NOT NULL
       GROUP BY merchant_id
       ORDER BY avg_price ASC
       LIMIT 5`,
      [productId]
    ),
  ]);

  const h = priceHistory.rows[0];
  if (!h || Number(h.total_sightings) === 0) {
    return {
      product_id: productId,
      current_price: currentPrice,
      verdict: "unknown",
      message: "No price history available for this product.",
    };
  }

  const avg = Number(h.avg_price);
  const lowest = Number(h.lowest_seen);
  const median = Number(h.median);
  const savings = Math.round((avg - currentPrice) * 100) / 100;
  const pctBelow = Math.round(((avg - currentPrice) / avg) * 100);

  let verdict: string;
  if (currentPrice <= lowest) verdict = "best_price_ever";
  else if (currentPrice <= Number(h.p25)) verdict = "great_deal";
  else if (currentPrice <= median) verdict = "good_deal";
  else if (currentPrice <= Number(h.p75)) verdict = "fair_price";
  else verdict = "above_average";

  return {
    product_id: productId,
    current_price: currentPrice,
    verdict,
    savings_vs_avg: savings,
    pct_below_avg: pctBelow,
    price_history: {
      avg: avg,
      median: median,
      lowest_seen: lowest,
      highest_seen: Number(h.highest_seen),
      total_sightings: Number(h.total_sightings),
    },
    cheapest_merchants: merchantPrices.rows.map((r) => ({
      merchant_id: r.merchant_id,
      avg_price: Number(r.avg_price),
      best_price: Number(r.best_price),
      sightings: Number(r.sightings),
    })),
  };
}

/**
 * Failure prevention: surface recent problems with a product or merchant
 * (stock issues, high rejection rates, abandonment signals).
 */
export async function getRecentWarnings(productId?: string, merchantId?: string) {
  const warnings: { type: string; severity: string; message: string; data?: Record<string, unknown> }[] = [];

  if (productId) {
    // Check recent rejection rate
    const recentEvals = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE disposition = 'rejected') AS rejected,
         COUNT(*) FILTER (WHERE in_stock = false) AS out_of_stock
       FROM product_evaluations
       WHERE product_id = $1
         AND created_at > NOW() - INTERVAL '7 days'`,
      [productId]
    );
    const r = recentEvals.rows[0];
    const total = Number(r.total);
    const rejected = Number(r.rejected);
    const oos = Number(r.out_of_stock);

    if (total > 0 && rejected / total > 0.6) {
      const reasons = await pool.query(
        `SELECT rejection_reason, COUNT(*) AS count
         FROM product_evaluations
         WHERE product_id = $1 AND disposition = 'rejected'
           AND rejection_reason IS NOT NULL
           AND created_at > NOW() - INTERVAL '7 days'
         GROUP BY rejection_reason ORDER BY count DESC LIMIT 3`,
        [productId]
      );
      warnings.push({
        type: "high_rejection_rate",
        severity: "warning",
        message: `${Math.round((rejected / total) * 100)}% rejection rate in the last 7 days (${rejected}/${total} evaluations)`,
        data: { reasons: reasons.rows.map((row) => row.rejection_reason) },
      });
    }

    if (oos > 0) {
      warnings.push({
        type: "stock_issues",
        severity: oos / total > 0.3 ? "critical" : "info",
        message: `${oos} out of ${total} recent evaluations found this product out of stock`,
      });
    }

    // Check abandonment rate when this product was chosen
    const abandonments = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE o.outcome_type = 'abandoned') AS abandoned
       FROM outcomes o
       JOIN product_evaluations e ON e.session_id = o.session_id
       WHERE e.product_id = $1 AND e.disposition = 'selected'`,
      [productId]
    );
    const ab = abandonments.rows[0];
    const abTotal = Number(ab.total);
    const abCount = Number(ab.abandoned);
    if (abTotal > 2 && abCount / abTotal > 0.3) {
      warnings.push({
        type: "high_abandonment",
        severity: "warning",
        message: `${Math.round((abCount / abTotal) * 100)}% of sessions selecting this product ended in abandonment`,
      });
    }
  }

  if (merchantId) {
    // Check merchant stock reliability
    const stockCheck = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE in_stock = false) AS oos
       FROM product_evaluations
       WHERE merchant_id = $1
         AND created_at > NOW() - INTERVAL '7 days'`,
      [merchantId]
    );
    const s = stockCheck.rows[0];
    const sTotal = Number(s.total);
    const sOos = Number(s.oos);
    if (sTotal > 0 && sOos / sTotal > 0.2) {
      warnings.push({
        type: "merchant_stock_unreliable",
        severity: "warning",
        message: `${Math.round((sOos / sTotal) * 100)}% out-of-stock rate at ${merchantId} in the last 7 days`,
      });
    }

    // Check merchant rejection rate
    const merchantRejects = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE disposition = 'rejected') AS rejected
       FROM product_evaluations
       WHERE merchant_id = $1
         AND created_at > NOW() - INTERVAL '7 days'`,
      [merchantId]
    );
    const mr = merchantRejects.rows[0];
    const mrTotal = Number(mr.total);
    const mrRejected = Number(mr.rejected);
    if (mrTotal > 3 && mrRejected / mrTotal > 0.5) {
      warnings.push({
        type: "merchant_high_rejection",
        severity: "warning",
        message: `${Math.round((mrRejected / mrTotal) * 100)}% of products from ${merchantId} were rejected recently`,
      });
    }
  }

  return {
    product_id: productId ?? null,
    merchant_id: merchantId ?? null,
    warnings,
    all_clear: warnings.length === 0,
  };
}

/**
 * Decision shortcuts: match on exact constraints and return what worked
 * for agents with the same requirements.
 */
export async function getConstraintMatch(
  category: string,
  constraints: string[],
  budgetMax?: number
) {
  if (constraints.length === 0) {
    return { message: "Provide at least one constraint for matching." };
  }

  // Find sessions that contain ALL of the given constraints
  const budgetFilter = budgetMax
    ? `AND (s.budget_max IS NULL OR s.budget_max >= ${Number(budgetMax) * 0.8})`
    : "";

  const [exactMatches, partialMatches] = await Promise.all([
    // Sessions matching ALL constraints
    pool.query(
      `SELECT s.session_id, s.raw_query, s.budget_max, s.constraints,
              o.outcome_type, o.product_chosen_id, o.reason,
              e.product_id, e.price_at_time, e.match_score, e.merchant_id
       FROM shopping_sessions s
       JOIN outcomes o ON o.session_id = s.session_id
       LEFT JOIN product_evaluations e ON e.session_id = s.session_id AND e.disposition = 'selected'
       WHERE ${CAT_MATCH}
         AND s.constraints @> $2::jsonb
         ${budgetFilter}
       ORDER BY s.created_at DESC
       LIMIT 20`,
      [category, JSON.stringify(constraints)]
    ),
    // Sessions matching ANY constraint (broader pool for aggregation)
    pool.query(
      `SELECT e.product_id,
              COUNT(*) FILTER (WHERE e.disposition = 'selected') AS selections,
              COUNT(*) AS considerations,
              ROUND(AVG(e.match_score), 2) AS avg_score,
              ROUND(AVG(e.price_at_time), 2) AS avg_price,
              array_agg(DISTINCT e.merchant_id) FILTER (WHERE e.disposition = 'selected') AS merchants
       FROM product_evaluations e
       JOIN shopping_sessions s ON s.session_id = e.session_id
       WHERE ${CAT_MATCH}
         AND s.constraints ?| $2::text[]
         ${budgetFilter}
       GROUP BY e.product_id
       HAVING COUNT(*) FILTER (WHERE e.disposition = 'selected') > 0
       ORDER BY selections DESC
       LIMIT 5`,
      [category, constraints]
    ),
  ]);

  // Deduplicate and summarize exact matches
  const exactResults = new Map<string, {
    product_id: string;
    times_chosen: number;
    outcomes: string[];
    avg_price: number | null;
    avg_score: number | null;
    reasons: string[];
    merchants: Set<string>;
  }>();

  for (const row of exactMatches.rows) {
    if (!row.product_chosen_id) continue;
    const existing = exactResults.get(row.product_chosen_id);
    if (existing) {
      existing.times_chosen++;
      if (row.outcome_type && !existing.outcomes.includes(row.outcome_type))
        existing.outcomes.push(row.outcome_type);
      if (row.reason && !existing.reasons.includes(row.reason))
        existing.reasons.push(row.reason);
      if (row.merchant_id) existing.merchants.add(row.merchant_id);
    } else {
      exactResults.set(row.product_chosen_id, {
        product_id: row.product_chosen_id,
        times_chosen: 1,
        outcomes: row.outcome_type ? [row.outcome_type] : [],
        avg_price: row.price_at_time ? Number(row.price_at_time) : null,
        avg_score: row.match_score ? Number(row.match_score) : null,
        reasons: row.reason ? [row.reason] : [],
        merchants: new Set(row.merchant_id ? [row.merchant_id] : []),
      });
    }
  }

  const shortcut = Array.from(exactResults.values())
    .sort((a, b) => b.times_chosen - a.times_chosen)
    .slice(0, 3)
    .map((r) => ({
      product_id: r.product_id,
      times_chosen: r.times_chosen,
      outcomes: r.outcomes,
      avg_price: r.avg_price,
      avg_match_score: r.avg_score,
      reasons: r.reasons.slice(0, 3),
      available_at: Array.from(r.merchants),
    }));

  return {
    category,
    constraints_matched: constraints,
    budget_max: budgetMax ?? null,
    exact_constraint_matches: shortcut.length,
    recommended_products: shortcut,
    broader_recommendations: partialMatches.rows.map((r) => ({
      product_id: r.product_id,
      times_selected: Number(r.selections),
      times_considered: Number(r.considerations),
      avg_match_score: r.avg_score ? Number(r.avg_score) : null,
      avg_price: r.avg_price ? Number(r.avg_price) : null,
      available_at: r.merchants?.filter(Boolean) ?? [],
    })),
  };
}

// ── Seller Intelligence ──

export async function getCompetitiveLandscape(productId: string) {
  const [productStats, headToHead, categoryContext, pricePosition] =
    await Promise.all([
      // How this product performs overall
      pool.query(
        `SELECT
           COUNT(*) AS times_considered,
           COUNT(*) FILTER (WHERE disposition = 'selected') AS times_selected,
           COUNT(*) FILTER (WHERE disposition = 'rejected') AS times_rejected,
           COUNT(*) FILTER (WHERE disposition = 'shortlisted') AS times_shortlisted,
           ROUND(AVG(match_score), 2) AS avg_match_score,
           ROUND(AVG(price_at_time), 2) AS avg_price
         FROM product_evaluations
         WHERE product_id = $1`,
        [productId]
      ),
      // Head-to-head comparison results
      pool.query(
        `SELECT
           c.winner_product_id,
           COUNT(*) AS wins,
           ARRAY_AGG(DISTINCT c.deciding_factor) AS deciding_factors
         FROM comparisons c
         WHERE $1 = ANY(SELECT jsonb_array_elements_text(c.products_compared))
         GROUP BY c.winner_product_id
         ORDER BY wins DESC
         LIMIT 10`,
        [productId]
      ),
      // Category-level context: where does this product rank?
      pool.query(
        `WITH product_cat AS (
           SELECT DISTINCT s.category
           FROM product_evaluations e
           JOIN shopping_sessions s ON s.session_id = e.session_id
           WHERE e.product_id = $1
           LIMIT 1
         )
         SELECT e.product_id,
                COUNT(*) FILTER (WHERE e.disposition = 'selected') AS selections,
                COUNT(*) AS considerations,
                ROUND(AVG(e.price_at_time), 2) AS avg_price
         FROM product_evaluations e
         JOIN shopping_sessions s ON s.session_id = e.session_id
         WHERE s.category = (SELECT category FROM product_cat)
         GROUP BY e.product_id
         ORDER BY selections DESC
         LIMIT 15`,
        [productId]
      ),
      // Price comparison vs competitors in same sessions
      pool.query(
        `WITH same_sessions AS (
           SELECT DISTINCT session_id FROM product_evaluations WHERE product_id = $1
         )
         SELECT e.product_id,
                ROUND(AVG(e.price_at_time), 2) AS avg_price,
                COUNT(*) FILTER (WHERE e.disposition = 'selected') AS times_selected
         FROM product_evaluations e
         WHERE e.session_id IN (SELECT session_id FROM same_sessions)
           AND e.product_id != $1
           AND e.price_at_time IS NOT NULL
         GROUP BY e.product_id
         ORDER BY times_selected DESC
         LIMIT 10`,
        [productId]
      ),
    ]);

  const stats = productStats.rows[0];
  const considered = Number(stats?.times_considered ?? 0);
  const selected = Number(stats?.times_selected ?? 0);

  // Calculate win rate in head-to-head
  const totalComparisons = headToHead.rows.reduce((sum, r) => sum + Number(r.wins), 0);
  const myWins = headToHead.rows.find((r) => r.winner_product_id === productId);
  const myWinCount = myWins ? Number(myWins.wins) : 0;

  // Find rank in category
  const rank = categoryContext.rows.findIndex((r) => r.product_id === productId) + 1;

  return {
    product_id: productId,
    performance: {
      times_considered: considered,
      times_selected: selected,
      times_rejected: Number(stats?.times_rejected ?? 0),
      selection_rate: considered > 0 ? Math.round((selected / considered) * 100) : 0,
      avg_match_score: stats?.avg_match_score ? Number(stats.avg_match_score) : null,
      avg_price: stats?.avg_price ? Number(stats.avg_price) : null,
    },
    competitive_position: {
      category_rank: rank || null,
      category_total_products: categoryContext.rows.length,
      head_to_head_win_rate: totalComparisons > 0
        ? Math.round((myWinCount / totalComparisons) * 100)
        : null,
      total_comparisons: totalComparisons,
    },
    losses_to: headToHead.rows
      .filter((r) => r.winner_product_id !== productId)
      .map((r) => ({
        product_id: r.winner_product_id,
        times_lost: Number(r.wins),
        lost_because: r.deciding_factors,
      })),
    price_vs_competitors: pricePosition.rows.map((r) => ({
      product_id: r.product_id,
      avg_price: Number(r.avg_price),
      times_selected: Number(r.times_selected),
    })),
  };
}

export async function getRejectionAnalysis(productId: string) {
  const [rejectionBreakdown, rejectionTrend, rejectedVsSelected, merchantBreakdown] =
    await Promise.all([
      // Rejection reasons with counts
      pool.query(
        `SELECT rejection_reason, COUNT(*) AS count,
                ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
         FROM product_evaluations
         WHERE product_id = $1 AND disposition = 'rejected' AND rejection_reason IS NOT NULL
         GROUP BY rejection_reason
         ORDER BY count DESC`,
        [productId]
      ),
      // Rejection rate over time (last 4 weeks, weekly)
      pool.query(
        `SELECT
           DATE_TRUNC('week', e.created_at) AS week,
           COUNT(*) AS total_evals,
           COUNT(*) FILTER (WHERE e.disposition = 'rejected') AS rejections,
           ROUND(COUNT(*) FILTER (WHERE e.disposition = 'rejected')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS rejection_rate
         FROM product_evaluations e
         WHERE e.product_id = $1
           AND e.created_at > NOW() - INTERVAL '28 days'
         GROUP BY DATE_TRUNC('week', e.created_at)
         ORDER BY week DESC`,
        [productId]
      ),
      // When rejected, what won instead?
      pool.query(
        `WITH rejected_sessions AS (
           SELECT session_id FROM product_evaluations
           WHERE product_id = $1 AND disposition = 'rejected'
         )
         SELECT e.product_id AS winner,
                COUNT(*) AS times_chosen_instead,
                ROUND(AVG(e.price_at_time), 2) AS winner_avg_price,
                ROUND(AVG(e.match_score), 2) AS winner_avg_score
         FROM product_evaluations e
         WHERE e.session_id IN (SELECT session_id FROM rejected_sessions)
           AND e.disposition = 'selected'
           AND e.product_id != $1
         GROUP BY e.product_id
         ORDER BY times_chosen_instead DESC
         LIMIT 5`,
        [productId]
      ),
      // Rejection rate by merchant
      pool.query(
        `SELECT merchant_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE disposition = 'rejected') AS rejections,
                ROUND(COUNT(*) FILTER (WHERE disposition = 'rejected')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS rejection_rate
         FROM product_evaluations
         WHERE product_id = $1 AND merchant_id IS NOT NULL
         GROUP BY merchant_id
         ORDER BY rejection_rate DESC`,
        [productId]
      ),
    ]);

  const totalRejections = rejectionBreakdown.rows.reduce((sum, r) => sum + Number(r.count), 0);

  return {
    product_id: productId,
    total_rejections: totalRejections,
    rejection_reasons: rejectionBreakdown.rows.map((r) => ({
      reason: r.rejection_reason,
      count: Number(r.count),
      pct_of_rejections: Number(r.pct),
    })),
    weekly_trend: rejectionTrend.rows.map((r) => ({
      week: r.week,
      total_evaluations: Number(r.total_evals),
      rejections: Number(r.rejections),
      rejection_rate_pct: Number(r.rejection_rate),
    })),
    replaced_by: rejectedVsSelected.rows.map((r) => ({
      product_id: r.winner,
      times_chosen_instead: Number(r.times_chosen_instead),
      avg_price: r.winner_avg_price ? Number(r.winner_avg_price) : null,
      avg_match_score: r.winner_avg_score ? Number(r.winner_avg_score) : null,
    })),
    rejection_by_merchant: merchantBreakdown.rows.map((r) => ({
      merchant_id: r.merchant_id,
      total_evaluations: Number(r.total),
      rejections: Number(r.rejections),
      rejection_rate_pct: Number(r.rejection_rate),
    })),
  };
}

export async function getCategoryDemand(category: string) {
  const [demandSignals, unmetNeeds, budgetDistribution, outcomePatterns, topProducts] =
    await Promise.all([
      // What constraints/features are agents searching for?
      pool.query(
        `SELECT value AS constraint, COUNT(*) AS demand_count
         FROM shopping_sessions,
              jsonb_array_elements_text(constraints) AS value
         WHERE ${CAT_MATCH_BARE}
         GROUP BY value
         ORDER BY demand_count DESC
         LIMIT 15`,
        [category]
      ),
      // Constraints in abandoned sessions (unmet needs)
      pool.query(
        `SELECT value AS constraint, COUNT(*) AS unmet_count
         FROM shopping_sessions s
         JOIN outcomes o ON o.session_id = s.session_id
         CROSS JOIN jsonb_array_elements_text(s.constraints) AS value
         WHERE ${CAT_MATCH} AND o.outcome_type = 'abandoned'
         GROUP BY value
         ORDER BY unmet_count DESC
         LIMIT 10`,
        [category]
      ),
      // Budget distribution
      pool.query(
        `SELECT
           COUNT(*) AS total_sessions,
           ROUND(AVG(budget_max), 2) AS avg_budget,
           MIN(budget_max) AS min_budget,
           MAX(budget_max) AS max_budget,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY budget_max) AS p25,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY budget_max) AS median,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY budget_max) AS p75
         FROM shopping_sessions
         WHERE ${CAT_MATCH_BARE} AND budget_max IS NOT NULL`,
        [category]
      ),
      // Outcome distribution
      pool.query(
        `SELECT o.outcome_type, COUNT(*) AS count,
                ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
         FROM outcomes o
         JOIN shopping_sessions s ON s.session_id = o.session_id
         WHERE ${CAT_MATCH}
         GROUP BY o.outcome_type
         ORDER BY count DESC`,
        [category]
      ),
      // Most demanded products (by consideration count)
      pool.query(
        `SELECT e.product_id,
                COUNT(*) AS times_considered,
                COUNT(*) FILTER (WHERE e.disposition = 'selected') AS times_selected,
                ROUND(AVG(e.price_at_time), 2) AS avg_price,
                ROUND(AVG(e.match_score), 2) AS avg_score
         FROM product_evaluations e
         JOIN shopping_sessions s ON s.session_id = e.session_id
         WHERE ${CAT_MATCH}
         GROUP BY e.product_id
         ORDER BY times_considered DESC
         LIMIT 10`,
        [category]
      ),
    ]);

  const budget = budgetDistribution.rows[0];

  return {
    category,
    total_sessions: Number(budget?.total_sessions ?? 0),
    what_agents_want: demandSignals.rows.map((r) => ({
      constraint: r.constraint,
      demand_count: Number(r.demand_count),
    })),
    unmet_needs: unmetNeeds.rows.map((r) => ({
      constraint: r.constraint,
      abandoned_sessions: Number(r.unmet_count),
    })),
    budget_distribution: budget?.avg_budget ? {
      avg: Number(budget.avg_budget),
      median: budget.median ? Number(budget.median) : null,
      p25: budget.p25 ? Number(budget.p25) : null,
      p75: budget.p75 ? Number(budget.p75) : null,
      min: Number(budget.min_budget),
      max: Number(budget.max_budget),
    } : null,
    outcome_rates: outcomePatterns.rows.map((r) => ({
      outcome: r.outcome_type,
      count: Number(r.count),
      pct: Number(r.pct),
    })),
    top_products: topProducts.rows.map((r) => ({
      product_id: r.product_id,
      times_considered: Number(r.times_considered),
      times_selected: Number(r.times_selected),
      selection_rate: Number(r.times_considered) > 0
        ? Math.round((Number(r.times_selected) / Number(r.times_considered)) * 100)
        : 0,
      avg_price: r.avg_price ? Number(r.avg_price) : null,
      avg_match_score: r.avg_score ? Number(r.avg_score) : null,
    })),
  };
}

export async function getMerchantScorecard(merchantId: string) {
  const [overview, categoryBreakdown, stockIssues, priceCompetitiveness, topProducts] =
    await Promise.all([
      // Overall merchant stats
      pool.query(
        `SELECT
           COUNT(*) AS total_evaluations,
           COUNT(*) FILTER (WHERE disposition = 'selected') AS selections,
           COUNT(*) FILTER (WHERE disposition = 'rejected') AS rejections,
           COUNT(DISTINCT product_id) AS unique_products,
           COUNT(DISTINCT e.session_id) AS sessions_appeared_in,
           ROUND(AVG(match_score), 2) AS avg_match_score,
           ROUND(AVG(price_at_time), 2) AS avg_price
         FROM product_evaluations e
         WHERE merchant_id = $1`,
        [merchantId]
      ),
      // Performance by category
      pool.query(
        `SELECT s.category,
                COUNT(*) AS evaluations,
                COUNT(*) FILTER (WHERE e.disposition = 'selected') AS selections,
                ROUND(COUNT(*) FILTER (WHERE e.disposition = 'selected')::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS selection_rate
         FROM product_evaluations e
         JOIN shopping_sessions s ON s.session_id = e.session_id
         WHERE e.merchant_id = $1
         GROUP BY s.category
         ORDER BY evaluations DESC`,
        [merchantId]
      ),
      // Stock reliability
      pool.query(
        `SELECT
           COUNT(*) AS total_checks,
           COUNT(*) FILTER (WHERE in_stock = false) AS out_of_stock,
           ROUND(COUNT(*) FILTER (WHERE in_stock = false)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS oos_rate
         FROM product_evaluations
         WHERE merchant_id = $1`,
        [merchantId]
      ),
      // Price competitiveness: how often is this merchant the cheapest?
      pool.query(
        `WITH merchant_prices AS (
           SELECT e.session_id, e.product_id, e.price_at_time,
                  RANK() OVER (PARTITION BY e.session_id, e.product_id ORDER BY e.price_at_time ASC) AS price_rank
           FROM product_evaluations e
           WHERE e.price_at_time IS NOT NULL
             AND e.session_id IN (SELECT DISTINCT session_id FROM product_evaluations WHERE merchant_id = $1)
         )
         SELECT
           COUNT(*) FILTER (WHERE merchant_id = $1) AS total_price_comparisons,
           COUNT(*) FILTER (WHERE merchant_id = $1 AND price_rank = 1) AS times_cheapest
         FROM merchant_prices mp
         JOIN product_evaluations e ON e.session_id = mp.session_id AND e.product_id = mp.product_id AND e.price_at_time = mp.price_at_time`,
        [merchantId]
      ),
      // Best performing products at this merchant
      pool.query(
        `SELECT product_id,
                COUNT(*) AS evaluations,
                COUNT(*) FILTER (WHERE disposition = 'selected') AS selections,
                ROUND(AVG(price_at_time), 2) AS avg_price
         FROM product_evaluations
         WHERE merchant_id = $1
         GROUP BY product_id
         ORDER BY selections DESC
         LIMIT 10`,
        [merchantId]
      ),
    ]);

  const stats = overview.rows[0];
  const totalEvals = Number(stats?.total_evaluations ?? 0);
  const selections = Number(stats?.selections ?? 0);
  const stock = stockIssues.rows[0];

  return {
    merchant_id: merchantId,
    overview: {
      total_evaluations: totalEvals,
      selection_rate: totalEvals > 0 ? Math.round((selections / totalEvals) * 100) : 0,
      unique_products: Number(stats?.unique_products ?? 0),
      sessions_appeared_in: Number(stats?.sessions_appeared_in ?? 0),
      avg_match_score: stats?.avg_match_score ? Number(stats.avg_match_score) : null,
    },
    stock_reliability: {
      total_checks: Number(stock?.total_checks ?? 0),
      out_of_stock_rate: Number(stock?.oos_rate ?? 0),
    },
    price_competitiveness: {
      total_comparisons: Number(priceCompetitiveness.rows[0]?.total_price_comparisons ?? 0),
      times_cheapest: Number(priceCompetitiveness.rows[0]?.times_cheapest ?? 0),
    },
    performance_by_category: categoryBreakdown.rows.map((r) => ({
      category: r.category,
      evaluations: Number(r.evaluations),
      selections: Number(r.selections),
      selection_rate: Number(r.selection_rate),
    })),
    top_products: topProducts.rows.map((r) => ({
      product_id: r.product_id,
      evaluations: Number(r.evaluations),
      selections: Number(r.selections),
      avg_price: r.avg_price ? Number(r.avg_price) : null,
    })),
  };
}

// ── Network stats (fallback for empty results) ──

export async function getNetworkStats() {
  const [categories, totals] = await Promise.all([
    pool.query(
      `SELECT category, COUNT(*) AS sessions
       FROM shopping_sessions
       WHERE category IS NOT NULL
       GROUP BY category
       ORDER BY sessions DESC`
    ),
    pool.query(
      `SELECT
         COUNT(DISTINCT s.session_id) AS total_sessions,
         COUNT(DISTINCT e.product_id) AS total_products,
         COUNT(DISTINCT e.merchant_id) FILTER (WHERE e.merchant_id IS NOT NULL) AS total_merchants
       FROM shopping_sessions s
       LEFT JOIN product_evaluations e ON e.session_id = s.session_id`
    ),
  ]);

  return {
    total_sessions: Number(totals.rows[0]?.total_sessions ?? 0),
    total_products: Number(totals.rows[0]?.total_products ?? 0),
    total_merchants: Number(totals.rows[0]?.total_merchants ?? 0),
    categories: categories.rows.map((r) => ({
      category: r.category,
      sessions: Number(r.sessions),
    })),
  };
}

// ── Category miss tracking ──

export async function logCategoryMiss(category: string, agentPlatform?: string, queryContext?: string) {
  await pool.query(
    `INSERT INTO category_misses (category, agent_platform, query_context)
     VALUES ($1, $2, $3)`,
    [category, agentPlatform ?? null, queryContext ?? null]
  );
}

// ── Subcategory breakdown ──

export async function getSubcategoryBreakdown(category: string) {
  const result = await pool.query(
    `SELECT s.category AS subcategory,
            COUNT(DISTINCT s.session_id) AS sessions,
            COUNT(DISTINCT e.product_id) AS products,
            ROUND(AVG(s.budget_max), 2) AS avg_budget
     FROM shopping_sessions s
     LEFT JOIN product_evaluations e ON e.session_id = s.session_id
     WHERE s.category LIKE $1 || '/%'
     GROUP BY s.category
     ORDER BY sessions DESC`,
    [category]
  );
  return result.rows.map((r) => ({
    subcategory: r.subcategory,
    sessions: Number(r.sessions),
    products: Number(r.products),
    avg_budget: r.avg_budget ? Number(r.avg_budget) : null,
  }));
}

// ── Trending products ──

export async function getTrendingProducts(category?: string, days = 7) {
  const catFilter = category
    ? `AND ${CAT_MATCH}`
    : "";
  const params: (string | number)[] = [days];
  if (category) params.push(category);
  // Current period vs previous period
  const [current, previous] = await Promise.all([
    pool.query(
      `SELECT e.product_id,
              COUNT(*) FILTER (WHERE e.disposition = 'selected') AS selections,
              COUNT(*) AS considerations,
              ROUND(AVG(e.match_score), 2) AS avg_score,
              ROUND(AVG(e.price_at_time), 2) AS avg_price
       FROM product_evaluations e
       JOIN shopping_sessions s ON s.session_id = e.session_id
       WHERE e.created_at > NOW() - MAKE_INTERVAL(days => $1::int)
         ${category ? `AND (s.category = $2 OR s.category LIKE $2 || '/%')` : ""}
       GROUP BY e.product_id
       ORDER BY selections DESC
       LIMIT 15`,
      params
    ),
    pool.query(
      `SELECT e.product_id,
              COUNT(*) FILTER (WHERE e.disposition = 'selected') AS selections,
              COUNT(*) AS considerations
       FROM product_evaluations e
       JOIN shopping_sessions s ON s.session_id = e.session_id
       WHERE e.created_at BETWEEN NOW() - MAKE_INTERVAL(days => ($1::int * 2))
                               AND NOW() - MAKE_INTERVAL(days => $1::int)
         ${category ? `AND (s.category = $2 OR s.category LIKE $2 || '/%')` : ""}
       GROUP BY e.product_id`,
      params
    ),
  ]);

  const prevMap = new Map(previous.rows.map((r) => [r.product_id, Number(r.selections)]));

  return current.rows.map((r) => {
    const prevSelections = prevMap.get(r.product_id) || 0;
    const currSelections = Number(r.selections);
    const trend = prevSelections > 0
      ? Math.round(((currSelections - prevSelections) / prevSelections) * 100)
      : currSelections > 0 ? 100 : 0; // new entry = 100% growth

    return {
      product_id: r.product_id,
      selections_this_period: currSelections,
      selections_last_period: prevSelections,
      trend_pct: trend,
      considerations: Number(r.considerations),
      avg_match_score: r.avg_score ? Number(r.avg_score) : null,
      avg_price: r.avg_price ? Number(r.avg_price) : null,
    };
  });
}

// ── Price alerts (store and check) ──

export async function createPriceAlert(productId: string, targetPrice: number, agentPlatform?: string) {
  const result = await pool.query(
    `INSERT INTO price_alerts (product_id, target_price, agent_platform)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [productId, targetPrice, agentPlatform ?? "unknown"]
  );
  return result.rows[0];
}

export async function checkPriceAlerts(productId?: string) {
  // Get all active alerts, optionally filtered by product
  const filter = productId ? `AND pa.product_id = $1` : "";
  const params = productId ? [productId] : [];

  const result = await pool.query(
    `SELECT pa.id, pa.product_id, pa.target_price, pa.agent_platform, pa.created_at,
            MIN(e.price_at_time) AS current_lowest_price,
            MIN(e.merchant_id) FILTER (WHERE e.price_at_time = sub.min_price) AS cheapest_merchant
     FROM price_alerts pa
     LEFT JOIN LATERAL (
       SELECT MIN(price_at_time) AS min_price
       FROM product_evaluations
       WHERE product_id = pa.product_id
         AND price_at_time IS NOT NULL
         AND created_at > NOW() - INTERVAL '7 days'
     ) sub ON true
     LEFT JOIN product_evaluations e ON e.product_id = pa.product_id
       AND e.price_at_time = sub.min_price
       AND e.created_at > NOW() - INTERVAL '7 days'
     WHERE pa.active = true ${filter}
     GROUP BY pa.id, pa.product_id, pa.target_price, pa.agent_platform, pa.created_at, sub.min_price`,
    params
  );

  return result.rows.map((r) => ({
    alert_id: r.id,
    product_id: r.product_id,
    target_price: Number(r.target_price),
    current_lowest_price: r.current_lowest_price ? Number(r.current_lowest_price) : null,
    triggered: r.current_lowest_price ? Number(r.current_lowest_price) <= Number(r.target_price) : false,
    cheapest_merchant: r.cheapest_merchant,
    agent_platform: r.agent_platform,
    created_at: r.created_at,
  }));
}

export async function deactivatePriceAlert(alertId: number) {
  await pool.query(`UPDATE price_alerts SET active = false WHERE id = $1`, [alertId]);
}

// ── Budget-aware product search ──

export async function getBudgetProducts(category: string, budgetMax: number) {
  const [products, budgetStats] = await Promise.all([
    pool.query(
      `SELECT e.product_id,
              COUNT(*) FILTER (WHERE e.disposition = 'selected') AS selections,
              COUNT(*) AS considerations,
              ROUND(AVG(e.match_score), 2) AS avg_score,
              ROUND(MIN(e.price_at_time), 2) AS lowest_price,
              ROUND(AVG(e.price_at_time), 2) AS avg_price,
              ROUND(MAX(e.price_at_time), 2) AS highest_price,
              ARRAY_AGG(DISTINCT e.merchant_id) FILTER (WHERE e.price_at_time <= $2 AND e.merchant_id IS NOT NULL) AS merchants_under_budget
       FROM product_evaluations e
       JOIN shopping_sessions s ON s.session_id = e.session_id
       WHERE (s.category = $1 OR s.category LIKE $1 || '/%')
         AND e.price_at_time IS NOT NULL
         AND e.price_at_time <= $2
       GROUP BY e.product_id
       HAVING COUNT(*) FILTER (WHERE e.disposition = 'selected') > 0
       ORDER BY selections DESC, avg_score DESC
       LIMIT 15`,
      [category, budgetMax]
    ),
    pool.query(
      `SELECT
         COUNT(DISTINCT e.product_id) AS total_products_in_budget,
         COUNT(DISTINCT e.product_id) FILTER (WHERE e.disposition = 'selected') AS selectable_products,
         ROUND(AVG(e.price_at_time), 2) AS avg_price_in_range,
         COUNT(DISTINCT s.session_id) AS sessions_in_range
       FROM product_evaluations e
       JOIN shopping_sessions s ON s.session_id = e.session_id
       WHERE (s.category = $1 OR s.category LIKE $1 || '/%')
         AND e.price_at_time IS NOT NULL
         AND e.price_at_time <= $2`,
      [category, budgetMax]
    ),
  ]);

  const stats = budgetStats.rows[0];
  return {
    category,
    budget_max: budgetMax,
    products_in_budget: Number(stats?.total_products_in_budget ?? 0),
    sessions_in_range: Number(stats?.sessions_in_range ?? 0),
    avg_price_in_range: stats?.avg_price_in_range ? Number(stats.avg_price_in_range) : null,
    best_picks: products.rows.map((r) => ({
      product_id: r.product_id,
      times_selected: Number(r.selections),
      times_considered: Number(r.considerations),
      avg_match_score: r.avg_score ? Number(r.avg_score) : null,
      lowest_price: Number(r.lowest_price),
      avg_price: Number(r.avg_price),
      merchants_under_budget: r.merchants_under_budget?.filter(Boolean) ?? [],
    })),
  };
}

export async function getTopCategoryMisses(limit = 10) {
  const result = await pool.query(
    `SELECT category, COUNT(*) AS miss_count,
            COUNT(DISTINCT agent_platform) AS unique_agents,
            MAX(created_at) AS last_missed
     FROM category_misses
     WHERE created_at > NOW() - INTERVAL '30 days'
     GROUP BY category
     ORDER BY miss_count DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    category: r.category,
    miss_count: Number(r.miss_count),
    unique_agents: Number(r.unique_agents),
    last_missed: r.last_missed,
  }));
}

// ── Daily deals ──

export async function getTodaysDeals() {
  // Products with the best prices seen in the last 7 days vs their historical average
  const result = await pool.query(
    `WITH recent_prices AS (
       SELECT product_id, merchant_id, price_at_time,
              ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY price_at_time ASC) AS rn
       FROM product_evaluations
       WHERE price_at_time IS NOT NULL
         AND created_at > NOW() - INTERVAL '7 days'
     ),
     historical AS (
       SELECT product_id,
              ROUND(AVG(price_at_time), 2) AS avg_price,
              MIN(price_at_time) AS all_time_low,
              COUNT(*) AS total_sightings
       FROM product_evaluations
       WHERE price_at_time IS NOT NULL
       GROUP BY product_id
       HAVING COUNT(*) >= 3
     )
     SELECT r.product_id, r.merchant_id, r.price_at_time AS current_price,
            h.avg_price, h.all_time_low, h.total_sightings,
            ROUND((h.avg_price - r.price_at_time), 2) AS savings,
            ROUND(((h.avg_price - r.price_at_time) / h.avg_price * 100), 1) AS pct_off
     FROM recent_prices r
     JOIN historical h ON h.product_id = r.product_id
     WHERE r.rn = 1
       AND r.price_at_time < h.avg_price * 0.9
     ORDER BY pct_off DESC
     LIMIT 20`
  );

  return result.rows.map((r) => ({
    product_id: r.product_id,
    merchant_id: r.merchant_id,
    current_price: Number(r.current_price),
    avg_price: Number(r.avg_price),
    all_time_low: Number(r.all_time_low),
    savings: Number(r.savings),
    pct_off: Number(r.pct_off),
    is_all_time_low: Number(r.current_price) <= Number(r.all_time_low),
  }));
}

// ── Product search ──

export async function searchProducts(query: string, category?: string, limit = 15) {
  const catFilter = category
    ? `AND (s.category = $2 OR s.category LIKE $2 || '/%')`
    : "";
  const params: (string | number)[] = [`%${query.toLowerCase()}%`];
  if (category) params.push(category);

  const result = await pool.query(
    `SELECT e.product_id,
            COUNT(*) AS times_seen,
            COUNT(*) FILTER (WHERE e.disposition = 'selected') AS times_selected,
            ROUND(AVG(e.match_score), 2) AS avg_score,
            ROUND(AVG(e.price_at_time), 2) AS avg_price,
            MIN(e.price_at_time) AS lowest_price,
            ARRAY_AGG(DISTINCT e.merchant_id) FILTER (WHERE e.merchant_id IS NOT NULL) AS merchants,
            ARRAY_AGG(DISTINCT s.category) FILTER (WHERE s.category IS NOT NULL) AS categories
     FROM product_evaluations e
     JOIN shopping_sessions s ON s.session_id = e.session_id
     WHERE LOWER(e.product_id) LIKE $1
       ${catFilter}
     GROUP BY e.product_id
     ORDER BY times_selected DESC, times_seen DESC
     LIMIT ${Number(limit)}`,
    params
  );

  return result.rows.map((r) => ({
    product_id: r.product_id,
    times_seen: Number(r.times_seen),
    times_selected: Number(r.times_selected),
    selection_rate: Number(r.times_seen) > 0
      ? Math.round((Number(r.times_selected) / Number(r.times_seen)) * 100)
      : 0,
    avg_match_score: r.avg_score ? Number(r.avg_score) : null,
    avg_price: r.avg_price ? Number(r.avg_price) : null,
    lowest_price: r.lowest_price ? Number(r.lowest_price) : null,
    merchants: r.merchants?.filter(Boolean) ?? [],
    categories: r.categories?.filter(Boolean) ?? [],
  }));
}

// ── Price history ──

export async function getPriceHistory(productId: string) {
  const [timeline, merchantPrices, stats] = await Promise.all([
    pool.query(
      `SELECT DATE_TRUNC('day', created_at) AS day,
              ROUND(AVG(price_at_time), 2) AS avg_price,
              MIN(price_at_time) AS low,
              MAX(price_at_time) AS high,
              COUNT(*) AS sightings
       FROM product_evaluations
       WHERE product_id = $1 AND price_at_time IS NOT NULL
       GROUP BY DATE_TRUNC('day', created_at)
       ORDER BY day DESC
       LIMIT 30`,
      [productId]
    ),
    pool.query(
      `SELECT merchant_id,
              ROUND(AVG(price_at_time), 2) AS avg_price,
              MIN(price_at_time) AS best_price,
              MAX(price_at_time) AS worst_price,
              COUNT(*) AS sightings
       FROM product_evaluations
       WHERE product_id = $1 AND price_at_time IS NOT NULL AND merchant_id IS NOT NULL
       GROUP BY merchant_id
       ORDER BY avg_price ASC`,
      [productId]
    ),
    pool.query(
      `SELECT
         COUNT(*) AS total_sightings,
         ROUND(AVG(price_at_time), 2) AS avg_price,
         MIN(price_at_time) AS all_time_low,
         MAX(price_at_time) AS all_time_high,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_at_time) AS median
       FROM product_evaluations
       WHERE product_id = $1 AND price_at_time IS NOT NULL`,
      [productId]
    ),
  ]);

  const s = stats.rows[0];
  return {
    product_id: productId,
    summary: s?.total_sightings > 0 ? {
      total_sightings: Number(s.total_sightings),
      avg_price: Number(s.avg_price),
      median_price: s.median ? Number(s.median) : null,
      all_time_low: Number(s.all_time_low),
      all_time_high: Number(s.all_time_high),
    } : null,
    daily_prices: timeline.rows.map((r) => ({
      date: r.day,
      avg: Number(r.avg_price),
      low: Number(r.low),
      high: Number(r.high),
      sightings: Number(r.sightings),
    })),
    by_merchant: merchantPrices.rows.map((r) => ({
      merchant_id: r.merchant_id,
      avg_price: Number(r.avg_price),
      best_price: Number(r.best_price),
      worst_price: Number(r.worst_price),
      sightings: Number(r.sightings),
    })),
  };
}

// ── Wishlist ──

export async function addToWishlist(productId: string, targetPrice?: number, agentPlatform?: string) {
  const result = await pool.query(
    `INSERT INTO wishlists (product_id, target_price, agent_platform)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [productId, targetPrice ?? null, agentPlatform ?? "unknown"]
  );
  return result.rows[0];
}

export async function getWishlist(agentPlatform?: string) {
  const filter = agentPlatform ? `AND agent_platform = $1` : "";
  const params = agentPlatform ? [agentPlatform] : [];

  const result = await pool.query(
    `SELECT w.id, w.product_id, w.target_price, w.agent_platform, w.created_at,
            sub.current_lowest, sub.cheapest_merchant
     FROM wishlists w
     LEFT JOIN LATERAL (
       SELECT MIN(e.price_at_time) AS current_lowest,
              MIN(e.merchant_id) FILTER (WHERE e.price_at_time = sub2.min_price) AS cheapest_merchant
       FROM product_evaluations e
       LEFT JOIN LATERAL (
         SELECT MIN(price_at_time) AS min_price
         FROM product_evaluations
         WHERE product_id = w.product_id AND price_at_time IS NOT NULL
           AND created_at > NOW() - INTERVAL '7 days'
       ) sub2 ON true
       WHERE e.product_id = w.product_id
         AND e.price_at_time IS NOT NULL
         AND e.created_at > NOW() - INTERVAL '7 days'
     ) sub ON true
     WHERE w.active = true ${filter}
     ORDER BY w.created_at DESC`,
    params
  );

  return result.rows.map((r) => ({
    id: r.id,
    product_id: r.product_id,
    target_price: r.target_price ? Number(r.target_price) : null,
    current_lowest: r.current_lowest ? Number(r.current_lowest) : null,
    cheapest_merchant: r.cheapest_merchant,
    price_alert_triggered: r.target_price && r.current_lowest
      ? Number(r.current_lowest) <= Number(r.target_price)
      : false,
    agent_platform: r.agent_platform,
    created_at: r.created_at,
  }));
}

export async function removeFromWishlist(id: number) {
  await pool.query(`UPDATE wishlists SET active = false WHERE id = $1`, [id]);
}

// ── Cached read functions (2-min TTL) ──
// Write functions are NOT cached — they always hit the DB.
// Read functions that aggregate data are cached to avoid redundant queries.

const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export const cachedGetProductIntelligence = cached("prodIntel", getProductIntelligence, CACHE_TTL);
export const cachedGetCategoryRecommendations = cached("catRecs", getCategoryRecommendations, CACHE_TTL);
export const cachedGetMerchantReliability = cached("merchRel", getMerchantReliability, CACHE_TTL);
export const cachedGetSimilarSessionOutcomes = cached("simSess", getSimilarSessionOutcomes, CACHE_TTL);
export const cachedDetectDeal = cached("deal", detectDeal, CACHE_TTL);
export const cachedGetRecentWarnings = cached("warn", getRecentWarnings, CACHE_TTL);
export const cachedGetConstraintMatch = cached("conMatch", getConstraintMatch, CACHE_TTL);
export const cachedGetNetworkStats = cached("netStats", getNetworkStats, CACHE_TTL);
export const cachedGetCompetitiveLandscape = cached("compLand", getCompetitiveLandscape, CACHE_TTL);
export const cachedGetRejectionAnalysis = cached("rejAnal", getRejectionAnalysis, CACHE_TTL);
export const cachedGetCategoryDemand = cached("catDemand", getCategoryDemand, CACHE_TTL);
export const cachedGetMerchantScorecard = cached("merchScore", getMerchantScorecard, CACHE_TTL);
export const cachedGetTrendingProducts = cached("trending", getTrendingProducts, CACHE_TTL);
export const cachedGetBudgetProducts = cached("budget", getBudgetProducts, CACHE_TTL);
export const cachedGetSubcategoryBreakdown = cached("subcat", getSubcategoryBreakdown, CACHE_TTL);
export const cachedGetTodaysDeals = cached("deals", getTodaysDeals, CACHE_TTL);
export const cachedSearchProducts = cached("search", searchProducts, CACHE_TTL);
export const cachedGetPriceHistory = cached("priceHist", getPriceHistory, CACHE_TTL);
