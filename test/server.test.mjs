import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STAGES = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const KEY = "test-key-0123456789abcdef";

async function setup({ key = KEY, answer } = {}) {
  const svc = await fakeService(answer ?? ((req) => {
    if (req.url.includes("/files")) return { type: "text/plain", body: "<script>alert(1)</script>" };
    return { body: { builds: [], echo: req.url } };
  }));
  const dir = await tempDir("srv");
  const keys = createKeyStore({ service: svc.url, env: key ? { ADLC_KEY: key } : {}, dir });
  const app = createConsoleServer({ service: svc.url, keys, stages: STAGES, version: "test" });
  const url = await app.listen(0);
  const host = new URL(url).host;
  return { svc, app, url, host, keys, dir, done: async () => { await app.close(); await svc.close(); } };
}

test("status says whether a key is held, and never shows it", async () => {
  const s = await setup();
  try {
    const r = await hit(s.url, { path: "/local/status", headers: { host: s.host } });
    assert.equal(r.status, 200);
    assert.equal(r.json.signed_in, true);
    assert.equal(r.json.key_from, "environment");
    assert.ok(!r.text.includes(KEY));
  } finally { await s.done(); }
});

test("the proxy adds the key and passes the service's answer through", async () => {
  const s = await setup();
  try {
    const r = await hit(s.url, { path: "/api/v1/lifecycle/builds", headers: { host: s.host } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.builds, []);
    assert.equal(s.svc.seen[0].url, "/v1/lifecycle/builds");
    assert.equal(s.svc.seen[0].headers.authorization, `Bearer ${KEY}`);
    assert.match(r.headers["content-security-policy"], /sandbox/);
  } finally { await s.done(); }
});

test("an action is posted to the service with its inputs", async () => {
  const s = await setup();
  try {
    const r = await hit(s.url, { method: "POST", path: "/api/v1/lifecycle/builds/b1/actions/approve", headers: { host: s.host }, body: { repository: "me/agent" } });
    assert.equal(r.status, 200);
    const seen = s.svc.seen[0];
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/v1/lifecycle/builds/b1/actions/approve");
    assert.deepEqual(JSON.parse(seen.body), { repository: "me/agent" });
    assert.equal(seen.headers.authorization, `Bearer ${KEY}`);
  } finally { await s.done(); }
});

test("a file comes back as plain text, never as a page", async () => {
  const s = await setup();
  try {
    const r = await hit(s.url, { path: "/api/v1/lifecycle/builds/b1/files?path=scripts%2Fjudge.mjs&other=x", headers: { host: s.host } });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /^text\/plain/);
    assert.match(r.headers["content-security-policy"], /sandbox/);
    assert.equal(s.svc.seen[0].url, "/v1/lifecycle/builds/b1/files?path=scripts%2Fjudge.mjs");
  } finally { await s.done(); }
});

test("requests addressed to another name are refused", async () => {
  const s = await setup();
  try {
    const r = await hit(s.url, { path: "/local/status", headers: { host: "evil.example" } });
    assert.equal(r.status, 421);
    const r2 = await hit(s.url, { path: "/api/v1/lifecycle/builds", headers: { host: `evil.example:${new URL(s.url).port}` } });
    assert.equal(r2.status, 421);
    assert.equal(s.svc.seen.length, 0);
  } finally { await s.done(); }
});

test("a post from another page is refused", async () => {
  const s = await setup();
  try {
    const noHeader = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host, "x-adlc-console": "" }, body: {} });
    assert.equal(noHeader.status, 403);
    const form = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host, "content-type": "text/plain" }, body: "{}" });
    assert.equal(form.status, 403);
    const other = await hit(s.url, { method: "POST", path: "/api/v1/lifecycle/builds", headers: { host: s.host, origin: "https://evil.example" }, body: {} });
    assert.equal(other.status, 403);
    assert.equal(s.svc.seen.length, 0);
  } finally { await s.done(); }
});

test("the list may ask for archived builds too, and no other query goes through", async () => {
  const s = await setup();
  try {
    await hit(s.url, { path: "/api/v1/lifecycle/builds?archived=1", headers: { host: s.host } });
    await hit(s.url, { path: "/api/v1/lifecycle/builds?archived=1&x=2", headers: { host: s.host } });
    await hit(s.url, { path: "/api/v1/lifecycle/builds?other=1", headers: { host: s.host } });
    await hit(s.url, { path: "/api/v1/lifecycle/builds/b1?archived=1", headers: { host: s.host } });
    assert.deepEqual(s.svc.seen.map((x) => x.url), ["/v1/lifecycle/builds?archived=1", "/v1/lifecycle/builds?archived=1", "/v1/lifecycle/builds", "/v1/lifecycle/builds/b1"]);
  } finally { await s.done(); }
});

test("only lifecycle paths go through the proxy", async () => {
  const s = await setup();
  try {
    for (const path of ["/api/v1/accounts/me", "/api/v1/lifecycle/builds/..%2f..%2fadmin", "/api/v1/lifecycle/builds/a/b/c/d/e/f", "/api/v1/lifecycle/other"]) {
      const r = await hit(s.url, { path, headers: { host: s.host } });
      assert.equal(r.status, 404, path);
    }
    assert.equal(s.svc.seen.length, 0);
  } finally { await s.done(); }
});

test("with no key, the page is told to ask for one and the service is not called", async () => {
  const s = await setup({ key: null });
  try {
    const st = await hit(s.url, { path: "/local/status", headers: { host: s.host } });
    assert.equal(st.json.signed_in, false);
    const r = await hit(s.url, { path: "/api/v1/lifecycle/builds", headers: { host: s.host } });
    assert.equal(r.status, 401);
    assert.equal(r.json.need_key, true);
    assert.equal(s.svc.seen.length, 0);
  } finally { await s.done(); }
});

test("a key pasted in the page is kept in a file only the person can read, and can be forgotten", async () => {
  const s = await setup({ key: null });
  try {
    const bad = await hit(s.url, { method: "POST", path: "/local/key", headers: { host: s.host }, body: { key: "no" } });
    assert.equal(bad.status, 400);
    const r = await hit(s.url, { method: "POST", path: "/local/key", headers: { host: s.host }, body: { key: KEY } });
    assert.equal(r.status, 200);
    assert.equal(r.json.key_from, "saved");
    assert.ok(!r.text.includes(KEY));
    const file = join(s.dir, "keys.json");
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    await hit(s.url, { path: "/api/v1/lifecycle/builds", headers: { host: s.host } });
    assert.equal(s.svc.seen.at(-1).headers.authorization, `Bearer ${KEY}`);
    const f = await hit(s.url, { method: "POST", path: "/local/forget-key", headers: { host: s.host }, body: {} });
    assert.equal(f.json.signed_in, false);
    assert.ok(!(await readFile(file, "utf8")).includes(KEY));
  } finally { await s.done(); }
});

test("a service that does not answer gets plain words", async () => {
  const dir = await tempDir("down");
  const keys = createKeyStore({ service: "http://127.0.0.1:1", env: { ADLC_KEY: KEY }, dir });
  const app = createConsoleServer({ service: "http://127.0.0.1:1", keys, stages: STAGES });
  const url = await app.listen(0);
  try {
    const r = await hit(url, { path: "/api/v1/lifecycle/builds", headers: { host: new URL(url).host } });
    assert.equal(r.status, 502);
    assert.match(r.json.error, /did not answer/);
  } finally { await app.close(); }
});

test("the service's own error words reach the page", async () => {
  const s = await setup({ answer: () => ({ status: 409, body: { error: "This build does not offer that now." } }) });
  try {
    const r = await hit(s.url, { method: "POST", path: "/api/v1/lifecycle/builds/b1/actions/accept", headers: { host: s.host }, body: {} });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "This build does not offer that now.");
  } finally { await s.done(); }
});

test("the local check runs node .adlc/check.mjs in the named folder, without the key", async () => {
  const s = await setup();
  try {
    const good = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host }, body: { folder: join(HERE, "fixtures", "clone") } });
    assert.equal(good.status, 200);
    assert.equal(good.json.result.passed, true);
    assert.match(good.json.result.output, /14 of 14/);
    assert.ok(!good.json.result.output.includes("THE KEY LEAKED"));
    const bad = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host }, body: { folder: join(HERE, "fixtures", "failing-clone") } });
    assert.equal(bad.json.result.passed, false);
    assert.equal(bad.json.result.exit, 1);
    assert.match(bad.json.result.output, /punctuation is ignored/);
  } finally { await s.done(); }
});

test("the local check finds the build's own folder in a clone that holds several hand-offs, and never runs another agent's check", async () => {
  // A hand-off goes to agents/<name>/ in its repository (AgentMesh technical
  // debt 653); a repository may also hold an earlier hand-off at its root.
  const s = await setup();
  try {
    const repo = join(HERE, "fixtures", "repo");
    const top = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host }, body: { folder: repo, agent: "acro" } });
    assert.equal(top.status, 200);
    assert.match(top.json.result.output, /14 of 14 for acro/);
    assert.equal(top.json.result.folder, join(repo, "agents", "acro"));
    const inside = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host }, body: { folder: join(repo, "agents", "acro"), agent: "acro" } });
    assert.match(inside.json.result.output, /14 of 14 for acro/);
    const other = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host }, body: { folder: repo, agent: "palindrome-judge" } });
    assert.equal(other.status, 400);
    assert.match(other.json.error, /word-reverser, not palindrome-judge/);
    // Without a name, or for a folder that does not say whose it is, as before.
    const old = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host }, body: { folder: join(HERE, "fixtures", "clone"), agent: "acro" } });
    assert.equal(old.json.result.passed, true);
  } finally { await s.done(); }
});

test("the local check refuses a folder without the check, or a partial path", async () => {
  const s = await setup();
  try {
    for (const folder of [HERE, "fixtures/clone", "", join(HERE, "nowhere"), join(HERE, "server.test.mjs")]) {
      const r = await hit(s.url, { method: "POST", path: "/local/check", headers: { host: s.host }, body: { folder } });
      assert.equal(r.status, 400, folder);
      assert.equal(typeof r.json.error, "string");
    }
  } finally { await s.done(); }
});

test("the page is served with a strict policy, and nothing outside it", async () => {
  const s = await setup();
  try {
    const r = await hit(s.url, { path: "/", headers: { host: s.host } });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-security-policy"], /default-src 'self'/);
    assert.match(r.text, /ADLC Console/);
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/app.js.map", "/local/nothing"]) {
      const x = await hit(s.url, { path, headers: { host: s.host } });
      assert.equal(x.status, 404, path);
    }
    const stages = await hit(s.url, { path: "/local/stages", headers: { host: s.host } });
    assert.equal(stages.json.stages.length, 24);
  } finally { await s.done(); }
});
