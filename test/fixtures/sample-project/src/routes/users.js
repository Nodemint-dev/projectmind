// User-facing auth endpoints: signup, login, and the authenticated profile.
import { Router } from "express";
import crypto from "node:crypto";
import { query } from "../db.js";
import { issueToken, requireAuth } from "../auth.js";

export const users = Router();

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}

users.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rowCount) return res.status(409).json({ error: "email already registered" });
  const { rows } = await query(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
    [email, hashPassword(password)]
  );
  res.status(201).json({ token: issueToken(rows[0]) });
});

users.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "invalid credentials" });
  }
  res.json({ token: issueToken(user) });
});

users.get("/me", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT id, email, created_at FROM users WHERE id = $1", [req.userId]);
  res.json(rows[0]);
});
