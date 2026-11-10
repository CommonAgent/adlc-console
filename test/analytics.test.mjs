// The Analytics page and the route it reads, GET /v1/lifecycle/analytics: a
// service's own addition, outside the lifecycle API standard. The demo answers
// it with made-up weeks; the page draws the four answers; the proxy passes only
// the window and the project; and a service without the route never shows it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService, demoAnalytics } from "../lib/demo.mjs";
import { checkAnalytics } from "../lib/contract.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { analyticsHtml, analyticsOffered, analyticsQuery, analyticsHash, analyticsPath, weekLabel } from "../public/analytics.js";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STAGES = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const MIN = 60_000;
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const NOW = Date.parse("2026-11-08T12:00:00Z"); // a Sunday: its week began Monday 2026-11-02

test("the demo answers analytics with made-up weeks, in the contract's shape", async () => {
  const svc = createDemoService();
  for (const w of ["7d", "30d", "all"]) {
    const r = await svc.handle("GET", "/v1/lifecycle/analytics", new URLSearchParams({ window: w }), {});
    assert.equal(r.status, 200);
    assert.deepEqual(checkAnalytics(r.body), [], w);
    assert.equal(r.body.window, w);
  }
  assert.deepEqual(demoAnalytics("7d", null, NOW).weeks, ["2026-10-26", "2026-11-02"]);
  assert.deepEqual(demoAnalytics("30d", null, NOW).weeks, ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  assert.equal(demoAnalytics("all", null, NOW).weeks.length, 12);
  // The same week gives the same numbers; a project's are part of every project's.
  assert.deepEqual(demoAnalytics("30d", null, NOW), demoAnalytics("30d", null, NOW));
  const all = demoAnalytics("30d", null, NOW);
  const fin = demoAnalytics("30d", "finance", NOW);
  assert.equal(fin.project, "finance");
  const started = (a) => a.builds.reduce((n, x) => n + x.started, 0);
  assert.ok(started(fin) > 0 && started(fin) < started(all));
  assert.equal(started(demoAnalytics("30d", "nobody", NOW)), 0);
  assert.equal((await svc.handle("GET", "/v1/lifecycle/analytics", new URLSearchParams({ window: "1y" }), {})).status, 400);
  assert.equal((await svc.handle("POST", "/v1/lifecycle/analytics", new URLSearchParams(), {})).status, 405);
});

test("the contract check finds a wrong analytics answer", () => {
  assert.deepEqual(checkAnalytics(demoAnalytics("30d", null, NOW)), []);
  const bad = { window: "1y", project: 3, weeks: ["2026-11-02", "2026-10-26"], builds: [{ week: "x", started: -1, finished: 1.5 }], stage_times: [{ stage: "code", weeks: [{ week: "2026-11-02", median_ms: "4 min", builds: 1 }] }], send_backs: [{ stage: "code", rounds: 2, back: 3, rate: 1.5 }], waiting: "none" };
  const p = checkAnalytics(bad).join("\n");
  for (const want of [/window is one of/, /project is words or null/, /weeks are oldest first/, /builds\[0\]: week is a date/, /started is a count/, /finished is a count/, /median_ms is a number/, /back is a count, at most rounds/, /rate is a number from 0 to 1/, /waiting is a list/]) assert.match(p, want);
});

test("the page's window and project, in the hash and on the service path", () => {
  assert.deepEqual(analyticsQuery("analytics"), { window: "30d", project: "" });
  assert.deepEqual(analyticsQuery("analytics?window=7d&project=web"), { window: "7d", project: "web" });
  assert.deepEqual(analyticsQuery("analytics?window=1y"), { window: "30d", project: "" });
  assert.equal(analyticsHash({ window: "30d", project: "" }), "#/analytics");
  assert.equal(analyticsHash({ window: "all", project: "web team" }), "#/analytics?window=all&project=web+team");
  assert.equal(analyticsPath({ window: "7d", project: "" }), "/analytics?window=7d");
  assert.equal(analyticsPath({ window: "all", project: "web" }), "/analytics?window=all&project=web");
  assert.equal(weekLabel("2026-11-02"), "Nov 2");
});

test("the page draws the four answers as tables with bars, and the filters", () => {
  const data = {
    window: "30d", project: null, weeks: ["2026-10-26", "2026-11-02"], projects: ["finance", "<web>"],
    builds: [{ week: "2026-10-26", started: 1, finished: 0, stopped: 1 }, { week: "2026-11-02", started: 3, finished: 2, stopped: 0 }],
    stage_times: [{ stage: "code", name: "Code", weeks: [{ week: "2026-11-02", median_ms: 24 * MIN, builds: 2 }] }],
    send_backs: [{ stage: "code", name: "Code", rounds: 4, back: 1, rate: 0.25, builds: 2 }],
    waiting: [{ week: "2026-10-26", person_ms: 0, agent_ms: 0 }, { week: "2026-11-02", person_ms: 125 * MIN, agent_ms: 40 * MIN }],
  };
  const html = analyticsHtml(data, { window: "30d", project: "" }, { service: "127.0.0.1:4100" });
  const text = visible(html);
  assert.match(text, /Analytics/);
  assert.match(text, /Builds started and finished Week of Started Finished Nov 2 3 2 Oct 26 1 0/);
  assert.match(text, /1 stopped in this window, not counted as finished\./);
  assert.match(text, /Median time per stage Stage Oct 26 Nov 2 Code · 24 min/);
  assert.match(text, /How often work is sent back Stage Sent back Rounds Code 25% 1 of 4/);
  assert.match(text, /2 h 5 min waiting on people · 40 min with agents working/);
  assert.match(text, /From 127\.0\.0\.1:4100's history of its builds, never estimated\./);
  // Bars drawn in CSS from data-w, never inline styles; the project names are escaped.
  assert.ok((html.match(/<span class="hb/g) ?? []).length >= 6);
  assert.ok(!/style=/.test(html));
  assert.match(html, /<option value="&lt;web&gt;">&lt;web&gt;<\/option>/);
  assert.match(html, /<option value="30d" selected>Last 30 days<\/option>/);
  assert.match(html, /<option value="" selected>Every project<\/option>/);

  const empty = visible(analyticsHtml({ window: "7d", project: "x", weeks: ["2026-11-02"], projects: [], builds: [{ week: "2026-11-02", started: 0, finished: 0, stopped: 0 }], stage_times: [], send_backs: [], waiting: [{ week: "2026-11-02", person_ms: 0, agent_ms: 0 }] }, { window: "7d", project: "x" }));
  assert.match(empty, /No build started or finished in this window\. .*No stage ran a round in this window\. .*No step finished in this window\. .*No stage finished in this window\./);
  assert.match(analyticsHtml(null, { window: "30d", project: "" }), /Reading the history/);
  // The demo's answer draws without a problem.
  assert.match(visible(analyticsHtml(demoAnalytics("all", null, NOW), { window: "all", project: "" })), /Requirements/);
});

test("the rail shows Analytics only when the service answers the route", async () => {
  assert.equal(analyticsOffered(200, demoAnalytics("7d", null, NOW)), true);
  assert.equal(analyticsOffered(404, { error: "Nothing here." }), false);
  assert.equal(analyticsOffered(200, { builds: [] }), false);
  assert.equal(analyticsOffered(0, null), false);
  // Until the service has answered, the link is hidden.
  const page = await readFile(join(HERE, "..", "public", "index.html"), "utf8");
  assert.match(page, /<a id="analytics" href="#\/analytics" hidden>/);
  const app = await readFile(join(HERE, "..", "public", "app.js"), "utf8");
  assert.match(app, /an\.hidden = !state\.analytics/);
});

async function consoleFor(answer) {
  const svc = await fakeService(answer);
  const keys = createKeyStore({ service: svc.url, env: { ADLC_KEY: "test-key-0123456789abcdef" }, dir: await tempDir("an") });
  const app = createConsoleServer({ service: svc.url, keys, stages: STAGES, version: "test" });
  const url = await app.listen(0);
  return { svc, url, host: new URL(url).host, done: async () => { await app.close(); await svc.close(); } };
}

test("the proxy passes analytics with only its window and project; a service without it answers 404", async () => {
  const s = await consoleFor((req) => (req.url.startsWith("/v1/lifecycle/analytics") ? { body: demoAnalytics("7d", null, NOW) } : { status: 404, body: { error: "Nothing here." } }));
  try {
    const r = await hit(s.url, { path: "/api/v1/lifecycle/analytics?window=7d&project=web&other=x", headers: { host: s.host } });
    assert.equal(r.status, 200);
    assert.equal(analyticsOffered(r.status, r.json), true);
    assert.equal(s.svc.seen[0].url, "/v1/lifecycle/analytics?window=7d&project=web");
    assert.equal(s.svc.seen[0].headers.authorization, "Bearer test-key-0123456789abcdef");
    assert.match(r.headers["content-security-policy"], /sandbox/);
    await hit(s.url, { path: "/api/v1/lifecycle/analytics?window=1y", headers: { host: s.host } });
    assert.equal(s.svc.seen[1].url, "/v1/lifecycle/analytics");
    const post = await hit(s.url, { method: "POST", path: "/api/v1/lifecycle/analytics", headers: { host: s.host }, body: {} });
    assert.equal(post.status, 405);
  } finally { await s.done(); }

  // A lifecycle service that keeps no history: the route is absent, so the page stays hidden.
  const plain = await consoleFor(() => ({ status: 404, body: { error: "Nothing here." } }));
  try {
    const r = await hit(plain.url, { path: "/api/v1/lifecycle/analytics?window=7d", headers: { host: plain.host } });
    assert.equal(r.status, 404);
    assert.equal(analyticsOffered(r.status, r.json), false);
  } finally { await plain.done(); }
});

test("the demo console answers analytics, so its page is shown", async () => {
  const app = createConsoleServer({ demo: createDemoService(), stages: STAGES, version: "test" });
  const url = await app.listen(0);
  try {
    const r = await hit(url, { path: "/api/v1/lifecycle/analytics?window=all", headers: { host: new URL(url).host } });
    assert.equal(r.status, 200);
    assert.equal(analyticsOffered(r.status, r.json), true);
    assert.equal(r.json.window, "all");
  } finally { await app.close(); }
});
