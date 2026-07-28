import { z } from "zod";
import { cachedGetMerchantScorecard as getMerchantScorecard, cachedGetNetworkStats as getNetworkStats } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerMerchantScorecard(server: McpServer) {
  server.registerTool("get_merchant_scorecard", {
    title: "Get Merchant Scorecard",
    description:
      "Seller intelligence: comprehensive merchant performance report across all agent sessions. " +
      "Returns selection rate, stock reliability, price competitiveness, " +
      "performance by category, and top products. " +
      "Use this for merchant self-assessment or to compare merchant quality.",
    inputSchema: {
      merchant_id: z.string().describe("Merchant identifier, e.g. 'amazon', 'bestbuy'"),
    },
  }, async ({ merchant_id }) => {
    const result = await getMerchantScorecard(merchant_id);

    if (result.overview.total_evaluations === 0) {
      const stats = await getNetworkStats();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            merchant_id,
            message: `No data for merchant '${merchant_id}' yet.`,
            network_status: {
              total_merchants_tracked: stats.total_merchants,
              total_sessions: stats.total_sessions,
            },
            tip: "This merchant hasn't appeared in any agent evaluations yet.",
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
