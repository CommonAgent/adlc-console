// The spec (lifecycle API 0.4.8, stages.json 1.6.0) in the console: what
// Requirements hands back, drawn from an artifact of kind spec and its
// SpecSummary. Each feature with its requirements (the shall line, its kind,
// and the exact words in code style) and its Gherkin scenarios; the interfaces
// with the ones to keep marked; the constraints, systems, settings and open
// questions; the Spec tab at Requirements; and each feature's requirements and
// scenarios under it on the Features tab. Against made-up answers held to the
// lifecycle API's own check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { specHtml, specTabHtml, specOf, specFeature, featureCounts, featureSpecHtml, interfacesHtml } from "../public/spec.js";
import { artifactBodyHtml, artifactsTabHtml, stageWorkspace } from "../public/workspace.js";
import { requirementsFeaturesHtml, ARTIFACT_STAGE, featuresOfTest } from "../public/features.js";
import { checkArtifacts } from "../standards/lifecycle-api-check.mjs";
import { createDemoService } from "../lib/demo.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const AT = "2026-11-09T10:00:00Z";

const SUMMARY = {
  product: "hn-reader 0.2.0",
  purpose: "Reads the top stories of Hacker News and hands back their titles.",
  features: [
    {
      id: "F1", name: "Read the top stories", does: "Hands back the titles of the top stories.", offering: "Read", as_built: "B1",
      requirements: [
        { id: "F1.R1", shall: "The agent shall hand back at most 30 titles.", kind: "limit", exact: ["30"] },
        { id: "F1.R2", shall: "The agent shall stop at a line matching the stop pattern.", kind: "pattern", exact: ["^-- end --$"] },
      ],
      acceptance: [{ id: "F1.A1", gherkin: "Scenario: forty stories\n  Given 40 top stories\n  When it reads them\n  Then it hands back 30 titles" }],
    },
    {
      id: "F2", name: "Refuse a login", does: "Declines to sign in anywhere.",
      requirements: [{ id: "F2.R1", shall: "The agent shall refuse to sign in, saying \"I read only what is public.\"", kind: "refusal", exact: ["I read only what is public."] }],
      acceptance: [{ id: "F2.A1", gherkin: "Scenario: asked to sign in\n  When it is asked to sign in\n  Then it says \"I read only what is public.\"" }],
    },
  ],
  interfaces: [
    { id: "I1", kind: "command", name: "read-news --limit <n>", keep: true },
    { id: "I2", kind: "file", name: "out/stories.json", keep: false },
  ],
  constraints: ["C1 (performance): The agent shall finish within 60 seconds."],
  systems: ["Hacker News API (read): https://hacker-news.firebaseio.com/v0, for the stories."],
  settings: ["limit (integer, default 30, 1 to 100): how many titles it hands back."],
  price: "free",
  open: ["Should it follow a story's link?"],
};
const SPEC = { id: "spec", stage: "requirements", name: "Spec", by: "spec writer", state: "made", kind: "spec", version: "v2", at: AT, summary: SUMMARY, files: [] };

test("a spec artifact in the console's shape is one the lifecycle API's check accepts", () => {
  assert.deepEqual(checkArtifacts([SPEC], IDS), []);
  assert.equal(ARTIFACT_STAGE.spec, "requirements");
});

test("the spec shows each feature with its requirements (shall, kind, exact words in code) and its Gherkin scenarios", () => {
  const html = specHtml(SUMMARY);
  const v = visible(html);
  assert.match(v, /^hn-reader 0\.2\.0 free Reads the top stories of Hacker News and hands back their titles\./);
  assert.match(v, /F1 Read the top stories in Read as built, B1 Hands back the titles of the top stories\. Requirements F1\.R1 The agent shall hand back at most 30 titles\. limit 30 F1\.R2 The agent shall stop at a line matching the stop pattern\. pattern \^-- end --\$ Acceptance F1\.A1 Scenario: forty stories Given 40 top stories When it reads them Then it hands back 30 titles/);
  // The exact words are in code style, byte for byte; the Gherkin keeps its lines.
  assert.match(html, /<code>\^-- end --\$<\/code>/);
  assert.match(html, /<code>I read only what is public\.<\/code>/);
  assert.match(html, /<pre class="gherkin">Scenario: forty stories\n {2}Given 40 top stories\n/);
  // A feature the reader is opened at is marked.
  assert.match(specHtml(SUMMARY, { feature: "F2" }), /<section class="sfe at" data-spec-feature="F2">/);
});

test("the spec shows the interfaces with keep marked, then the constraints, systems, settings and what is still open", () => {
  const v = visible(specHtml(SUMMARY));
  assert.match(v, /Interfaces 2 I1 command read-news --limit <n> Keep exactly I2 file out\/stories\.json May change/);
  assert.match(v, /Constraints 1 C1 \(performance\): The agent shall finish within 60 seconds\. Systems 1 Hacker News API \(read\): https:\/\/hacker-news\.firebaseio\.com\/v0, for the stories\. Settings 1 limit \(integer, default 30, 1 to 100\): how many titles it hands back\. Still open 1 Should it follow a story's link\?$/);
  assert.match(interfacesHtml(SUMMARY.interfaces), /<li class="sif keep">/);
  // Nothing is drawn for a part the service did not give, and nothing open says so.
  const bare = visible(specHtml({ product: "a 0.1.0", features: SUMMARY.features.slice(1), open: [] }));
  assert.doesNotMatch(bare, /Interfaces|Constraints|Systems|Settings/);
  assert.match(bare, /Nothing is still open\.$/);
});

test("the spec is read as words, never raw JSON, and HTML in it is escaped", () => {
  const odd = { product: { nested: true }, features: [{ id: "F1", name: "<b>x</b>", does: "y", requirements: [{ id: "F1.R1", shall: "The agent shall <script>.", exact: [{ a: 1 }, "<i>"] }], acceptance: "no" }], interfaces: "x", open: [{ q: 1 }] };
  const html = specHtml(odd);
  assert.doesNotMatch(html, /[{}]|\[object|<script>|<b>x|<i>/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(specHtml(null), "");
});

test("the Artifacts reader draws a spec artifact from its SpecSummary", () => {
  const v = visible(artifactBodyHtml(SPEC));
  assert.match(v, /F1 Read the top stories .* F2 Refuse a login .* Interfaces 2/);
  const ws = { stage: "requirements", name: "Requirements", given: [], outputs: [SPEC], handedBack: {} };
  assert.match(visible(artifactsTabHtml(ws, "spec", { stageName: (s) => defs.get(s)?.name ?? s })), /^Spec Requirements · spec writer · v2 hn-reader 0\.2\.0/);
});

test("the Spec tab shows the spec with who made it and its version, or that there is none yet", () => {
  assert.match(visible(specTabHtml(SPEC, { when: () => "10:00 AM" })), /^spec writer · v2 · 10:00 AM hn-reader 0\.2\.0/);
  assert.match(visible(specTabHtml(null)), /No spec yet\. The spec writer hands it back at Requirements\./);
  assert.equal(specOf([{ ...SPEC, state: "next" }, { id: "x", kind: "statement", state: "made", summary: {} }]), null);
  assert.equal(specOf([{ ...SPEC, version: "v1" }, SPEC]).version, "v2");
});

test("the Features tab shows, under each feature the spec holds, its requirements and scenarios, folded with their count", () => {
  const row = (id, extra = {}) => ({ id, name: `Name ${id}`, does: `Does ${id}.`, offering: "Read", state: "approved", backlog: false, badge: "new", cells: {}, ...extra });
  const m = { product: "hn-reader", build: "b1", version: "0.2.0", features: [row("F1"), row("F3")] };
  const html = requirementsFeaturesHtml(m, { spec: SUMMARY });
  assert.match(html, /<details class="rfspec"><summary>2 requirements · 1 scenario<\/summary>/);
  assert.match(visible(html), /F1 Name F1 Approved Read Does F1\. 2 requirements · 1 scenario Requirements F1\.R1 The agent shall hand back at most 30 titles\./);
  // A feature the spec does not hold has nothing folded under it, and without a spec nothing changes.
  assert.equal((html.match(/rfspec/g) ?? []).length, 1);
  assert.doesNotMatch(requirementsFeaturesHtml(m, {}), /rfspec/);
  assert.equal(featureCounts(specFeature(SUMMARY, "F2")), "1 requirement · 1 scenario");
  assert.equal(featureSpecHtml(null), "");
});

test("a test named by an acceptance scenario names its feature; a kept interface's test names none; [F1] still works", () => {
  assert.deepEqual(featuresOfTest("[F1.A1] forty stories"), ["F1"]);
  assert.deepEqual(featuresOfTest("[F1.A1, F2.A3] both"), ["F1", "F2"]);
  assert.deepEqual(featuresOfTest("[F3.R2] a requirement"), ["F3"]);
  assert.deepEqual(featuresOfTest("[I4] read-news keeps its flags"), []);
  assert.deepEqual(featuresOfTest("[F1] count words"), ["F1"]);
  // A suite opened at a feature shows the tests of its scenarios.
  const suite = { id: "suite", stage: "test", name: "The suite", by: "test writer", kind: "suite", state: "made", version: "v1", summary: { count: 4, tests: ["counts words", "[F1.A1] forty stories", "[F1.A2] none", "[I1] read-news keeps its flags"] } };
  assert.match(visible(artifactBodyHtml(suite, { feature: "F1" })), /^2 of 4 tests name F1\. \[F1\.A1\] forty stories \[F1\.A2\] none and 2 tests for other things$/);
});

test("the demo's Requirements hands back a spec, and its agent's own files are made at Design", async () => {
  const d = createDemoService();
  const get = async (path) => (await d.handle("GET", path, new URLSearchParams(), {})).body;
  const list = await get("/v1/lifecycle/builds");
  const pj = list.builds.find((b) => b.name === "palindrome-judge");
  const b = (await get(`/v1/lifecycle/builds/${pj.id}`)).build;
  assert.deepEqual(checkArtifacts(b.artifacts, IDS), []);
  const req = stageWorkspace(b, "requirements", await get(`/v1/lifecycle/builds/${pj.id}/stages/requirements`), { defs });
  const spec = specOf(req.outputs);
  assert.equal(spec.name, "Spec");
  assert.match(visible(specHtml(spec.summary)), /F1 Judge a sentence .* F1\.A1 Scenario: a palindrome with spaces and capitals/);
  const agent = b.artifacts.find((a) => a.kind === "statement");
  assert.equal(agent.stage, "architecture");
  assert.equal(agent.name, "The agent's own files");
});
