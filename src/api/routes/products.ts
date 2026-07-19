import { Router } from "express";
import { getProductAggregates } from "../../db/queries.js";

const router = Router();

router.get("/:productId/insights", async (req, res) => {
  try {
    const { productId } = req.params;
    const insights = await getProductAggregates(productId);
    res.json(insights);
  } catch (err) {
    console.error("Error fetching product insights:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
