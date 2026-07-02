// Thin PostgreSQL wrapper. A single shared pool plus a query() helper so call
// sites don't manage connections directly.
import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl });

pool.on("error", (err) => {
  // A pooled client errored while idle; log and let pg recycle it.
  console.error("Unexpected idle client error", err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms > 200) console.warn(`Slow query (${ms}ms): ${text}`);
  return res;
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function close() {
  await pool.end();
}
