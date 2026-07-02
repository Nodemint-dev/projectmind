// Order endpoints for the authenticated user. Money is integer cents.
import { Router } from "express";
import { query, withTransaction } from "../db.js";
import { requireAuth } from "../auth.js";

export const orders = Router();

orders.use(requireAuth);

orders.get("/", async (req, res) => {
  const { rows } = await query(
    "SELECT id, total_cents, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
    [req.userId]
  );
  res.json(rows);
});

orders.post("/", async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items required" });
  }
  const order = await withTransaction(async (client) => {
    const totalCents = items.reduce((sum, it) => sum + it.priceCents * it.quantity, 0);
    const { rows } = await client.query(
      "INSERT INTO orders (user_id, total_cents, status) VALUES ($1, $2, 'pending') RETURNING id, total_cents, status",
      [req.userId, totalCents]
    );
    const orderId = rows[0].id;
    for (const it of items) {
      await client.query(
        "INSERT INTO order_items (order_id, sku, quantity, price_cents) VALUES ($1, $2, $3, $4)",
        [orderId, it.sku, it.quantity, it.priceCents]
      );
    }
    return rows[0];
  });
  res.status(201).json(order);
});
