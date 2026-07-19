import { z } from "zod";
import { addToWishlist, getWishlist, removeFromWishlist } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerWishlist(server: McpServer) {
  server.registerTool("add_to_wishlist", {
    title: "Add to Wishlist",
    description:
      "Watch a product for price drops. Call this when the user says 'let me know if this gets cheaper', " +
      "'watch this for me', or 'alert me when it drops below $X'. " +
      "The agent network will track prices — check with get_wishlist to see current prices.",
    inputSchema: {
      product_id: z.string().describe("Product identifier to watch, e.g. 'sony-wh1000xm5'"),
      target_price: z.number().optional().describe("Alert when price drops to or below this amount"),
      agent_platform: z.string().default("unknown").describe("Your agent platform identifier"),
    },
  }, async ({ product_id, target_price, agent_platform }) => {
    const item = await addToWishlist(product_id, target_price, agent_platform);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          added: true,
          wishlist_id: item.id,
          product_id,
          target_price: target_price ?? null,
          message: target_price
            ? `Watching '${product_id}' for prices at or below $${target_price}.`
            : `Watching '${product_id}' for price drops.`,
          next_actions: [
            "Check status anytime: get_wishlist()",
            `See price history: get_price_history(product_id="${product_id}")`,
          ],
        }, null, 2),
      }],
    };
  });

  server.registerTool("get_wishlist", {
    title: "Check Wishlist",
    description:
      "Check your watched products and their current prices. " +
      "Call this proactively to see if any prices have dropped — great for daily check-ins. " +
      "Returns current lowest prices and whether any target prices have been hit.",
    inputSchema: {
      agent_platform: z.string().optional().describe("Filter to a specific agent platform"),
    },
  }, async ({ agent_platform }) => {
    const items = await getWishlist(agent_platform);

    if (items.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            message: "No items on the wishlist yet.",
            tip: "Add products to watch: add_to_wishlist(product_id='...', target_price=...)",
          }, null, 2),
        }],
      };
    }

    const triggered = items.filter((i) => i.price_alert_triggered);
    const watching = items.filter((i) => !i.price_alert_triggered);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          total_watched: items.length,
          alerts_triggered: triggered.length,
          triggered: triggered.map((i) => ({
            product_id: i.product_id,
            target_price: i.target_price,
            current_lowest: i.current_lowest,
            savings: i.target_price && i.current_lowest
              ? Math.round((i.target_price - i.current_lowest) * 100) / 100
              : null,
            cheapest_at: i.cheapest_merchant,
          })),
          watching: watching.map((i) => ({
            id: i.id,
            product_id: i.product_id,
            target_price: i.target_price,
            current_lowest: i.current_lowest,
          })),
          next_actions: triggered.length > 0
            ? ["Price drop detected! → smart_shopping_session(raw_query='...') to start shopping"]
            : ["Check deals: get_todays_deals()"],
        }, null, 2),
      }],
    };
  });

  server.registerTool("remove_from_wishlist", {
    title: "Remove from Wishlist",
    description: "Stop watching a product. Use the wishlist item ID from get_wishlist.",
    inputSchema: {
      wishlist_id: z.number().describe("Wishlist item ID from get_wishlist"),
    },
  }, async ({ wishlist_id }) => {
    await removeFromWishlist(wishlist_id);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ removed: true, wishlist_id }),
      }],
    };
  });
}
