#!/usr/bin/env node
/**
 * OrganicHistory MCP server.
 *
 * Answers one question no free USDA tool answers: has this organic operation
 * EVER lost its certification, when, and to what status?
 *
 * Data: USDA Organic INTEGRITY monthly snapshots (public domain), diffed by
 * Operation ID across every published month of the current year.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "data", "organic-history.json.gz");
const BAD = new Set(["Surrendered", "Suspended", "Revoked"]);

let DB = null;

function db() {
  if (DB) return DB;
  const raw = gunzipSync(readFileSync(DATA)).toString("utf8");
  DB = JSON.parse(raw);
  return DB;
}

function verdictOf(rec) {
  const status = rec[3];
  const events = rec[5] || [];
  if (status === "Certified") return events.length ? "certified_after_loss" : "verified_certified";
  return "not_certified";
}

function shape(id, rec) {
  const events = rec[5] || [];
  return {
    operation_id: id,
    name: rec[0],
    certifier: rec[1],
    country: rec[2],
    current_status: rec[3],
    status_since: rec[4],
    verdict: verdictOf(rec),
    ever_non_certified: events.length > 0,
    non_certified_events: events.map(([month, status]) => ({ month, status })),
  };
}

const TOOLS = [
  {
    name: "verify_operation",
    description:
      "Verify one USDA organic operation by its 10-digit Operation ID. Returns current certification status plus every prior loss of certification observed in the published monthly snapshots. Use this before contracting or buying from an organic supplier.",
    inputSchema: {
      type: "object",
      properties: {
        operation_id: { type: "string", description: "USDA NOP 10-digit Operation ID" },
      },
      required: ["operation_id"],
    },
  },
  {
    name: "verify_many",
    description:
      "Verify up to 100 operations in one call. Returns a verdict per ID so an agent can screen a supplier list.",
    inputSchema: {
      type: "object",
      properties: {
        operation_ids: {
          type: "array",
          items: { type: "string" },
          description: "Up to 100 USDA Operation IDs",
        },
      },
      required: ["operation_ids"],
    },
  },
  {
    name: "list_changes",
    description:
      "List operations that moved INTO a non-certified status (Surrendered, Suspended, Revoked) between two months. Answers 'which suppliers lost certification this period'.",
    inputSchema: {
      type: "object",
      properties: {
        from_month: { type: "string", description: "YYYY-MM, inclusive" },
        to_month: { type: "string", description: "YYYY-MM, inclusive" },
        to_status: {
          type: "string",
          description: "Comma-separated: Surrendered, Suspended, Revoked. Omit for all.",
        },
        country: { type: "string", description: "Optional country filter, exact match" },
        limit: { type: "number", description: "Max rows, default 200, max 2000" },
      },
    },
  },
  {
    name: "search_operations",
    description:
      "Find organic operations by name, optionally filtered by country and current status. Use to resolve a supplier name to an Operation ID.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring of the operation name" },
        country: { type: "string", description: "Optional country filter" },
        status: {
          type: "string",
          description: "Certified | Surrendered | Suspended | Revoked",
        },
        limit: { type: "number", description: "Max rows, default 25, max 200" },
      },
      required: ["query"],
    },
  },
];

function handle(name, args) {
  const d = db();
  const ops = d.ops;

  if (name === "verify_operation") {
    const id = String(args.operation_id || "").trim();
    const rec = ops[id];
    if (!rec) return { found: false, operation_id: id, note: "No such operation in the observed window." };
    return { found: true, ...shape(id, rec) };
  }

  if (name === "verify_many") {
    const ids = Array.isArray(args.operation_ids) ? args.operation_ids.slice(0, 100) : [];
    const results = ids.map((raw) => {
      const id = String(raw).trim();
      const rec = ops[id];
      return rec
        ? shape(id, rec)
        : { operation_id: id, verdict: "unknown", note: "No such operation in the observed window." };
    });
    return {
      count: results.length,
      summary: {
        verified_certified: results.filter((r) => r.verdict === "verified_certified").length,
        certified_after_loss: results.filter((r) => r.verdict === "certified_after_loss").length,
        not_certified: results.filter((r) => r.verdict === "not_certified").length,
        unknown: results.filter((r) => r.verdict === "unknown").length,
      },
      results,
    };
  }

  if (name === "list_changes") {
    const from = args.from_month || d.months[0];
    const to = args.to_month || d.months[d.months.length - 1];
    const wanted = args.to_status
      ? new Set(String(args.to_status).split(",").map((s) => s.trim()).filter(Boolean))
      : null;
    const country = args.country ? String(args.country) : null;
    const limit = Math.min(Number(args.limit) || 200, 2000);
    const rows = [];
    for (const [id, month, fromStatus, toStatus] of d.changes) {
      if (month < from || month > to) continue;
      if (wanted && !wanted.has(toStatus)) continue;
      const rec = ops[id];
      if (country && rec[2] !== country) continue;
      rows.push({
        operation_id: id,
        name: rec[0],
        country: rec[2],
        from_status: fromStatus,
        to_status: toStatus,
        month,
      });
      if (rows.length >= limit) break;
    }
    return { from_month: from, to_month: to, returned: rows.length, changes: rows };
  }

  if (name === "search_operations") {
    const q = String(args.query || "").toLowerCase().trim();
    if (q.length < 2) return { error: "query must be at least 2 characters" };
    const country = args.country ? String(args.country) : null;
    const status = args.status ? String(args.status) : null;
    const limit = Math.min(Number(args.limit) || 25, 200);
    const rows = [];
    for (const [id, rec] of Object.entries(ops)) {
      if (!rec[0] || !rec[0].toLowerCase().includes(q)) continue;
      if (country && rec[2] !== country) continue;
      if (status && rec[3] !== status) continue;
      rows.push(shape(id, rec));
      if (rows.length >= limit) break;
    }
    return { query: args.query, returned: rows.length, results: rows };
  }

  throw new Error(`Unknown tool: ${name}`);
}

const server = new Server(
  { name: "organic-history", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const out = handle(name, args || {});
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${err.message}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
