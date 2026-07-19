import { z } from "zod";

// ── Enums ──

export const Disposition = z.enum(["selected", "rejected", "shortlisted"]);
export type Disposition = z.infer<typeof Disposition>;

export const OutcomeType = z.enum([
  "purchased",
  "recommended",
  "abandoned",
  "deferred",
]);
export type OutcomeType = z.infer<typeof OutcomeType>;

export const Urgency = z.enum(["immediate", "standard", "flexible"]);
export type Urgency = z.infer<typeof Urgency>;

// ── MCP Tool Input Schemas ──

export const LogSessionInput = z.object({
  raw_query: z.string().describe("The user's original shopping request"),
  category: z
    .string()
    .optional()
    .describe("Product category, e.g. 'footwear/running'"),
  budget_max: z.number().optional().describe("Maximum budget amount"),
  budget_currency: z
    .string()
    .default("USD")
    .describe("Budget currency code"),
  constraints: z
    .array(z.string())
    .default([])
    .describe("Required attributes, e.g. ['wide fit', 'cushioned']"),
  exclusions: z
    .array(z.string())
    .default([])
    .describe("Excluded brands or features, e.g. ['Nike']"),
  urgency: Urgency.default("standard"),
  gift: z.boolean().default(false).describe("Whether this is a gift purchase"),
  agent_platform: z
    .string()
    .default("unknown")
    .describe("Agent platform identifier, e.g. 'claude', 'chatgpt'"),
});
export type LogSessionInput = z.infer<typeof LogSessionInput>;

export const LogEvaluationInput = z.object({
  session_id: z.string().uuid().describe("Session ID from log_shopping_session"),
  product_id: z.string().describe("Product identifier"),
  merchant_id: z.string().optional().describe("Merchant/retailer identifier"),
  price_at_time: z.number().optional().describe("Price at time of evaluation"),
  in_stock: z.boolean().default(true),
  match_score: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("How well the product matches intent (0-1)"),
  match_reasons: z
    .array(z.string())
    .default([])
    .describe("Why this product was a match"),
  disposition: Disposition.describe(
    "Whether the product was selected, rejected, or shortlisted"
  ),
  rejection_reason: z
    .string()
    .optional()
    .describe(
      "Why the product was rejected, e.g. 'price too high', 'poor reviews'"
    ),
});
export type LogEvaluationInput = z.infer<typeof LogEvaluationInput>;

export const LogComparisonInput = z.object({
  session_id: z.string().uuid(),
  products_compared: z
    .array(z.string())
    .min(2)
    .describe("Product IDs being compared"),
  dimensions_compared: z
    .array(z.string())
    .default([])
    .describe("What dimensions were compared, e.g. ['price', 'reviews']"),
  winner_product_id: z.string().describe("The product that won the comparison"),
  deciding_factor: z
    .string()
    .describe("The primary factor that decided the winner"),
});
export type LogComparisonInput = z.infer<typeof LogComparisonInput>;

export const LogOutcomeInput = z.object({
  session_id: z.string().uuid(),
  outcome_type: OutcomeType,
  product_chosen_id: z
    .string()
    .optional()
    .describe("Product ID if purchased or recommended"),
  reason: z
    .string()
    .optional()
    .describe("Why this outcome, e.g. 'best price-to-quality at user size'"),
});
export type LogOutcomeInput = z.infer<typeof LogOutcomeInput>;

// ── Database Row Types ──

export interface ShoppingSessionRow {
  session_id: string;
  agent_platform: string;
  raw_query: string;
  category: string | null;
  budget_max: number | null;
  budget_currency: string;
  constraints: string[];
  exclusions: string[];
  urgency: string;
  gift: boolean;
  created_at: Date;
}

export interface ProductEvaluationRow {
  id: number;
  session_id: string;
  product_id: string;
  merchant_id: string | null;
  price_at_time: number | null;
  in_stock: boolean;
  match_score: number | null;
  match_reasons: string[];
  disposition: string;
  rejection_reason: string | null;
  created_at: Date;
}

export interface ComparisonRow {
  id: number;
  session_id: string;
  products_compared: string[];
  dimensions_compared: string[];
  winner_product_id: string;
  deciding_factor: string;
  created_at: Date;
}

export interface OutcomeRow {
  id: number;
  session_id: string;
  outcome_type: string;
  product_chosen_id: string | null;
  reason: string | null;
  created_at: Date;
}

// ── Aggregated Insight Types ──

export interface ProductInsight {
  product_id: string;
  period: string;
  times_considered: number;
  times_shortlisted: number;
  times_selected: number;
  times_rejected: number;
  top_rejection_reasons: Array<{ reason: string; count: number }>;
  lost_to: Array<{
    competitor_product_id: string;
    count: number;
    primary_reason: string;
  }>;
  consideration_to_selection_rate: number;
}

export interface CategoryInsight {
  category: string;
  period: string;
  total_sessions: number;
  avg_products_considered: number;
  avg_comparisons_made: number;
  top_decision_factors: Array<{ factor: string; count: number }>;
  budget_distribution: Record<string, number>;
  trending_constraints: Array<{ attribute: string; count: number }>;
}
