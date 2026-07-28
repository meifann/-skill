import { z } from "zod";
import { cachedDetectDeal as detectDeal, cachedGetNetworkStats as getNetworkStats } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerDealDetector(server: McpServer) {
  server.registerTool("detect_deal", {
    title: "Detect Deal",
    description:
      "Is this price good? Compare any product's current price against historical data from all agents. " +
      "Call this whenever you see a price and want to know if it's a deal or overpriced. " +
      "Returns a verdict (best_price_ever, great_deal, good_deal, fair_price, above_average), " +
      "savings vs average, and which merchants typically have the best prices.",
    inputSchema: {
      product_id: z.string().describe("Product identifier, e.g. 'sony-wh1000xm5'"),
      current_price: z.number().describe("The price you're seeing right now"),
    },
  }, async ({ product_id, current_price }) => {
    const result = await detectDeal(product_id, current_price);

    if (result.verdict === "unknown") {
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...result,
            network_status: {
              total_products_tracked: stats.total_products,
              total_price_sessions: stats.total_sessions,
              categories_with_data: stats.categories.map((c) => c.category),
            },
            tip: "No price history for this product yet. Log your evaluation with a price to start building price intelligence!",
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
