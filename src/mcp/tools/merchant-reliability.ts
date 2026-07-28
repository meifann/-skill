import { z } from "zod";
import { cachedGetMerchantReliability as getMerchantReliability } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerMerchantReliability(server: McpServer) {
  server.registerTool("check_merchant_reliability", {
    title: "Check Merchant Reliability",
    description:
      "Check a merchant's reliability based on data from other AI agents' shopping sessions. " +
      "Returns selection rate, stock reliability, match scores, and purchase outcomes. " +
      "Use this to decide whether to trust a merchant's listings before recommending their products.",
    inputSchema: {
      merchant_id: z.string().describe("Merchant identifier to look up, e.g. 'amazon', 'bestbuy'"),
    },
  }, async ({ merchant_id }) => {
    const reliability = await getMerchantReliability(merchant_id);

    if (reliability.total_evaluations === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            merchant_id,
            message: "No data available for this merchant yet.",
          }),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(reliability, null, 2),
      }],
    };
  });
}
