import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRoot, cleanup } from "./helpers.js";
import { init } from "../src/core/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../src/mcp/server.js", import.meta.url));

async function withClient(root, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: root, // server discovers root from cwd
  });
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

test("MCP smoke: lists tools and each tool responds; mind_update persists", async () => {
  const r = tmpRoot();
  try {
    init(r);
    await withClient(r, async (client) => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      assert.deepEqual(names, ["mind_context", "mind_digest", "mind_handoff", "mind_query", "mind_search", "mind_stats", "mind_update"]);

      const digest = await client.callTool({ name: "mind_digest", arguments: {} });
      assert.match(digest.content[0].text, /project map/);

      // persist a node
      const upd = await client.callTool({
        name: "mind_update",
        arguments: { node: { id: "billing", summary: "handles invoices", status: "active" } },
      });
      assert.match(upd.content[0].text, /Updated map/);

      // it should now show up in query and digest
      const q = await client.callTool({ name: "mind_query", arguments: { node: "billing" } });
      assert.match(q.content[0].text, /handles invoices/);

      const d2 = await client.callTool({ name: "mind_digest", arguments: {} });
      assert.match(d2.content[0].text, /billing/);

      const stats = await client.callTool({ name: "mind_stats", arguments: {} });
      assert.match(stats.content[0].text, /digestTokensEst/);
      // savings ledger recorded the digest read and surfaces in stats
      assert.match(stats.content[0].text, /"savings"/);
      const parsed = JSON.parse(stats.content[0].text);
      assert.ok(parsed.savings.totals.reads >= 1, "digest read should be in the ledger");
      assert.equal(parsed.savings.estimated, true);

      const search = await client.callTool({ name: "mind_search", arguments: { term: "invoices" } });
      assert.match(search.content[0].text, /billing/);

      // add a node with files, then fetch task-scoped context by file
      await client.callTool({ name: "mind_update", arguments: { node: { id: "billing", files: ["src/billing/**"] } } });
      const ctx = await client.callTool({ name: "mind_context", arguments: { files: ["src/billing/charge.js"] } });
      assert.match(ctx.content[0].text, /billing/);
      assert.match(ctx.content[0].text, /Focus/);

      // handoff round-trip: set → shows in digest → clear
      await client.callTool({ name: "mind_handoff", arguments: { note: "wiring invoices; next: taxes" } });
      const d3 = await client.callTool({ name: "mind_digest", arguments: {} });
      assert.match(d3.content[0].text, /wiring invoices/);
      await client.callTool({ name: "mind_handoff", arguments: { clear: true } });
      const d4 = await client.callTool({ name: "mind_digest", arguments: {} });
      assert.doesNotMatch(d4.content[0].text, /wiring invoices/);
    });
  } finally { cleanup(r); }
});

test("MCP: bad input returns an error string, does not crash transport", async () => {
  const r = tmpRoot();
  try {
    init(r);
    await withClient(r, async (client) => {
      // mind_query for a missing node returns a friendly message, still usable after
      const q = await client.callTool({ name: "mind_query", arguments: { node: "does-not-exist" } });
      assert.match(q.content[0].text, /No node/);
      // transport still alive:
      const d = await client.callTool({ name: "mind_digest", arguments: {} });
      assert.ok(d.content[0].text.length > 0);
    });
  } finally { cleanup(r); }
});
