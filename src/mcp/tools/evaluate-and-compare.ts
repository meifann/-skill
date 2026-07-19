import { z } from "zod";
import { LogEvaluationInput } from "../../types/index.js";
import { insertEvaluation, sessionExists, cachedGetProductIntelligence as getProductIntelligence, cachedDetectDeal as detectDeal } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerEvaluateAndCompare(server: McpServer) {
  server.registerTool("evaluate_and_compare", {
    title: "Evaluate Product & Get Intelligence",
    description:
      "Log a product evaluation AND instantly get intelligence about it in one call. " +
      "Call this for EACH product you consider during a shopping task. " +
      "Returns how other agents rated this product, whether the price is a deal or overpriced, " +
      "top rejection reasons, and competitive alternatives. Requires a session_id from smart_shopping_session.",
    inputSchema: {
      session_id: z.string().uuid().describe("Session ID from log_shopping_session or smart_shopping_session"),
      product_id: z.string().describe("Product identifier"),
      merchant_id: z.string().optional().describe("Merchant/retailer identifier"),
      price_at_time: z.number().optional().describe("Price at time of evaluation"),
      in_stock: z.boolean().default(true),
      match_score: z.number().min(0).max(1).optional().describe("How well the product matches intent (0-1)"),
      match_reasons: z.array(z.string()).default([]).describe("Why this product was a match"),
      disposition: z.enum(["selected", "rejected", "shortlisted"]).describe("Whether the product was selected, rejected, or shortlisted"),
      rejection_reason: z.string().optional().describe("Why the product was rejected"),
    },
  }, async (args) => {
    const input = LogEvaluationInput.parse(args);

    const exists = await sessionExists(input.session_id);
    if (!exists) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: "Session not found. It may have expired (30 min idle limit). Start a new one with smart_shopping_session.",
        }) }],
        isError: true,
      };
    }

    // Log the evaluation and fetch intelligence in parallel
    const [row, intel, deal] = await Promise.all([
      insertEvaluation(input),
      getProductIntelligence(input.product_id),
      input.price_at_time
        ? detectDeal(input.product_id, input.price_at_time)
        : Promise.resolve(null),
    ]);

    const response: Record<string, unknown> = {
      evaluation_logged: true,
      evaluation_id: row.id,
    };

    if (intel.times_considered === 0) {
      response.product_status = "new_to_network";
      response.message = "First evaluation for this product — your data helps future agents make better decisions.";
    }

    if (intel.times_considered > 0) {
      response.product_intelligence = {
        selection_rate: intel.selection_rate,
        times_considered: intel.times_considered,
        times_selected: intel.times_selected,
        avg_match_score: intel.avg_match_score,
        top_rejection_reasons: intel.top_rejection_reasons,
        beats_these: intel.beats_these,
        price_range: intel.price_range,
      };
    }

    if (deal && deal.verdict !== "unknown") {
      response.deal_verdict = {
        verdict: deal.verdict,
        savings_vs_avg: deal.savings_vs_avg,
        pct_below_avg: deal.pct_below_avg,
        price_history: deal.price_history,
      };
    }

    response.next_actions = [
      `Safety check: get_warnings(product_id="${input.product_id}")`,
      `Compare finalists: log_comparison(session_id="...", products_compared=[...], winner_product_id="...", deciding_factor="...")`,
      `Done shopping: log_outcome(session_id="...", outcome_type="purchased|recommended|abandoned")`,
    ];

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      }],
    };
  });
}
