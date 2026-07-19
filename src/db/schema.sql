-- AgentSignal Database Schema

-- Enums
CREATE TYPE disposition_type AS ENUM ('selected', 'rejected', 'shortlisted');
CREATE TYPE outcome_type AS ENUM ('purchased', 'recommended', 'abandoned', 'deferred');
CREATE TYPE urgency_type AS ENUM ('immediate', 'standard', 'flexible');

-- Shopping Sessions
CREATE TABLE shopping_sessions (
  session_id UUID PRIMARY KEY,
  agent_platform VARCHAR(100) NOT NULL DEFAULT 'unknown',
  raw_query TEXT NOT NULL,
  category VARCHAR(255),
  budget_max NUMERIC(10, 2),
  budget_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  constraints JSONB NOT NULL DEFAULT '[]',
  exclusions JSONB NOT NULL DEFAULT '[]',
  urgency urgency_type NOT NULL DEFAULT 'standard',
  gift BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_category ON shopping_sessions(category);
CREATE INDEX idx_sessions_created_at ON shopping_sessions(created_at);
CREATE INDEX idx_sessions_agent_platform ON shopping_sessions(agent_platform);

-- Product Evaluations
CREATE TABLE product_evaluations (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES shopping_sessions(session_id),
  product_id VARCHAR(255) NOT NULL,
  merchant_id VARCHAR(255),
  price_at_time NUMERIC(10, 2),
  in_stock BOOLEAN NOT NULL DEFAULT TRUE,
  match_score NUMERIC(3, 2),
  match_reasons JSONB NOT NULL DEFAULT '[]',
  disposition disposition_type NOT NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evaluations_session ON product_evaluations(session_id);
CREATE INDEX idx_evaluations_product ON product_evaluations(product_id);
CREATE INDEX idx_evaluations_disposition ON product_evaluations(disposition);
CREATE INDEX idx_evaluations_created_at ON product_evaluations(created_at);

-- Comparisons
CREATE TABLE comparisons (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES shopping_sessions(session_id),
  products_compared JSONB NOT NULL,
  dimensions_compared JSONB NOT NULL DEFAULT '[]',
  winner_product_id VARCHAR(255) NOT NULL,
  deciding_factor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_comparisons_session ON comparisons(session_id);
CREATE INDEX idx_comparisons_winner ON comparisons(winner_product_id);

-- Outcomes
CREATE TABLE outcomes (
  id SERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES shopping_sessions(session_id),
  outcome_type outcome_type NOT NULL,
  product_chosen_id VARCHAR(255),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outcomes_session ON outcomes(session_id);
CREATE INDEX idx_outcomes_product ON outcomes(product_chosen_id);
CREATE INDEX idx_outcomes_type ON outcomes(outcome_type);

-- Category Misses (tracks queries for categories with no data)
CREATE TABLE category_misses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(255) NOT NULL,
  agent_platform VARCHAR(100),
  query_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_category_misses_category ON category_misses(category);
CREATE INDEX idx_category_misses_created ON category_misses(created_at);

-- Tool Call Analytics
CREATE TABLE tool_calls (
  id SERIAL PRIMARY KEY,
  tool_name VARCHAR(100) NOT NULL,
  transport VARCHAR(20) DEFAULT 'http',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name);
CREATE INDEX idx_tool_calls_created ON tool_calls(created_at);

-- Price Alerts
CREATE TABLE price_alerts (
  id SERIAL PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL,
  target_price NUMERIC(10, 2) NOT NULL,
  agent_platform VARCHAR(100) DEFAULT 'unknown',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_price_alerts_product ON price_alerts(product_id);
CREATE INDEX idx_price_alerts_active ON price_alerts(active);

-- Browse Events (tracks read-only tool engagement per connection)
CREATE TABLE browse_events (
  id SERIAL PRIMARY KEY,
  browse_session_id VARCHAR(100) NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  query_context JSONB DEFAULT '{}',
  transport VARCHAR(20) DEFAULT 'stdio',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_browse_session ON browse_events(browse_session_id);
CREATE INDEX idx_browse_created ON browse_events(created_at);

-- Wishlists
CREATE TABLE wishlists (
  id SERIAL PRIMARY KEY,
  product_id VARCHAR(255) NOT NULL,
  target_price NUMERIC(10, 2),
  agent_platform VARCHAR(100) DEFAULT 'unknown',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wishlists_product ON wishlists(product_id);
CREATE INDEX idx_wishlists_active ON wishlists(active);

-- Product Insights (pre-computed aggregates)
CREATE TABLE product_insights (
  product_id VARCHAR(255) NOT NULL,
  period VARCHAR(20) NOT NULL,
  times_considered INTEGER NOT NULL DEFAULT 0,
  times_shortlisted INTEGER NOT NULL DEFAULT 0,
  times_selected INTEGER NOT NULL DEFAULT 0,
  times_rejected INTEGER NOT NULL DEFAULT 0,
  top_rejection_reasons JSONB NOT NULL DEFAULT '[]',
  lost_to JSONB NOT NULL DEFAULT '[]',
  consideration_to_selection_rate NUMERIC(5, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, period)
);
