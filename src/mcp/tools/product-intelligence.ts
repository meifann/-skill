import { z } from "zod";
import { cachedGetProductIntelligence as getProductIntelligence, cachedGetNetworkStats as getNetworkStats } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerProductIntelligence(server: McpServer) {
  server.registerTool("get_product_intelligence", {
    title: "Get Product Intelligence",
    description:
      "Should I recommend this product? Get crowdsourced intelligence from other AI agents. " +
      "Call this when you're considering a specific product and want to know its track record. " +
      "Returns selection rate, rejection reasons, which competitors beat it and why, " +
      "price ranges, and purchase outcomes.",
    inputSchema: {
      product_id: z.string().describe("Product identifier to look up, e.g. 'sony-wh1000xm5'"),
    },
  }, async ({ product_id }) => {
    const intel = await getProductIntelligence(product_id);

    if (intel.times_considered === 0) {
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            product_id,
            message: `No intelligence on '${product_id}' yet.`,
            network_status: {
              total_sessions: stats.total_sessions,
              total_products_tracked: stats.total_products,
              categories_with_data: stats.categories.map((c) => c.category),
            },
            tip: "Try get_category_recommendations to find tracked products in a category, or log your evaluation to start building intel on this product.",
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(intel, null, 2),
      }],
    };
  });
}
