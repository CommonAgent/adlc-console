// The Lifecycle page, drawn from the demo's answers (GET /stages and GET
// /roles), with no service and no browser. The page draws what the service
// says: whether a stage may be left out is the service's, never the page's.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { palindromeJudge, expenseCheck } from "../lib/fixture.mjs";
import { lifecyclePageHtml, lifecycleSummary, heldBy, lifecycleDraft, referenceHolder, stagesToReset, notUsedHtml, buildLifecycleHtml, lifecycleHash, lifecycleWords } from "../public/lifecycle.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const DEFS = new Map(DOC.stages.map((s) => [s.id, s]));
const PHASES = DOC.phases.map((p) => [p.id, p.name]);
const ctx = (over = {}) => ({ phases: PHASES, formats: DOC.evidence_formats, number: (id) => DEFS.get(id)?.number, roleWords: (id) => DEFS.get(id)?.role, ...over });
const get = async (d, path, q = "") => (await d.handle("GET", path, new URLSearchParams(q), {})).body;
async function answers(q = "", d = createDemoService()) {
  return { stages: await get(d, "/v1/lifecycle/stages", q), roles: await get(d, "/v1/lifecycle/roles", q) };
}
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
// One stage's row, and the holder form under it when one is open.
function row(html, id) {
  const at = html.indexOf(`id="lc-${id}"`);
  assert.ok(at > -1, `row ${id}`);
  const next = html.indexOf('<div class="cols row', at + 10);
  const ph = html.indexOf('<div class="ph">', at);
  const ends = [next, ph].filter((x) => x > -1);
  return html.slice(html.lastIndexOf("<div", at), ends.length ? Math.min(...ends) : undefined);
}
const selected = (h, role) => (new RegExp(`data-role-kind="${role}"[^>]*>(?:(?!</select>).)*<option value="([^"]*)" selected`, "s").exec(h) ?? [])[1];

test("the 24 stages and Reverse engineering are listed by phase, in order, with their numbers and roles", async () => {
  const { stages, roles } = await answers();
  const html = lifecyclePageHtml(stages, roles, ctx());
  assert.equal((html.match(/class="cols row/g) ?? []).length, 25);
  // Reverse engineering is stage 0, and reads "00"; Requirements stays 01.
  assert.match(row(html, "reverse-engineering"), /<span class="num">00<\/span>/);
  assert.match(row(html, "requirements"), /<span class="num">01<\/span>/);
  const heads = [...html.matchAll(/<div class="ph">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ["Define", "Make", "Ship", "Prove", "Use", "Run", "Change"]);
  const ids = [...html.matchAll(/class="cols row[^"]*" id="lc-([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, DOC.stages.map((s) => s.id));
  assert.match(visible(row(html, "eval")), /^18 Eval agent critic/);
  assert.match(visible(html), /The organization's lifecycle/);
  assert.match(visible(html), /Stage Use Who holds the role/);
});

test("a stage the lifecycle leaves out is struck through and dimmed, and its switch is off", async () => {
  const { stages, roles } = await answers();
  const html = lifecyclePageHtml(stages, roles, ctx());
  for (const id of ["impact", "source", "retract", "reconfigure"]) {
    const r = row(html, id);
    assert.match(r, /class="cols row off"/, id);
    assert.doesNotMatch(r, /data-use="[a-z]+" checked/, id);
  }
  assert.match(row(html, "review"), /class="cols row"/);
  assert.match(row(html, "review"), /data-use="review" checked/);
});

test("a stage the service cannot leave out has its switch disabled, with the service's words", async () => {
  const { stages, roles } = await answers();
  const html = lifecyclePageHtml(stages, roles, ctx());
  const t = row(html, "test");
  assert.match(t, /data-use="test" checked disabled/);
  assert.match(t, /aria-describedby="why-test"/);
  assert.match(visible(t), /Code is written to Test's suite; this service cannot build without it\./);
  assert.match(row(html, "review"), /data-use="review" checked aria-label/);
});

test("the page decides nothing itself: it draws can_leave_out and why_not as the service sends them", async () => {
  const { stages, roles } = await answers();
  const body = structuredClone(stages);
  const s = (id) => body.stages.find((x) => x.stage === id);
  Object.assign(s("docs"), { can_leave_out: false, why_not: "Our <b>auditor</b> reads the docs." });
  Object.assign(s("test"), { can_leave_out: true });
  delete s("test").why_not;
  const html = lifecyclePageHtml(body, roles, ctx());
  assert.match(row(html, "docs"), /data-use="docs" checked disabled/);
  assert.match(row(html, "docs"), /Our &lt;b&gt;auditor&lt;\/b&gt; reads the docs\./);
  assert.doesNotMatch(row(html, "test"), /disabled/);
});

test("stages sharing a role show the same holder, and a change to the role shows on every one", async () => {
  const d = createDemoService();
  const before = await answers("", d);
  let html = lifecyclePageHtml(before.stages, before.roles, ctx());
  for (const id of ["deploy", "update", "reconfigure", "rollback", "decommission"]) assert.equal(selected(row(html, id), "deployment-manager"), "reference_agent", id);
  const r = await d.handle("PUT", "/v1/lifecycle/roles/deployment-manager", new URLSearchParams(), { holder: { kind: "contracted", name: "Harbor Ops", handle: "ops.harbor@example.com" } });
  html = lifecyclePageHtml(before.stages, r.body, ctx());
  for (const id of ["deploy", "update", "rollback", "decommission"]) {
    assert.equal(selected(row(html, id), "deployment-manager"), "contracted", id);
    assert.match(visible(row(html, id)), /Harbor Ops · ops\.harbor@example\.com/);
  }
  assert.equal(selected(row(html, "package"), "package-maker"), "contracted");
  assert.equal(selected(row(html, "release"), "package-maker"), "contracted");
});

test("the requester row reads the person who asked, with no form", async () => {
  const { stages, roles } = await answers();
  const html = lifecyclePageHtml(stages, roles, ctx({ editing: { role: "requester", stage: "acceptance" }, draft: { kind: "person" } }));
  const a = row(html, "acceptance");
  assert.match(visible(a), /The person who asked/);
  assert.doesNotMatch(a, /<select|<form|data-edit-role|data-reset-role/);
});

test("the holder choice offers every kind a role may be held by, and says when nobody is chosen", async () => {
  const { stages, roles } = await answers();
  const html = lifecyclePageHtml(stages, roles, ctx());
  const critic = row(html, "review");
  for (const w of ["The service's code-critic", "Your own agent…", "A contracted supplier…", "A person or team…", "An outside tool…"]) assert.ok(visible(critic).includes(w), w);
  assert.match(critic, /class="ours"/);
  // agent-critic has no reference agent and nobody holds it.
  const ev = row(html, "eval");
  assert.match(ev, /<option value="" selected>Not chosen<\/option>/);
  assert.match(ev, /class="none"/);
  assert.ok(!visible(ev).includes("The service's"));
  // An outside tool keeps its evidence formats, as the Roles page did.
  const sec = row(html, "security");
  assert.equal(selected(sec, "security-reviewer"), "outside_tool");
  assert.match(visible(sec), /The scanner in our CI/);
});

test("a stage held by two roles shows each role's holder, labelled", async () => {
  const { stages, roles } = await answers();
  const html = lifecyclePageHtml(stages, roles, ctx());
  const req = row(html, "requirements");
  assert.match(visible(req), /Spec writer .* Solution planner/);
  assert.ok(selected(req, "spec-writer"));
  assert.ok(selected(req, "solution-planner"));
  assert.equal((row(html, "architecture").match(/<select/g) ?? []).length, 3);
  assert.doesNotMatch(row(html, "review"), /class="rl"/);
});

test("the holder form asks for a handle only where one is needed, and offers the evidence formats in words", async () => {
  const { stages, roles } = await answers();
  const form = (kind) => {
    const html = lifecyclePageHtml(stages, roles, ctx({ editing: { role: "agent-critic", stage: "eval" }, draft: lifecycleDraft(roles.roles.find((r) => r.role === "agent-critic"), kind) }));
    const at = html.indexOf('<form class="lcbind');
    assert.ok(at > -1, kind);
    return html.slice(at, html.indexOf("</form>", at));
  };
  for (const k of ["your_agent", "contracted"]) assert.match(form(k), /name="handle"/, k);
  for (const k of ["person", "outside_tool"]) assert.doesNotMatch(form(k), /name="handle"/, k);
  const words = visible(form("outside_tool"));
  for (const w of ["Agent critic: an outside tool", "Security findings (SARIF)", "Bill of materials (CycloneDX)", "Where its evidence can be read", "Save", "Cancel"]) assert.ok(words.includes(w), w);
  for (const bad of ["json", "application/", "reference_agent", "outside_tool", "agent-critic", "{"]) assert.ok(!words.toLowerCase().includes(bad), bad);
  assert.match(form("person"), /data-kind="person"/);
});

test("the service's refusal shows on the row in its own words", async () => {
  const { stages, roles } = await answers();
  const words = "Give the supplier's handle on the mesh, so the stage's work can be sent to it.";
  const open = lifecyclePageHtml(stages, roles, ctx({ editing: { role: "code-critic", stage: "review" }, draft: { kind: "contracted", name: "Them" }, errors: new Map([["role:code-critic", words]]) }));
  assert.ok(visible(row(open, "review")).includes(words));
  const use = lifecyclePageHtml(stages, roles, ctx({ errors: new Map([["use:docs", "Only an admin of the organization can change its lifecycle."]]) }));
  assert.ok(visible(row(use, "docs")).includes("Only an admin of the organization can change its lifecycle."));
});

test("the summary line counts the stages used, and who holds them", async () => {
  const { stages, roles } = await answers();
  // From stages.json 1.4.1 the reverse engineer role names its reference agent, so the service holds it.
  assert.deepEqual(lifecycleSummary(stages, roles), { used: 21, total: 25, ours: 13, others: 7, open: 1 });
  const html = lifecyclePageHtml(stages, roles, ctx());
  assert.match(visible(html), /21 of 25 stages used 13 held by the service's own agents 7 held by others 1 not chosen/);
  // With every role held, "not chosen" is not shown.
  const all = structuredClone(roles);
  const critic = all.roles.find((r) => r.role === "agent-critic");
  Object.assign(critic, { from: "org", binding: { role: "agent-critic", holder: { kind: "person", name: "QA team" }, scope: { org: true } } });
  const rev = all.roles.find((r) => r.role === "reverse-engineer");
  Object.assign(rev, { from: "org", binding: { role: "reverse-engineer", holder: { kind: "person", name: "Platform team" }, scope: { org: true } } });
  assert.doesNotMatch(visible(lifecyclePageHtml(stages, all, ctx())), /not chosen/);
  // A stage counts as not chosen when any of its roles has nobody; as the service's own only when every role is.
  const m = new Map(all.roles.map((r) => [r.role, r]));
  assert.equal(heldBy({ roles: ["spec-writer", "solution-planner"] }, m), "ours");
  assert.equal(heldBy({ roles: ["spec-writer", "code-writer"] }, m), "others");
  assert.equal(heldBy({ roles: ["spec-writer", "nobody"] }, m), "open");
});

test("a project's page names it, and offers going back only for what the project chose", async () => {
  const { stages, roles } = await answers("project=finance");
  const html = lifecyclePageHtml(stages, roles, ctx({ project: "finance" }));
  assert.match(visible(html), /Lifecycle for finance/);
  assert.match(visible(html), /Use the organization's stages/);
  assert.match(row(html, "code"), /data-reset-role="code-writer"/);
  assert.doesNotMatch(row(html, "security"), /data-reset-role/);
  assert.match(row(html, "impact"), /class="cols row"/);
  assert.match(row(html, "eval"), /class="cols row off"/);
  assert.deepEqual(stagesToReset(stages, "finance"), ["impact", "eval"]);
  const org = await answers();
  assert.deepEqual(stagesToReset(org.stages, ""), ["impact", "source", "retract", "reconfigure"]);
  assert.match(visible(lifecyclePageHtml(org.stages, org.roles, ctx())), /Go back to the default stages/);
});

test("a service without the stages operations still lists every stage, for choosing holders", async () => {
  const { roles } = await answers();
  const html = lifecyclePageHtml(null, roles, ctx({ noStages: true, fallback: DOC.stages }));
  assert.equal((html.match(/class="cols row/g) ?? []).length, 25);
  assert.doesNotMatch(html, /data-use=/);
  assert.match(visible(html), /This service does not let you choose stages yet\. You can still choose who holds each role\./);
  assert.doesNotMatch(html, /data-reset-stages/);
});

test("the holder drafts and the body that binds the service's own agent", async () => {
  const { roles } = await answers();
  const r = (id) => roles.roles.find((x) => x.role === id);
  assert.deepEqual(lifecycleDraft(r("package-maker"), "contracted"), { kind: "contracted", name: "Harbor Builds", handle: "builds.harbor@example.com", formats: ["cyclonedx", "slsa"], where: "https://harbor.example.com/builds" });
  assert.deepEqual(lifecycleDraft(r("package-maker"), "person"), { kind: "person", name: "", handle: "", formats: [], where: "" });
  assert.deepEqual(referenceHolder(r("code-critic")), { holder: { kind: "reference_agent", name: "code-critic", handle: "code-critic.platform@agentmesh.ai" } });
  assert.equal(referenceHolder(r("agent-critic")), null);
});

test("a build says which lifecycle it follows, and a not_used stage says it is not part of it", () => {
  const day = () => "Oct 31";
  const pal = palindromeJudge();
  assert.equal(visible(buildLifecycleHtml(pal, { day })), "It follows the organization's lifecycle, as it was on Oct 31. See that lifecycle");
  assert.match(buildLifecycleHtml(pal), /href="#\/lifecycle"/);
  assert.equal(visible(notUsedHtml(pal, { day })), "This stage is not part of this build's lifecycle. The build follows the organization's lifecycle, as it was on Oct 31. See that lifecycle");
  const exp = expenseCheck();
  assert.match(visible(buildLifecycleHtml(exp, { day })), /^Built for the project finance\. It follows the lifecycle for the project finance, as it was on Oct 31\./);
  assert.match(notUsedHtml(exp), /href="#\/lifecycle\?project=finance"/);
  // A build from a service that keeps no lifecycle still says its project.
  const old = { ...exp, lifecycle: undefined };
  assert.equal(visible(buildLifecycleHtml(old)), "Built for the project finance. Who holds its roles");
  assert.equal(buildLifecycleHtml({ name: "x" }), "");
  assert.equal(lifecycleHash("a b"), "#/lifecycle?project=a%20b");
  assert.equal(lifecycleWords(""), "the organization's lifecycle");
});
