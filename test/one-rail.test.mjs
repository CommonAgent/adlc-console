// One rail for every version: Spec (its documents), Features (each run of
// its own, else each feature the version lists, else one line for the
// version's work) and Ship. A version made in one chain lists its features
// from its features answer or its spec, and each opens a feature page: its
// strip, one card (the version's gate when it is the only feature, a note
// when one OK covers several, the approve buttons for a feature listed after
// the build) and its Work. Stage names are never the menu.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { steps, spineHtml, versionFeatures, featurePageHtml, featureRegion } from "../public/workspace.js";
import { createDemoService } from "../lib/demo.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const stageName = (id) => defs.get(id)?.name ?? id;
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const getBuild = async (id) => (await createDemoService().handle("GET", `/v1/lifecycle/builds/${id}`, new URLSearchParams(), {})).body.build;
const opts = (b) => ({ href: (s) => `#/b/${b.id}/${s}`, productHref: `#/p/${b.name}`, runHref: (s, r) => `#/b/${b.id}/${s}/run/${r}`, runsHref: `#/b/${b.id}/code`, stageName, featureHref: (f) => `#/b/${b.id}/f/${f.id}` });

test("a version made in one chain gets the same rail: its spec's features, each where the version is, and no stage names", async () => {
  const b = await getBuild("b_palindrome_judge");
  assert.deepEqual([...featureRegion(b)], ["test", "code", "review", "security"]);
  const fs = versionFeatures(b, null, { defs, stageName });
  assert.deepEqual(fs.map((f) => [f.id, f.name, f.line, f.mark, f.wait]), [["F1", "Judge a sentence", "Waiting on you at Code", "now", true]]);
  const html = spineHtml(b, steps(b, { defs }), { ...opts(b), features: fs, featSel: "F1", line: { text: "Waiting on you at Code", wait: true } });
  const text = visible(html);
  assert.equal(text, "palindrome-judge 0.1.0 Waiting on you at Code Features 0 of 1 built F1 Judge a sentence Waiting on you at Code");
  for (const stage of ["Requirements", "Test", "Review", "Security review"]) assert.ok(!new RegExp(`class="rn">${stage}<`).test(html), `${stage} is not a line of the menu`);
  assert.match(html, /<a class="rs run now sel" href="#\/b\/b_palindrome_judge\/f\/F1" aria-current="page"/);
});

test("a finished version lists what each feature has and lacks; with no feature list at all, one line for the version's work", async () => {
  const b = { ...(await getBuild("b_palindrome_judge")), summary: "Handed to your runtime" };
  b.stages = b.stages.map((s) => (["test", "code", "review", "security", "package", "deploy"].includes(s.stage) ? { ...s, state: "done" } : s));
  const answer = { features: [
    { id: "F1", name: "Count words", state: "proposed", cells: { spec: { state: "missing" }, tests: { state: "done", tests: ["a", "b"] }, code: { state: "done" }, review: { state: "stale" }, docs: { state: "missing" } }, pending: { proposal: "p1", state: "open", you_may_approve: true }, tests: ["a", "b"] },
    { id: "F7", name: "Record signed manifest", state: "proposed", cells: { tests: { state: "missing" }, code: { state: "missing" } } },
  ] };
  const fs = versionFeatures(b, answer, { defs, stageName });
  assert.deepEqual(fs.map((f) => [f.id, f.line, f.mark]), [["F1", "Tests and code done", "done"], ["F7", "No tests, no code", "gap"]]);
  const page = featurePageHtml(fs[0], b, { features: fs, defs, stageName, stageHref: (s, t) => `#/b/${b.id}/${s}/${t}` });
  const text = visible(page);
  assert.ok(text.startsWith("Count words F1"), text);
  assert.ok(text.includes("Spec not written down → Tests 2 → Code done → Review stale → Docs missing"), text);
  assert.ok(text.includes("Built in 0.1.0 and shipped Listed after the build, so the spec never named it."), text);
  assert.match(page, /<button class="btn p" type="button" data-feat="approve" data-feat-id="F1" data-feat-proposal="p1"/);
  assert.ok(text.includes("test: a") && text.includes("test: b"), text);
  const none = versionFeatures({ ...b, artifacts: [] }, null, { defs, stageName });
  assert.deepEqual(none.map((f) => [f.id, f.name, f.mark]), [["", "This version's work", "done"]]);
});

test("a feature's page shows the version's gate when it is the only feature, and a note when one OK covers several", async () => {
  const b = await getBuild("b_palindrome_judge");
  const one = versionFeatures(b, null, { defs, stageName });
  const gate = '<div class="gcard" id="gate">the gate</div>';
  const page = featurePageHtml(one[0], b, { features: one, defs, stageName, holder: "Claude Code", gateHtml: () => gate, featuresHref: "#features" });
  assert.ok(page.includes(gate));
  assert.ok(visible(page).includes("Test done → Code waiting on you · Claude Code → Review done → Security review done"), visible(page));
  const two = [...one, { ...one[0], id: "F2", name: "Second" }];
  const many = featurePageHtml(two[0], b, { features: two, defs, stageName, gateHtml: () => gate, featuresHref: "#features" });
  assert.ok(!many.includes(gate));
  assert.match(many, /One OK covers every feature of this version\.<\/p><div class="acts"><a class="btn p" href="#features">Open the Features page<\/a>/);
});

test("the version's documents are tabs: one per group of stages that holds something, each listing its artifacts and evidence, the gate on the tab that waits", async () => {
  const { docTabs, docTabsBarHtml, docTabHtml, docTabOf } = await import("../public/workspace.js");
  const b = await getBuild("b_palindrome_judge");
  const tabs = docTabs(b);
  assert.deepEqual(tabs.map((t) => [t.id, t.items.map((x) => x.name)]), tabs.map((t) => [t.id, t.items.map((x) => x.name)]));
  assert.ok(tabs.some((t) => t.id === "spec") && tabs.some((t) => t.id === "design"), JSON.stringify(tabs.map((t) => t.id)));
  assert.equal(docTabOf("architecture"), "design");
  assert.equal(docTabOf("release"), "package");
  assert.equal(docTabOf("code"), null);
  const design = tabs.find((t) => t.id === "design");
  assert.ok(design.items.length >= 2, "Architecture and Design made two artifacts");
  // Evidence an outside tool sent is an item of its stage's tab.
  const withEvidence = { ...b, stages: b.stages.map((s) => (s.stage === "security" ? { ...s, evidence: [{ format: "cyclonedx", name: "SBOM", at: "2026-10-31T15:41:00Z", summary: "0 packages outside Node" }] } : s)) };
  const sec = docTabs(withEvidence).find((t) => t.id === "security");
  assert.deepEqual(sec.items.map((x) => [x.kind, x.name]).at(-1), ["evidence", "SBOM"]);
  // The bar: the feature first, then the tabs, a tab with several artifacts showing how many.
  const bar = docTabsBarHtml(b, { feature: { label: "Judge a sentence", id: "F1", href: "#f1" }, active: "design", tabHref: (t) => `#d/${t}` });
  assert.match(bar, /<a class="ct" href="#f1">Judge a sentence<i>F1<\/i><\/a><span class="ctsep"/);
  assert.match(bar, new RegExp(`<a class="ct on" href="#d/design" aria-current="page">Design<small>${design.items.length}</small></a>`));
  // A tab: a switcher of icons and names, the chosen artifact in full, its status under its name, Ask for a change.
  const html = docTabHtml(b, "design", { item: 0, stageName, itemHref: (n) => `#d/design/${n}`, chatHref: (s) => `#chat/${s}` });
  assert.match(html, /<div class="dsw" role="tablist" aria-label="Design"><a class="on" role="tab" aria-selected="true" href="#d\/design\/0"><svg/);
  assert.ok(!/<a [^>]*role="tab"[^>]*>[^]*?<small>/.test(html.split('<div class="dsw"')[1].split("</div>")[0]), "no status words inside a switcher button");
  assert.match(html, /<p class="dact"><a class="btn" href="#chat\/architecture">Ask for a change<\/a><\/p>/);
  const shown = docTabHtml(withEvidence, "security", { item: sec.items.length - 1, stageName });
  assert.match(shown, /<h1>SBOM<\/h1><p class="dsub">0 packages outside Node<\/p>/);
});
