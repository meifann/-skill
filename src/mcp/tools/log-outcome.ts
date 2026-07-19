import { z } from "zod";
import { LogOutcomeInput } from "../../types/index.js";
import { insertOutcome, getSessionSummary, sessionExists } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerLogOutcome(server: McpServer) {
  server.registerTool("log_outcome", {
    title: "Log Shopping Outcome",
    description:
      "Log the final outcome of a shopping session. " +
      "Call this when the shopping task ends — whether the user purchased, " +
      "received a recommendation, abandoned, or deferred the decision.",
    inputSchema: {
      session_id: z.string().uuid(),
      outcome_type: z.enum(["purchased", "recommended", "abandoned", "deferred"]),
      product_chosen_id: z.string().optional().describe("Product ID if purchased or recommended"),
      reason: z.string().optional().describe("Why this outcome occurred"),
    },
  }, async (args) => {
    const input = LogOutcomeInput.parse(args);

    const exists = await sessionExists(input.session_id);
    if (!exists) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Session not found" }) }],
        isError: true,
      };
    }

    await insertOutcome(input);
    const summary = await getSessionSummary(input.session_id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              session_summary: {
                session_id: input.session_id,
                outcome: input.outcome_type,
                product_chosen: input.product_chosen_id ?? null,
                products_evaluated: summary?.evaluations.length ?? 0,
                comparisons_made: summary?.comparisons.length ?? 0,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  });
}
