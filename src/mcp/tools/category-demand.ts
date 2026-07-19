import { z } from "zod";
import { cachedGetCategoryDemand as getCategoryDemand, cachedGetNetworkStats as getNetworkStats, logCategoryMiss } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCategoryDemand(server: McpServer) {
  server.registerTool("get_category_demand", {
    title: "Get Category Demand Signals",
    description:
      "Seller intelligence: see what AI agents are searching for in a product category. " +
      "Returns top demanded features/constraints, unmet needs (from abandoned sessions), " +
      "budget distribution, outcome rates, and top products. " +
      "Use this to identify market gaps and product opportunities.",
    inputSchema: {
      category: z.string().describe("Product category, e.g. 'footwear/running', 'electronics/headphones'"),
    },
  }, async ({ category }) => {
    const result = await getCategoryDemand(category);

    if (result.total_sessions === 0) {
      logCategoryMiss(category, undefined, "get_category_demand").catch(() => {});
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            category,
            message: `No demand data for '${category}' yet.`,
            available_categories: stats.categories,
            tip: "Try one of these categories that have active agent sessions.",
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
