// A product's documents (lifecycle API 0.4.11) in the console: the demo
// answers one document per stage of stages.json that names an asset, in its
// order, each with the copy that stands now and the versions that made it;
// the product page's Documents tab groups them (standing, this version's
// proofs, occasional), reads the chosen one in full from the build that made
// it, and offers Ask for a change, which is the stage's chat.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { documentsHtml, documentGroup, documentLine, productPageHtml } from "../public/workspace.js";
import { createDemoService } from "../lib/demo.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const stageName = (id) => defs.get(id)?.name ?? id;
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = (d, path) => d.handle("GET", path, new URLSearchParams(), {});

test("the demo answers a product's documents: every stage that names an asset, in order, the made ones with the copy that stands and its history", async () => {
  const d = createDemoService();
  const r = await get(d, "/v1/lifecycle/products/palindrome-judge/documents");
  assert.equal(r.status, 200);
  assert.equal(r.body.product, "palindrome-judge");
  const assets = DOC.stages.filter((s) => typeof s.asset === "string" && s.asset);
  assert.deepEqual(r.body.documents.map((x) => [x.stage, x.name, x.cadence]), assets.map((s) => [s.id, s.asset, s.cadence ?? "every_build"]));
  const doc = (stage) => r.body.documents.find((x) => x.stage === stage);
  assert.deepEqual(doc("architecture").current && [doc("architecture").current.build, doc("architecture").current.version, doc("architecture").current.artifact.kind, doc("architecture").current.carried], ["b_palindrome_judge", "0.1.0", "architecture", false]);
  assert.deepEqual(doc("architecture").history.map((h) => [h.build, h.artifact]), [["b_palindrome_judge", "pj-design"]]);
  assert.equal(doc("package").state, "not_made");
  assert.equal(doc("package").current, null);
  for (const x of r.body.documents) assert.equal(x.state === "made", x.current !== null, x.stage);
  assert.equal((await get(d, "/v1/lifecycle/products/nobody/documents")).status, 404);
  // A version with nothing made yet lists them all as not made, or not used where its lifecycle leaves the stage out.
  const w = (await get(d, "/v1/lifecycle/products/word-stats/documents")).body;
  assert.ok(w.documents.every((x) => x.state !== "made"));
  assert.equal(w.documents.find((x) => x.stage === "impact").state, "not_used");
});

test("the Documents tab: three groups, the chosen document read in full from the build that made it, its versions, and Ask for a change at the stage's chat", async () => {
  const d = createDemoService();
  const a = (await get(d, "/v1/lifecycle/products/palindrome-judge/documents")).body;
  // Grouping: a setup stage's, the spec and the AgentDoc stand; the rest of every_build are a version's proofs; when_needed is occasional.
  assert.equal(documentGroup({ stage: "architecture", cadence: "setup" }), "standing");
  assert.equal(documentGroup({ stage: "requirements", cadence: "every_build" }), "standing");
  assert.equal(documentGroup({ stage: "docs", cadence: "every_build" }), "standing");
  assert.equal(documentGroup({ stage: "test", cadence: "every_build" }), "proofs");
  assert.equal(documentGroup({ stage: "impact", cadence: "when_needed" }), "occasional");
  assert.equal(documentLine({ state: "made", current: { version: "0.1.0", carried: true } }), "unchanged since 0.1.0");
  assert.equal(documentLine({ state: "made", current: { version: "0.2.0", carried: false, artifact: {} } }), "0.2.0");
  assert.equal(documentLine({ state: "not_made" }), "not made yet");
  assert.equal(documentLine({ state: "not_used" }), "not in this lifecycle");
  const files = (list, openOne, build) => `<files build="${build}" open="${openOne}">${list.map((f) => f.path).join(",")}</files>`;
  const html = documentsHtml(a, { sel: "architecture", stageName, stageHref: (b, s, t) => `#/b/${b}/${s}/${t}`, filesHtml: files });
  const text = visible(html);
  assert.ok(text.indexOf("Standing documents") < text.indexOf("This version's proofs"), text);
  assert.ok(!text.includes("Occasional records"), "no occasional record exists, so the group is not shown");
  assert.match(html, /<button class="drow made sel" type="button" data-doc="architecture" aria-pressed="true"><b>Architecture record<\/b><small>0.1.0/);
  assert.match(html, /<button class="drow not_made" type="button" data-doc="package" aria-pressed="false"><b>The package<\/b><small>not made yet<\/small>/);
  // The reader: the design in full, its words, Ask for a change at Architecture's chat, and the version that made it.
  assert.match(html, /<h3>Architecture record<\/h3><div class="vm">Architecture and Design · spec writer · version 0.1.0/);
  assert.match(html, /<a class="btn" href="#\/b\/b_palindrome_judge\/architecture\/chat">Ask for a change<\/a>/);
  assert.ok(text.includes("One step, a program: scripts/judge.mjs"), text);
  assert.match(html, /<h4 class="ft">Versions <span>made once<\/span><\/h4><ul><li><a href="#\/b\/b_palindrome_judge\/architecture\/artifacts"><b>0.1.0<\/b>.*<i>stands now<\/i>/);
  // A document's files are read from the build that made it, which may not be the newest.
  const older = { product: "p", documents: [{ stage: "architecture", name: "Architecture record", cadence: "setup", state: "made", current: { build: "b_old", version: "0.1.0", carried: true, artifact: { id: "d1", stage: "architecture", name: "Design", by: "an architect", state: "made", kind: "architecture", summary: { words: "Two modules." }, files: [{ path: "design.md", size: 12 }] } }, history: [{ build: "b_old", version: "0.1.0", artifact: "d1" }] }] };
  assert.match(documentsHtml(older, { stageName, filesHtml: files }), /<files build="b_old" open="true">design\.md<\/files>/);
  assert.match(documentsHtml(older, { stageName, filesHtml: files }), /<small>unchanged since 0\.1\.0<\/small>/);
  // Nothing chosen opens the first made document; a document not made says so.
  assert.match(documentsHtml(a, { stageName }), /data-doc="requirements" aria-pressed="true"/);
  assert.match(documentsHtml(a, { sel: "package", stageName }), /<h3>The package<\/h3><div class="vm">Package<\/div><p class="gw">Package has not made it yet.<\/p>/);
});

test("the product page lands on Documents when the service answers them, and on the boss otherwise", async () => {
  const d = createDemoService();
  const p = (await get(d, "/v1/lifecycle/products/palindrome-judge")).body;
  const a = (await get(d, "/v1/lifecycle/products/palindrome-judge/documents")).body;
  const boss = { offered: true, messages: [], builds: [], composer: {} };
  const withDocs = productPageHtml(p, { stageName, boss, documents: { offered: true, answer: a, sel: null } });
  assert.match(withDocs, /aria-selected="true" data-ptab="documents"/);
  assert.match(withDocs, /class="ptab documents"/);
  const without = productPageHtml(p, { stageName, boss, documents: { offered: false } });
  assert.match(without, /aria-selected="true" data-ptab="boss"/);
  assert.match(without, /disabled title="This service does not list the product&#39;s documents">Documents/);
});
