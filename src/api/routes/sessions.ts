import { Router } from "express";
import { getRecentSessions, getSessionSummary } from "../../db/queries.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const sessions = await getRecentSessions(limit, offset);
    res.json({ sessions, limit, offset });
  } catch (err) {
    console.error("Error fetching sessions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const summary = await getSessionSummary(sessionId);
    if (!summary) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(summary);
  } catch (err) {
    console.error("Error fetching session:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
