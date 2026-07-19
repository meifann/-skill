import { z } from "zod";
import { cachedGetCompetitiveLandscape as getCompetitiveLandscape, cachedGetNetworkStats as getNetworkStats } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCompetitiveLandscape(server: McpServer) {
  server.registerTool("get_competitive_landscape", {
    title: "Get Competitive Landscape",
    description:
      "Seller intelligence: see how a product ranks against competitors across all agent sessions. " +
      "Returns category rank, head-to-head win rate, which products beat it and why, " +
      "and price positioning vs alternatives. Use this to understand competitive positioning.",
    inputSchema: {
      product_id: z.string().describe("Product identifier to analyze, e.g. 'sony-wh1000xm5'"),
    },
  }, async ({ product_id }) => {
    const result = await getCompetitiveLandscape(product_id);

    if (result.performance.times_considered === 0) {
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            product_id,
            message: `No competitive data on '${product_id}' yet.`,
            network_status: {
              total_products_tracked: stats.total_products,
              total_sessions: stats.total_sessions,
              categories_with_data: stats.categories.map((c) => c.category),
            },
            tip: "This product hasn't appeared in any agent sessions yet. Use get_category_demand to see what agents are looking for.",
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
