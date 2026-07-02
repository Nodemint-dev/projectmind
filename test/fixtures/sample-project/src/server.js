// HTTP entrypoint. Wires JSON parsing, mounts route modules, and starts
// listening. Kept intentionally thin — logic lives in the route modules.
import express from "express";
import { config } from "./config.js";
import { users } from "./routes/users.js";
import { orders } from "./routes/orders.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/users", users);
  app.use("/orders", orders);

  // Any thrown/forwarded error becomes a 500 with a generic message.
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createApp().listen(config.port, () => {
    console.log(`shopflow-api listening on :${config.port}`);
  });
}
