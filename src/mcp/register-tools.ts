import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "crypto";
import pool from "../db/client.js";

import { registerStatus } from "./tools/status.js";
import { registerSmartSession } from "./tools/smart-session.js";
import { registerEvaluateAndCompare } from "./tools/evaluate-and-compare.js";
import { registerTrendingProducts } from "./tools/trending-products.js";
import { registerCategoryRecommendations } from "./tools/category-recommendations.js";
import { registerConstraintMatch } from "./tools/constraint-match.js";
import { registerDealDetector } from "./tools/deal-detector.js";
import { registerBudgetSearch } from "./tools/budget-search.js";
import { registerWarnings } from "./tools/warnings.js";
import { registerMerchantReliability } from "./tools/merchant-reliability.js";
import { registerProductIntelligence } from "./tools/product-intelligence.js";
import { registerSimilarSessions } from "./tools/similar-sessions.js";
import { registerImportSession } from "./tools/import-session.js";
import { registerLogSession } from "./tools/log-session.js";
import { registerLogEvaluation } from "./tools/log-evaluation.js";
import { registerLogComparison } from "./tools/log-comparison.js";
import { registerLogOutcome } from "./tools/log-outcome.js";
import { registerGetSummary } from "./tools/get-summary.js";
import { registerPriceAlerts } from "./tools/price-alerts.js";
import { registerCompetitiveLandscape } from "./tools/competitive-landscape.js";
import { registerRejectionAnalysis } from "./tools/rejection-analysis.js";
import { registerCategoryDemand } from "./tools/category-demand.js";
import { registerMerchantScorecard } from "./tools/merchant-scorecard.js";
import { registerTodaysDeals } from "./tools/todays-deals.js";
import { registerSearchProducts } from "./tools/search-products.js";
import { registerPriceHistory } from "./tools/price-history.js";
import { registerWishlist } from "./tools/wishlist.js";

// Read-only tools that indicate browsing behavior
const BROWSE_TOOLS = new Set([
  "agent_signal_status", "get_todays_deals", "search_products",
  "get_trending_products", "get_category_recommendations", "get_budget_products",
  "get_product_intelligence", "get_price_history", "detect_deal",
  "get_similar_session_outcomes", "get_constraint_match", "get_warnings",
  "check_merchant_reliability", "get_competitive_landscape",
  "get_rejection_analysis", "get_category_demand", "get_merchant_scorecard",
]);

export function registerAllTools(server: McpServer, transport: "stdio" | "http" = "stdio") {
  // Each server instance gets a browse session ID for tracking engagement
  const browseSessionId = `browse-${randomUUID().slice(0, 8)}`;

  // Wrap registerTool to log every tool call + browse events
  const origRegister = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: any, cb: any) => {
    const wrappedCb = async (...args: any[]) => {
      // Log tool call
      pool.query(
        "INSERT INTO tool_calls (tool_name, transport) VALUES ($1, $2)",
        [name, transport]
      ).catch(() => {});

      // Log browse event for read-only tools
      if (BROWSE_TOOLS.has(name)) {
        const inputArg = args[0] as Record<string, unknown> | undefined;
        const context = inputArg ? Object.fromEntries(
          Object.entries(inputArg).filter(([, v]) => v !== undefined).slice(0, 5)
        ) : {};
        pool.query(
          "INSERT INTO browse_events (browse_session_id, tool_name, query_context, transport) VALUES ($1, $2, $3, $4)",
          [browseSessionId, name, JSON.stringify(context), transport]
        ).catch(() => {});
      }

      return cb(...args);
    };
    return origRegister(name, config, wrappedCb);
  }) as typeof server.registerTool;

  // 1. Entry points — highest activation priority
  registerStatus(server);
  registerSmartSession(server);
  registerEvaluateAndCompare(server);

  // 2. Discovery — browsing, deals, search
  registerTodaysDeals(server);
  registerSearchProducts(server);
  registerTrendingProducts(server);
  registerCategoryRecommendations(server);
  registerBudgetSearch(server);
  registerConstraintMatch(server);

  // 3. Intelligence — product, deal, price history
  registerPriceHistory(server);
  registerDealDetector(server);
  registerProductIntelligence(server);
  registerWarnings(server);
  registerMerchantReliability(server);
  registerSimilarSessions(server);

  // 4. Write — manual logging (smart tools preferred)
  registerLogSession(server);
  registerLogEvaluation(server);
  registerLogComparison(server);
  registerLogOutcome(server);
  registerGetSummary(server);
  registerImportSession(server);

  // 5. Monitoring & wishlist
  registerPriceAlerts(server);
  registerWishlist(server);

  // 6. Seller intelligence
  registerCompetitiveLandscape(server);
  registerRejectionAnalysis(server);
  registerCategoryDemand(server);
  registerMerchantScorecard(server);
}
