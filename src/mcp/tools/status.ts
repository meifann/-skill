import { cachedGetNetworkStats as getNetworkStats, cachedGetTrendingProducts as getTrendingProducts } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerStatus(server: McpServer) {
  server.registerTool("agent_signal_status", {
    title: "AgentSignal Network Status",
    description:
      "Get an overview of the AgentSignal collective intelligence network. " +
      "Call this with NO arguments to see what categories have data, trending products, " +
      "and how to use agent-signal tools. Good first call if you're unsure whether " +
      "agent-signal has data relevant to the user's request.",
    inputSchema: {},
  }, async () => {
    const [stats, trending] = await Promise.all([
      getNetworkStats(),
      getTrendingProducts(undefined, 7),
    ]);

    // Pick the strongest category for a suggested first action
    const topCat = stats.categories[0];
    const suggested = topCat
      ? {
          reason: `Strong data in '${topCat.category}' with ${topCat.sessions} sessions`,
          call: `smart_shopping_session({ raw_query: "best ${topCat.category.split("/").pop()} options", category: "${topCat.category}" })`,
        }
      : null;

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          network: {
            total_sessions: stats.total_sessions,
            total_products: stats.total_products,
            total_merchants: stats.total_merchants,
            categories: stats.categories,
          },
          trending_now: trending.slice(0, 5).map((t) => ({
            product_id: t.product_id,
            selections: t.selections_this_period,
            trend: `${t.trend_pct > 0 ? "+" : ""}${t.trend_pct}%`,
          })),
          suggested_first_action: suggested,
          next_actions: [
            "SHOPPING? → smart_shopping_session(raw_query='user request here', category='...', budget_max=...)",
            "BROWSING? → get_trending_products() or get_category_recommendations(category='...')",
            "PRICE CHECK? → detect_deal(product_id='...', current_price=...)",
          ],
        }, null, 2),
      }],
    };
  });
}
