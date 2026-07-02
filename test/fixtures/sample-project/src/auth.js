// JWT issuing/verification plus an Express middleware that gates protected
// routes. Tokens carry the user id and expire per config.jwtTtlSeconds.
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const claims = token && verifyToken(token);
  if (!claims) return res.status(401).json({ error: "unauthorized" });
  req.userId = claims.sub;
  next();
}
