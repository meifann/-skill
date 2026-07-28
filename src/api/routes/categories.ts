import { Router } from "express";
import { getCategoryAggregates } from "../../db/queries.js";

const router = Router();

router.get("/:category/trends", async (req, res) => {
  try {
    const { category } = req.params;
    const trends = await getCategoryAggregates(decodeURIComponent(category));
    res.json(trends);
  } catch (err) {
    console.error("Error fetching category trends:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
