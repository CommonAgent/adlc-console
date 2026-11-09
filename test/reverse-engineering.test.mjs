// Starting from existing code (stages.json 1.4.0, lifecycle API 0.4.6) in the
// console: Reverse engineering reads "00"; New build offers "Start from
// existing code"; the stage is a step of a build that ran it; the as-built
// record has its own reader; a behavior as built is answered with Approve
// feature, This is a bug or Drop; and the product says which commit its builds
// knew. Against made-up answers in the contract's shape, held to the lifecycle
// API's own check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { newBuildHtml, newBuildBody, STARTS } from "../public/start.js";
import { steps, spineHtml, stepLabel, stepStages, ranStageZero, artifactBodyHtml, asBuiltSource, productPageHtml, whenNeededHtml, sourceHtml } from "../public/workspace.js";
import { featureProposalHtml, featureDecision, requirementsFeaturesHtml, featuresMatrixHtml, featureStateOf, fixesHtml, asBuiltOf } from "../public/features.js";
import { boardHtml } from "../public/board.js";
import { validate, checkArtifacts, checkFeatures, checkFeatureDecision, checkProduct, checkBuild } from "../standards/lifecycle-api-check.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const PHASES = DOC.phases.map((p) => [p.id, p.name]);
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const AT = "2026-11-08T10:00:00Z";
const T2 = "2026-11-08T10:05:00Z";

// ---------- a build started from existing code ----------

const blank = (stage, state = "not_offered", extra = {}) => ({ stage, state, holder: null, runs: 0, rounds: [], given: "", handed_back: { words: [], files: [] }, done_when_met: null, log: [], where: null, cadence: defs.get(stage).cadence, ...extra });
const RUNS = new Set(["reverse-engineering", "requirements", "test", "code", "package"]);
function adopted({ at = "requirements", zero = "done" } = {}) {
  const order = ["reverse-engineering", "requirements", "test", "code", "package"];
  const stages = IDS.map((id) => {
    if (!RUNS.has(id)) return blank(id);
    const i = order.indexOf(id);
    const state = id === "reverse-engineering" ? zero : i < order.indexOf(at) ? "done" : id === at ? "waiting_on_you" : "not_started";
    return blank(id, state, { holder: { kind: "reference_agent", name: id === "reverse-engineering" ? "reverse-engineer" : "spec-writer" }, runs: state === "not_started" ? 0 : 1 });
  });
  return {
    id: "b_adopt", name: "word-counter", does: "Adopt the existing code of word-counter", version: "0.1.0", handle: "word-counter.example",
    stages, actions: [{ stage: at, name: "approve", label: "Approve the spec", needs: [] }], log: [], can_try: { pull_request: false, installed: false },
    source: { starting_point: "existing-code", trigger: "adoption", repository: "https://github.com/acme/word-counter", commit: "3f2a9c1d0e4b5a6978c1d2e3f4a5b6c7d8e9f0a1", at: AT, words: "Adopted at 3f2a9c1." },
  };
}

test("Reverse engineering reads 00: in the spine of a build that ran it, on the board, and in the step label", () => {
  const b = adopted();
  assert.deepEqual(checkBuild({ build: b }, IDS), []);
  const spine = steps(b, { defs });
  assert.deepEqual(spine.slice(0, 3).map((x) => [x.stage, x.number]), [["reverse-engineering", 0], ["requirements", 1], ["test", 2]]);
  assert.equal(stepLabel(spine[0], spine), "Step 00 of 4");
  assert.equal(stepLabel(spine[1], spine), "Step 1 of 4");
  const html = spineHtml(b, spine, { href: (s) => `#/b/b_adopt/${s}` });
  assert.match(html, /aria-label="00\. Reverse engineering: /);
  assert.match(visible(html), /word-counter 0\.1\.0 Step 1 of 4 · waiting on you ✓ Reverse engineering/);
  // A build that did not run it has no step 00, whatever its cadence: it is the product's action then.
  const idea = adopted({ zero: "not_offered" });
  idea.stages[0].runs = 0;
  assert.ok(!stepStages(idea, defs).some((s) => s.stage === "reverse-engineering"));
  assert.equal(steps(idea, { defs })[0].number, 1);
  assert.equal(ranStageZero({ stage: "reverse-engineering", state: "working", runs: 1 }), true);
  assert.equal(ranStageZero({ stage: "reverse-engineering", state: "not_used", runs: 0 }), false);
  // A build working at Reverse engineering is at step 00.
  const working = adopted({ at: "reverse-engineering", zero: "working" });
  assert.match(visible(spineHtml(working, steps(working, { defs }))), /Step 00 of 4 · working/);
  // The board places it in Define at 00.
  const board = boardHtml([{ id: "b_adopt", name: "word-counter", does: "x", version: "0.1.0", at: { stage: "reverse-engineering", state: "working", summary: "Working at Reverse engineering" }, updated: AT }], DOC.stages, PHASES);
  assert.match(visible(board), /00 · Reverse engineering/);
});

// ---------- New build: Start from existing code ----------

test("New build offers Start from existing code: a repository and commit, or a folder, and what the product is called", () => {
  assert.deepEqual(STARTS.map((s) => s.label), ["Start from an idea", "Start from existing code"]);
  const idea = newBuildHtml({}, { from: "idea" });
  assert.match(idea, /data-start-from="existing-code"[^>]*>Start from existing code</);
  assert.match(idea, /id="n-does"/);
  const code = newBuildHtml({ name: "word-counter" }, { from: "existing-code" });
  assert.match(code, /<form class="form" id="new-form" data-from="existing-code">/);
  assert.match(visible(code), /What the product is called .* Repository .* Commit Optional\. .* Or a folder on the service's computer/);
  assert.match(code, /id="n-name" value="word-counter" required/);
  assert.doesNotMatch(code, /id="n-does"/);

  const repo = newBuildBody({ name: " word-counter ", repository: "https://github.com/acme/word-counter", commit: "3f2a9c1" }, "existing-code");
  assert.deepEqual(repo.body, { does: "Adopt the existing code of word-counter", name: "word-counter", starting_point: "existing-code", source: { repository: "https://github.com/acme/word-counter", commit: "3f2a9c1" } });
  assert.deepEqual(validate("StartRequest", repo.body), []);
  const folder = newBuildBody({ name: "word-counter", folder: "/work/word-counter", project: "tools" }, "existing-code");
  assert.deepEqual(folder.body, { does: "Adopt the existing code of word-counter", name: "word-counter", starting_point: "existing-code", source: { folder: "/work/word-counter" }, project: "tools" });
  assert.deepEqual(validate("StartRequest", folder.body), []);
  assert.deepEqual(newBuildBody({ repository: "x" }, "existing-code"), { error: "Say what the product is called." });
  assert.deepEqual(newBuildBody({ name: "w" }, "existing-code"), { error: "Name a repository, or a folder on the service's computer." });
  assert.deepEqual(newBuildBody({ name: "w", repository: "x", folder: "y" }, "existing-code"), { error: "Name a repository or a folder, not both." });
  // From an idea, as before.
  assert.deepEqual(newBuildBody({ does: "Count words. ", refuses: "", name: "wc" }, "idea"), { body: { does: "Count words.", name: "wc" } });
  assert.deepEqual(newBuildBody({ does: " " }), { error: "Say what the agent should do." });
});

// ---------- the as-built record's reader ----------

const part = (id, name, items, words) => ({ part: id, name, count: items.length, words, items });
const asBuilt = (extra = {}) => ({
  id: "as_built", stage: "reverse-engineering", name: "As-built record", by: "reverse engineer", state: "made", kind: "as_built", version: "3f2a9c1", at: AT,
  summary: {
    source: { repository: "https://github.com/acme/word-counter", commit: "3f2a9c1d0e4b5a6978c1d2e3f4a5b6c7d8e9f0a1", ran: true, words: "Read and run at 3f2a9c1." },
    trigger: "adoption",
    parts: [
      part("behaviors", "Behaviors", ["B1 Counts the words: splits on runs of spaces (scripts/count.mjs:4)", "B2 Counts an empty passage as 1 (scripts/count.mjs:6)"], "2 behaviors, each with its evidence."),
      part("architecture", "Architecture as built", ["Entry point: scripts/count.mjs", "Reads no settings and no credentials"], "One script, run by node."),
      part("interfaces", "Interfaces", ["Command: count, given a passage, answers a number"], "One command."),
      part("dependencies", "Dependencies", [], "No components: the SBOM lists none."),
      part("tests_and_gaps", "Existing tests and gaps", ["test/count.test.mjs: 1 test, passed in the baseline run", "Gap: what a passage of only punctuation gives was not determined"], "1 test, 1 gap."),
    ],
    ...extra,
  },
  files: [{ path: "as-built/behaviors.json", size: 812, link: "/v1/lifecycle/builds/b_adopt/files?path=as-built%2Fbehaviors.json" }],
});

test("the as-built record reads its source, then its five parts in order, each with its count, words and items", () => {
  const a = asBuilt();
  assert.deepEqual(checkArtifacts([a], IDS), []);
  const html = artifactBodyHtml(a);
  assert.match(visible(html), /^https:\/\/github\.com\/acme\/word-counter at 3f2a9c1, read and run\. On adoption: the codebase as it was taken on\. Behaviors 2 2 behaviors, each with its evidence\. B1 Counts the words: splits on runs of spaces \(scripts\/count\.mjs:4\) B2 Counts an empty passage as 1 \(scripts\/count\.mjs:6\) Architecture as built 2 One script, run by node\. Entry point: scripts\/count\.mjs Reads no settings and no credentials Interfaces 1 One command\. Command: count, given a passage, answers a number Dependencies 0 No components: the SBOM lists none\. Existing tests and gaps 2 1 test, 1 gap\./);
  assert.deepEqual([...html.matchAll(/data-part="([a-z_]+)"/g)].map((m) => m[1]), ["behaviors", "architecture", "interfaces", "dependencies", "tests_and_gaps"]);
  assert.match(html, /<li class="gap">Gap: what a passage of only punctuation gives was not determined<\/li>/);
  // On drift, it says what it is described against; read only when the code was not run.
  const drift = asBuilt({ trigger: "drift", since: "1a2b3c4d5e6f7a8b9c0d", source: { repository: "/work/word-counter", commit: "9b1c2d4", ran: false } });
  assert.deepEqual(checkArtifacts([drift], IDS), []);
  assert.equal(asBuiltSource(drift.summary), "/work/word-counter at 9b1c2d4, read only, not run. On drift: only what changed since 1a2b3c4.");
});

// ---------- a behavior as built: Approve feature, This is a bug, Drop ----------

const mark = { behavior: "B2", evidence: ["scripts/count.mjs:6"], commit: "3f2a9c1d0e" };
const proposal = (extra = {}) => ({ proposal: "fp_2", feature: "F2", name: "Empty passage", does: "Counts an empty passage as 1.", offering: "Count", change: "new", state: "open", you_may_approve: true, approvers: [], as_built: mark, ...extra });
const msg = { id: "t_7", build: "b_adopt" };
const fix = { id: "fx_1", feature: "F2", behavior: "B2", name: "Empty passage", does: "Counts an empty passage as 1.", words: "An empty passage has no words.", state: "proposed", by: "Test Person", at: T2, build: "b_adopt" };

test("a behavior as built offers Approve feature, This is a bug (with what is wrong) and Drop, each to its own route", () => {
  const html = featureProposalHtml(proposal(), msg);
  assert.match(visible(html), /^F2 Behavior as built Empty passage in Count Counts an empty passage as 1\. As built Behavior B2 at 3f2a9c1 scripts\/count\.mjs:6 Approve feature This is a bug Drop This is what the code does today\./);
  assert.match(html, /data-feat="approve" data-feat-id="F2" data-feat-proposal="fp_2" data-feat-build="b_adopt" data-feat-message="t_7">Approve feature</);
  assert.match(html, /data-feat="bug"[^>]*>This is a bug</);
  assert.match(html, /data-feat="drop"[^>]*>Drop</);
  assert.match(html, /<input type="text" data-feat-words="fp_2" placeholder="What is wrong \(optional\)"/);
  assert.doesNotMatch(html, /data-feat="not_now"/);
  const d = { featId: "F2", featProposal: "fp_2", featBuild: "b_adopt", featMessage: "t_7" };
  assert.deepEqual(featureDecision({ ...d, feat: "bug", featWords: " An empty passage has no words. " }), { path: "/builds/b_adopt/features/F2/bug", body: { proposal: "fp_2", message: "t_7", words: "An empty passage has no words." } });
  assert.deepEqual(featureDecision({ ...d, feat: "bug", featWords: "" }), { path: "/builds/b_adopt/features/F2/bug", body: { proposal: "fp_2", message: "t_7" } });
  assert.deepEqual(featureDecision({ ...d, feat: "drop", featWords: "ignored" }), { path: "/builds/b_adopt/features/F2/drop", body: { proposal: "fp_2", message: "t_7" } });
  assert.deepEqual(featureDecision({ ...d, feat: "approve" }).path, "/builds/b_adopt/features/F2/approve");
  // Answered: a bug keeps a fix item, never approved; a dropped one is not kept.
  const bug = proposal({ state: "bug", answered: { decision: "bug", by: "Test Person", at: T2 }, fix });
  const entry = { id: "F2", name: "Empty passage", does: "Counts an empty passage as 1.", offering: "Count", state: "proposed", backlog: false, as_built: mark, fix };
  assert.deepEqual(checkFeatureDecision({ feature: entry, proposal: bug, fix }, "bug"), []);
  assert.match(visible(featureProposalHtml(bug, msg)), /This is a bug, said Test Person .* F2 Empty passage: a bug as built, "An empty passage has no words"\. Kept as a proposed fix item by Test Person, never approved by that answer\./);
  assert.doesNotMatch(featureProposalHtml(bug, msg), /data-feat=/);
  const dropped = proposal({ state: "dropped", answered: { decision: "dropped", by: "Test Person", at: T2 } });
  assert.match(visible(featureProposalHtml(dropped, msg)), /Dropped by Test Person .* Not kept: the statement does not carry it, and no test pins it\./);
  // Someone who may not answer Requirements asks instead, as for any feature.
  assert.match(featureProposalHtml(proposal({ you_may_approve: false, approvers: ["Ana Lee (ana@example.com)"] }), msg), /data-feat="ask"[^>]*>Ask Ana Lee to approve</);
});

const cell = (state, words) => ({ state, words });
const cells = () => ({ spec: cell("missing", "Proposed, not approved"), tests: cell("missing", "No suite yet"), code: cell("missing", "No code yet"), review: cell("missing", "Not reviewed yet"), docs: cell("missing", "No docs yet") });
const row = (id, extra = {}) => ({ id, name: id === "F1" ? "Count words" : "Empty passage", does: "x", offering: "Count", state: "proposed", backlog: false, badge: "new", cells: cells(), ...extra });

test("the Requirements Features tab lists behaviors as built with the three answers, then bugs as fix items and dropped ones in words", () => {
  const m = {
    product: "word-counter", build: "b_adopt", version: "0.1.0", versions: [{ version: "0.1.0", build: "b_adopt" }], columns: ["spec", "tests", "code", "review", "docs"],
    features: [
      row("F1", { does: "Counts the words in a passage.", as_built: { behavior: "B1", evidence: ["scripts/count.mjs:4"] }, pending: proposal({ proposal: "fp_1", feature: "F1", name: "Count words", does: "Counts the words in a passage.", as_built: { behavior: "B1", evidence: ["scripts/count.mjs:4"] } }), from: { build: "b_adopt", stage: "requirements", message: "t_7" } }),
      row("F2", { as_built: mark, fix }),
      row("F3", { name: "Help text", as_built: { behavior: "B3", evidence: ["scripts/count.mjs:12"] }, dropped: { by: "Test Person", at: T2 } }),
    ],
    fixes: [fix],
  };
  assert.deepEqual(checkFeatures(m, "b_adopt"), []);
  assert.deepEqual(m.features.map((r) => featureStateOf(r).key), ["as_built", "bug", "dropped"]);
  const html = requirementsFeaturesHtml(m);
  const v = visible(html);
  assert.match(v, /^3 features in 0\.1\.0 · 1 as built, to answer · 1 bug · 1 dropped The behaviors marked As built are what the existing code does today/);
  assert.match(v, /F1 Count words As built Count Counts the words in a passage\. As built Behavior B1 scripts\/count\.mjs:4 From the message Approve feature This is a bug Drop/);
  assert.match(v, /F2 Empty passage A bug: fix item kept .* Kept as a proposed fix item by Test Person, never approved by that answer\./);
  assert.match(v, /F3 Help text Dropped .* Dropped by Test Person: not kept, and no test pins it\./);
  assert.match(v, /Fix items, proposed F2 Empty passage ?: Counts an empty passage as 1\. "An empty passage has no words\." behavior B2, by Test Person Each waits to be taken up through Requirements/);
  assert.equal((html.match(/data-feat="(approve|bug|drop)"/g) ?? []).length, 3, "only the behavior waiting for an answer has buttons");
  assert.match(html, /data-feat="bug" data-feat-id="F1" data-feat-proposal="fp_1" data-feat-build="b_adopt" data-feat-message="t_7"/);
  // The matrix marks them too, and lists the fix items.
  const mx = visible(featuresMatrixHtml(m));
  assert.match(mx, /F1 Count words New As built Count .* F2 Empty passage New A bug Count .* F3 Help text New Dropped Count/);
  assert.match(mx, /Fix items, proposed F2 Empty passage/);
  assert.equal(fixesHtml([]), "");
  assert.equal(asBuiltOf({ as_built: { evidence: [] } }), null);
});

test("the proxy passes This is a bug and Drop through the builds path, with their bodies", async () => {
  const svc = await fakeService((req) => ({ body: { echo: req.url } }));
  const keys = createKeyStore({ service: svc.url, env: { ADLC_KEY: "test-key-0123456789abcdef" }, dir: await tempDir("reveng") });
  const app = createConsoleServer({ service: svc.url, keys, stages: DOC, version: "test" });
  const url = await app.listen(0);
  try {
    const h = { host: new URL(url).host, "content-type": "application/json", "x-adlc-console": "1" };
    for (const [decision, body] of [["bug", { proposal: "fp_2", words: "An empty passage has no words." }], ["drop", { proposal: "fp_3" }]]) {
      const r = await hit(url, { path: `/api/v1/lifecycle/builds/b_adopt/features/F2/${decision}`, method: "POST", body: JSON.stringify(body), headers: h });
      assert.equal(r.status, 200, decision);
      const seen = svc.seen.at(-1);
      assert.deepEqual({ url: seen.url, method: seen.method, body: JSON.parse(seen.body) }, { url: `/v1/lifecycle/builds/b_adopt/features/F2/${decision}`, method: "POST", body });
    }
    // A start from existing code goes through as it was sent.
    const start = { does: "Adopt the existing code of word-counter", name: "word-counter", starting_point: "existing-code", source: { repository: "https://github.com/acme/word-counter" } };
    await hit(url, { path: "/api/v1/lifecycle/builds", method: "POST", body: JSON.stringify(start), headers: h });
    assert.deepEqual(JSON.parse(svc.seen.at(-1).body), start);
  } finally { await app.close(); await svc.close(); }
});

// ---------- the product: Reverse engineering when needed, and the commit its builds knew ----------

test("the product page says the last commit any build knew beside Reverse engineering, and turns the action on for drift", () => {
  const p = {
    name: "word-counter",
    builds: [{ id: "b_adopt", version: "0.1.0", state: "done", at: { stage: "package", state: "done" }, created: AT }],
    activity: [{ at: AT, build: "b_adopt", stage: "reverse-engineering", words: "The reverse engineer handed back the as-built record." }],
    when_needed: DOC.stages.filter((s) => s.cadence === "when_needed").map((s) => (s.id === "reverse-engineering"
      ? { stage: s.id, name: s.name, can_run: true, action: { build: "b_adopt", name: "reverse-engineering", label: "Reverse engineer the change", needs: [] }, confirm: { title: "Reverse engineer what changed in word-counter?", will: "x", who_may: "Anyone may.", you_may: true, cannot_undo: [], steps: ["Only what changed since 3f2a9c1 is described."] } }
      : { stage: s.id, name: s.name, can_run: false, why_not: "Nothing of word-counter is running yet." })),
    source: { repository: "https://github.com/acme/word-counter", commit: "3f2a9c1d0e", build: "b_adopt", version: "0.1.0", current: "9b1c2d4e5f", drift: true, words: "The code changed outside the lifecycle: the repository is at 9b1c2d4, and the last build knew 3f2a9c1." },
  };
  assert.deepEqual(checkProduct(p, "word-counter"), []);
  const html = whenNeededHtml(p.when_needed, { source: p.source });
  assert.match(html, /<button class="btn" type="button" data-when-act="reverse-engineering">Reverse engineer the change<\/button>/);
  assert.match(visible(html), /Reverse engineering: The code changed outside the lifecycle: the repository is at 9b1c2d4, and the last build knew 3f2a9c1\./);
  assert.match(sourceHtml(p.source), /class="srcw drift"/);
  assert.match(sourceHtml({ ...p.source, current: "3f2a9c1d0e", drift: false, words: "No change since 3f2a9c1." }), /class="srcw" role="note"><b>Reverse engineering:<\/b> No change since 3f2a9c1\./);
  assert.equal(sourceHtml(null), "");
  assert.match(visible(productPageHtml(p, { builds: [] })), /When needed Reverse engineer the change Impact .* Reverse engineering: The code changed outside the lifecycle/);
});
