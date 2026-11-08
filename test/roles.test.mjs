// The stage page's words for holders, states and evidence, drawn from
// fixtures (the demo's answers), with no service and no browser. The
// Lifecycle page, where roles are chosen, is tested in lifecycle.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { holderWords, holderHtml, stateOf, stageNoticeHtml, evidenceHtml, holderFrom, formatWords } from "../public/roles.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
// The page's visible words: tags taken out and entities read back.
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("the holder and its kind, in words, with the handle when there is one", () => {
  assert.equal(holderWords({ kind: "reference_agent", name: "code-critic" }), "code-critic, our reference agent");
  assert.equal(holderWords({ kind: "your_agent", name: "Claude Code" }), "Claude Code, your agent");
  assert.equal(holderWords({ kind: "contracted", name: "Harbor Builds" }), "contracted: Harbor Builds");
  assert.equal(holderWords({ kind: "person", name: "Our security team" }), "Our security team, a person");
  assert.equal(holderWords({ kind: "person", name: "you" }), "you");
  assert.equal(holderWords({ kind: "outside_tool", name: "The scanner in our CI" }), "outside tool: The scanner in our CI");
  assert.match(holderHtml({ kind: "contracted", name: "Harbor Builds", handle: "builds.harbor@example.com" }), /contracted: Harbor Builds · <code class="handle">builds\.harbor@example\.com<\/code>/);
  // A your_agent holder on a build may have no handle.
  assert.doesNotMatch(holderHtml({ kind: "your_agent", name: "Claude Code" }), /handle/);
});

test("an unknown state is drawn as not offered; not_used is known", () => {
  assert.equal(stateOf({ state: "paused_for_review" }), "not_offered");
  assert.equal(stateOf({}), "not_offered");
  for (const s of ["not_bound", "not_applicable", "not_used", "done", "not_offered"]) assert.equal(stateOf({ state: s }), s);
});

test("nobody holding a role links to the Lifecycle page; a stage that does not apply says so", () => {
  const nb = stageNoticeHtml("not_bound", "#/lifecycle?project=finance");
  assert.match(visible(nb), /Nobody holds this role yet\./);
  assert.match(visible(nb), /Choose who holds it on the Lifecycle page/);
  assert.match(nb, /href="#\/lifecycle\?project=finance"/);
  assert.match(stageNoticeHtml("not_bound"), /href="#\/lifecycle"/);
  assert.match(visible(stageNoticeHtml("not_applicable")), /This stage doesn't apply to a process\./);
  assert.match(stageNoticeHtml("not_applicable"), /class="sec na"/);
});

test("evidence shows its name, its format in words, when, its summary and the file", async () => {
  const b = (await createDemoService().handle("GET", "/v1/lifecycle/builds/b_expense_check", new URLSearchParams(), {})).body.build;
  const sec = b.stages.find((s) => s.stage === "security");
  const html = evidenceHtml(sec.evidence, { when: () => "4:20 PM", fileHtml: (f) => `<details data-file="${f.path}"></details>` });
  const words = visible(html);
  assert.match(words, /CI scan of scripts/);
  assert.match(words, /Security findings \(SARIF\)/);
  assert.match(words, /4:20 PM/);
  assert.match(words, /No errors\. 1 warning/);
  assert.match(html, /data-file="evidence\/scan\.sarif"/);
  assert.match(html, /href="https:\/\/ci\.example\.com\/expense-check\/runs\/88\/evidence\/scan\.sarif"/);
  assert.equal(evidenceHtml([]), "");
  // Evidence.file is optional.
  assert.doesNotMatch(evidenceHtml([{ format: "pact", name: "Pact run", at: "x", summary: "All 12 passed." }]), /href|data-file/);
});

test("what the holder form sends: the handle only where it belongs, evidence only when given", () => {
  assert.deepEqual(holderFrom({ kind: "contracted", name: " Harbor ", handle: "h@x.com", formats: ["slsa"], where: "" }), { holder: { kind: "contracted", name: "Harbor", handle: "h@x.com", evidence: { formats: ["slsa"] } } });
  assert.deepEqual(holderFrom({ kind: "person", name: "Ann", handle: "left@over.com", formats: [], where: "" }), { holder: { kind: "person", name: "Ann" } });
  assert.deepEqual(holderFrom({ kind: "outside_tool", name: "CI", formats: [], where: "https://ci.example.com" }), { holder: { kind: "outside_tool", name: "CI", evidence: { formats: [], where: "https://ci.example.com" } } });
});

test("every evidence format in stages.json has plain words", () => {
  for (const f of DOC.evidence_formats) assert.notEqual(formatWords(f.id), "Evidence in another format", f.id);
});
