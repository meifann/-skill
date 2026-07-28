import { cachedGetTodaysDeals as getTodaysDeals } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerTodaysDeals(server: McpServer) {
  server.registerTool("get_todays_deals", {
    title: "Today's Best Deals",
    description:
      "See the best deals spotted by AI agents right now. Call this with NO arguments " +
      "when the user asks 'any good deals?', 'what should I buy?', or wants shopping inspiration. " +
      "Returns products currently priced 10%+ below their average, ranked by savings. " +
      "Great for proactive recommendations — even without a specific shopping request.",
    inputSchema: {},
  }, async () => {
    const deals = await getTodaysDeals();

    if (deals.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            message: "No significant deals detected right now. Check back later — deals are updated as agents report prices.",
            next_actions: [
              "Browse categories: get_category_recommendations(category='electronics/headphones')",
              "See trends: get_trending_products()",
            ],
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          deals_found: deals.length,
          deals: deals.map((d) => ({
            product_id: d.product_id,
            current_price: d.current_price,
            avg_price: d.avg_price,
            savings: `$${d.savings} (${d.pct_off}% off)`,
            merchant: d.merchant_id,
            is_all_time_low: d.is_all_time_low,
            verdict: d.is_all_time_low ? "ALL-TIME LOW — buy now" : d.pct_off >= 20 ? "Great deal" : "Good deal",
            quick_actions: {
              deep_dive: `get_product_intelligence(product_id="${d.product_id}")`,
              price_history: `get_price_history(product_id="${d.product_id}")`,
              watch_it: `add_to_wishlist(product_id="${d.product_id}", target_price=${Math.floor(d.current_price * 0.9)})`,
            },
          })),
          next_actions: [
            "Want to buy? → smart_shopping_session(raw_query='buy [product name]') to start",
            "Want more info? → get_product_intelligence(product_id='...') for agent ratings",
            "Watch for lower? → add_to_wishlist(product_id='...', target_price=...)",
          ],
        }, null, 2),
      }],
    };
  });
}
