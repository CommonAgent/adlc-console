// Features (lifecycle API 0.4.3) in the console: a proposal's buttons on a
// reply (Approve feature, Not now, Ask <approver> to approve), the short
// Requirements gate, the Features matrix with its cells, badges and version
// filter, a feature's history, and the proxy's routes. Against made-up answers
// in the contract's shape, held to the lifecycle API's own check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { featureProposalHtml, featureDecision, requirementsGateHtml, featuresMatrixHtml, featureHistoryHtml, cellTarget, approverWords, featuresOfTest, historyHref } from "../public/features.js";
import { messageHtml, bossMessageHtml, gateCardHtml, artifactsTabHtml, productPageHtml, stageWorkspace } from "../public/workspace.js";
import { checkFeatures, checkFeature, checkMessages, checkStageWorkspace } from "../standards/lifecycle-api-check.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const AT = "2026-11-08T10:00:00Z";
const when = () => "t";

const proposal = (extra = {}) => ({ proposal: "fp_1", feature: "F3", name: "Empty passage", does: "Answers 0 for an empty passage.", offering: "Count", change: "new", state: "open", you_may_approve: true, approvers: [], ...extra });
const reply = (features) => ({ id: "t_2", at: AT, build: "b1", version: "0.1.0", from: { kind: "agent", name: "Spec writer", role: "spec-writer", stage: "requirements" }, text: "I would add it.", features });

test("a proposed feature on a reply: Approve feature and Not now for someone who may approve", () => {
  const m = reply([proposal()]);
  assert.deepEqual(checkMessages({ messages: [m] }, "requirements"), []);
  const html = messageHtml(m, { when });
  assert.match(visible(html), /F3 New feature Empty passage in Count Answers 0 for an empty passage\. Approve feature Not now Approving it is your Requirements decision for this feature alone\. The spec gets a new version with it\./);
  assert.match(html, /<button class="btn p" type="button" data-feat="approve" data-feat-id="F3" data-feat-proposal="fp_1" data-feat-build="b1" data-feat-message="t_2">Approve feature<\/button>/);
  assert.match(html, /data-feat="not_now"[^>]*>Not now</);
  // A button's data is the route's path and body.
  assert.deepEqual(featureDecision({ feat: "approve", featId: "F3", featProposal: "fp_1", featBuild: "b1", featMessage: "t_2" }), { path: "/builds/b1/features/F3/approve", body: { proposal: "fp_1", message: "t_2" } });
  assert.equal(featureDecision({ feat: "delete", featId: "F3", featProposal: "fp_1", featBuild: "b1" }), null);
  // While one is sent, every feature button waits.
  assert.match(featureProposalHtml(proposal(), m, { pending: "fp_1 approve" }), /disabled>Sending…</);
  // A changed feature says what it was.
  assert.match(visible(featureProposalHtml(proposal({ change: "changed", was: { name: "Empty passage", does: "Refuses an empty passage.", offering: "Count" } }), m)), /F3 Changed feature .* Was Empty passage: Refuses an empty passage\./);
  // The boss's reply carries the same buttons.
  assert.match(bossMessageHtml({ ...reply([proposal()]), from: { kind: "agent", name: "The boss", role: "boss" } }, { when }), /data-feat="approve"/);
});

test("teams: someone who may not approve gets Ask <approver> to approve; once asked, the approver gets the button", () => {
  const m = reply([proposal({ you_may_approve: false, approvers: ["Ana Lee (ana@example.com)"] })]);
  const html = messageHtml(m, { when });
  assert.match(html, /data-feat="ask"[^>]*>Ask Ana Lee to approve</);
  assert.doesNotMatch(html, /data-feat="approve"/);
  assert.match(visible(html), /Only Ana Lee may approve features\. Asking tells them, and they see this same proposal\./);
  assert.equal(approverWords(["Ana Lee (ana@example.com)", "an approver in the team web"]), "Ana Lee or an approver in the team web");
  assert.equal(approverWords([]), "an approver");
  // After the ask: the member sees it waiting; the approver sees Approve feature.
  const asked = { state: "asked", asked: { by: "Max Member", at: AT, to: ["Ana Lee (ana@example.com)"] } };
  assert.match(visible(featureProposalHtml(proposal({ ...asked, you_may_approve: false, approvers: ["Ana Lee (ana@example.com)"] }), m, { when })), /Waiting on Ana Lee Not now Max Member asked Ana Lee to approve it · t\./);
  const ana = featureProposalHtml(proposal({ ...asked, you_may_approve: true, approvers: ["Ana Lee (ana@example.com)"] }), m, { when });
  assert.match(ana, /data-feat="approve"[^>]*>Approve feature</);
  assert.match(visible(ana), /Max Member asked Ana Lee to approve it · t\./);
});

test("an answered proposal says how: approved, not now (still in the backlog), or replaced", () => {
  const m = reply([]);
  assert.match(featureProposalHtml(proposal({ state: "approved", answered: { decision: "approved", by: "Ana Lee", at: AT } }), m, { when }), /class="gcard done feat".*<span class="btn used">Approved by Ana Lee · t<\/span>/s);
  const later = featureProposalHtml(proposal({ state: "not_now", answered: { decision: "not_now", by: "You", at: AT } }), m, { when });
  assert.match(visible(later), /Not now, said You · t: it stays proposed, in the backlog\. Approve feature$/);
  assert.match(visible(featureProposalHtml(proposal({ state: "replaced" }), m)), /A newer proposal of F3 replaced this one\.$/);
});

test("the Requirements gate shrinks to what is still open and Start building with these features", () => {
  const gate = { actions: ["approve", "changes", "stop"], state: "open", who_may: "Anyone may answer this gate.", open: ["What should it cost per passage?"], features: { approved: [{ id: "F1", name: "Count words", does: "x", offering: "Count" }], to_approve: [{ id: "F2", name: "Lines", does: "x", offering: "Count" }], backlog: [{ id: "F3", name: "Bytes", does: "x", offering: "Count" }] } };
  const ans = { stage: "requirements", state: "waiting_on_you", holder: null, given: [], outputs: [], done_when: "x", gate };
  assert.deepEqual(checkStageWorkspace(ans, IDS, "requirements"), []);
  const build = { id: "b1", stages: [{ stage: "requirements", state: "waiting_on_you" }], actions: [{ stage: "requirements", name: "approve", label: "Approve the spec" }] };
  const ws = stageWorkspace(build, "requirements", ans);
  let labels = null;
  const html = gateCardHtml(ws, build, { actionsHtml: (stage, opts) => { labels = opts.labels; return `<div class="acts"><button>${opts.labels.approve}</button></div>`; } });
  assert.deepEqual(labels, { approve: "Start building with these features" });
  assert.match(visible(html), /^Ready to build Still open What should it cost per passage\? Start building with these features F1 Count words approved F2 Lines approved when you start Not now: F3 Bytes\. Start building with these features$/);
  // Nothing open says so; a person who may not answer sees who may.
  assert.match(visible(requirementsGateHtml(ws, { ...gate, open: [] }, {})), /^Waiting at this gate Nothing is still open\. .* Anyone may answer this gate\.$/);
  // A gate without features is drawn as before.
  assert.doesNotMatch(gateCardHtml(stageWorkspace(build, "requirements", { ...ans, gate: { actions: ["approve"], state: "open", who_may: "x" } }), build, {}), /Start building/);
});

const cell = (state, words, extra = {}) => ({ state, words, ...extra });
const row = (id, name, extra = {}) => ({
  id, name, does: `${name}, in one sentence.`, offering: "Count", state: "approved", backlog: false, badge: "unchanged",
  cells: {
    spec: cell("done", "Spec v3", { link: { build: "b2", stage: "requirements", artifact: "statement", feature: id } }),
    tests: cell("done", "Tests 6/6", { tests: { passed: 6, total: 6 }, link: { build: "b2", stage: "test", artifact: "suite", feature: id } }),
    code: cell("done", "Passes 6/6", { tests: { passed: 6, total: 6 }, link: { build: "b2", stage: "code", artifact: "programs", feature: id } }),
    review: cell("done", "Reviewed on abc1234"),
    docs: cell("missing", "No docs yet"),
  },
  ...extra,
});
const matrix = () => ({
  product: "counter", build: "b2", version: "0.2.0", versions: [{ version: "0.2.0", build: "b2" }, { version: "0.1.0", build: "b1" }], columns: ["spec", "tests", "code", "review", "docs"],
  features: [
    row("F1", "Count words"),
    row("F2", "Lines", { badge: "changed", cells: { ...row("F2", "Lines").cells, tests: cell("failing", "Tests 4/6", { tests: { passed: 4, total: 6 }, link: { build: "b2", stage: "test", artifact: "suite", feature: "F2" } }), code: cell("stale", "Written before F2 changed") } }),
    row("F4", "Words per line", { badge: "new", state: "proposed", backlog: true, cells: { ...row("F4", "Words per line").cells, spec: cell("missing", "In the backlog, not approved"), tests: cell("missing", "No test names F4"), code: cell("missing", "No test checks F4") } }),
  ],
});

test("the Features matrix: rows of features, a cell per column that is done, stale, missing or failing, badges, and a version filter", () => {
  const m = matrix();
  assert.deepEqual(checkFeatures(m, "b2"), []);
  const html = featuresMatrixHtml(m, { filter: true });
  assert.match(visible(html), /^3 features in 0\.2\.0 · 1 failing · 1 stale Version 0\.2\.0 0\.1\.0 Feature Spec Tests Code Review Docs F1 Count words Unchanged Count Spec v3 Tests 6\/6 Passes 6\/6 Reviewed on abc1234 No docs yet F2 Lines Changed Count Spec v3 Tests 4\/6 Written before F2 changed/);
  assert.match(html, /<option value="0\.2\.0" selected>/);
  assert.match(html, /<select data-feat-version>/);
  for (const s of ["done", "stale", "missing", "failing"]) assert.match(html, new RegExp(`<td class="fc ${s}">`), s);
  assert.match(html, /<span class="fb b-changed">Changed<\/span>/);
  assert.match(html, /<span class="fb b-new">New<\/span><span class="fb b-prop">Not now<\/span>/);
  // A cell opens its artifact at its feature; a cell with no link is not a button.
  assert.match(html, /<button type="button" class="fcell" data-feat-cell="F2" data-cell-build="b2" data-cell-stage="test" data-cell-artifact="suite" aria-label="F2 tests: Failing, Tests 4\/6\. Open it\.">/);
  assert.match(html, /<span class="fcell" aria-label="F1 docs: Missing, No docs yet">/);
  assert.deepEqual(cellTarget({ featCell: "F2", cellBuild: "b2", cellStage: "test", cellArtifact: "suite" }), { build: "b2", stage: "test", artifact: "suite", feature: "F2", hash: "#/b/b2/test/artifacts" });
  assert.equal(cellTarget({ featCell: "F2", cellBuild: "b2", cellStage: "", cellArtifact: "programs" }).stage, "code", "a link without a stage opens its artifact's stage");
  // A row opens the feature's history.
  assert.match(html, /<button type="button" class="frow" data-feat-row="F1" aria-expanded="false"/);
  // No features: what to do.
  assert.match(visible(featuresMatrixHtml({ ...m, features: [], words: "No features yet. They are settled in a chat." })), /No features yet\. They are settled in a chat\.$/);
  assert.equal(visible(featuresMatrixHtml(null)), "Loading…");
});

test("a feature's history: each entry with when, what and who, linked to its message or its artifact", () => {
  const h = {
    feature: { id: "F1", name: "Count words", does: "Counts the words.", offering: "Count", state: "approved", backlog: false },
    history: [
      { at: AT, kind: "proposed", words: "Spec writer proposed F1: Count words.", by: "Spec writer", build: "b1", version: "0.1.0", link: { kind: "message", stage: "requirements", message: "t_2" } },
      { at: AT, kind: "approved", words: "Approved in the chat.", by: "Ana Lee", build: "b1", version: "0.1.0", link: { kind: "message", stage: "requirements", message: "t_2" } },
      { at: AT, kind: "tests", words: "2 tests in the suite v1 name F1.", build: "b1", version: "0.1.0", link: { kind: "artifact", artifact: "suite", feature: "F1" } },
      { at: AT, kind: "proposed", words: "The boss proposed a change to F1.", by: "The boss", build: "b2", version: "0.2.0", link: { kind: "message", message: "s_9" } },
    ],
  };
  assert.deepEqual(checkFeature(h, "F1"), []);
  const html = featureHistoryHtml(h, { when, product: "counter" });
  assert.match(visible(html), /^F1 Count words Counts the words\. in Count t Proposed v0\.1\.0 Spec writer proposed F1: Count words\. Spec writer Open the message t Approved v0\.1\.0 Approved in the chat\. Ana Lee Open the message t Tests v0\.1\.0 2 tests in the suite v1 name F1\. Open it t Proposed v0\.2\.0/);
  assert.match(html, /<a href="#\/b\/b1\/requirements\/chat">Open the message<\/a>/);
  assert.match(html, /data-feat-cell="F1" data-cell-build="b1" data-cell-stage="" data-cell-artifact="suite">Open it</);
  assert.equal(historyHref(h.history[3], "counter"), "#/p/counter/boss", "the boss's conversation");
  // Opened from the matrix, it sits below it.
  assert.match(featuresMatrixHtml(matrix(), { selected: "F1", history: h, when }), /<tr class="sel"><th scope="row"><button type="button" class="frow" data-feat-row="F1" aria-expanded="true".*class="fhist"/s);
});

test("the product page has a Features tab, and the Requirements stage's Artifacts tab the build's matrix", () => {
  const p = { name: "counter", builds: [{ id: "b2", version: "0.2.0", state: "waiting_on_you", at: { stage: "requirements", state: "waiting_on_you" } }], activity: [], setup: [] };
  const off = productPageHtml(p, {}, "features");
  assert.match(off, /disabled title="This service keeps no feature list">Features<\/button>/);
  assert.match(off, /class="tab on" aria-selected="true" data-ptab="versions"/, "without features the tab cannot be opened");
  const on = productPageHtml(p, { when, features: { offered: true, answer: matrix() } }, "features");
  assert.match(on, /class="tab on" aria-selected="true" data-ptab="features">Features <span>3<\/span>/);
  assert.match(on, /<table class="fmx">/);
  assert.match(on, /data-feat-version/);

  const ws = { stage: "requirements", name: "Requirements", given: [], outputs: [{ id: "statement", stage: "requirements", name: "Statement of the job", by: "spec writer", kind: "statement", state: "made", version: "v3", summary: { agent: "counter 0.2.0", offerings: [{ name: "Count", does: "Counts." }], refuses: [], records: [], open: [], features: [{ id: "F1", name: "Count words", does: "Counts the words.", offering: "Count", state: "approved" }, { id: "F4", name: "Words per line", does: "x", offering: "Count", state: "proposed" }] } }], handedBack: {} };
  const tab = artifactsTabHtml(ws, null, { featuresHtml: () => featuresMatrixHtml(matrix()), feature: "F1", featureName: "Count words" });
  assert.match(visible(tab), /At F1 : Count words Show all .* Features F1 Count words: Counts the words\. Count F4 Words per line: x proposed Count/);
  assert.match(tab, /<span class="fl at"><b>F1<\/b>/);
  assert.match(tab, /<section class="afeat" aria-label="Features"><div class="grp">Features in this build<\/div>/);
  // A suite opened at a feature shows the tests naming it.
  const suite = { id: "suite", stage: "test", name: "The suite", by: "test writer", kind: "suite", state: "made", version: "v1", summary: { count: 3, tests: ["counts words", "[F1] count words", "[F1, F2] counts lines too"] } };
  assert.match(visible(artifactsTabHtml({ ...ws, stage: "test", outputs: [suite] }, "suite", { feature: "F1" })), /2 of 3 tests name F1\. \[F1\] count words \[F1, F2\] counts lines too and 1 test for other things/);
  assert.deepEqual(featuresOfTest("[F1, F2] counts lines too"), ["F1", "F2"]);
});

async function proxy(answer) {
  const svc = await fakeService(answer ?? ((req) => ({ body: { echo: req.url } })));
  const keys = createKeyStore({ service: svc.url, env: { ADLC_KEY: "test-key-0123456789abcdef" }, dir: await tempDir("feat") });
  const app = createConsoleServer({ service: svc.url, keys, stages: DOC, version: "test" });
  const url = await app.listen(0);
  return { svc, url, host: new URL(url).host, done: async () => { await app.close(); await svc.close(); } };
}

test("the proxy reads a product's features, for a version, and a feature's history, and posts an answer through the builds path", async () => {
  const s = await proxy();
  try {
    const h = { host: s.host };
    let r = await hit(s.url, { path: "/api/v1/lifecycle/products/counter/features?version=0.1.0&other=x", headers: h });
    assert.equal(r.status, 200);
    assert.equal(s.svc.seen.at(-1).url, "/v1/lifecycle/products/counter/features?version=0.1.0", "only the version goes through");
    r = await hit(s.url, { path: "/api/v1/lifecycle/products/counter/features/F3", headers: h });
    assert.equal(s.svc.seen.at(-1).url, "/v1/lifecycle/products/counter/features/F3");
    r = await hit(s.url, { path: "/api/v1/lifecycle/products/counter/features", method: "POST", body: "{}", headers: { ...h, "content-type": "application/json", "x-adlc-console": "1" } });
    assert.equal(r.status, 405, "the matrix is only read");
    r = await hit(s.url, { path: "/api/v1/lifecycle/products/counter/features/F3/approve", headers: h });
    assert.equal(r.status, 404, "an answer goes through the builds path");
    r = await hit(s.url, { path: "/api/v1/lifecycle/builds/b1/features/F3/approve", method: "POST", body: JSON.stringify({ proposal: "fp_1", message: "t_2" }), headers: { ...h, "content-type": "application/json", "x-adlc-console": "1" } });
    assert.equal(r.status, 200);
    assert.deepEqual({ url: s.svc.seen.at(-1).url, method: s.svc.seen.at(-1).method }, { url: "/v1/lifecycle/builds/b1/features/F3/approve", method: "POST" });
    r = await hit(s.url, { path: "/api/v1/lifecycle/builds/b1/features", headers: h });
    assert.equal(s.svc.seen.at(-1).url, "/v1/lifecycle/builds/b1/features");
  } finally { await s.done(); }
});
