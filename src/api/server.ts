import express from "express";
import dotenv from "dotenv";

import productsRouter from "./routes/products.js";
import categoriesRouter from "./routes/categories.js";
import competitiveRouter from "./routes/competitive.js";
import sessionsRouter from "./routes/sessions.js";
import { computeAllInsights } from "../aggregation/compute.js";

dotenv.config();

const app = express();
const port = Number(process.env.API_PORT) || 3100;

app.use(express.json());

// Routes
app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/competitive", competitiveRouter);
app.use("/api/sessions", sessionsRouter);

// Admin: trigger aggregation
app.post("/api/admin/aggregate", async (_req, res) => {
  try {
    const result = await computeAllInsights();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Error computing aggregates:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "agent-signal" });
});

app.listen(port, () => {
  console.log(`AgentSignal API running on http://localhost:${port}`);
});
