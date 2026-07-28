import { Router } from "express";
import { getCompetitiveLosses } from "../../db/queries.js";

const router = Router();

router.get("/lost-to", async (req, res) => {
  try {
    const productId = req.query.product_id as string;
    if (!productId) {
      res.status(400).json({ error: "product_id query parameter is required" });
      return;
    }
    const losses = await getCompetitiveLosses(productId);
    res.json({ product_id: productId, losses });
  } catch (err) {
    console.error("Error fetching competitive losses:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
