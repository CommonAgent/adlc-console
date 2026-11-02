// The Roles page and the stage page's words for holders, states and evidence,
// drawn from fixtures (the demo's answers), with no service and no browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { rolesPageHtml, holderWords, holderHtml, stateOf, stageNoticeHtml, evidenceHtml, draftFor, holderFrom, formatWords } from "../public/roles.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const NAMES = new Map(DOC.stages.map((s) => [s.id, s.name]));
const ctx = (over = {}) => ({ formats: DOC.evidence_formats, stageName: (id) => NAMES.get(id) ?? id, day: () => "Nov 1", ...over });
const roles = async (q = "") => (await createDemoService().handle("GET", "/v1/lifecycle/roles", new URLSearchParams(q), {})).body;
// The page's visible words: tags taken out and entities read back.
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
function section(html, id) {
  const at = html.indexOf(`id="role-${id}"`);
  return html.slice(at, html.indexOf("</section>", at));
}

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

test("an unknown state is drawn as not offered", () => {
  assert.equal(stateOf({ state: "paused_for_review" }), "not_offered");
  assert.equal(stateOf({}), "not_offered");
  for (const s of ["not_bound", "not_applicable", "done", "not_offered"]) assert.equal(stateOf({ state: s }), s);
});

test("nobody holding a role links to the Roles page; a stage that does not apply says so", () => {
  const nb = stageNoticeHtml("not_bound", "#/roles/finance");
  assert.match(visible(nb), /Nobody holds this role yet\./);
  assert.match(nb, /href="#\/roles\/finance"/);
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

test("the Roles page lists every role with its contract, stages, holder and where that came from", async () => {
  const html = rolesPageHtml(await roles(), ctx());
  assert.equal((html.match(/class="role"/g) ?? []).length, DOC.roles.length);
  const sec = section(html, "security-reviewer");
  assert.match(sec, /href="https:\/\/agentroles\.ai\/security-reviewer\.html"/);
  assert.match(visible(sec), /Holds Security review\./);
  assert.match(visible(sec), /Held by outside tool: The scanner in our CI/);
  assert.match(visible(sec), /Chosen for the organization on Nov 1 by jeff@example\.com\./);
  assert.match(visible(sec), /It hands in Security findings \(SARIF\)\./);
  assert.match(sec, /data-unbind="security-reviewer"/);
  const pkg = visible(section(html, "package-maker"));
  assert.match(pkg, /Holds Package and Release\./);
  assert.match(pkg, /contracted: Harbor Builds · builds\.harbor@example\.com/);
  const code = section(html, "code-writer");
  assert.match(visible(code), /Held by code-writer, our reference agent · code-writer\.platform@agentmesh\.ai/);
  assert.match(visible(code), /This is the default\./);
  assert.doesNotMatch(code, /data-unbind/);
  assert.match(visible(section(html, "agent-critic")), /Nobody holds this role yet\./);
});

test("a project shows its own bindings, and going back is offered only where one was chosen", async () => {
  const html = rolesPageHtml(await roles("project=finance"), ctx({ project: "finance" }));
  assert.match(visible(html), /Roles for finance/);
  assert.match(html, /id="r-project" value="finance"/);
  const code = section(html, "code-writer");
  assert.match(visible(code), /Held by Our finance coder, your agent · coder\.finance@example\.com/);
  assert.match(visible(code), /Chosen for the project finance/);
  assert.match(code, /data-unbind="code-writer"/);
  // The organization's choice shows in a project, but is not undone from there.
  assert.doesNotMatch(section(html, "security-reviewer"), /data-unbind/);
});

test("the requester row says the person who asked, and has no form", async () => {
  const html = rolesPageHtml(await roles(), ctx({ editing: "requester" }));
  const sec = section(html, "requester");
  assert.match(visible(sec), /The person who asked/);
  assert.doesNotMatch(sec, /<form|data-bind|data-unbind/);
});

test("the bind form offers plain choices, and shows no ids, formats or media types", async () => {
  const body = await roles();
  const r = body.roles.find((x) => x.role === "agent-critic");
  const html = rolesPageHtml(body, ctx({ editing: "agent-critic", draft: draftFor(r) }));
  const at = html.indexOf('<form class="bind');
  const form = html.slice(at, html.indexOf("</form>", at));
  const words = visible(form);
  for (const w of ["Your own agent", "A contracted supplier", "A person", "An outside tool", "Security findings (SARIF)", "Bill of materials (CycloneDX)", "Where its evidence can be read", "Save", "Cancel"]) assert.ok(words.includes(w), w);
  // agent-critic has no reference agent, so one is not offered.
  assert.ok(!words.includes("Our reference agent"));
  for (const bad of ["json", "application/", "reference_agent", "your_agent", "outside_tool", "sarif ", "cyclonedx ", "agent-critic", "role-", "{"]) assert.ok(!words.toLowerCase().includes(bad), bad);
  // The handle is asked for only for your own agent or a contracted supplier.
  assert.match(form, /data-handle>/);
  const person = rolesPageHtml(body, ctx({ editing: "agent-critic", draft: { kind: "person", name: "Ann" } }));
  assert.match(person, /data-handle hidden>/);
  const critic = body.roles.find((x) => x.role === "code-critic");
  assert.match(visible(rolesPageHtml(body, ctx({ editing: "code-critic", draft: draftFor(critic) }))), /Our reference agent/);
});

test("the service's refusal shows on the role as written", async () => {
  const words = "Give the supplier's handle on the mesh, so the stage's work can be sent to it.";
  const html = rolesPageHtml(await roles(), ctx({ editing: "code-critic", draft: { kind: "contracted", name: "Them" }, errors: new Map([["code-critic", words]]) }));
  assert.ok(visible(section(html, "code-critic")).includes(words));
  // A refused go-back shows on the role too, with no form open.
  const back = rolesPageHtml(await roles(), ctx({ errors: new Map([["security-reviewer", "The service could not do that now."]]) }));
  assert.ok(visible(section(back, "security-reviewer")).includes("The service could not do that now."));
});

test("what the form sends: the handle only where it belongs, evidence only when given", () => {
  assert.deepEqual(holderFrom({ kind: "contracted", name: " Harbor ", handle: "h@x.com", formats: ["slsa"], where: "" }), { holder: { kind: "contracted", name: "Harbor", handle: "h@x.com", evidence: { formats: ["slsa"] } } });
  assert.deepEqual(holderFrom({ kind: "person", name: "Ann", handle: "left@over.com", formats: [], where: "" }), { holder: { kind: "person", name: "Ann" } });
  assert.deepEqual(holderFrom({ kind: "outside_tool", name: "CI", formats: [], where: "https://ci.example.com" }), { holder: { kind: "outside_tool", name: "CI", evidence: { formats: [], where: "https://ci.example.com" } } });
});

test("every evidence format in stages.json has plain words", () => {
  for (const f of DOC.evidence_formats) assert.notEqual(formatWords(f.id), "Evidence in another format", f.id);
});

test("a role's stages read as a sentence, even when a stage's name holds and", async () => {
  const html = rolesPageHtml(await roles(), ctx());
  assert.match(visible(section(html, "spec-writer")), /Holds Requirements, and Architecture and Design\./);
  assert.match(visible(section(html, "deployment-manager")), /Holds Deploy, Update, Reconfigure, Rollback, and Decommission\./);
});
