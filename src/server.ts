import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, "../.env") });

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerAllTools } from "./mcp/register-tools.js";
import { MCP_VERSION, MCP_INSTRUCTIONS } from "./mcp/constants.js";

import productsRouter from "./api/routes/products.js";
import categoriesRouter from "./api/routes/categories.js";
import competitiveRouter from "./api/routes/competitive.js";
import sessionsRouter from "./api/routes/sessions.js";
import { computeAllInsights } from "./aggregation/compute.js";

const app = express();
const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 3100;

app.use(express.json());

// Trust proxy (Railway runs behind a reverse proxy)
app.set("trust proxy", 1);

// ── Rate Limiting ──

// General API limiter: 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// MCP limiter: 200 requests per minute per IP (agents make multiple calls per session)
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many MCP requests. Please slow down." },
});

app.use("/api", apiLimiter);
app.use("/mcp", mcpLimiter);

// ── REST API Routes ──

app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/competitive", competitiveRouter);
app.use("/api/sessions", sessionsRouter);

app.post("/api/admin/aggregate", async (_req, res) => {
  try {
    const result = await computeAllInsights();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Error computing aggregates:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "agent-signal" });
});

// ── Remote MCP Server (Streamable HTTP) ──

// Map of session ID -> transport + last activity timestamp
const transports = new Map<string, { transport: StreamableHTTPServerTransport; lastActivity: number }>();

// Session TTL: clean up idle sessions every 60s, expire after 30 min
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_SESSIONS = 500; // hard cap

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [sid, entry] of transports) {
    if (now - entry.lastActivity > SESSION_TTL_MS) {
      entry.transport.close?.();
      transports.delete(sid);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`Session cleanup: removed ${cleaned} idle sessions, ${transports.size} active`);
  }
}, 60_000);

async function handleMcp(req: express.Request, res: express.Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "GET" || req.method === "DELETE") {
    // GET = SSE stream, DELETE = close session
    const entry = sessionId ? transports.get(sessionId) : undefined;
    if (!entry) {
      res.status(400).json({ error: "No active session. Send an initialize request first." });
      return;
    }
    entry.lastActivity = Date.now();
    await entry.transport.handleRequest(req, res);
    if (req.method === "DELETE") {
      transports.delete(sessionId!);
    }
    return;
  }

  // POST requests
  const body = req.body;

  if (sessionId && transports.has(sessionId)) {
    const entry = transports.get(sessionId)!;
    entry.lastActivity = Date.now();
    await entry.transport.handleRequest(req, res, body);
    return;
  }

  if (body?.method === "initialize") {
    const mcpServer = new McpServer(
      { name: "agent-signal", version: MCP_VERSION },
      { instructions: MCP_INSTRUCTIONS }
    );
    registerAllTools(mcpServer, "http");

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
      // Session ID captured below after handleRequest sets it
      const sid = (transport as any).__sessionId;
      if (sid) transports.delete(sid);
    };

    // Enforce max sessions
    if (transports.size >= MAX_SESSIONS) {
      // Evict oldest session
      let oldestSid: string | undefined;
      let oldestTime = Infinity;
      for (const [sid, entry] of transports) {
        if (entry.lastActivity < oldestTime) {
          oldestTime = entry.lastActivity;
          oldestSid = sid;
        }
      }
      if (oldestSid) {
        transports.get(oldestSid)?.transport.close?.();
        transports.delete(oldestSid);
      }
    }

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);

    // Extract session ID from response headers
    const newSessionId = res.getHeader("mcp-session-id") as string;
    if (newSessionId) {
      (transport as any).__sessionId = newSessionId;
      transports.set(newSessionId, { transport, lastActivity: Date.now() });
    }
  } else {
    res.status(400).json({ error: "No session. Send an initialize request first." });
  }
}

app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);
app.delete("/mcp", handleMcp);

// ── Start ──

app.listen(port, "0.0.0.0", () => {
  console.log(`AgentSignal running on http://0.0.0.0:${port}`);
  console.log(`  REST API: http://0.0.0.0:${port}/api`);
  console.log(`  MCP endpoint: http://0.0.0.0:${port}/mcp`);
});
