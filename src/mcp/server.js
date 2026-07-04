#!/usr/bin/env node
// projectmind MCP server (stdio). A thin adapter: MCP tool -> core -> response.
// Holds no state of its own; every write goes through core (atomic + validated).
// Every handler is wrapped so a bad call returns an error string, never crashes
// the transport.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as core from "../core/index.js";
import { recordDigestRead, recordScopedRead, savingsSummary, resolvePrice } from "../core/ledger.js";

const TOOLS = [
  {
    name: "mind_digest",
    description:
      "Call this BEFORE running ls, find, glob, grep, tree, or reading any file, whenever the task is to explain, describe, summarize, or give an overview of this project or its architecture, or when you otherwise need to orient yourself in an unfamiliar codebase. This includes questions like \"what is this project\", \"explain this codebase\", \"what's the tech stack\", or \"how is this structured\" — call mind_digest first, THEN use its output to decide whether further file exploration is even needed. Returns a compact map of modules, dependencies, decisions, and conventions in a few hundred tokens, replacing what would otherwise be many file reads.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "mind_context",
    description:
      "Call this BEFORE reading/greping files, when you're about to work on specific files or a module and want its purpose, notes, and direct dependencies without opening them. Given the files you're about to edit (and/or a node id or keyword), returns ONLY the relevant part of the map. Use this over mind_digest when you already know which files a task touches — it's the most surgical, token-cheap option.",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Repo-relative paths you're working on." },
        node: { type: "string", description: "Seed the subgraph from this node id." },
        term: { type: "string", description: "Seed the subgraph from a keyword." },
        depth: { type: "number", description: "Neighbor expansion depth (default 1)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "mind_query",
    description:
      "Get full detail on ONE node (its files, notes, and edges) when you need to drill into a specific module. Use after mind_digest points you at the right node — cheaper than reading the files.",
    inputSchema: {
      type: "object",
      properties: { node: { type: "string", description: "The node id from the digest." } },
      required: ["node"],
      additionalProperties: false,
    },
  },
  {
    name: "mind_search",
    description:
      "Find nodes, decisions, or glossary terms by keyword. Use to locate the right part of the project without reading files.",
    inputSchema: {
      type: "object",
      properties: { term: { type: "string", description: "Case-insensitive search term." } },
      required: ["term"],
      additionalProperties: false,
    },
  },
  {
    name: "mind_update",
    description:
      "Call this when you add or change a module, make an architectural decision, or learn a project convention — so the next session doesn't have to rediscover it. Do NOT call for trivial edits. Pass ONLY the fields that changed.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "object", description: "Partial project fields, e.g. { name, description }." },
        stack: { type: "array", items: { type: "string" }, description: "Stack tags to add (set-union)." },
        node: {
          type: "object",
          description: "Add/update a node.",
          properties: {
            id: { type: "string" },
            summary: { type: "string", description: "One line, ~140 chars max." },
            type: { type: "string", enum: ["module", "component", "service", "doc", "concept"] },
            status: { type: "string", enum: ["active", "stable", "deprecated"] },
            files: { type: "array", items: { type: "string" }, description: "Globs mapping files to this node." },
            notes: { type: "string", description: "Longer detail; excluded from the digest, shown by mind_query." },
          },
          required: ["id"],
        },
        removeNode: { type: "string" },
        edge: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" }, rel: { type: "string" } },
          required: ["from", "to", "rel"],
        },
        removeEdge: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" }, rel: { type: "string" } },
          required: ["from", "to", "rel"],
        },
        decision: {
          type: "object",
          properties: { text: { type: "string" }, rationale: { type: "string" } },
          required: ["text"],
        },
        convention: { type: "string" },
        glossary: { type: "object", description: "term -> definition." },
        local: { type: "boolean", description: "Write to the per-developer overlay instead of the shared map." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "mind_handoff",
    description:
      "Leave a one-line handoff note — what you were doing and what's next — before the session ends or the context is about to be compacted. It appears at the TOP of the next session's mind_digest, so the next session (yours or a teammate's agent) resumes instantly instead of rediscovering the task. Stored in the developer's local overlay, never committed. Pass clear: true when the noted work is done.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", description: "One or two lines: what's in progress, what to do next, any gotcha." },
        clear: { type: "boolean", description: "Clear the current handoff note instead of setting one." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "mind_stats",
    description:
      "Return map size, the estimated token cost of the digest, and the local savings ledger (estimated tokens/dollars saved by reading the map instead of scanning files).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
const errorText = (s) => ({ content: [{ type: "text", text: s }], isError: true });

function handleTool(name, args) {
  const r = core.root();
  switch (name) {
    case "mind_digest": {
      const d = core.digest(r);
      // Ledger: this read replaced an estimated whole-repo orientation scan.
      recordDigestRead(d, r);
      return text(d);
    }
    case "mind_context": {
      const { files, node, term, depth } = args || {};
      const out = core.context({ files, node, term }, r, { depth: depth || 1 });
      // Ledger: baseline = the files covered by the focus nodes we served.
      const map = core.load(r);
      const seeds = core.seedNodeIds(map, { files, node, term });
      const globs = [...seeds].flatMap((id) => map.nodes[id]?.files || []);
      recordScopedRead("mind_context", out, globs, r);
      return text(out);
    }
    case "mind_query": {
      const node = core.query(args?.node, r);
      if (!node) return text(`No node "${args?.node}". Try mind_search or mind_digest.`);
      recordScopedRead("mind_query", JSON.stringify(node), node.files || [], r);
      return text(node);
    }
    case "mind_search": {
      const hits = core.search(args?.term, r);
      return text(hits.length ? hits : `No matches for "${args?.term}".`);
    }
    case "mind_update": {
      const { local, ...delta } = args || {};
      const opts = local ? { scope: "local" } : {};
      core.patch(delta, r, opts);
      const warns = core.summaryWarnings(core.load(r));
      const suffix = warns.length ? `\nWarnings:\n- ${warns.join("\n- ")}` : "";
      return text(`Updated map${local ? " (local overlay)" : ""}.${suffix}`);
    }
    case "mind_handoff": {
      if (args?.clear) {
        core.clearHandoff(r);
        return text("Handoff cleared.");
      }
      if (!args?.note) return errorText("Pass a note (or clear: true).");
      core.setHandoff(args.note, r);
      return text("Handoff saved — it will lead the next session's digest.");
    }
    case "mind_stats": {
      const { price, label } = resolvePrice(core.loadConfig(r).savings);
      return text({ ...core.stats(r), savings: savingsSummary(r, { pricePerMTok: price, priceLabel: label }) });
    }
    default:
      return errorText(`Unknown tool: ${name}`);
  }
}

async function main() {
  const server = new Server(
    { name: "projectmind", version: "0.4.4" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      return handleTool(req.params.name, req.params.arguments || {});
    } catch (err) {
      return errorText(`projectmind error: ${err.message}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[projectmind-mcp] fatal: ${err.message}\n`);
  process.exit(1);
});
