// The console's local server. It serves the page, holds the service key, and
// passes the page's requests to the lifecycle service. It makes no lifecycle
// decision of its own.
//
//   GET  /                       the page
//   GET  /app.js /app.css /fonts/* the page's files
//   GET  /local/status           which source, whether a key is held (never the key)
//   GET  /local/stages           the 24 stages
//   POST /local/key   { key }    keep a key for this service, in a 0600 file
//   POST /local/forget-key       forget the kept key
//   POST /local/check { folder, agent } run `node .adlc/check.mjs` in the build folder: agents/<agent>/ in that folder, or the folder
//   GET|POST /api/v1/lifecycle/builds/... passed to <service>/v1/lifecycle/builds/... with the key
//   GET|PUT|DELETE /api/v1/lifecycle/roles[/<role>][?project=<name>] passed the same way
//   GET|PUT|DELETE /api/v1/lifecycle/stages[/<stage>][?project=<name>] passed the same way
//   (each list is only read; PUT and DELETE reach one role or one stage)
//   GET  /api/v1/lifecycle/analytics[?window=7d|30d|all&project=<name>] passed the same way: a
//        service's own addition, not part of the lifecycle API (Product Factory answers it)
//   GET  /api/v1/lifecycle/products[/<name>]  the products, and one product's versions, run plan and activity (0.4, read)
//   GET|POST /api/v1/lifecycle/products/<name>/stages/<stage>/messages  a product's chat with a stage's agent (0.4)
//   GET|POST /api/v1/lifecycle/products/<name>/boss/messages  the product's boss (0.4.1)
//   GET  /api/v1/lifecycle/products/<name>/boss/commitments   what the boss committed (0.4.1, read)
//   GET  /api/v1/lifecycle/products/<name>/features[?version=]   the features matrix (0.4.3, read)
//   GET  /api/v1/lifecycle/products/<name>/documents   the product's documents, with the copy of each that stands (0.4.11, read)
//   GET  /api/v1/lifecycle/products/<name>/features/<feature>   one feature and its history (0.4.3, read);
//        a build's features, and an answer to a feature proposal, go through the builds path, as do
//        listing a product's features after the build and Approve all (0.4.5)
//   GET  /api/v1/lifecycle/builds/<id>/stages/<stage>  one stage's workspace (0.4), through the builds path
//   GET  /api/v1/lifecycle/me             who the key belongs to
//   GET  /api/v1/lifecycle/people         the service's people, teams and projects, when it keeps them (read-only)
//   POST /local/added-stages[?project=<name>]              with --lifecycle only: add a stage of your own
//   PUT|DELETE /local/added-stages/<stage>[?project=<name>] change or remove one
//
// Only this computer can reach it (127.0.0.1), and it answers only requests
// addressed to itself, so another web page cannot use it.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck, CheckRefused } from "./check.mjs";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/** The 24 stages shipped with the console (standards/stages.json). */
export function shippedStages() {
  return JSON.parse(readFileSync(join(ROOT, "standards", "stages.json"), "utf8"));
}
const PUBLIC = join(ROOT, "public");
const BODY_LIMIT = 1024 * 1024;
const UPSTREAM_TIMEOUT = 60_000;
// A post the service answers through a model (a stage's chat, the boss, the features listed after a
// build, 0.4.5) waits longer: a service may give the model a few minutes.
const MODEL_TIMEOUT = 6 * 60_000;
const MODEL_POST = /\/(?:messages|features\/backfill)$/;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const PAGE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'",
  "img-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join("; ");

const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
};

// The lifecycle paths the page may reach through the proxy.
const LIFECYCLE = /^\/v1\/lifecycle\/builds(?:\/[A-Za-z0-9._~%-]+){0,4}$/;
const ROLES = /^\/v1\/lifecycle\/roles(?:\/[a-z0-9-]{1,64})?$/;
const STAGES = /^\/v1\/lifecycle\/stages(?:\/[a-z0-9-]{1,64})?$/;
// Products (0.4): the list and one product are read; a product's stage chat is read and posted to.
const PRODUCTS = /^\/v1\/lifecycle\/products(?:\/[A-Za-z0-9._~%-]{1,200})?$/;
const PRODUCT_CHAT = /^\/v1\/lifecycle\/products\/[A-Za-z0-9._~%-]{1,200}\/stages\/[a-z0-9-]{1,64}\/messages$/;
// The product's boss (0.4.1): its conversation is read and posted to; its commitments are read.
const BOSS_CHAT = /^\/v1\/lifecycle\/products\/[A-Za-z0-9._~%-]{1,200}\/boss\/messages$/;
const BOSS_COMMITMENTS = /^\/v1\/lifecycle\/products\/[A-Za-z0-9._~%-]{1,200}\/boss\/commitments$/;
// Features (0.4.3): a product's matrix, for a version, and one feature's history are read.
const FEATURES = /^\/v1\/lifecycle\/products\/[A-Za-z0-9._~%-]{1,200}\/features(?:\/[A-Za-z][A-Za-z0-9._-]{0,63})?$/;
// Documents (0.4.11): a product's documents are read.
const DOCUMENTS = /^\/v1\/lifecycle\/products\/[A-Za-z0-9._~%-]{1,200}\/documents$/;
const VERSION_MAX = 100;
// Read only: who the key belongs to, and the service's people.
const READ_ONLY = new Set(["/v1/lifecycle/me", "/v1/lifecycle/people"]);
const PROJECT_MAX = 200;
const ANALYTICS = "/v1/lifecycle/analytics";
const WINDOWS = new Set(["7d", "30d", "all"]);

export function serviceLabel(url) {
  try { return new URL(url).host; } catch { return url; }
}

export function createConsoleServer({ service, keys, source = null, demo = null, stages = shippedStages(), version = "0.0.0", check = runCheck, fetchImpl = fetch } = {}) {
  // An in-process source (the demo, or GitHub) answers in place of the service.
  const inproc = source ?? demo;
  let allowedHosts = new Set();
  const origin = () => [...allowedHosts].map((h) => `http://${h}`);

  function send(res, status, body, type = "application/json; charset=utf-8", extra = {}) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    res.writeHead(status, { ...BASE_HEADERS, "content-type": type, "content-length": buf.length, ...extra });
    res.end(buf);
  }
  const fail = (res, status, error, extra = {}) => send(res, status, { error, ...extra });

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > BODY_LIMIT) throw Object.assign(new Error("too big"), { status: 413 });
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }

  async function jsonBody(req) {
    const buf = await readBody(req);
    if (!buf.length) return {};
    try {
      const v = JSON.parse(buf.toString("utf8"));
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      throw Object.assign(new Error("bad body"), { status: 400 });
    }
  }

  async function serveStatic(res, pathname) {
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + sep) || rel.includes("\0")) return fail(res, 404, "Nothing here.");
    const type = TYPES[extname(file)];
    if (!type) return fail(res, 404, "Nothing here.");
    let body;
    try { body = await readFile(file); } catch { return fail(res, 404, "Nothing here."); }
    const extra = type.startsWith("text/html") ? { "content-security-policy": PAGE_CSP } : {};
    if (type === "font/woff2") extra["cache-control"] = "max-age=86400";
    return send(res, 200, body, type, extra);
  }

  async function status() {
    const from = inproc ? (inproc.keyFrom ?? null) : await keys.source();
    return {
      service: inproc ? inproc.label : serviceLabel(service),
      source: inproc ? inproc.kind : "service",
      demo: inproc?.kind === "demo",
      read_only: Boolean(inproc?.readOnly),
      can_try: inproc ? inproc.canTry !== false : true,
      signed_in: Boolean(inproc) || Boolean(from),
      key_from: from,
      can_forget: !inproc && from === "saved",
      ...(inproc?.kind === "file" ? { lifecycle_file: inproc.file } : {}),
      version,
    };
  }

  // One request to the service (or the in-process source). Returns { status, type, body }.
  async function upstream(method, path, search, body) {
    if (inproc) {
      const parsed = body && body.length ? JSON.parse(body.toString("utf8")) : {};
      return inproc.handle(method, path, new URLSearchParams(search), parsed);
    }
    const key = await keys.get();
    if (!key) return { status: 401, type: "application/json", body: { error: "The console has no key for this service yet.", need_key: true } };
    const headers = { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": `adlc-console/${version}` };
    const sends = method === "POST" || method === "PUT";
    if (sends) headers["content-type"] = "application/json";
    let r;
    try {
      r = await fetchImpl(`${service.replace(/\/+$/, "")}${path}${search}`, {
        method, headers, body: sends ? (body?.length ? body : "{}") : undefined,
        redirect: "error", signal: AbortSignal.timeout(method === "POST" && MODEL_POST.test(path) ? MODEL_TIMEOUT : UPSTREAM_TIMEOUT),
      });
    } catch {
      return { status: 502, type: "application/json", body: { error: `The service at ${serviceLabel(service)} did not answer.` } };
    }
    const type = r.headers.get("content-type") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (type.includes("json")) {
      try { return { status: r.status, type: "application/json", body: JSON.parse(buf.toString("utf8")) }; } catch { /* fall through */ }
    }
    if (r.ok) return { status: r.status, type: "application/octet-stream", body: buf };
    return { status: r.status, type: "application/json", body: { error: `The service answered with an error (${r.status}).` } };
  }

  async function proxy(req, res, url) {
    const path = url.pathname.slice("/api".length);
    // Analytics: only read, with only its window and project passed on.
    if (path === ANALYTICS) {
      if (req.method !== "GET") return fail(res, 405, "Not allowed.");
      const q = new URLSearchParams();
      const w = url.searchParams.get("window") ?? "";
      if (WINDOWS.has(w)) q.set("window", w);
      const project = (url.searchParams.get("project") ?? "").trim();
      if (project && project.length <= PROJECT_MAX) q.set("project", project);
      const out = await upstream("GET", path, q.size ? `?${q}` : "", null);
      if (out.type === "application/json") return send(res, out.status, out.body, "application/json; charset=utf-8", { "content-security-policy": "default-src 'none'; sandbox" });
      return fail(res, out.status >= 400 ? out.status : 502, "The service's analytics answer was not readable.");
    }
    // A choice for the organization or a project: who holds a role (0.2), or whether a stage is used (0.3).
    const choice = ROLES.test(path) ? "roles" : STAGES.test(path) ? "stages" : null;
    const chat = PRODUCT_CHAT.test(path) || BOSS_CHAT.test(path);
    const readOnly = READ_ONLY.has(path) || PRODUCTS.test(path) || BOSS_COMMITMENTS.test(path) || FEATURES.test(path) || DOCUMENTS.test(path);
    if ((!choice && !readOnly && !chat && !LIFECYCLE.test(path)) || path.split("/").some((s) => s === ".." || s === "." || /%2e%2e|%2f|%5c/i.test(s))) {
      return fail(res, 404, "Nothing here.");
    }
    // Builds and a product's stage chat take GET and POST; a list of roles or stages is read, and
    // one role or stage is read, chosen (PUT) or set back (DELETE).
    const methods = readOnly ? ["GET"] : !choice ? ["GET", "POST"] : path === `/v1/lifecycle/${choice}` ? ["GET"] : ["GET", "PUT", "DELETE"];
    if (!methods.includes(req.method)) return fail(res, 405, "Not allowed.");
    const isFile = /\/files$/.test(path);
    const project = (url.searchParams.get("project") ?? "").trim();
    const version = (url.searchParams.get("version") ?? "").trim();
    // The only queries that go through: a file's path, asking the list for archived builds too,
    // and the project a role or a stage is chosen for.
    const search = isFile ? `?${new URLSearchParams({ path: url.searchParams.get("path") ?? "" })}`
      : path === "/v1/lifecycle/builds" && req.method === "GET" && url.searchParams.get("archived") === "1" ? "?archived=1"
        : choice && project && project.length <= PROJECT_MAX ? `?${new URLSearchParams({ project })}`
          // The product's features matrix, for one version (0.4.3).
          : FEATURES.test(path) && path.endsWith("/features") && version && version.length <= VERSION_MAX ? `?${new URLSearchParams({ version })}` : "";
    const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : null;
    if (body?.length) {
      try { JSON.parse(body.toString("utf8")); } catch { return fail(res, 400, "That request was not readable."); }
    }
    const out = await upstream(req.method, path, search, body);
    // Whatever the service sends back is shown as data, never run as a page.
    const sandbox = { "content-security-policy": "default-src 'none'; sandbox" };
    if (out.type === "application/json") return send(res, out.status, out.body, "application/json; charset=utf-8", sandbox);
    return send(res, out.status, Buffer.isBuffer(out.body) ? out.body : Buffer.from(String(out.body)), "text/plain; charset=utf-8", sandbox);
  }

  function addressedToUs(req) {
    return allowedHosts.has(String(req.headers.host || "").toLowerCase());
  }

  function postAllowed(req) {
    if (req.headers["x-adlc-console"] !== "1") return false;
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return false;
    const o = req.headers.origin;
    return !o || origin().includes(o);
  }

  async function route(req, res) {
    if (!addressedToUs(req)) return fail(res, 421, "This server only answers its own page.");
    const url = new URL(req.url, "http://local");
    const p = url.pathname;
    if (req.method !== "GET" && !postAllowed(req)) return fail(res, 403, "This server only answers its own page.");

    if (p.startsWith("/api/")) return proxy(req, res, url);

    if (p === "/local/status" && req.method === "GET") return send(res, 200, await status());
    // The organization's own stages, kept in the lifecycle file (--lifecycle). A service has no such route.
    const added = /^\/local\/added-stages(?:\/([a-z0-9-]{1,64}))?$/.exec(p);
    if (added && inproc?.kind === "file") {
      const project = (url.searchParams.get("project") ?? "").trim();
      const q = new URLSearchParams(project && project.length <= PROJECT_MAX ? { project } : {});
      const out = await inproc.handleAdded(req.method, added[1] ?? null, q, req.method === "DELETE" ? {} : await jsonBody(req));
      return send(res, out.status, out.body);
    }
    if (p === "/local/stages" && req.method === "GET") return send(res, 200, stages);
    if (p === "/local/key" && req.method === "POST") {
      if (inproc) return fail(res, 409, `${inproc.label} needs no service key.`);
      const { key } = await jsonBody(req);
      try { await keys.save(key); } catch (e) { return fail(res, 400, e.message); }
      return send(res, 200, await status());
    }
    if (p === "/local/forget-key" && req.method === "POST") {
      if (!inproc) await keys.forget();
      return send(res, 200, await status());
    }
    if (p === "/local/check" && req.method === "POST") {
      const { folder, agent } = await jsonBody(req);
      try {
        return send(res, 200, { result: await check(folder, { agent: typeof agent === "string" ? agent : "" }) });
      } catch (e) {
        if (e instanceof CheckRefused) return fail(res, 400, e.message);
        throw e;
      }
    }
    if (req.method === "GET" && !p.startsWith("/local/")) return serveStatic(res, p);
    return fail(res, 404, "Nothing here.");
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) return res.destroy();
      if (e.status === 413) return fail(res, 413, "That request is too big.");
      if (e.status === 400) return fail(res, 400, "That request was not readable.");
      fail(res, 500, "Something went wrong in the console.");
    });
  });

  return {
    server,
    async listen(port = 0, host = "127.0.0.1") {
      await new Promise((ok, no) => { server.once("error", no); server.listen(port, host, ok); });
      const actual = server.address().port;
      allowedHosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
      return `http://127.0.0.1:${actual}/`;
    },
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
