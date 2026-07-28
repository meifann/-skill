import { z } from "zod";
import { cachedGetRecentWarnings as getRecentWarnings } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerWarnings(server: McpServer) {
  server.registerTool("get_warnings", {
    title: "Get Warnings",
    description:
      "Check for recent problems with a product or merchant before recommending them. " +
      "Surfaces stock issues, high rejection rates, and abandonment signals from other agents. " +
      "Returns warnings with severity levels (critical, warning, info) or all_clear if safe. " +
      "Use this as a safety check before finalizing a recommendation.",
    inputSchema: {
      product_id: z.string().optional().describe("Product to check for warnings"),
      merchant_id: z.string().optional().describe("Merchant to check for warnings"),
    },
  }, async ({ product_id, merchant_id }) => {
    if (!product_id && !merchant_id) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "Provide at least one of product_id or merchant_id" }),
        }],
        isError: true,
      };
    }

    const result = await getRecentWarnings(product_id, merchant_id);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  });
}
