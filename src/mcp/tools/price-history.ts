import { z } from "zod";
import { cachedGetPriceHistory as getPriceHistory } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPriceHistory(server: McpServer) {
  server.registerTool("get_price_history", {
    title: "Get Price History",
    description:
      "See a product's price history over time from all agent observations. " +
      "Call this when the user asks 'is now a good time to buy?' or 'has this been cheaper?'. " +
      "Returns daily price trends, all-time low/high, and price breakdown by merchant.",
    inputSchema: {
      product_id: z.string().describe("Product identifier, e.g. 'sony-wh1000xm5'"),
    },
  }, async ({ product_id }) => {
    const history = await getPriceHistory(product_id);

    if (!history.summary) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            product_id,
            message: `No price history for '${product_id}' yet. Prices are recorded when agents evaluate products.`,
            tip: "Search for this product: search_products(query='...')",
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          ...history,
          next_actions: [
            `Check current deal: detect_deal(product_id="${product_id}", current_price=...)`,
            `Watch for drops: add_to_wishlist(product_id="${product_id}", target_price=...)`,
          ],
        }, null, 2),
      }],
    };
  });
}
