# Agent Commerce MCP Server

MCP Server for agent commerce — a protocol for how AI agents create, compare, and track purchases. Enables structured buying workflows with offer comparison and merchant verification.

## Features

- **Purchase Intents** — Create structured purchase requests with budget constraints
- **Offer Comparison** — Compare offers from multiple sources side by side
- **Purchase Tracking** — Track status from intent to delivery
- **Merchant Verification** — Build reliability scores based on order history

## Installation

```bash
pip install agent-commerce-mcp-server
```

## Usage with Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-commerce": {
      "command": "uvx",
      "args": ["agent-commerce-mcp-server"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `create_purchase_intent` | Create a structured purchase request |
| `compare_offers` | Compare offers from multiple sources |
| `track_purchase` | Track or update purchase status |
| `list_purchases` | List purchase history with optional filters |
| `verify_merchant` | Check or update merchant reliability score |

## Purchase Flow

1. `create_purchase_intent` — Define what you want to buy
2. `compare_offers` — Add and compare offers from different merchants
3. `verify_merchant` — Check merchant reliability before ordering
4. `track_purchase` — Update status as the order progresses

## Data Storage

All purchase data is stored locally in SQLite at `~/.agent-commerce/purchases.db`.


---

## More MCP Servers by AiAgentKarl

| Category | Servers |
|----------|---------|
| 🔗 Blockchain | [Solana](https://github.com/AiAgentKarl/solana-mcp-server) |
| 🌍 Data | [Weather](https://github.com/AiAgentKarl/weather-mcp-server) · [Germany](https://github.com/AiAgentKarl/germany-mcp-server) · [Agriculture](https://github.com/AiAgentKarl/agriculture-mcp-server) · [Space](https://github.com/AiAgentKarl/space-mcp-server) · [Aviation](https://github.com/AiAgentKarl/aviation-mcp-server) · [EU Companies](https://github.com/AiAgentKarl/eu-company-mcp-server) |
| 🔒 Security | [Cybersecurity](https://github.com/AiAgentKarl/cybersecurity-mcp-server) · [Policy Gateway](https://github.com/AiAgentKarl/agent-policy-gateway-mcp) · [Audit Trail](https://github.com/AiAgentKarl/agent-audit-trail-mcp) |
| 🤖 Agent Infra | [Memory](https://github.com/AiAgentKarl/agent-memory-mcp-server) · [Directory](https://github.com/AiAgentKarl/agent-directory-mcp-server) · [Hub](https://github.com/AiAgentKarl/mcp-appstore-server) · [Reputation](https://github.com/AiAgentKarl/agent-reputation-mcp-server) |
| 🔬 Research | [Academic](https://github.com/AiAgentKarl/crossref-academic-mcp-server) · [LLM Benchmark](https://github.com/AiAgentKarl/llm-benchmark-mcp-server) · [Legal](https://github.com/AiAgentKarl/legal-court-mcp-server) |

[→ Full catalog (40+ servers)](https://github.com/AiAgentKarl)

## License

MIT
