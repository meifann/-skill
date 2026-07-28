import { z } from "zod";
import { cachedGetRejectionAnalysis as getRejectionAnalysis, cachedGetNetworkStats as getNetworkStats } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerRejectionAnalysis(server: McpServer) {
  server.registerTool("get_rejection_analysis", {
    title: "Get Rejection Analysis",
    description:
      "Seller intelligence: deep dive into why AI agents are rejecting a product. " +
      "Returns rejection reasons ranked by frequency, weekly rejection trends, " +
      "which products agents chose instead, and rejection rates by merchant. " +
      "Use this to identify and fix product or listing issues.",
    inputSchema: {
      product_id: z.string().describe("Product identifier to analyze, e.g. 'sony-wh1000xm5'"),
    },
  }, async ({ product_id }) => {
    const result = await getRejectionAnalysis(product_id);

    if (result.total_rejections === 0) {
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            product_id,
            message: `No rejections recorded for '${product_id}' — either it's always selected or hasn't been evaluated yet.`,
            network_status: {
              total_products_tracked: stats.total_products,
              total_sessions: stats.total_sessions,
            },
            tip: "Use get_product_intelligence to check if this product has been evaluated at all.",
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
