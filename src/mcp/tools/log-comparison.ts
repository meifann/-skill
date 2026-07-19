import { z } from "zod";
import { LogComparisonInput } from "../../types/index.js";
import { insertComparison, sessionExists } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerLogComparison(server: McpServer) {
  server.registerTool("log_comparison", {
    title: "Log Product Comparison",
    description:
      "Log a comparison between two or more products during a shopping session. " +
      "Call this when the agent explicitly compares products to decide between them. " +
      "Record which product won and what the deciding factor was.",
    inputSchema: {
      session_id: z.string().uuid(),
      products_compared: z.array(z.string()).min(2).describe("Product IDs being compared"),
      dimensions_compared: z.array(z.string()).default([]).describe("Dimensions compared, e.g. ['price', 'reviews', 'durability']"),
      winner_product_id: z.string().describe("The product that won the comparison"),
      deciding_factor: z.string().describe("The primary factor that decided the winner"),
    },
  }, async (args) => {
    const input = LogComparisonInput.parse(args);

    const exists = await sessionExists(input.session_id);
    if (!exists) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Session not found" }) }],
        isError: true,
      };
    }

    const row = await insertComparison(input);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ success: true, comparison_id: row.id }, null, 2),
        },
      ],
    };
  });
}
