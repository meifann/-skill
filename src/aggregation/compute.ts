import pool from "../db/client.js";

export async function computeAllInsights() {
  // Get the current period (year-week)
  const now = new Date();
  const year = now.getFullYear();
  const weekNum = getWeekNumber(now);
  const period = `${year}-W${String(weekNum).padStart(2, "0")}`;

  // Get all unique product IDs that have been evaluated
  const productsResult = await pool.query(
    "SELECT DISTINCT product_id FROM product_evaluations"
  );

  let updated = 0;

  for (const row of productsResult.rows) {
    const productId = row.product_id;

    // Compute counts
    const counts = await pool.query(
      `SELECT
         COUNT(*) AS times_considered,
         COUNT(*) FILTER (WHERE disposition = 'shortlisted') AS times_shortlisted,
         COUNT(*) FILTER (WHERE disposition = 'selected') AS times_selected,
         COUNT(*) FILTER (WHERE disposition = 'rejected') AS times_rejected
       FROM product_evaluations
       WHERE product_id = $1`,
      [productId]
    );

    // Compute top rejection reasons
    const rejections = await pool.query(
      `SELECT rejection_reason, COUNT(*) AS count
       FROM product_evaluations
       WHERE product_id = $1 AND disposition = 'rejected' AND rejection_reason IS NOT NULL
       GROUP BY rejection_reason
       ORDER BY count DESC
       LIMIT 10`,
      [productId]
    );

    // Compute lost-to competitors
    const lostTo = await pool.query(
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
    );

    const c = counts.rows[0];
    const considered = Number(c.times_considered);
    const selected = Number(c.times_selected);

    // Upsert into product_insights
    await pool.query(
      `INSERT INTO product_insights
         (product_id, period, times_considered, times_shortlisted, times_selected,
          times_rejected, top_rejection_reasons, lost_to, consideration_to_selection_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (product_id, period) DO UPDATE SET
         times_considered = EXCLUDED.times_considered,
         times_shortlisted = EXCLUDED.times_shortlisted,
         times_selected = EXCLUDED.times_selected,
         times_rejected = EXCLUDED.times_rejected,
         top_rejection_reasons = EXCLUDED.top_rejection_reasons,
         lost_to = EXCLUDED.lost_to,
         consideration_to_selection_rate = EXCLUDED.consideration_to_selection_rate,
         updated_at = NOW()`,
      [
        productId,
        period,
        considered,
        Number(c.times_shortlisted),
        selected,
        Number(c.times_rejected),
        JSON.stringify(
          rejections.rows.map((r) => ({
            reason: r.rejection_reason,
            count: Number(r.count),
          }))
        ),
        JSON.stringify(
          lostTo.rows.map((r) => ({
            competitor_product_id: r.competitor_product_id,
            count: Number(r.count),
            primary_reason: r.primary_reason,
          }))
        ),
        considered > 0 ? selected / considered : 0,
      ]
    );

    updated++;
  }

  return { period, products_updated: updated };
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
