import { z } from "zod";
import { cachedGetBudgetProducts as getBudgetProducts, cachedGetNetworkStats as getNetworkStats } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerBudgetSearch(server: McpServer) {
  server.registerTool("get_budget_products", {
    title: "Get Budget Products",
    description:
      "Find the best products within a specific budget for a category. " +
      "Call this when the user says 'under $X' or has a clear budget constraint. " +
      "ranked by selection count. Includes which merchants offer it under budget.",
    inputSchema: {
      category: z.string().describe("Product category, e.g. 'electronics', 'footwear/running'"),
      budget_max: z.number().describe("Maximum price — only shows products seen at or below this price"),
    },
  }, async ({ category, budget_max }) => {
    const result = await getBudgetProducts(category, budget_max);

    if (result.products_in_budget === 0) {
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            category,
            budget_max,
            message: `No products found under $${budget_max} in '${category}'.`,
            suggestion: "Try a higher budget or a different category.",
            available_categories: stats.categories,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  });
}
