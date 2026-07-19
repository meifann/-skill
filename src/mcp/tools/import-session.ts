import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { insertSession, insertEvaluation, insertComparison, insertOutcome } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerImportSession(server: McpServer) {
  server.registerTool("import_completed_session", {
    title: "Import Completed Shopping Session",
    description:
      "Retroactively contribute shopping data to the network. " +
      "Call this AFTER you've already helped a user shop WITHOUT using agent-signal tools. " +
      "Accepts the full session in one call: intent, products evaluated, comparisons, and outcome. " +
      "This builds collective intelligence even when agent-signal wasn't used during the original task.",
    inputSchema: {
      session: z.object({
        raw_query: z.string().describe("The user's original shopping request"),
        category: z.string().optional().describe("Product category, e.g. 'footwear/running'"),
        budget_max: z.number().optional().describe("Maximum budget"),
        budget_currency: z.string().default("USD"),
        constraints: z.array(z.string()).default([]).describe("Required attributes"),
        exclusions: z.array(z.string()).default([]).describe("Excluded brands/features"),
        urgency: z.enum(["immediate", "standard", "flexible"]).default("standard"),
        gift: z.boolean().default(false),
        agent_platform: z.string().default("unknown"),
      }).describe("Shopping session intent"),

      evaluations: z.array(z.object({
        product_id: z.string().describe("Product identifier"),
        merchant_id: z.string().optional().describe("Merchant identifier"),
        price_at_time: z.number().optional().describe("Price seen"),
        in_stock: z.boolean().default(true),
        match_score: z.number().min(0).max(1).optional().describe("How well it matched (0-1)"),
        match_reasons: z.array(z.string()).default([]).describe("Why it matched or didn't"),
        disposition: z.enum(["selected", "rejected", "shortlisted"]).describe("What happened"),
        rejection_reason: z.string().optional().describe("Why rejected"),
      })).default([]).describe("Products that were evaluated"),

      comparisons: z.array(z.object({
        products_compared: z.array(z.string()).min(2).describe("Product IDs compared"),
        dimensions_compared: z.array(z.string()).default([]).describe("What dimensions were compared"),
        winner_product_id: z.string().describe("Which product won"),
        deciding_factor: z.string().describe("Why the winner won"),
      })).default([]).describe("Comparisons made between products"),

      outcome: z.object({
        outcome_type: z.enum(["purchased", "recommended", "abandoned", "deferred"]).describe("How it ended"),
        product_chosen_id: z.string().optional().describe("Final product chosen"),
        reason: z.string().optional().describe("Why this outcome"),
      }).optional().describe("Final outcome of the session"),
    },
  }, async ({ session, evaluations, comparisons, outcome }) => {
    try {
      const sessionId = uuidv4();

      // Insert session
      await insertSession(sessionId, {
        raw_query: session.raw_query,
        category: session.category ?? undefined,
        budget_max: session.budget_max ?? undefined,
        budget_currency: session.budget_currency,
        constraints: session.constraints,
        exclusions: session.exclusions,
        urgency: session.urgency,
        gift: session.gift,
        agent_platform: session.agent_platform,
      });

      // Insert all evaluations
      let evalCount = 0;
      for (const e of evaluations) {
        await insertEvaluation({
          session_id: sessionId,
          product_id: e.product_id,
          merchant_id: e.merchant_id ?? undefined,
          price_at_time: e.price_at_time ?? undefined,
          in_stock: e.in_stock,
          match_score: e.match_score ?? undefined,
          match_reasons: e.match_reasons,
          disposition: e.disposition,
          rejection_reason: e.rejection_reason ?? undefined,
        });
        evalCount++;
      }

      // Insert all comparisons
      let compCount = 0;
      for (const c of comparisons) {
        await insertComparison({
          session_id: sessionId,
          products_compared: c.products_compared,
          dimensions_compared: c.dimensions_compared,
          winner_product_id: c.winner_product_id,
          deciding_factor: c.deciding_factor,
        });
        compCount++;
      }

      // Insert outcome if provided
      let outcomeType = null;
      if (outcome) {
        const result = await insertOutcome({
          session_id: sessionId,
          outcome_type: outcome.outcome_type,
          product_chosen_id: outcome.product_chosen_id ?? undefined,
          reason: outcome.reason ?? undefined,
        });
        outcomeType = result.outcome_type;
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            session_id: sessionId,
            imported: {
              evaluations: evalCount,
              comparisons: compCount,
              outcome: outcomeType,
            },
            message: "Thanks for contributing! This data helps all agents make better decisions.",
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: `Import failed: ${(err as Error).message}` }),
        }],
        isError: true,
      };
    }
  });
}
