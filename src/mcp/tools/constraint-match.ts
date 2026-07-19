import { z } from "zod";
import { cachedGetConstraintMatch as getConstraintMatch } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerConstraintMatch(server: McpServer) {
  server.registerTool("get_constraint_match", {
    title: "Match Constraints to Products",
    description:
      "Decision shortcut: find what products worked for agents with your EXACT constraints. " +
      "Matches on specific requirements (e.g. 'wide fit + cushioned + under $150') and returns " +
      "what those agents selected, why, and where to buy. Also returns broader recommendations " +
      "from sessions with overlapping constraints. Use this to skip the search when a proven " +
      "answer already exists.",
    inputSchema: {
      category: z.string().describe("Product category, e.g. 'footwear/running'"),
      constraints: z.array(z.string()).min(1).describe("Required attributes, e.g. ['wide fit', 'cushioned']"),
      budget_max: z.number().optional().describe("Maximum budget"),
    },
  }, async ({ category, constraints, budget_max }) => {
    const result = await getConstraintMatch(category, constraints, budget_max);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  });
}
