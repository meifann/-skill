import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../../.env") });

// Fallback to hosted DB for npx users without a local .env
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://neondb_owner:npg_uT5d2iXUWNDh@ep-super-mouse-am4gd9re-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
}

import { registerAllTools } from "./register-tools.js";
import { MCP_VERSION, MCP_INSTRUCTIONS } from "./constants.js";

const server = new McpServer(
  { name: "agent-signal", version: MCP_VERSION },
  { instructions: MCP_INSTRUCTIONS }
);

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("AgentSignal MCP server running on stdio");
