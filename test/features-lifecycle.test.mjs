// Features through the lifecycle (lifecycle API 0.4.5) in the console: the
// Requirements stage's Features tab (each feature's state, the message it came
// from, Approve feature and Not now inline, Approve all, the tests not tied to
// a feature, and List this product's features when there are none), each
// stage's features in its Artifacts tab, and the counts on the spine. Against
// made-up answers in the contract's shape, held to the lifecycle API's own check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { requirementsFeaturesHtml, stageFeaturesHtml, featureStateOf, approveAllIds, approveAllRequest, fromHref, featureDecision } from "../public/features.js";
import { steps, spineHtml, stageWorkspace, artifactsTabHtml } from "../public/workspace.js";
import { checkFeatures, checkStageWorkspace } from "../standards/lifecycle-api-check.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const AT = "2026-11-08T10:00:00Z";

const cell = (state, words) => ({ state, words });
const cells = { spec: cell("done", "Spec v5"), tests: cell("done", "Tests 2/2"), code: cell("done", "Passes 2/2"), review: cell("done", "Reviewed"), docs: cell("missing", "No docs yet") };
const proposal = (id, extra = {}) => ({ proposal: `fp_${id}`, feature: id, name: `Name ${id}`, does: `Does ${id}.`, offering: "Count words", change: "new", state: "open", you_may_approve: true, approvers: [], ...extra });
const row = (id, extra = {}) => ({ id, name: `Name ${id}`, does: `Does ${id}.`, offering: "Count words", state: "approved", backlog: false, badge: "new", cells, tests: ["a test"], from: { build: "b1", stage: "requirements", message: "t_2" }, ...extra });
const missing = { ...cells, spec: cell("missing", "Proposed, not approved") };
const matrix = (features, extra = {}) => ({ product: "word-counter", build: "b1", version: "0.1.0", versions: [{ version: "0.1.0", build: "b1" }], columns: ["spec", "tests", "code", "review", "docs"], features, ...extra });

test("the Requirements Features tab: each feature's state, the message it came from, its tests, and Approve feature and Not now inline", () => {
  const m = matrix([
    row("F1"),
    row("F2", { state: "proposed", cells: missing, pending: proposal("F2"), tests: [] }),
    row("F3", { badge: "changed" }),
    row("F4", { pending: proposal("F4", { change: "changed", name: "Name F4", does: "Does F4 better.", was: { name: "Name F4", does: "Does F4.", offering: "Count words" } }) }),
    row("F5", { state: "proposed", backlog: true, cells: missing, pending: proposal("F5", { state: "not_now", answered: { decision: "not_now", by: "You", at: AT } }) }),
  ], { unmapped: ["markdown is parsed to find the sentence"] });
  assert.deepEqual(checkFeatures(m, "b1"), []);
  assert.deepEqual(m.features.map((r) => featureStateOf(r).label), ["Approved", "Proposed", "Changed in this version", "Change proposed", "Not now"]);
  const html = requirementsFeaturesHtml(m);
  assert.match(visible(html), /^5 features in 0\.1\.0 · 3 approved · 1 proposed · 2 changed · 1 not now/);
  assert.match(visible(html), /F1 Name F1 Approved Count words Does F1\. From the message 1 test/);
  assert.match(visible(html), /F2 Name F2 Proposed Count words Does F2\. From the message no test yet Approve feature Not now/);
  assert.match(visible(html), /F4 Name F4 Change proposed Count words Does F4\. Proposed Name F4: Does F4 better\. Was Name F4: Does F4\./);
  // Inline buttons carry the same data as the chat's, so they post the same answer.
  assert.match(html, /<button class="btn sm p" type="button" data-feat="approve" data-feat-id="F2" data-feat-proposal="fp_F2" data-feat-build="b1" data-feat-message="t_2">Approve feature<\/button>/);
  assert.deepEqual(featureDecision({ feat: "not_now", featId: "F2", featProposal: "fp_F2", featBuild: "b1", featMessage: "t_2" }), { path: "/builds/b1/features/F2/not_now", body: { proposal: "fp_F2", message: "t_2" } });
  // Left for later: it can still be approved, and is not offered Not now again.
  assert.match(visible(html), /F5 Name F5 Not now Count words Does F5\. From the message 1 test Approve feature$|F5 Name F5 Not now Count words Does F5\. From the message 1 test Approve feature /);
  assert.equal((html.match(/data-feat="not_now" data-feat-id="F5"/g) ?? []).length, 0);
  // The message it came from opens that stage's chat.
  assert.match(html, /<a href="#\/b\/b1\/requirements\/chat">From the message<\/a>/);
  assert.equal(fromHref({ build: "b1", message: "t_9" }, "word-counter"), "#/p/word-counter/boss");
  assert.equal(fromHref(null), null);
  // Approve all: the waiting proposals this person may approve, not those left for later.
  assert.deepEqual(approveAllIds(m), ["fp_F2", "fp_F4"]);
  assert.match(html, /<button class="btn p" type="button" data-feat-all="fp_F2 fp_F4" data-feat-build="b1" data-feat-message="t_2">Approve all 2<\/button>/);
  // The tests no feature checks are shown as such.
  assert.match(visible(html), /1 test not tied to a feature markdown is parsed to find the sentence Left unmapped: nothing in the test's name or content made clear which feature it checks\./);
  // While anything is sent, every button waits.
  assert.match(requirementsFeaturesHtml(m, { allPending: true }), /disabled>Approving…</);
  assert.match(requirementsFeaturesHtml(m, { pending: "fp_F2 approve" }), /disabled>Sending…</);
});

test("Approve all sends every waiting proposal in one answer; someone who may not approve gets Ask instead and no Approve all", () => {
  assert.deepEqual(approveAllRequest({ featAll: "fp_F1 fp_F2", featBuild: "b1", featMessage: "t_2" }), { path: "/builds/b1/features/approve_all", body: { proposals: ["fp_F1", "fp_F2"], message: "t_2" } });
  assert.deepEqual(approveAllRequest({ featAll: "fp_F1", featBuild: "b1" }), { path: "/builds/b1/features/approve_all", body: { proposals: ["fp_F1"] } });
  assert.equal(approveAllRequest({ featAll: " ", featBuild: "b1" }), null);
  assert.equal(approveAllRequest({ featBuild: "b1" }), null);
  const theirs = (id) => row(id, { state: "proposed", cells: missing, pending: proposal(id, { you_may_approve: false, approvers: ["Ana Lee (ana@example.com)"] }) });
  const m = matrix([theirs("F1"), theirs("F2")]);
  assert.deepEqual(checkFeatures(m, "b1"), []);
  const html = requirementsFeaturesHtml(m);
  assert.doesNotMatch(html, /data-feat-all/);
  assert.match(html, /data-feat="ask" data-feat-id="F1"[^>]*>Ask Ana Lee to approve</);
  // One waiting proposal needs no Approve all.
  assert.doesNotMatch(requirementsFeaturesHtml(matrix([row("F1"), row("F2", { state: "proposed", cells: missing, pending: proposal("F2") })])), /data-feat-all/);
});

test("with no features, the tab offers List this product's features when the service can, and says why not otherwise", () => {
  const offered = matrix([], { words: "No features yet. This build was made before features.", backfill: { offered: true, words: "The spec writer lists the features of the spec v4, and maps the 29 tests already in the build to them where their names or content make it clear." } });
  assert.deepEqual(checkFeatures(offered, "b1"), []);
  const html = requirementsFeaturesHtml(offered);
  assert.match(visible(html), /^No features yet The spec writer lists the features of the spec v4, and maps the 29 tests already in the build to them where their names or content make it clear\. List this product's features$/);
  assert.match(html, /<button class="btn p" type="button" data-feat-backfill="b1">List this product's features<\/button>/);
  assert.match(visible(requirementsFeaturesHtml(offered, { listing: true })), /Listing… The spec writer is reading the spec and the suite\. This can take a few minutes\./);
  const not = matrix([], { words: "No features yet.", backfill: { offered: false, words: "There is no spec yet." } });
  assert.equal(visible(requirementsFeaturesHtml(not)), "No features yet.");
  assert.doesNotMatch(requirementsFeaturesHtml(not), /data-feat-backfill/);
  assert.equal(visible(requirementsFeaturesHtml(null)), "Loading…");
});

const slices = {
  test: { stage: "test", covered: 2, total: 3, words: "2 of 3 features", items: [
    { id: "F1", name: "Count words", state: "done", words: "2 tests", tests: ["the good case counts exactly the words", "[F1] counts"] },
    { id: "F2", name: "Refuse non-text", state: "done", words: "2 tests", tests: ["binary files and images are refused immediately", "multiple sentences or non-text content are refused"] },
    { id: "F3", name: "Stop on empty input", state: "to_do", words: "No test yet: to do", tests: [] },
  ], untied: { words: "1 test not tied to a feature", items: ["markdown is parsed to find the sentence"] } },
  code: { stage: "code", covered: 1, total: 2, words: "1 of 2 features pass", items: [
    { id: "F1", name: "Count words", state: "done", words: "6 of 6 passing", passed: 6, of: 6 },
    { id: "F2", name: "Refuse non-text", state: "failing", words: "1 of 2 passing", passed: 1, of: 2 },
  ] },
  review: { stage: "review", covered: 1, total: 2, words: "1 of 2 features clear", items: [
    { id: "F1", name: "Count words", state: "done", words: "No findings", findings: [] },
    { id: "F2", name: "Refuse non-text", state: "findings", words: "1 finding open", findings: [{ place: "test/count.test.mjs:12", claim: "The test asserts nothing.", open: true }] },
  ], untied: { words: "1 finding not tied to a feature", items: ["agent-runtime-requirements.json:34: The run command leaves out --records. (outside the change)"] } },
};

test("each stage's features in its Artifacts tab: tests per feature with to-do, passing per feature, findings per feature and not tied", () => {
  for (const [stage, s] of Object.entries(slices)) assert.deepEqual(checkStageWorkspace({ stage, state: "done", holder: null, given: [], outputs: [], done_when: "x", features: s }, IDS, stage), [], stage);
  const t = stageFeaturesHtml(slices.test);
  assert.match(visible(t), /^Tests per feature · 2 of 3 features F1 Count words : 2 tests the good case counts exactly the words \[F1\] counts F2 Refuse non-text : 2 tests .* F3 Stop on empty input : No test yet: to do 1 test not tied to a feature markdown is parsed to find the sentence$/);
  assert.match(t, /<li class="sf s-to_do"><span class="cs" aria-hidden="true"><\/span><span class="fid">F3<\/span>/);
  assert.match(visible(stageFeaturesHtml(slices.code)), /^Passing per feature · 1 of 2 features pass F1 Count words : 6 of 6 passing F2 Refuse non-text : 1 of 2 passing$/);
  assert.match(stageFeaturesHtml(slices.code), /class="sf s-failing"/);
  const r = stageFeaturesHtml(slices.review);
  assert.match(visible(r), /F2 Refuse non-text : 1 finding open test\/count\.test\.mjs:12 The test asserts nothing\. 1 finding not tied to a feature agent-runtime-requirements\.json:34: The run command leaves out --records\. \(outside the change\)$/);
  assert.equal(stageFeaturesHtml(null), "");
  assert.match(visible(stageFeaturesHtml({ stage: "docs", covered: 0, total: 0, words: "0 of 0 documented", items: [] })), /^Documented features · 0 of 0 documented No approved features yet\.$/);

  // The workspace keeps the service's features, and the Artifacts tab shows them at its foot.
  const build = { id: "b1", stages: [{ stage: "test", state: "done", holder: null, rounds: [] }], artifacts: [], actions: [] };
  const suite = { id: "suite", stage: "test", name: "The suite", by: "test writer", kind: "suite", state: "made", version: "v1", summary: { count: 5, tests: [] } };
  const ws = stageWorkspace(build, "test", { stage: "test", name: "Test", state: "done", holder: null, given: [], outputs: [suite], done_when: "x", features: slices.test }, { defs });
  assert.equal(ws.features, slices.test);
  const tab = artifactsTabHtml(ws, null, { featuresTitle: "Features at this stage", featuresHtml: () => stageFeaturesHtml(ws.features) });
  assert.match(tab, /<section class="afeat" aria-label="Features"><div class="grp">Features at this stage<\/div><div class="sfeat">/);
  assert.equal(stageWorkspace(build, "test", { stage: "test", given: [], outputs: [] }, { defs }).features, null, "a service without them has none");
});

test("the spine shows each stage's feature count beside its name", () => {
  const stage = (id, state, features) => ({ stage: id, state, holder: null, runs: 1, rounds: [], given: "", handed_back: { words: [], files: [] }, done_when_met: null, log: [], where: null, cadence: "every_build", ...(features ? { features } : {}) });
  const build = { id: "b1", name: "word-counter", version: "0.1.0", summary: "Done", actions: [], artifacts: [], stages: [
    stage("requirements", "done", { covered: 4, total: 5, words: "4 of 5 approved" }),
    stage("test", "done", { covered: 4, total: 5, words: "4 of 5 features" }),
    stage("code", "done", { covered: 3, total: 5, words: "3 of 5 features pass" }),
    stage("package", "done"),
  ] };
  const spine = steps(build, { defs });
  assert.deepEqual(spine.map((x) => [x.stage, x.count ?? null]), [["requirements", "4 of 5 approved"], ["test", "4 of 5 features"], ["code", "3 of 5 features pass"], ["package", null]]);
  const html = spineHtml(build, spine, { sel: "test", href: (s) => `#/b/b1/${s}` });
  assert.match(html, /<span class="rn">Test<em class="fct" title="Features at Test">4 of 5 features<\/em><\/span>/);
  assert.match(html, /aria-label="2\. Test: [^"]*; 4 of 5 features"/);
  assert.match(visible(html), /Test 4 of 5 features/);
  assert.doesNotMatch(html.split('href="#/b/b1/package"')[1], /class="fct"/, "a stage without features has no count");
});

test("the proxy passes the listing and Approve all through the builds path", async () => {
  const svc = await fakeService((req) => ({ body: { echo: req.url } }));
  const keys = createKeyStore({ service: svc.url, env: { ADLC_KEY: "test-key-0123456789abcdef" }, dir: await tempDir("featlc") });
  const app = createConsoleServer({ service: svc.url, keys, stages: DOC, version: "test" });
  const url = await app.listen(0);
  try {
    const h = { host: new URL(url).host, "content-type": "application/json", "x-adlc-console": "1" };
    let r = await hit(url, { path: "/api/v1/lifecycle/builds/b1/features/backfill", method: "POST", body: "{}", headers: h });
    assert.equal(r.status, 200);
    assert.deepEqual({ url: svc.seen.at(-1).url, method: svc.seen.at(-1).method }, { url: "/v1/lifecycle/builds/b1/features/backfill", method: "POST" });
    r = await hit(url, { path: "/api/v1/lifecycle/builds/b1/features/approve_all", method: "POST", body: JSON.stringify({ proposals: ["fp_1", "fp_2"] }), headers: h });
    assert.equal(r.status, 200);
    assert.equal(svc.seen.at(-1).url, "/v1/lifecycle/builds/b1/features/approve_all");
  } finally { await app.close(); await svc.close(); }
});

test("the page's features module is served with the 0.4.5 parts", async () => {
  const src = await readFile(join(HERE, "..", "public", "features.js"), "utf8");
  for (const name of ["requirementsFeaturesHtml", "stageFeaturesHtml", "approveAllRequest"]) assert.match(src, new RegExp(`export function ${name}\\(`));
  const app = await readFile(join(HERE, "..", "public", "app.js"), "utf8");
  assert.match(app, /\{ id: "features", label: "Features"/, "the Requirements stage's Features tab");
  assert.match(app, /\.\.\.\(reqFeat \? \[\{ id: "features"[^\n]*\n\s*\.\.\.\(spec \? \[\{ id: "spec"[^\n]*\n\s*\{ id: "chat"/, "Features, then Spec, come before Chat");
});
