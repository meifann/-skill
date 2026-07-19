import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { LogSessionInput } from "../../types/index.js";
import { insertSession, cachedGetCategoryRecommendations as getCategoryRecommendations, cachedGetSimilarSessionOutcomes as getSimilarSessionOutcomes, cachedGetNetworkStats as getNetworkStats, logCategoryMiss } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSmartSession(server: McpServer) {
  server.registerTool("smart_shopping_session", {
    title: "Start Smart Shopping Session",
    description:
      "CALL THIS FIRST when the user wants to buy, find, compare, or get recommendations for any product. " +
      "Logs the shopping intent and instantly returns what other AI agents chose for similar requests — " +
      "top products, deciding factors, price data, and outcomes. One call replaces hours of research. " +
      "Returns a session_id needed for follow-up tools like evaluate_and_compare.",
    inputSchema: {
      raw_query: z.string().describe("The user's original shopping request"),
      category: z.string().optional().describe("Product category, e.g. 'footwear/running'"),
      budget_max: z.number().optional().describe("Maximum budget amount"),
      budget_currency: z.string().default("USD").describe("Budget currency code"),
      constraints: z.array(z.string()).default([]).describe("Required attributes, e.g. ['wide fit', 'cushioned']"),
      exclusions: z.array(z.string()).default([]).describe("Excluded brands or features"),
      urgency: z.enum(["immediate", "standard", "flexible"]).default("standard"),
      gift: z.boolean().default(false).describe("Whether this is a gift purchase"),
      agent_platform: z.string().default("unknown").describe("Agent platform identifier"),
    },
  }, async ({ raw_query, category, budget_max, budget_currency, constraints, exclusions, urgency, gift, agent_platform }) => {
    const input = LogSessionInput.parse({
      raw_query, category, budget_max, budget_currency,
      constraints, exclusions, urgency, gift, agent_platform,
    });

    const sessionId = uuidv4();
    await insertSession(sessionId, input);

    // Fetch intelligence in parallel
    const intel: Record<string, unknown> = {};

    if (category) {
      const [catRecs, similar] = await Promise.all([
        getCategoryRecommendations(category, budget_max),
        getSimilarSessionOutcomes(category, constraints, budget_max),
      ]);

      if (catRecs.total_sessions > 0) {
        intel.category_intelligence = {
          total_sessions: catRecs.total_sessions,
          avg_budget: catRecs.avg_budget,
          top_picks: catRecs.top_picks.slice(0, 5),
          what_matters_most: catRecs.what_matters_most,
          common_requirements: catRecs.common_requirements,
        };
      }

      if (similar.similar_sessions_found > 0) {
        intel.similar_sessions = {
          found: similar.similar_sessions_found,
          outcomes: similar.outcome_distribution,
          what_agents_chose: similar.what_agents_chose,
          deciding_factors: similar.deciding_factors,
        };
      }
    }

    // If no category data, log the miss and suggest alternatives
    if (Object.keys(intel).length === 0) {
      if (category) {
        logCategoryMiss(category, agent_platform, raw_query).catch(() => {});
      }
      const stats = await getNetworkStats();

      // Fuzzy match: find categories containing the queried term
      const query = (category || "").toLowerCase();
      const didYouMean = stats.categories
        .filter((c) => {
          const cat = c.category.toLowerCase();
          return cat.includes(query) || query.includes(cat.split("/").pop() || "");
        })
        .slice(0, 5);

      intel.network_overview = {
        total_sessions: stats.total_sessions,
        total_products: stats.total_products,
        available_categories: stats.categories,
      };

      if (didYouMean.length > 0) {
        intel.did_you_mean = didYouMean.map((c) => `${c.category} (${c.sessions} sessions)`);
      }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          session_id: sessionId,
          message: "Session logged. Here's what the network knows:",
          ...intel,
          next_actions: [
            `For each product you consider: evaluate_and_compare(session_id="${sessionId}", product_id="...", disposition="selected|rejected|shortlisted")`,
            `When done: log_outcome(session_id="${sessionId}", outcome_type="purchased|recommended|abandoned")`,
          ],
        }, null, 2),
      }],
    };
  });
}
