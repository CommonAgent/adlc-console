// The demo's answers have exactly the contract's shape, so the page built
// against the demo works against a real service.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { STAGE_IDS, palindromeJudge, expenseCheck } from "../lib/fixture.mjs";
import { checkBuildList, checkBuild, checkTry, checkTries, checkAction, checkRoles, checkStages } from "../lib/contract.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const get = (d, path, q = "") => d.handle("GET", path, new URLSearchParams(q), {});
const post = (d, path, body = {}) => d.handle("POST", path, new URLSearchParams(), body);

test("stages.json holds the 24 stages and Reverse engineering, numbered 0, with the plan's fields", () => {
  assert.equal(DOC.stages.length, 25);
  assert.deepEqual([DOC.stages[0].id, DOC.stages[0].number, DOC.stages[0].cadence], ["reverse-engineering", 0, "when_needed"]);
  assert.match(DOC.source, /agenticdevelopment\.ai|CommonAgent\/adlc/);
  const phases = ["define", "make", "ship", "prove", "use", "run", "change"];
  DOC.stages.forEach((s, i) => {
    assert.equal(s.number, i);
    assert.ok(phases.includes(s.phase), s.id);
    for (const k of ["id", "name", "role", "given", "hands_back", "done_when"]) assert.equal(typeof s[k], "string", `${s.id}.${k}`);
    assert.ok(s.reference_holder === null || typeof s.reference_holder === "string");
    assert.ok(s.asset === null || typeof s.asset === "string");
    assert.equal(typeof s.person_gate, "boolean");
  });
});

test("the demo names exactly the stages in stages.json", () => {
  assert.deepEqual(STAGE_IDS, IDS);
});

test("the build list has the contract's shape", async () => {
  const d = createDemoService();
  const r = await get(d, "/v1/lifecycle/builds");
  assert.equal(r.status, 200);
  assert.deepEqual(checkBuildList(r.body), []);
  assert.equal(r.body.builds.length, 13);
});

test("every demo build has the contract's shape", async () => {
  const d = createDemoService();
  for (const b of (await get(d, "/v1/lifecycle/builds")).body.builds) {
    const r = await get(d, `/v1/lifecycle/builds/${b.id}`);
    assert.deepEqual(checkBuild(r.body, IDS), [], b.id);
  }
});

test("the palindrome-judge build is waiting on you at Code, with a pull request", async () => {
  const b = palindromeJudge();
  const code = b.stages.find((s) => s.stage === "code");
  assert.equal(code.state, "waiting_on_you");
  assert.equal(code.holder.kind, "your_agent");
  assert.equal(code.where.kind, "pull_request");
  assert.equal(code.runs, 3);
  assert.equal(code.rounds.filter((r) => r.back).length, 2);
  assert.deepEqual(b.actions.map((a) => a.name), ["accept", "stop"]);
});

test("files handed back can be read, and nothing else", async () => {
  const d = createDemoService();
  const ok = await get(d, "/v1/lifecycle/builds/b_palindrome_judge/files", "path=scripts/judge.mjs");
  assert.equal(ok.status, 200);
  assert.match(ok.body, /export function judge/);
  const no = await get(d, "/v1/lifecycle/builds/b_palindrome_judge/files", "path=../../etc/passwd");
  assert.equal(no.status, 404);
});

test("taking each action keeps the contract's shape", async () => {
  const d = createDemoService();
  const path = "/v1/lifecycle/builds/b_palindrome_judge";
  for (const name of ["accept", "approve"]) {
    const r = await post(d, `${path}/actions/${name}`);
    assert.equal(r.status, 200, name);
    assert.deepEqual(checkBuild(r.body, IDS), [], name);
  }
  const deploy = (await get(d, path)).body.build.stages.find((s) => s.stage === "deploy");
  assert.equal(deploy.state, "done");
  const notOffered = await post(d, `${path}/actions/accept`);
  assert.equal(notOffered.status, 409);
  const stopped = await post(d, "/v1/lifecycle/builds/b_word_tally/actions/resume");
  assert.deepEqual(checkBuild(stopped.body, IDS), []);
});

test("a try, and the list of tries, have the contract's shape", async () => {
  const d = createDemoService();
  const path = "/v1/lifecycle/builds/b_palindrome_judge";
  const r = await post(d, `${path}/try`, { say: "Never odd or even", against: "pull_request" });
  assert.equal(r.status, 200);
  assert.deepEqual(checkTry(r.body), []);
  assert.equal(r.body.try.answer, "yes: neveroddoreven");
  const installed = await post(d, `${path}/try`, { say: "x", against: "installed" });
  assert.equal(installed.status, 409);
  const list = await get(d, `${path}/tries`);
  assert.deepEqual(checkTries(list.body), []);
  assert.equal(list.body.tries[0].id, r.body.try.id);
  await post(d, `${path}/tries/${r.body.try.id}/keep`);
  await post(d, `${path}/tries/t4/wrong`, { why: "fine" });
  const after = (await get(d, `${path}/tries`)).body.tries;
  assert.equal(after[0].kept, true);
  assert.equal(after.find((t) => t.id === "t4").sent_back, true);
});

test("a new build starts at Requirements with the contract's shape", async () => {
  const d = createDemoService();
  const r = await post(d, "/v1/lifecycle/builds", { does: "Count the words in a passage." });
  assert.equal(r.status, 201);
  assert.deepEqual(checkBuild(r.body, IDS), []);
  assert.equal(r.body.build.stages.find((s) => s.stage === "requirements").state, "working");
  assert.equal(r.body.build.stages[0].stage, "reverse-engineering");
  assert.equal((await post(d, "/v1/lifecycle/builds", {})).status, 400);
});

test("the checks notice a build that breaks the contract", () => {
  const b = palindromeJudge();
  b.stages[0].state = "finished";
  b.stages[6].rounds.reverse();
  b.stages[2].handed_back.files.push({ path: "x", size: "1 KB", link: "" });
  delete b.actions[0].needs;
  const problems = checkBuild({ build: b }, IDS);
  assert.ok(problems.some((p) => p.includes("state is one of")));
  assert.ok(problems.some((p) => p.includes("newest first")));
  assert.ok(problems.some((p) => p.includes("size is a count")));
  assert.ok(problems.some((p) => p.includes("needs is a list")));
});

test("each build in the list says where it ended or is, in words", async () => {
  const d = createDemoService();
  const by = Object.fromEntries((await get(d, "/v1/lifecycle/builds")).body.builds.map((b) => [b.id, b]));
  assert.equal(by.b_palindrome_judge.at.summary, "Waiting on you at Code");
  assert.equal(by.b_tally_words.at.summary, "Installed · not checked for conformance yet");
  assert.equal(by.b_word_tally.at.summary, "Stopped at Code");
  for (const b of Object.values(by)) assert.equal(b.archived, false);
  const one = (await get(d, "/v1/lifecycle/builds/b_word_tally")).body.build;
  assert.equal(one.summary, "Stopped at Code");
  assert.equal(one.paused, null);
});

test("an archived build leaves the list, comes back with ?archived=1, and can be put back", async () => {
  const d = createDemoService();
  const r = await post(d, "/v1/lifecycle/builds/b_word_tally/actions/archive");
  assert.equal(r.status, 200);
  assert.deepEqual(checkBuild(r.body, IDS), []);
  assert.equal(r.body.build.archived, true);
  assert.ok(r.body.build.actions.some((a) => a.name === "unarchive"));
  const ids = async (q = "") => (await get(d, "/v1/lifecycle/builds", q)).body.builds.map((b) => b.id);
  assert.ok(!(await ids()).includes("b_word_tally"));
  const all = await get(d, "/v1/lifecycle/builds", "archived=1");
  assert.deepEqual(checkBuildList(all.body), []);
  assert.equal(all.body.builds.find((b) => b.id === "b_word_tally").archived, true);
  await post(d, "/v1/lifecycle/builds/b_word_tally/actions/unarchive");
  assert.ok((await ids()).includes("b_word_tally"));
});

test("the checks take the summary, the pause and archived when given, and notice the wrong kind", () => {
  const list = (over) => ({ builds: [{ id: "b", name: "n", does: "d", version: "0.1.0", at: { stage: "code", state: "stopped", ...over.at }, updated: "2026-10-31T09:00:00Z", ...over.top }] });
  assert.deepEqual(checkBuildList(list({ at: {}, top: {} })), []);
  assert.deepEqual(checkBuildList(list({ at: { summary: "Stopped at Code" }, top: { archived: true } })), []);
  assert.equal(checkBuildList(list({ at: { summary: 3 }, top: { archived: "yes" } })).length, 2);
  const b = palindromeJudge();
  assert.deepEqual(checkBuild({ build: { ...b, summary: "Installed · paused: failed conformance", paused: { at: "2026-10-31T22:10:00Z", why: "The conformance check failed." }, archived: false } }, IDS), []);
  assert.deepEqual(checkBuild({ build: { ...b, paused: null } }, IDS), []);
  assert.equal(checkBuild({ build: { ...b, summary: 1, paused: { why: "x" }, archived: 0 } }, IDS).length, 3);
});

test("a need may say it is optional, as true or false and nothing else", () => {
  const a = (optional) => ({ stage: "requirements", name: "approve", label: "Approve the spec", needs: [{ name: "repository", label: "Repository", kind: "repository", ...(optional === undefined ? {} : { optional }) }] });
  assert.deepEqual(checkAction(a(undefined), "a"), []);
  assert.deepEqual(checkAction(a(true), "a"), []);
  assert.equal(checkAction(a("yes"), "a").length, 1);
});

// ---------- 0.2: who holds each role, and evidence ----------

const put = (d, path, body, q = "") => d.handle("PUT", path, new URLSearchParams(q), body);
const del = (d, path, q = "") => d.handle("DELETE", path, new URLSearchParams(q), {});
const ROLE_IDS = DOC.roles.map((r) => r.id);
const roleOf = (body, id) => body.roles.find((r) => r.role === id);

test("stages.json 1.5.0 lists the roles, each stage's role ids and cadence, the evidence formats and the starting points", () => {
  assert.equal(DOC.version, "1.5.0");
  assert.equal(DOC.starting_points.find((p) => p.id === "existing-code").enters, "reverse-engineering");
  assert.equal(DOC.starting_points.find((p) => p.id === "as-built-record").enters, "requirements");
  for (const s of DOC.stages) assert.ok(["every_build", "setup", "when_needed"].includes(s.cadence), `${s.id}: cadence`);
  assert.equal(DOC.roles.length, 20);
  for (const r of DOC.roles) {
    assert.equal(r.contract, `https://agentroles.ai/${r.id}.html`);
    assert.equal(r.offering, `role-${r.id}`);
    for (const s of r.stages) assert.ok(DOC.stages.find((x) => x.id === s).role_ids.includes(r.id), `${r.id} at ${s}`);
  }
  for (const s of DOC.stages) assert.ok(s.role_ids.length > 0 && s.role_ids.every((id) => ROLE_IDS.includes(id)), s.id);
  assert.deepEqual(DOC.evidence_formats.map((f) => f.id), ["sarif", "cyclonedx", "spdx", "slsa", "in-toto", "otel-genai", "pact"]);
  for (const f of DOC.evidence_formats) for (const k of ["id", "name", "read_for"]) assert.equal(typeof f[k], "string");
});

test("the roles answer has the contract's shape, for the organization and for a project", async () => {
  const d = createDemoService();
  const org = await get(d, "/v1/lifecycle/roles");
  assert.equal(org.status, 200);
  assert.deepEqual(checkRoles(org.body, ROLE_IDS), []);
  assert.deepEqual(org.body.roles.map((r) => r.role), ROLE_IDS);
  assert.equal(roleOf(org.body, "security-reviewer").from, "org");
  assert.equal(roleOf(org.body, "code-writer").from, "org");
  assert.equal(roleOf(org.body, "code-critic").from, "default");
  assert.equal(roleOf(org.body, "agent-critic").from, "unbound");
  assert.equal(roleOf(org.body, "agent-critic").binding, null);
  assert.deepEqual(roleOf(org.body, "requester").binding.holder, { kind: "person", name: "the person who asked" });
  const fin = await get(d, "/v1/lifecycle/roles", "project=finance");
  assert.deepEqual(checkRoles(fin.body, ROLE_IDS), []);
  assert.equal(roleOf(fin.body, "code-writer").from, "project");
  assert.equal(roleOf(fin.body, "code-writer").binding.holder.handle, "coder.finance@example.com");
});

test("binding a role, and going back to the default, keep the contract's shape", async () => {
  const d = createDemoService();
  const holder = { kind: "contracted", name: "Northwind Review", handle: "review.northwind@example.com", evidence: { formats: ["sarif"], where: "https://northwind.example.com" } };
  const r = await put(d, "/v1/lifecycle/roles/code-critic", { holder });
  assert.equal(r.status, 200);
  assert.deepEqual(checkRoles(r.body, ROLE_IDS), []);
  assert.equal(roleOf(r.body, "code-critic").from, "org");
  assert.deepEqual(roleOf(r.body, "code-critic").binding.holder, holder);
  // A project binding overrides the organization's, and going back leaves the organization's.
  const p = await put(d, "/v1/lifecycle/roles/code-critic", { holder: { kind: "person", name: "Our review team" } }, "project=web");
  assert.equal(roleOf(p.body, "code-critic").from, "project");
  const back = await del(d, "/v1/lifecycle/roles/code-critic", "project=web");
  assert.equal(roleOf(back.body, "code-critic").from, "org");
  const def = await del(d, "/v1/lifecycle/roles/code-critic");
  assert.equal(roleOf(def.body, "code-critic").from, "default");
  assert.deepEqual(checkRoles(def.body, ROLE_IDS), []);
});

test("a binding the contract refuses is a 400 with words", async () => {
  const d = createDemoService();
  const cases = [
    ["nobody-role", { kind: "person", name: "x" }],
    ["code-critic", { kind: "your_agent", name: "Ours" }],
    ["code-critic", { kind: "contracted", name: "Them" }],
    ["requester", { kind: "outside_tool", name: "A form" }],
    ["code-critic", { kind: "outside_tool", name: "Scanner", evidence: { formats: ["pdf"] } }],
    ["code-critic", { kind: "robot", name: "x" }],
  ];
  for (const [role, holder] of cases) {
    const r = await put(d, `/v1/lifecycle/roles/${role}`, { holder });
    assert.equal(r.status, 400, `${role} ${holder.kind}`);
    assert.equal(typeof r.body.error, "string");
  }
});

test("a process build shows outside holders, evidence, and the stages nobody holds or that do not apply", async () => {
  const d = createDemoService();
  const r = await get(d, "/v1/lifecycle/builds/b_expense_check");
  assert.deepEqual(checkBuild(r.body, IDS), []);
  const b = r.body.build;
  const at = (id) => b.stages.find((s) => s.stage === id);
  assert.equal(b.project, "finance");
  assert.equal(at("review").state, "not_applicable");
  assert.equal(at("impact").state, "not_bound");
  assert.equal(at("security").holder.kind, "outside_tool");
  assert.equal(at("security").evidence[0].format, "sarif");
  assert.equal(at("package").holder.kind, "contracted");
  assert.equal(at("release").state, "not_started");
  const file = await get(d, "/v1/lifecycle/builds/b_expense_check/files", "path=evidence/scan.sarif");
  assert.equal(file.status, 200);
  assert.match(file.body, /js\/path-injection/);
});

test("a new build may name its project", async () => {
  const d = createDemoService();
  const r = await post(d, "/v1/lifecycle/builds", { does: "Count the words.", project: "finance" });
  assert.equal(r.body.build.project, "finance");
  assert.deepEqual(checkBuild(r.body, IDS), []);
});

test("the checks notice a roles answer or evidence that breaks the contract", async () => {
  const d = createDemoService();
  const body = structuredClone((await get(d, "/v1/lifecycle/roles")).body);
  roleOf(body, "agent-critic").binding = { role: "agent-critic", holder: { kind: "your_agent", name: "Ours" } };
  roleOf(body, "code-critic").reference_agent = "code-critic";
  roleOf(body, "requester").binding.holder.kind = "outside_tool";
  roleOf(body, "watcher").from = "somewhere";
  const problems = checkRoles(body, ROLE_IDS);
  assert.ok(problems.some((p) => p.includes("handle is given")));
  assert.ok(problems.some((p) => p.includes("reference_agent is null or a holder")));
  assert.ok(problems.some((p) => p.includes("always a person")));
  assert.ok(problems.some((p) => p.includes("from is one of")));
  const b = expenseCheck();
  b.stages.find((s) => s.stage === "security").evidence[0].format = "pdf";
  b.stages.find((s) => s.stage === "code").holder.kind = "robot";
  const bp = checkBuild({ build: b }, IDS);
  assert.ok(bp.some((p) => p.includes("known evidence format")));
  assert.ok(bp.some((p) => p.includes("holder.kind is one of")));
});

// ---------- 0.3: which stages the lifecycle uses ----------

const SCHEMA = JSON.parse(await readFile(join(HERE, "..", "standards", "lifecycle-api.schema.json"), "utf8"));
const at = (b, id) => b.stages.find((s) => s.stage === id);

test("the vendored schema is lifecycle API 0.4.7, with the stages operations, not_used, products, stage workspaces, chats, the boss, cadence, features, setup forms, confirm cards, features at every stage, starting from existing code or an as-built record, and back_to_requirements", () => {
  assert.equal(SCHEMA.version, "0.4.7");
  assert.match(SCHEMA.$defs.Action.properties.name.description, /back_to_requirements/);
  assert.match(SCHEMA.$defs.StartRequest.properties.starting_point.description, /as-built-record/);
  for (const [d, k] of [["StartSource", "path"], ["BuildSource", "record"], ["AsBuiltSummary", "brought"]]) assert.ok(SCHEMA.$defs[d].properties[k], `${d}.${k}`);
  for (const op of ["POST /builds/{id}/features/{feature}/bug", "POST /builds/{id}/features/{feature}/drop"]) assert.ok(SCHEMA.operations.some((o) => `${o.method} ${o.path}` === op), op);
  for (const d of ["AsBuiltSummary", "AsBuiltPart", "AsBuilt", "FixItem", "StartSource", "BuildSource", "ProductSource"]) assert.ok(SCHEMA.$defs[d], d);
  assert.ok(SCHEMA.$defs.Artifact.properties.kind.enum.includes("as_built"));
  for (const op of ["POST /builds/{id}/features/backfill", "POST /builds/{id}/features/approve_all"]) assert.ok(SCHEMA.operations.some((o) => `${o.method} ${o.path}` === op), op);
  for (const d of ["FeatureSlice", "FeatureCount"]) assert.ok(SCHEMA.$defs[d], d);
  for (const op of ["GET /builds/{id}/features", "POST /builds/{id}/features/{feature}/approve", "GET /products/{name}/features", "GET /products/{name}/features/{feature}"]) assert.ok(SCHEMA.operations.some((o) => `${o.method} ${o.path}` === op), op);
  for (const k of ["setup", "when_needed"]) assert.ok(SCHEMA.$defs.ProductAnswer.properties[k], k);
  for (const d of ["SetupForm", "WhenNeededConfirm", "WhenNeededLast", "ActionResult"]) assert.ok(SCHEMA.$defs[d], d);
  for (const op of ["GET /products/{name}/boss/messages", "POST /products/{name}/boss/messages", "GET /products/{name}/boss/commitments"]) assert.ok(SCHEMA.operations.some((o) => `${o.method} ${o.path}` === op), op);
  const ops = SCHEMA.operations.map((o) => `${o.method} ${o.path}`);
  for (const op of ["GET /stages", "PUT /stages/{stage}", "DELETE /stages/{stage}"]) assert.ok(ops.includes(op), op);
  for (const op of ["GET /products", "GET /products/{name}", "GET /builds/{id}/stages/{stage}", "GET /products/{name}/stages/{stage}/messages", "POST /products/{name}/stages/{stage}/messages"]) assert.ok(ops.includes(op), op);
  assert.ok(SCHEMA.$defs.State.enum.includes("not_used"));
  assert.deepEqual(SCHEMA.$defs.StageChoice.required, ["stage", "name", "phase", "roles", "used", "from", "can_leave_out"]);
  assert.deepEqual(SCHEMA.$defs.StagesAnswer.required, ["project", "stages"]);
  assert.deepEqual(SCHEMA.$defs.Build.properties.lifecycle.required, ["project", "at"]);
});

test("the stages answer has the contract's shape, for the organization and for a project", async () => {
  const d = createDemoService();
  const org = await get(d, "/v1/lifecycle/stages");
  assert.equal(org.status, 200);
  assert.deepEqual(checkStages(org.body, { stages: DOC.stages, project: null }), []);
  assert.equal(org.body.project, null);
  assert.deepEqual(org.body.stages.filter((s) => !s.used).map((s) => s.stage), ["impact", "source", "retract", "reconfigure"]);
  assert.equal(at(org.body, "impact").from, "org");
  assert.equal(at(org.body, "review").from, "default");
  assert.equal(at(org.body, "test").can_leave_out, false);
  assert.match(at(org.body, "test").why_not, /cannot build without it/);
  const fin = await get(d, "/v1/lifecycle/stages", "project=finance");
  assert.deepEqual(checkStages(fin.body, { stages: DOC.stages, project: "finance" }), []);
  assert.equal(at(fin.body, "impact").used, true);
  assert.equal(at(fin.body, "impact").from, "project");
  assert.equal(at(fin.body, "eval").used, false);
  assert.equal(at(fin.body, "source").from, "org");
});

test("choosing a stage, and going back, keep the contract's shape", async () => {
  const d = createDemoService();
  const off = await put(d, "/v1/lifecycle/stages/docs", { used: false });
  assert.equal(off.status, 200);
  assert.deepEqual(checkStages(off.body, { stages: DOC.stages, project: null }), []);
  assert.equal(at(off.body, "docs").used, false);
  assert.equal(at(off.body, "docs").from, "org");
  const p = await put(d, "/v1/lifecycle/stages/docs", { used: true }, "project=web");
  assert.equal(at(p.body, "docs").from, "project");
  assert.equal(at(p.body, "docs").used, true);
  const back = await del(d, "/v1/lifecycle/stages/docs", "project=web");
  assert.equal(at(back.body, "docs").from, "org");
  const def = await del(d, "/v1/lifecycle/stages/docs");
  assert.equal(at(def.body, "docs").from, "default");
  assert.equal(at(def.body, "docs").used, true);
});

test("a stage choice the service refuses is a 400 with words", async () => {
  const d = createDemoService();
  for (const [stage, body] of [["nothing", { used: false }], ["code", { used: false }], ["docs", { used: "no" }], ["docs", {}]]) {
    const r = await put(d, `/v1/lifecycle/stages/${stage}`, body);
    assert.equal(r.status, 400, `${stage} ${JSON.stringify(body)}`);
    assert.equal(typeof r.body.error, "string");
  }
  // The refusal for a stage the service needs is its why_not, in its own words.
  const code = await put(d, "/v1/lifecycle/stages/code", { used: false });
  assert.match(code.body.error, /cannot build without it/);
});

test("a build shows its lifecycle, and the stages it leaves out read not_used", async () => {
  const d = createDemoService();
  const pal = (await get(d, "/v1/lifecycle/builds/b_palindrome_judge")).body;
  assert.deepEqual(checkBuild(pal, IDS), []);
  assert.deepEqual(pal.build.lifecycle, { project: null, at: "2026-10-31T14:58:00Z" });
  for (const id of ["impact", "source", "retract", "reconfigure"]) {
    const s = at(pal.build, id);
    assert.equal(s.state, "not_used", id);
    assert.equal(s.holder, null);
    assert.equal(s.runs, 0);
  }
  const exp = (await get(d, "/v1/lifecycle/builds/b_expense_check")).body.build;
  assert.equal(exp.lifecycle.project, "finance");
  assert.equal(at(exp, "eval").state, "not_used");
  // not_applicable wins over not_used; the finance project uses Impact.
  assert.equal(at(exp, "review").state, "not_applicable");
  assert.equal(at(exp, "impact").state, "not_bound");
});

test("a new build keeps the lifecycle in effect when it started", async () => {
  const d = createDemoService();
  await put(d, "/v1/lifecycle/stages/docs", { used: false });
  const b = (await post(d, "/v1/lifecycle/builds", { does: "Count the words.", project: "finance" })).body;
  assert.deepEqual(checkBuild(b, IDS), []);
  assert.equal(b.build.lifecycle.project, "finance");
  assert.deepEqual(b.build.stages.filter((s) => s.state === "not_used").map((s) => s.stage), ["source", "docs", "retract", "eval", "reconfigure"]);
  // A later change leaves the started build as it was.
  await put(d, "/v1/lifecycle/stages/docs", { used: true });
  const again = (await get(d, `/v1/lifecycle/builds/${b.build.id}`)).body.build;
  assert.equal(at(again, "docs").state, "not_used");
});

test("the checks notice a stages answer or a build that breaks the 0.3 contract", async () => {
  const d = createDemoService();
  const body = structuredClone((await get(d, "/v1/lifecycle/stages")).body);
  at(body, "test").used = false;
  delete at(body, "code").why_not;
  at(body, "review").from = "project";
  at(body, "docs").from = "somewhere";
  at(body, "eval").name = "Evaluation";
  [body.stages[0], body.stages[1]] = [body.stages[1], body.stages[0]];
  const p = checkStages(body, { stages: DOC.stages, project: "finance" });
  for (const words of ["a stage that cannot be left out is used", "why_not says what needs the stage", "from is project only when a project was asked about", "from is one of", "name is the stage's name", "in its order", "project is the project asked about"]) {
    assert.ok(p.some((x) => x.includes(words)), words);
  }
  assert.ok(checkStages({ stages: [] }).some((x) => x.includes("project is words, or null")));
  const b = palindromeJudge();
  at(b, "impact").holder = { kind: "reference_agent", name: "impact-analyst" };
  at(b, "source").runs = 1;
  b.actions.push({ stage: "retract", name: "stop", label: "Stop", needs: [] });
  b.lifecycle = { project: "web", at: "yesterday" };
  const bp = checkBuild({ build: b }, IDS);
  for (const words of ["not_used stage has holder null", "not_used stage has runs 0", "is not at a not_used stage", "lifecycle.at is an ISO 8601 time", "lifecycle.project is the build's project"]) {
    assert.ok(bp.some((x) => x.includes(words)), words);
  }
});
