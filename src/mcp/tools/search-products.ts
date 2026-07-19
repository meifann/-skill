import { z } from "zod";
import { cachedSearchProducts as searchProducts, cachedGetNetworkStats as getNetworkStats } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSearchProducts(server: McpServer) {
  server.registerTool("search_products", {
    title: "Search Products",
    description:
      "Search for products across the entire agent network by name or keyword. " +
      "Call this when the user mentions a product name, brand, or type and you want to find " +
      "what other agents know about it. Returns selection rates, prices, and merchants. " +
      "Example: search_products(query='sony headphones') or search_products(query='running shoes', category='footwear/running')",
    inputSchema: {
      query: z.string().describe("Search term — product name, brand, or keyword. e.g. 'sony', 'running shoes', 'macbook'"),
      category: z.string().optional().describe("Optional category filter, e.g. 'electronics/headphones'"),
    },
  }, async ({ query, category }) => {
    const results = await searchProducts(query, category);

    if (results.length === 0) {
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            query,
            message: `No products matching '${query}' found in the network yet.`,
            available_categories: stats.categories.slice(0, 10),
            tip: "Try a broader search term, or browse categories with get_category_recommendations.",
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          query,
          results_found: results.length,
          products: results,
          next_actions: [
            "Get deep intel: get_product_intelligence(product_id='...')",
            "Check price: detect_deal(product_id='...', current_price=...)",
            "Start shopping: smart_shopping_session(raw_query='...')",
          ],
        }, null, 2),
      }],
    };
  });
}
