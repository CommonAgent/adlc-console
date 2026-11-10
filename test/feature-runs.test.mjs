// Each feature in a run of its own (lifecycle API 0.4.10) in the console: the
// Board has a card per feature run, placed by the run's own stage beside its
// version's card, an ended run's in Done, and Waiting on me counts the runs
// that wait on you, not the version that waits on them; at Test and Code a
// row per run takes the gate's place, with its stage and state, its pull
// request and its actions, each sent back with its run; and a run opened
// reads as a build of its own. A build from a service without feature runs
// draws as before. Against the demo service and a list shaped like Product
// Factory's, held to the lifecycle API's own check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { boardCards, boardColumns, boardHtml, cardWords, gathering, isDone, waitsOnMe } from "../public/board.js";
import { actionButtonsHtml, actionKey, featureRuns, featureRunsHtml, fallbackChat, runBuild, runLabel, runStageIds, stageWorkspace, artifactsTabHtml, steps, stepHeader, spineHtml, runGateHtml, runStripHtml, runWorkHtml, documentOf } from "../public/workspace.js";
import { validate, checkBuild, checkBuildList, stageIds } from "../standards/lifecycle-api-check.mjs";
import { checkBuild as checkContract, checkBuildList as checkContractList } from "../lib/contract.mjs";
import { createDemoService } from "../lib/demo.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const STAGES = DOC.stages;
const PHASES = DOC.phases.map((p) => [p.id, p.name]);
const IDS = stageIds();
const defs = new Map(STAGES.map((s) => [s.id, s]));
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = (d, path, q = "") => d.handle("GET", path, new URLSearchParams(q), {});
const post = (d, path, body) => d.handle("POST", path, new URLSearchParams(), body);
const WS = "/v1/lifecycle/builds/b_word_stats";
const ids = (col) => col.builds.map((b) => (b.run ? `${b.id}/${b.run.id}` : b.id));
const byId = (cols) => Object.fromEntries(cols.map((c) => [c.id, c]));
const stageName = (id) => defs.get(id)?.name ?? id;

test("the demo's version gathering its features meets the lifecycle API's check, as a build and on the list", async () => {
  const d = createDemoService();
  const b = (await get(d, WS)).body;
  assert.deepEqual(validate("BuildAnswer", b), []);
  assert.deepEqual(checkBuild(b, IDS, "b_word_stats"), []);
  assert.deepEqual(checkContract(b, IDS), []);
  const list = (await get(d, "/v1/lifecycle/builds")).body;
  assert.deepEqual(checkBuildList(list, IDS), []);
  assert.deepEqual(checkContractList(list), []);
  // One accepted, one waiting on you at Code on its pull request, one at Code with its pull request, waiting for a push.
  assert.deepEqual(b.build.feature_runs.map((r) => [r.id, r.name, r.at.stage, r.at.state, r.ended, r.pull_request?.url.split("/").at(-1)]), [
    ["F1", "F1 Count words", "code", "done", true, "7"],
    ["F2", "F2 Count lines", "code", "waiting_on_you", false, "8"],
    ["F3", "F3 Longest word", "code", "working", false, "9"],
  ]);
  assert.equal(b.build.summary, "Making 2 features, each in a run of its own: 1 waits on you");
  // The version's own Code reads across the runs, each round labeled with its run.
  const code = b.build.stages.find((s) => s.stage === "code");
  assert.equal(code.state, "waiting_on_you");
  assert.deepEqual(code.rounds.map((r) => r.label), ["F2 · Push 2 · 9be07d1", "F1 · Push 1 · a41c2e0", "F2 · Push 1 · 5d2a8f3"]);
  assert.ok(b.build.timeline.some((x) => x.run === "F3" && x.end === null));
  assert.deepEqual(b.build.actions.map((a) => actionKey(a).replace("\n", " ")), ["accept F2", "back_to_test F2", "stop F2", "stop F3", "stop"]);
});

test("the Board: a card per feature run beside its version, by the run's own stage, an ended run's in Done", async () => {
  const list = (await get(createDemoService(), "/v1/lifecycle/builds", "archived=1")).body.builds;
  const c = byId(boardColumns(list, STAGES, PHASES));
  assert.deepEqual(ids(c.make), ["b_palindrome_judge", "b_word_stats", "b_word_stats/F2", "b_word_stats/F3", "b_release_notes"]);
  assert.ok(ids(c.done).includes("b_word_stats/F1"));
  const html = boardHtml(list, STAGES, PHASES);
  const card = (href) => {
    const m = new RegExp(`<a class="(bc[^"]*)" href="${href.replace(/\//g, "\\/")}"[^>]*>(.*?)</a>`).exec(html);
    assert.ok(m, href);
    return { cls: m[1], text: visible(m[2]) };
  };
  // The version's card says how many features it is making, and is not itself waiting on you.
  assert.deepEqual(card("#/b/b_word_stats"), { cls: "bc work", text: "word-stats 0.1.0 06 · Code Making 2 features, each in a run of its own: 1 waits on you" });
  // Each run's card: the feature's name, its version, where it is, and who it waits on. It opens that run at its stage.
  assert.deepEqual(card("#/b/b_word_stats/code/run/F2"), { cls: "bc fr wait", text: "F2 Count lines word-stats 0.1.0 06 · Code Waiting on you at Code" });
  assert.deepEqual(card("#/b/b_word_stats/code/run/F3"), { cls: "bc fr work", text: "F3 Longest word word-stats 0.1.0 06 · Code Working Working at Code: waiting for a push to pull request #9" });
  assert.deepEqual(card("#/b/b_word_stats/code/run/F1"), { cls: "bc fr done", text: "F1 Count words word-stats 0.1.0 You OK'd the code on pull request #7" });
  // Waiting on me: the run that waits on you, never its version.
  const mine = boardColumns(list, STAGES, PHASES, { mine: true }).flatMap(ids);
  assert.ok(mine.includes("b_word_stats/F2"));
  assert.ok(!mine.includes("b_word_stats") && !mine.includes("b_word_stats/F3"));
});

test("a list shaped like Product Factory's: the version gathers, its runs wait, and once every run closed the version stands alone", () => {
  const card = (id, state, ended = false, stage = "code") => ({ id, feature: id, name: `${id} Feature`, started: "2026-11-10T17:18:32.270Z", at: { stage, state, summary: state === "done" ? "Code OK'd · counter 0.1.0" : "Waiting on you at Code" }, ended });
  const item = (feature_runs, at = { stage: "code", state: "waiting_on_you", summary: "Making 2 features, each in a run of its own: 2 wait on you" }) => ({ id: "b1", name: "counter", does: "Count the words.", version: "0.1.0", kind: "agent", at, archived: false, updated: "2026-11-10T17:18:34Z", feature_runs });
  const list = [item([card("F1", "done", true), card("F2", "waiting_on_you"), card("F3", "waiting_on_you")])];
  assert.deepEqual(checkBuildList({ builds: list }, IDS), []);
  assert.equal(boardCards(list).length, 4);
  assert.ok(gathering(list[0]));
  assert.ok(!waitsOnMe(list[0]));
  assert.equal(boardCards(list).filter(waitsOnMe).length, 2);
  assert.match(boardHtml(list, STAGES, PHASES), /Waiting on me \(2\)/);
  assert.deepEqual(cardWords(list[0], STAGES), { where: "06 · Code", state: "Making 2 features, each in a run of its own: 2 wait on you", note: "", tone: "work", archived: false });
  // Every run closed: the version is its own again, at the stage it went on to.
  const after = [item([card("F1", "done", true), card("F2", "done", true)], { stage: "deploy", state: "waiting_on_you", summary: "Waiting on you at Deploy" })];
  assert.ok(!gathering(after[0]));
  assert.ok(waitsOnMe(after[0]));
  assert.deepEqual(ids(byId(boardColumns(after, STAGES, PHASES)).done), ["b1/F1", "b1/F2"]);
  // An archived version's runs are archived with it.
  assert.ok(boardCards([{ ...after[0], archived: true }]).every(isDone));
});

test("at Test and Code, a row per run: the feature, its stage and state, its pull request, and its actions, each naming its run", async () => {
  const b = (await get(createDemoService(), WS)).body.build;
  assert.deepEqual([...runStageIds(b)], ["test", "code"]);
  const seen = [];
  const html = featureRunsHtml(b, "code", {
    sel: null, href: (r) => `#/b/b_word_stats/code${r ? `/run/${r}` : ""}`, stageName,
    actionsHtml: (run, labels) => { seen.push([run, labels]); return actionButtonsHtml(b.actions.filter((a) => a.stage === "code" && (a.run ?? null) === run), { labels }); },
  });
  const rows = [...html.matchAll(/<li class="rrow[^"]*">(.*?)<\/li>/g)].map((m) => m[1]);
  assert.equal(rows.length, 3);
  assert.equal(visible(rows[0]), "F1 Count words Done Code pull request #7");
  assert.equal(visible(rows[1]), "F2 Count lines Waiting on you Code pull request #8 OK the code Send back to Test Stop");
  assert.equal(visible(rows[2]), "F3 Longest word Working Code pull request #9 Stop");
  assert.match(rows[1], /<a class="rrn" href="#\/b\/b_word_stats\/code\/run\/F2"/);
  assert.match(rows[1], /data-act="accept" data-act-stage="code" data-act-run="F2"/);
  assert.match(rows[1], /href="https:\/\/github.com\/AgentMesh-Dev-Test\/word-stats\/pull\/8" target="_blank"/);
  // An ended run offers nothing; the version's own Stop comes after the rows.
  assert.deepEqual(seen.map(([r]) => r), ["F2", "F3", null]);
  assert.match(visible(html.slice(html.indexOf("</ul>"))), /^Stop$/);
  // The run open is marked, its row closes it again, and it says what its pull request's check said.
  const open = featureRunsHtml(b, "code", { sel: "F2", href: (r) => (r ? `#run/${r}` : "#closed"), stageName, actionsHtml: () => "" });
  assert.match(open, /<li class="rrow sel"><a class="rrn" href="#closed" aria-current="true"/);
  assert.match(visible(open), /Ready for your OK\. All 4 tests passed, F1's among them\./);
  assert.equal(runLabel({ label: "OK the code: F2" }, { id: "F2", feature: "F2" }), "OK the code");
  assert.equal(runLabel({ label: "OK the code" }, { id: "F2-2", feature: "F2" }), "OK the code");
});

test("an action of a run is sent with its run, and asks for its needs in its own form", () => {
  const a = { stage: "code", name: "back_to_test", label: "Send back to Test", needs: [{ name: "changes", label: "What is wrong with the suite", kind: "words" }], run: "F2" };
  const other = { ...a, run: "F3" };
  assert.equal(actionKey(a), "back_to_test\nF2");
  assert.equal(actionKey({ name: "stop" }), "stop");
  const html = actionButtonsHtml([a, other], { asking: "code\nback_to_test\nF2", pending: null });
  assert.equal((html.match(/<form class="ask"/g) ?? []).length, 1);
  assert.match(html, /<form class="ask" data-ask="back_to_test" data-ask-stage="code" data-ask-run="F2">/);
  // Sending one run's action marks that button alone.
  const busy = actionButtonsHtml([a, other], { pending: "back_to_test\nF3" });
  assert.deepEqual([...busy.matchAll(/data-act-run="(F\d)" disabled>([^<]+)</g)].map((m) => [m[1], m[2]]), [["F2", "Send back to Test"], ["F3", "Sending…"]]);
});

test("the demo takes an action on the run it names, the version's own without one, and goes on once every run has closed", async () => {
  const d = createDemoService();
  // Send back to Test on F2 needs its words, and leaves F3 as it was.
  assert.equal((await post(d, `${WS}/actions/back_to_test`, { run: "F2" })).status, 400);
  const sent = await post(d, `${WS}/actions/back_to_test`, { run: "F2", changes: "Count a line with only spaces." });
  assert.equal(sent.status, 200);
  assert.deepEqual(checkBuild(sent.body, IDS, "b_word_stats"), []);
  const run = (b, id) => b.feature_runs.find((r) => r.id === id);
  assert.deepEqual(run(sent.body.build, "F2").at, { stage: "test", state: "working", summary: "Working at Test: the test writer is revising the suite" });
  assert.equal(run(sent.body.build, "F3").at.state, "working");
  // A run that does not offer it is refused.
  assert.equal((await post(d, `${WS}/actions/accept`, { run: "F3" })).status, 409);
  // Stop with no run is the version's own: every open run stops with it.
  const stopped = (await post(d, `${WS}/actions/stop`, {})).body.build;
  assert.deepEqual(stopped.feature_runs.map((r) => r.ended), [true, true, true]);
  assert.equal(stopped.stages.find((s) => s.stage === "code").state, "stopped");
  // Another copy: OK F2, stop F3, and the version goes on to Package and the install.
  const e = createDemoService();
  const ok = (await post(e, `${WS}/actions/accept`, { run: "F2" })).body.build;
  assert.equal(run(ok, "F2").ended, true);
  assert.deepEqual(run(ok, "F2").actions, []);
  assert.equal(ok.summary, "Making 1 feature, each in a run of its own");
  const on = (await post(e, `${WS}/actions/stop`, { run: "F3" })).body.build;
  assert.deepEqual(checkBuild({ build: on }, IDS, "b_word_stats"), []);
  assert.deepEqual(["code", "package", "deploy"].map((id) => on.stages.find((s) => s.stage === id).state), ["done", "done", "waiting_on_you"]);
  assert.deepEqual(on.actions.map((a) => a.name), ["approve", "stop"]);
});

test("a run opened reads as a build of its own: its stage, its record as the chat, its files asked for under runs/<run id>/", async () => {
  const d = createDemoService();
  const b = (await get(d, WS)).body.build;
  const r = runBuild(b, "F2");
  assert.equal(r.run.id, "F2");
  assert.deepEqual(r.actions.map((a) => a.run), ["F2", "F2", "F2"]);
  assert.ok(r.timeline.every((x) => x.run === undefined));
  const ws = stageWorkspace(r, "code", null, { defs });
  assert.equal(ws.state, "waiting_on_you");
  assert.equal(ws.where.url.split("/").at(-1), "8");
  assert.deepEqual(ws.outputs, []);
  // What it handed back, each file shown at its own path and asked for at the run's.
  const files = ws.handedBack.files;
  assert.deepEqual(files.map((f) => [f.path, f.get]), [["scripts/lines.mjs", "runs/F2/scripts/lines.mjs"]]);
  const tab = artifactsTabHtml(ws, null, { filesHtml: (list) => list.map((f) => `<i data-file="${f.get ?? f.path}">${f.path}</i>`).join("") });
  assert.match(tab, /data-file="runs\/F2\/scripts\/lines\.mjs">scripts\/lines\.mjs</);
  const got = await get(d, `${WS}/files`, `path=${files[0].get}`);
  assert.equal(got.status, 200);
  assert.match(got.body, /^\/\/ lines\.mjs/);
  // Its chat is its own record: its rounds, its log and its pull request, never the other runs'.
  const chat = fallbackChat(r, "code", { defs });
  assert.ok(chat.some((m) => /Push 1 · 5d2a8f3: 1 test failed/.test(m.text)));
  assert.ok(chat.some((m) => m.link?.endsWith("/pull/8")));
  assert.ok(!chat.some((m) => /a41c2e0|pull request #9/.test(m.text)));
  assert.equal(runBuild(b, "F9"), null);
});

test("a build from a service without feature runs draws as before", async () => {
  const d = createDemoService();
  const pj = (await get(d, "/v1/lifecycle/builds/b_palindrome_judge")).body.build;
  assert.equal(pj.feature_runs, undefined);
  assert.deepEqual(featureRuns(pj), []);
  assert.equal(runStageIds(pj).size, 0);
  // Its actions carry no run, so they draw and send as they always did.
  const html = actionButtonsHtml(pj.actions, { asking: "code\nback_to_test" });
  assert.doesNotMatch(html, /data-act-run|data-ask-run/);
  assert.match(html, /<form class="ask" data-ask="back_to_test" data-ask-stage="code">/);
  const list = (await get(d, "/v1/lifecycle/builds")).body.builds.filter((x) => x.id !== "b_word_stats");
  assert.equal(boardCards(list).length, list.length);
  assert.ok(list.every((x) => !gathering(x)));
});

test("the console's checks notice a feature run that breaks the contract", async () => {
  const b = structuredClone((await get(createDemoService(), WS)).body);
  b.build.feature_runs[1].actions[0].run = "F3";
  b.build.feature_runs[2].ended = "no";
  b.build.actions[0].run = "F9";
  const p = checkContract(b, IDS);
  assert.ok(p.some((x) => x.startsWith("build.feature_runs[1].actions[0]: names its run")));
  assert.ok(p.some((x) => x.startsWith("build.feature_runs[2]: ended is true or false")));
  assert.ok(p.some((x) => x.startsWith("build.actions[0]: names a feature run the build has")));
  const list = structuredClone((await get(createDemoService(), "/v1/lifecycle/builds")).body);
  delete list.builds.find((x) => x.id === "b_word_stats").feature_runs[0].at;
  assert.ok(checkContractList(list).some((x) => x.includes("at has a stage id and a known state")));
});

test("the rail of a version with features: Spec, Features and Ship, none numbered; a feature opens its run, the open one shows its stages; Ship is one line until reached", async () => {
  const d = createDemoService();
  const b = (await get(d, WS)).body.build;
  const spine = steps(b, { defs });
  // Test and Code are the features'; the version's steps are Requirements, then Package and on.
  assert.deepEqual(spine.slice(0, 2).map((x) => [x.stage, x.mark]), [["requirements", "done"], ["package", "next"]]);
  assert.ok(!spine.some((x) => ["test", "code"].includes(x.stage)));
  assert.deepEqual(stepHeader(b, spine), { text: "Making 2 features, each in a run of its own: 1 waits on you", tone: "wait" });
  const opts = { href: (s) => `#/b/b_word_stats/${s}`, runHref: (s, r) => `#/b/b_word_stats/${s}/run/${r}`, runsHref: "#/b/b_word_stats/code", stageName };
  const html = spineHtml(b, spine, { sel: "code", runSel: "F2", ...opts });
  const text = visible(html);
  assert.equal(text, "word-stats 0.1.0 Spec all documents ✓ Requirements approved 2026-11-02T15:05:00Z Features 1 of 3 done ✓ Count words You OK'd the code on pull request #7 F2 Count lines Waiting on you at Code F3 Longest word Working at Code: waiting for a push to pull request #9 Ship after the features Package, Release, Deploy, Conformance and Acceptance");
  assert.ok(!/<span class="dot" aria-hidden="true">\d/.test(html), "no step numbers");
  // Each feature opens its run where it is; its stages are the feature page's, not the menu's.
  assert.match(html, /<a class="rs run done" href="#\/b\/b_word_stats\/code\/run\/F1"/);
  assert.match(html, /<a class="rs run now sel" href="#\/b\/b_word_stats\/code\/run\/F2" aria-current="page"/);
  assert.match(html, /<a class="rs run now work" href="#\/b\/b_word_stats\/code\/run\/F3"/);
  // Ship, folded, opens at its first stage; chosen, it unfolds.
  assert.match(html, /<a class="rs next ship" href="#\/b\/b_word_stats\/package"/);
  const open = spineHtml(b, spine, { sel: "deploy", ...opts });
  assert.ok(!/class="rs next ship"/.test(open));
  assert.match(open, /<h3 class="rg">Ship<\/h3><a class="rs next" href="#\/b\/b_word_stats\/package"/);
  assert.match(open, /<a class="rs next sel" href="#\/b\/b_word_stats\/deploy" aria-current="page"/);
  // The Features heading opens every feature at once, and is the page when the version's own Code is.
  assert.match(spineHtml(b, spine, { sel: "code", runSel: null, ...opts }), /<a class="rg sel" href="#\/b\/b_word_stats\/code" aria-current="page"/);
  // Without a way to open a run, the rail is the version's numbered steps alone, as before.
  assert.ok(!/class="rg/.test(spineHtml(b, spine, { sel: "code", href: (s) => s })));
});

test("a feature's page: its name over its own stages, and its gate alone, with its actions; a feature that ended says where, with its pull request", async () => {
  const d = createDemoService();
  const b = (await get(d, WS)).body.build;
  const fr = (id) => b.feature_runs.find((r) => r.id === id);
  const href = (s) => `#/b/b_word_stats/${s}/run/F2`;
  const strip = runStripHtml(fr("F2"), { sel: "code", href, stageName });
  assert.equal(visible(strip), "Test done → Code waiting on you");
  assert.match(strip, /<a class="fs done" href="#\/b\/b_word_stats\/test\/run\/F2">Test<small>done<\/small><\/a>.*<a class="fs now sel" href="#\/b\/b_word_stats\/code\/run\/F2" aria-current="page">Code<small>waiting on you<\/small><\/a>/);
  assert.equal(visible(runStripHtml(fr("F1"), { stageName })), "Test done → Code done");
  assert.equal(visible(runStripHtml(fr("F3"), { sel: "test", stageName })), "Test done → Code working");
  // F2's gate: its pull request's check, and only its own actions, labeled without the run.
  const run = runBuild(b, "F2");
  const ws = stageWorkspace(run, "code", null, { defs });
  const actionsHtml = (s) => actionButtonsHtml(run.actions.filter((a) => a.stage === s && a.run === "F2"), { labels: Object.fromEntries(run.actions.map((a) => [a.name, runLabel(a, fr("F2"))])) });
  const gate = runGateHtml(fr("F2"), ws, run, { actionsHtml });
  assert.match(gate, /<h4>Ready for your OK<\/h4><a class="pr" href="https:\/\/github.com\/AgentMesh-Dev-Test\/word-stats\/pull\/8"/);
  assert.equal(visible(gate).includes("F1 Count words"), false, "no other feature on it");
  assert.deepEqual([...gate.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]), ["OK the code", "Send back to Test", "Stop"]);
  assert.match(gate, /<details class="more"><summary>Done when<\/summary>/, "done-when waits behind a disclosure");
  // A feature that ended: where it ended, in the service's words, and its pull request.
  const done = runGateHtml(fr("F1"), stageWorkspace(runBuild(b, "F1"), "code", null, { defs }), runBuild(b, "F1"), { actionsHtml: () => "" });
  assert.match(done, /<div class="gcard feat done" id="gate"><div class="row"><h4>You OK&#39;d the code on pull request #7<\/h4><a class="pr" href="https:\/\/github.com\/AgentMesh-Dev-Test\/word-stats\/pull\/7"/);
  // A run whose stage names no pull request still shows the run's.
  const bare = runGateHtml({ ...fr("F2"), stages: [] }, { ...ws, where: null }, run, { actionsHtml });
  assert.match(bare, /<h4>Ready for your OK<\/h4><a class="pr" href="https:\/\/github.com\/AgentMesh-Dev-Test\/word-stats\/pull\/8"/);
});

test("the menu names a step before the features for the document it made, and opens it; a feature's Work tab gives the spec at that feature and what the run handed back", async () => {
  const d = createDemoService();
  const b0 = (await get(d, WS)).body.build;
  const b = { ...b0, artifacts: [{ id: "a-spec", stage: "requirements", kind: "statement", name: "Statement of the job", state: "made", version: "0.1.0" }] };
  assert.deepEqual(documentOf(b, "requirements"), { id: "a-spec", name: "Spec", kind: "statement", version: "0.1.0", tab: "spec" });
  assert.equal(documentOf(b, "package"), null);
  const html = spineHtml(b, steps(b, { defs }), { sel: "code", runSel: "F2", href: (s) => `#/b/b_word_stats/${s}`, runHref: (s, r) => `#/b/b_word_stats/${s}/run/${r}`, runsHref: "#", stageName });
  assert.match(html, /<a class="rg" href="#\/documents"[^>]*>Spec <small>all documents<\/small><\/a><a class="rs doc done" href="#\/b\/b_word_stats\/requirements\/spec"[^>]*><span class="dot" aria-hidden="true">✓<\/span><span class="rn">Spec<\/span><small>approved 2026-11-02T15:05:00Z<\/small><\/a>/);
  // The Work tab: given, the spec at this feature; made, the run's file, open.
  const fr = b.feature_runs.find((r) => r.id === "F2");
  const ws = stageWorkspace(runBuild(b, "F2"), "code", null, { defs });
  const work = runWorkHtml(fr, ws, b, { href: (s, t) => `#/b/b_word_stats/${s}/${t}`, filesHtml: (files, openOne) => `<files open="${openOne}">${files.map((f) => f.get ?? f.path).join(",")}</files>`, stageName });
  assert.match(work, /<h5>Given<\/h5><a class="gi" href="#\/b\/b_word_stats\/requirements\/spec"><b>Spec, feature F2<\/b>/);
  assert.match(work, /<h5>Made at Code<\/h5>.*<files open="true">runs\/F2\/scripts\/lines\.mjs<\/files>/s);
  assert.equal(visible(work).includes("F1"), false, "another feature's work is not on it");
});
