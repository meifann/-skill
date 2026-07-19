import { z } from "zod";
import { createPriceAlert, checkPriceAlerts, deactivatePriceAlert } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPriceAlerts(server: McpServer) {
  // Create a price alert
  server.registerTool("create_price_alert", {
    title: "Create Price Alert",
    description:
      "Set a price alert for a product. When agents report prices at or below your target, " +
      "the alert will trigger. Check alerts with check_price_alerts.",
    inputSchema: {
      product_id: z.string().describe("Product identifier, e.g. 'sony-wh1000xm5'"),
      target_price: z.number().describe("Target price — alert triggers when seen at or below this"),
      agent_platform: z.string().default("unknown").describe("Your agent platform identifier"),
    },
  }, async ({ product_id, target_price, agent_platform }) => {
    const alert = await createPriceAlert(product_id, target_price, agent_platform);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          alert_id: alert.id,
          product_id,
          target_price,
          message: `Price alert set. Use check_price_alerts to see if any agents have spotted '${product_id}' at or below $${target_price}.`,
        }, null, 2),
      }],
    };
  });

  // Check price alerts
  server.registerTool("check_price_alerts", {
    title: "Check Price Alerts",
    description:
      "Check if any price alerts have been triggered by recent agent activity. " +
      "Returns current lowest prices from the last 7 days and whether alerts are triggered.",
    inputSchema: {
      product_id: z.string().optional().describe("Filter to a specific product, or omit to check all active alerts"),
    },
  }, async ({ product_id }) => {
    const alerts = await checkPriceAlerts(product_id);

    if (alerts.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            message: product_id
              ? `No active alerts for '${product_id}'.`
              : "No active price alerts. Use create_price_alert to set one.",
          }),
        }],
      };
    }

    const triggered = alerts.filter((a) => a.triggered);
    const watching = alerts.filter((a) => !a.triggered);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          triggered: triggered.map((a) => ({
            alert_id: a.alert_id,
            product_id: a.product_id,
            target_price: a.target_price,
            current_lowest: a.current_lowest_price,
            savings: a.current_lowest_price ? Math.round((a.target_price - a.current_lowest_price) * 100) / 100 : 0,
            cheapest_at: a.cheapest_merchant,
          })),
          watching: watching.map((a) => ({
            alert_id: a.alert_id,
            product_id: a.product_id,
            target_price: a.target_price,
            current_lowest: a.current_lowest_price,
            gap: a.current_lowest_price ? Math.round((a.current_lowest_price - a.target_price) * 100) / 100 : null,
          })),
        }, null, 2),
      }],
    };
  });
}
