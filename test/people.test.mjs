// Who you are, who may answer a gate, and the People page, drawn from what a
// service that keeps people answers; and the proxy routes they read, GET only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { meWords, whoMayHtml, peoplePageHtml } from "../public/people.js";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { lifecycleModel } from "../lib/lifecycle-file.mjs";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STAGES = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const PEOPLE = {
  organization: "Example Org",
  people: [
    { name: "Ana Lee", email: "ana@example.com", role: "approver", teams: ["Platform"] },
    { name: "Max Kim", email: "max@example.com", role: "member", teams: [] },
  ],
  teams: [{ name: "Platform", members: ["ana@example.com"] }],
  projects: [{ name: "billing", teams: ["Platform"] }],
  problems: [],
  change: "People are changed with the command line: product-factory person add <email> --role approver.",
};

test("the top bar says who you are when the service says, and nothing when it does not", () => {
  assert.equal(meWords({ account: { name: "Ana Lee", email: "ana@example.com" }, role: "approver" }), "Ana Lee · approver");
  assert.equal(meWords({ account: { name: "Ana Lee", email: "ana@example.com" } }), "Ana Lee");
  assert.equal(meWords({ account: { name: "Ana Lee" }, role: "owner" }), "Ana Lee");
  assert.equal(meWords(null), "");
});

test("a gate you may not answer says who may, in the service's words; one you may answer says nothing", () => {
  const no = { stage: "requirements", state: "waiting_on_you", gate: { you_may_answer: false, who: ["Ana Lee (ana@example.com)"], words: "Only Ana Lee (ana@example.com) may answer the Requirements gate." } };
  assert.equal(visible(whoMayHtml(no)), "Only Ana Lee (ana@example.com) may answer the Requirements gate.");
  assert.equal(whoMayHtml({ ...no, gate: { ...no.gate, you_may_answer: true } }), "");
  assert.equal(whoMayHtml({ stage: "requirements", state: "waiting_on_you" }), "");
  assert.match(whoMayHtml({ gate: { you_may_answer: false, words: "<b>x</b>" } }), /&lt;b&gt;/);
});

test("the People page lists people, teams, roles and projects, read-only, with the service's problems", () => {
  const page = visible(peoplePageHtml(PEOPLE));
  assert.match(page, /Example Org: 2 people, 1 team and 1 project\. Read-only here\./);
  assert.match(page, /Ana Lee ana@example.com approver Platform/);
  assert.match(page, /Max Kim max@example.com member none/);
  assert.match(page, /Platform ana@example.com/);
  assert.match(page, /billing Platform/);
  assert.match(page, /product-factory person add <email> --role approver/);
  assert.doesNotMatch(peoplePageHtml(PEOPLE), /<input|<button|<form/);
  const bad = visible(peoplePageHtml({ ...PEOPLE, problems: ["The team Design is not in people.json."] }));
  assert.match(bad, /The service found a problem The team Design is not in people.json\./);
  assert.match(visible(peoplePageHtml({})), /0 people, 0 teams and 0 projects/);
});

test("who you are and the service's people are read through the proxy, and never changed", async () => {
  const svc = await fakeService((req) => ({ body: req.url === "/v1/lifecycle/me" ? { account: { name: "Ana Lee", email: "ana@example.com" }, service: { name: "S" }, role: "approver" } : PEOPLE }));
  const dir = await tempDir("ppl");
  const app = createConsoleServer({ service: svc.url, keys: createKeyStore({ service: svc.url, env: { ADLC_KEY: "k-0123456789abcdef" }, dir }), stages: STAGES, version: "test" });
  const url = await app.listen(0);
  const host = new URL(url).host;
  const h = { host, "x-adlc-console": "1", "content-type": "application/json" };
  try {
    assert.equal((await hit(url, { path: "/api/v1/lifecycle/me", headers: { host } })).json.role, "approver");
    assert.equal((await hit(url, { path: "/api/v1/lifecycle/people", headers: { host } })).json.organization, "Example Org");
    assert.deepEqual(svc.seen.map((r) => [r.method, r.url]), [["GET", "/v1/lifecycle/me"], ["GET", "/v1/lifecycle/people"]]);
    assert.equal((await hit(url, { method: "POST", path: "/api/v1/lifecycle/people", headers: h, body: {} })).status, 405);
    assert.equal((await hit(url, { method: "PUT", path: "/api/v1/lifecycle/me", headers: h, body: {} })).status, 405);
    assert.equal((await hit(url, { path: "/api/v1/lifecycle/people/ana", headers: { host } })).status, 404);
    assert.equal(svc.seen.length, 2);
    const page = await hit(url, { path: "/people.js", headers: { host } });
    assert.equal(page.status, 200);
  } finally { await app.close(); await svc.close(); }
});

test("a lifecycle file may name who approves each gate (lifecycle document approvers)", () => {
  const m = lifecycleModel(STAGES);
  assert.deepEqual(m.problems({ version: "0.1", organization: { approvers: { requirements: [{ team: "Platform" }, { person: "ana@example.com" }] } }, projects: { web: { approvers: { code: [] } } } }), []);
  const p = m.problems({ version: "0.1", organization: { approvers: { requirements: [{ who: "x" }], code: "Platform" } } });
  assert.match(p.join("\n"), /requirements\[0\] has "who", which the format does not have/);
  assert.match(p.join("\n"), /approvers.code must be a list/);
});
