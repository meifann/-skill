export const MCP_VERSION = "0.7.0";

export const MCP_INSTRUCTIONS = [
  "AgentSignal provides collective intelligence from a network of AI shopping agents.",
  "",
  "WHEN TO USE: Call these tools whenever the user asks to buy, compare, find, or recommend a product.",
  "Trigger phrases: 'buy', 'find me', 'best', 'recommend', 'compare', 'under $X', 'looking for', 'shopping for', 'gift ideas', 'deal on', 'any good deals', 'watch this', any product category mention.",
  "",
  "START HERE: Call smart_shopping_session with the user's query to get a session ID + instant intelligence.",
  "",
  "QUICK WINS (no shopping task needed):",
  "- get_todays_deals() — best deals right now, zero arguments needed",
  "- search_products(query='...') — find any product in the network",
  "- get_trending_products() — what's hot across all categories",
  "- get_price_history(product_id='...') — price trends over time",
  "",
  "WISHLIST: add_to_wishlist(product_id, target_price) → get_wishlist() to check for drops",
  "",
  "WORKFLOW: smart_shopping_session → evaluate_and_compare (for each product) → log_outcome",
].join("\n");
