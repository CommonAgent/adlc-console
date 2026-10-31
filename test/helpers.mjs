import { request, createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempDir = (name) => mkdtemp(join(process.env.ADLC_TEST_TMP || tmpdir(), `adlc-console-${name}-`));

// One request to a local server, with full control of the headers.
export function hit(url, { method = "GET", path = "/", headers = {}, body } = {}) {
  const u = new URL(url);
  const data = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const h = { ...headers };
  if (method === "POST" && !("x-adlc-console" in h)) h["x-adlc-console"] = "1";
  if (method === "POST" && !("content-type" in h)) h["content-type"] = "application/json";
  if (data) h["content-length"] = data.length;
  return new Promise((ok, no) => {
    const req = request({ host: u.hostname, port: u.port, method, path, headers: h }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        ok({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", no);
    if (data) req.write(data);
    req.end();
  });
}

// A stand-in lifecycle service that records what it was sent.
export async function fakeService(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const out = answer(req, body);
      res.writeHead(out.status ?? 200, { "content-type": out.type ?? "application/json" });
      res.end(typeof out.body === "string" ? out.body : JSON.stringify(out.body));
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((ok) => server.close(ok)) };
}
