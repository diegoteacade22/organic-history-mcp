#!/usr/bin/env node
/** Prueba end-to-end del servidor MCP por stdio: initialize, tools/list, tools/call. */
import { spawn } from "node:child_process";

const proc = spawn("node", ["index.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const pending = new Map();
let nextId = 1;

proc.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }
    }, 30000);
  });
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

const init = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test", version: "0" },
});
check("initialize", init.result?.serverInfo?.name === "organic-history", JSON.stringify(init.result?.serverInfo));

proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const list = await rpc("tools/list", {});
const names = (list.result?.tools || []).map((t) => t.name);
check("tools/list", names.length === 4, names.join(", "));

async function call(name, args) {
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.result?.content?.[0]?.text;
  return { isError: !!r.result?.isError, data: text ? JSON.parse(text) : null };
}

const v = await call("verify_operation", { operation_id: "8699694963" });
check(
  "verify_operation (BANANORIA)",
  v.data?.current_status === "Suspended" && v.data?.verdict === "not_certified",
  `${v.data?.name} → ${v.data?.current_status}`
);

const v2 = await call("verify_operation", { operation_id: "9963298001" });
check(
  "verify_operation (certificada)",
  v2.data?.verdict === "verified_certified",
  `${v2.data?.name} → ${v2.data?.current_status}`
);

const v3 = await call("verify_operation", { operation_id: "0000000000" });
check("verify_operation (id inexistente)", v3.data?.found === false, JSON.stringify(v3.data));

const many = await call("verify_many", {
  operation_ids: ["8699694963", "9963298001", "9999999999"],
});
check(
  "verify_many",
  many.data?.count === 3 && many.data?.summary?.unknown === 1,
  JSON.stringify(many.data?.summary)
);

const ch = await call("list_changes", { from_month: "2026-11", to_month: "2026-11", to_status: "Suspended" });
check("list_changes nov/Suspended", ch.data?.returned > 0, `${ch.data?.returned} filas`);

const se = await call("search_operations", { query: "bananoria", limit: 5 });
check("search_operations 'bananoria'", se.data?.returned >= 1, `${se.data?.returned} resultados`);

const bad = await call("list_changes", { from_month: "2026-01", to_month: "2026-11", limit: 5 });
check("list_changes limit=5", bad.data?.returned === 5, `${bad.data?.returned} filas`);

proc.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
process.exit(failed.length ? 1 : 0);
