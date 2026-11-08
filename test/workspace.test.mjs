// The build page, one stage at a time (public/workspace.js), against the demo's
// lifecycle API 0.4 answers and against a service without them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { tallyWords, palindromeJudge } from "../lib/fixture.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { checkBuild, checkArtifacts, checkProducts, checkProduct, checkStageWorkspace, checkMessages, checkMessageReply } from "../lib/contract.mjs";
import {
  steps, stepHeader, spineHtml, openingStage, usedStages, productOf, productLine, stageWorkspace, gateCardHtml, chatHtml, fallbackChat,
  messagesOffered, proposalHtml, confirmBody, artifactBodyHtml, artifactsTabHtml, artifactCount, tabsHtml, defaultArtifact, productPageHtml, productFromBuilds, canTalkTo, holderName,
} from "../public/workspace.js";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const roleDefs = DOC.roles;
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = (d, path) => d.handle("GET", path, new URLSearchParams(), {});
const post = (d, path, body = {}) => d.handle("POST", path, new URLSearchParams(), body);
const PJ = "/v1/lifecycle/builds/b_palindrome_judge";
const live = (b) => (stage) => (b.actions.some((a) => a.stage === stage) ? `<div class="acts">${b.actions.filter((a) => a.stage === stage).map((a) => `<button data-act="${a.name}">${a.label}</button>`).join("")}</div>` : "");

test("the spine is the every-build stages the build runs, done, now or next, and opening a build opens the stage it is at", async () => {
  const b = (await get(createDemoService(), PJ)).body.build;
  const spine = steps(b, { defs, roleDefs });
  // Only every-build stages: Architecture is set up once per product, Impact is run when needed, and
  // Docs is not offered. Review and Security review ran inside Code's gate, and are done.
  assert.deepEqual(spine.map((x) => x.stage), ["requirements", "test", "code", "review", "security", "package", "release", "deploy", "conformance", "acceptance"]);
  assert.deepEqual(spine.map((x) => x.mark), ["done", "done", "now", "done", "done", "next", "next", "next", "next", "next"]);
  assert.equal(spine[2].line, "your OK on pull request #5");
  assert.equal(spine[5].line, "next");
  assert.equal(spine[7].line, "your approval"); // Deploy waits on a person in stages.json
  assert.equal(spine[0].line.startsWith("approved"), true);
  assert.deepEqual(stepHeader(b, spine), { text: "Step 3 of 10 · waiting on you", tone: "wait" });
  assert.equal(openingStage(b), "code");
  const html = spineHtml(b, spine, { sel: "code", href: (s) => `#/b/${b.id}/${s}`, productHref: "#/p/palindrome-judge" });
  assert.match(html, /<a class="rb" href="#\/p\/palindrome-judge"/);
  assert.match(html, /<a class="rs now sel" href="#\/b\/b_palindrome_judge\/code" aria-current="page"/);
  assert.match(visible(html), /^palindrome-judge 0\.1\.0 Step 3 of 10 · waiting on you ✓ Requirements approved .* 3 Code your OK on pull request #5 /);
  assert.doesNotMatch(html, /Impact|Retract|Architecture|Monitor/);

  // A finished build opens at its last stage, and says where it ended.
  const done = (await get(createDemoService(), "/v1/lifecycle/builds/b_lunch_poll")).body.build;
  const ds = steps(done, { defs, roleDefs });
  assert.ok(ds.every((x) => x.mark === "done"));
  assert.equal(openingStage(done), "acceptance");
  assert.deepEqual(stepHeader(done, ds), { text: "Installed · conforms", tone: "ok" });
  assert.equal(productOf(done), "lunch-poll");
  assert.equal(productOf({ name: "x", product: "y" }), "y");
});

test("each stage's chat holds only that stage's messages, each marked with its version, and never a gate", async () => {
  const d = createDemoService();
  const code = (await get(d, "/v1/lifecycle/products/palindrome-judge/stages/code/messages")).body.messages;
  const req = (await get(d, "/v1/lifecycle/products/palindrome-judge/stages/requirements/messages")).body.messages;
  assert.deepEqual(checkMessages({ messages: code }, "code"), []);
  assert.ok(code.every((m) => m.version === "0.1.0" && m.build === "b_palindrome_judge"));
  assert.ok(code.some((m) => /Pushed 0da3161/.test(m.text)));
  assert.ok(!code.some((m) => /Call it palindrome-judge/.test(m.text)));
  assert.ok(req.some((m) => /Call it palindrome-judge/.test(m.text)));
  const b = (await get(d, PJ)).body.build;
  const html = chatHtml([...code, { id: "g", at: code[0].at, from: { kind: "gate", name: "Gate" }, text: "a gate", gate: { stage: "code", state: "open" }, build: b.id, version: "0.1.0" }],
    { build: b, artifacts: new Map(b.artifacts.map((a) => [a.id, a])) });
  assert.match(html, /<i class="vt"[^>]*>v0\.1\.0<\/i>/);
  assert.doesNotMatch(html, /a gate/);
  assert.match(html, /<button class="att" type="button" data-art="pj-programs">The programs <i>0da3161<\/i><\/button>/);
  // A chat across builds: a line where the next version's messages begin.
  const two = chatHtml([
    { id: "a", at: "2026-10-01T10:00:00Z", from: { kind: "person", name: "you" }, text: "first", build: "b1", version: "0.1.0" },
    { id: "b", at: "2026-11-01T10:00:00Z", from: { kind: "agent", name: "Spec writer" }, text: "second", build: "b2", version: "0.2.0" },
  ], { build: b });
  assert.match(visible(two), /You v0\.1\.0 .* first Version 0\.2\.0 SW Spec writer v0\.2\.0 .* second/);
  assert.match(chatHtml([], { empty: "Nothing yet." }), /Nothing yet\./);
});

test("the gate is pinned on the stage: open with the build's live actions, answered in a done style, and who may when you may not", async () => {
  const d = createDemoService();
  const b = (await get(d, PJ)).body.build;
  const ans = (await get(d, `${PJ}/stages/code`)).body;
  const ws = stageWorkspace(b, "code", ans, { defs });
  assert.equal(ws.from, "service");
  assert.deepEqual(ws.given.map((a) => a.id), ["pj-statement", "pj-design", "pj-suite"]);
  assert.deepEqual(ws.outputs.map((a) => a.id), ["pj-programs"]);
  const open = gateCardHtml(ws, b, { actionsHtml: live(b), checkHtml: () => "<form id=clone-form></form>" });
  assert.match(open, /<div class="gcard gate" id="gate"><h4>Pull request #5: Ready for your OK<\/h4>/);
  assert.match(open, /data-act="accept">OK the code/);
  assert.match(open, /data-act="back_to_test"/);
  assert.match(open, /Done when/);
  assert.match(open, /Run its check in your clone/);
  // Requirements was approved: a done card with who answered and when.
  const req = stageWorkspace(b, "requirements", (await get(d, `${PJ}/stages/requirements`)).body, { defs });
  const done = gateCardHtml(req, b, { actionsHtml: live(b), when: () => "9:04 AM" });
  assert.match(done, /<div class="gcard done"/);
  assert.match(visible(done), /Approved by you · 9:04 AM/);
  assert.doesNotMatch(done, /gcard gate/);
  // Someone else's gate: no buttons, the words for who may answer.
  const theirs = gateCardHtml({ ...ws, gate: { actions: ["accept"], state: "open", who_may: "Ana Lee" } }, b, { actionsHtml: () => "" });
  assert.match(visible(theirs), /Ana Lee may answer this gate\./);
  assert.equal(gateCardHtml({ ...ws, gate: null }, b, {}), "");
  // A gate that closed with no answer, such as after a newer push: why, in words.
  const closed = gateCardHtml({ ...ws, gate: { actions: ["accept"], state: "answered", closed: "A newer push replaced it.", who_may: "you" } }, b, {});
  assert.match(visible(closed), /Code: closed .* A newer push replaced it\./);
  assert.doesNotMatch(closed, /gcard gate|gcard done/);
});

test("each artifact kind is read as words, never as raw JSON, and HTML in a summary is escaped", () => {
  const read = (kind, summary) => visible(artifactBodyHtml({ kind, summary }, { stageName: (s) => defs.get(s)?.name ?? s }));
  assert.match(read("statement", { agent: "a 0.1.0", offerings: [{ name: "Count words", does: "counts" }], refuses: ["images", "binaries"], records: ["each job"], price: "free", open: ["What is the price?"] }),
    /Agent a 0\.1\.0 Offering Count words ?: counts Refuses images; binaries Records each job Price free Still open: What is the price\?/);
  assert.match(read("suite", { count: 29, tests: ["t1", "t2"] }), /^29 tests\. t1 t2 and 27 more$/);
  assert.match(read("programs", { scripts: [{ path: "scripts/count.mjs", lines: 185, does: "counts" }], commit: "21065e2", pr: { number: 1, url: "https://github.com/o/r/pull/1" } }), /scripts\/count\.mjs 185 lines: counts Commit 21065e2 on pull request #1 ?\./);
  assert.match(read("findings", { open: [], verdict: "Clean.", outside: [{ place: "b.mjs:2", claim: "A name could be clearer." }] }), /Noted outside the change, holding nothing up: b\.mjs:2 A name could be clearer\. Nothing open\. Clean\./);
  assert.match(read("findings", { open: [], verdict: "Clean." }), /^Nothing open\. Clean\.$/);
  assert.match(read("findings", { open: [{ place: "a.mjs:4", claim: "Empty says yes.", consequence: "Wrong answer." }], verdict: "Back." }), /1 open a\.mjs:4 Empty says yes\. Wrong answer\. Back\./);
  assert.match(read("security", { reach: [], spend: "10 USD a day", never: ["hold a credential"], verdict: "passed" }), /May reach nothing May spend 10 USD a day Must never hold a credential Passed/);
  assert.match(read("package", { file: "a.tar.gz", digest: "sha256:ab", validated: true }), /File a\.tar\.gz Digest sha256:ab Validated yes, with no problems/);
  assert.match(read("run_plan", { stages: [{ stage: "monitor", name: "Monitor", holder: "watcher", settings: "every 5 minutes", reads: "chosen" }, { stage: "eval", holder: null, settings: "", reads: "not chosen" }] }), /Monitor watcher every 5 minutes · chosen Eval nobody chosen not chosen/);
  for (const kind of ["architecture", "build_record", "attestation", "agentdoc", "other"]) assert.equal(read(kind, { words: "Plain words." }), "Plain words.");
  // Never JSON: a summary of the wrong shape shows nothing of itself.
  for (const kind of ["statement", "suite", "programs", "findings", "security", "package", "run_plan", "other"]) {
    const html = artifactBodyHtml({ kind, summary: { agent: { nested: true }, offerings: "x", tests: { a: 1 }, scripts: [1], words: ["a"], stages: "s" } });
    assert.doesNotMatch(html, /[{}]|"nested"|\[object/, kind);
  }
  assert.equal(artifactBodyHtml({ kind: "suite", summary: "not an object" }), "");
  assert.doesNotMatch(artifactBodyHtml({ kind: "other", summary: { words: "<script>x</script>" } }), /<script>/);
});

test("the Artifacts tab opens an artifact in its reader beside the stage's Given and Outputs, with their states", async () => {
  const d = createDemoService();
  const b = (await get(d, PJ)).body.build;
  const ws = stageWorkspace(b, "code", (await get(d, `${PJ}/stages/code`)).body, { defs });
  assert.equal(defaultArtifact(ws), "pj-programs");
  assert.equal(artifactCount(ws), 4);
  const html = artifactsTabHtml(ws, "pj-suite", { stageName: (s) => defs.get(s).name, filesHtml: (f) => `<files n=${f.length}>` });
  const v = visible(html);
  assert.match(v, /^The suite Test · test writer · 14 tests 14 tests\./);
  assert.match(v, /3 given · 1 of 1 made Given Statement of the job v3 Requirements · spec writer Design v1 Architecture and Design · spec writer The suite 14 tests Test · test writer Outputs The programs 0da3161/);
  assert.match(html, /<div class="viewer" id="reader">/);
  assert.match(html, /<button class="arow sel" type="button" data-art="pj-suite" aria-pressed="true">/);
  assert.match(html, /<files n=2>/);
  // With nothing chosen, the newest output made is open.
  assert.match(visible(artifactsTabHtml(ws, null, {})), /^The programs code · Claude Code/);
  // A stage still to come: its outputs carry their state.
  const pkg = stageWorkspace(b, "package", (await get(d, `${PJ}/stages/package`)).body, { defs });
  assert.match(artifactsTabHtml(pkg, null, {}), /<span class="need next">Next<\/span>/);
  assert.match(visible(artifactsTabHtml(pkg, null, {})), /It is made next\./);
  // The stage's tabs, with counts, and the one open marked.
  const tabs = tabsHtml([{ id: "chat", label: "Chat", count: 7 }, { id: "artifacts", label: "Artifacts", count: 4 }, { id: "try", label: "Try it" }], "artifacts", { label: "Code" });
  assert.match(tabs, /<div class="tabs" role="tablist" aria-label="Code">/);
  assert.match(tabs, /<button type="button" role="tab" class="tab" aria-selected="false" data-tab="chat">Chat <span>7<\/span><\/button>/);
  assert.match(tabs, /class="tab on" aria-selected="true" data-tab="artifacts">Artifacts <span>4<\/span>/);
  // An attachment in the chat names the artifact it opens.
  const chat = chatHtml((await get(d, "/v1/lifecycle/products/palindrome-judge/stages/code/messages")).body.messages, { build: b, artifacts: new Map(b.artifacts.map((a) => [a.id, a])) });
  assert.match(chat, /data-art="pj-programs"/);
});

test("a change asked in the chat comes back as a proposal; confirming it takes the build's own action, through the gate", async () => {
  const d = createDemoService();
  const chat = "/v1/lifecycle/products/palindrome-judge/stages/code/messages";
  // A question changes nothing and proposes nothing.
  const q = await post(d, chat, { text: "Which script did you change?", build: "b_palindrome_judge" });
  assert.equal(q.status, 200);
  assert.equal(q.body.reply.proposes, undefined);
  const r = await post(d, chat, { text: "The tests should cover a message of only digits", build: "b_palindrome_judge" });
  assert.equal(r.status, 200);
  let b = (await get(d, PJ)).body.build;
  assert.deepEqual(checkMessageReply(r.body, { build: b }), []);
  assert.deepEqual(r.body.reply.proposes, { action: "back_to_test", needs: { words: "The tests should cover a message of only digits" } });
  assert.equal(b.stages.find((s) => s.stage === "code").state, "waiting_on_you", "answering changes nothing");
  // The confirm button, and what it sends.
  const html = proposalHtml(r.body.reply, b);
  assert.match(html, new RegExp(`data-confirm="${r.body.reply.id}"`));
  assert.match(visible(html), /What the tests should cover The tests should cover a message of only digits Confirm: Send back to Test/);
  const body = confirmBody(b, r.body.reply.proposes);
  assert.deepEqual(body, { stage: "code", name: "back_to_test", needs: { words: "The tests should cover a message of only digits" } });
  const a = await post(d, `${PJ}/actions/${body.name}`, body.needs);
  assert.equal(a.status, 200);
  assert.deepEqual(checkBuild(a.body, IDS), []);
  b = a.body.build;
  assert.equal(b.stages.find((s) => s.stage === "test").state, "working");
  // The gate it went through is answered, and the proposal can no longer be taken.
  const ws = (await get(d, `${PJ}/stages/code`)).body;
  assert.deepEqual(ws.gate.answered.action, "back_to_test");
  assert.equal(confirmBody(b, r.body.reply.proposes), null);
  assert.match(visible(proposalHtml(r.body.reply, b)), /The build does not offer that now\./);
  assert.match(proposalHtml(r.body.reply, b, { done: true }), /Confirmed/);
  // The chat keeps both, and the line the action added.
  const after = (await get(d, chat)).body.messages;
  assert.deepEqual(checkMessages({ messages: after }, "code"), []);
  assert.ok(after.some((m) => m.id === r.body.reply.id && m.proposes));
  assert.ok(after.some((m) => m.from.kind === "system" && /sent it back to Test/.test(m.text)));
});

test("there is no agent to talk to where a person or an outside tool holds the stage", async () => {
  const d = createDemoService();
  const tool = await post(d, "/v1/lifecycle/products/expense-check/stages/security/messages", { text: "hello" });
  assert.equal(tool.status, 400);
  assert.match(tool.body.error, /outside tool/);
  const person = await post(d, "/v1/lifecycle/products/palindrome-judge/stages/acceptance/messages", { text: "hello" });
  assert.equal(person.status, 400);
  assert.equal((await post(d, "/v1/lifecycle/products/palindrome-judge/stages/code/messages", { text: " " })).status, 400);
  assert.equal(canTalkTo({ kind: "outside_tool", name: "x" }), false);
  assert.equal(canTalkTo({ kind: "person", name: "you" }), false);
  assert.equal(canTalkTo({ kind: "your_agent", name: "Claude Code" }), true);
  assert.equal(canTalkTo(null), false);
  assert.equal(holderName({ kind: "reference_agent", name: "spec-writer" }, { stage: "requirements" }, defs.get("requirements"), roleDefs), "Spec writer");
  assert.equal(holderName({ kind: "your_agent", name: "Claude Code" }, { stage: "code" }, defs.get("code"), roleDefs), "Claude Code");
});

test("without the 0.4 routes, each stage is drawn from the build answer and its chat from the stage's record", async () => {
  // A service that predates 0.4: no artifacts, no stage workspace, no chat.
  const b = tallyWords();
  assert.equal(messagesOffered(404), false);
  assert.equal(messagesOffered(405), false);
  assert.equal(messagesOffered(501), false);
  assert.equal(messagesOffered(500), true);
  const ws = stageWorkspace(b, "deploy", null, { defs });
  assert.equal(ws.from, "build");
  assert.equal(ws.state, "done");
  assert.deepEqual(ws.outputs, []);
  assert.equal(ws.gate, null);
  assert.match(ws.doneWhen, /./);
  // The panel shows what the stage was given and handed back, or nothing at all.
  assert.equal(artifactCount(ws), null);
  assert.equal(visible(artifactsTabHtml({ ...ws, givenWords: "", handedBack: { words: [], files: [] } }, null, {})), "Deploy has no artifacts yet.");
  assert.match(visible(artifactsTabHtml(ws, null, {})), /Given The stage before it\./);
  // The palindrome build without the routes: the gate from its live actions, the chat from its rounds and log.
  const pj = (await get(createDemoService(), PJ)).body.build;
  delete pj.artifacts;
  const code = stageWorkspace(pj, "code", null, { defs });
  assert.deepEqual(code.gate, { actions: ["accept", "back_to_test", "send_back", "stop"], state: "open" });
  assert.match(gateCardHtml(code, pj, { actionsHtml: live(pj) }), /gcard gate/);
  const chat = fallbackChat(pj, "code", { defs, roleDefs });
  assert.equal(chat[0].text, "Pull request #5 on AgentMesh-Dev-Test/handoff-proof.");
  assert.ok(chat.some((m) => m.from.kind === "agent" && m.from.name === "Claude Code" && /Push 3 · 0da3161: Ready for your OK/.test(m.text)));
  assert.ok(chat.some((m) => m.from.kind === "system" && /pushed 1 script/.test(m.text)));
  assert.ok(chat.every((m) => m.version === "0.1.0"));
  // The first stage's chat starts with the request.
  assert.equal(fallbackChat(pj, "requirements", { defs, roleDefs })[0].text, pj.does);
  // The product page from the build list alone.
  const list = (await get(createDemoService(), "/v1/lifecycle/builds")).body.builds;
  const p = productFromBuilds("palindrome-judge", list, pj);
  assert.deepEqual(checkProduct(p, "palindrome-judge"), []);
  assert.equal(p.builds[0].id, "b_palindrome_judge");
  assert.ok(p.activity.length > 0);
});

test("the product page has tabs for its versions, setup, run plan and activity; the Boss tab is disabled for a service without a boss", async () => {
  const d = createDemoService();
  const p = (await get(d, "/v1/lifecycle/products/lunch-poll")).body;
  const ctx = { stageName: (s) => defs.get(s)?.name ?? s, when: () => "t", does: "Runs the poll.", buildHref: (id) => `#/b/${id}` };
  const versions = productPageHtml(p, ctx, "versions");
  assert.match(visible(versions), /^lunch-poll Runs the poll\. When needed Impact Retract Reconfigure Rollback Decommission Why they are off .* Boss Versions 1 Setup 1 Run plan Activity \d+ 1\.0\.0 Installed · conforms started t$/);
  assert.match(versions, /<button type="button" role="tab" class="tab" aria-selected="false" disabled title="This service has no boss">Boss<\/button>/);
  // Without a boss, the page opens at Versions.
  assert.match(productPageHtml(p, ctx), /class="tab on" aria-selected="true" data-ptab="versions"/);
  assert.match(versions, /data-ptab="plan"/);
  assert.match(versions, /<a href="#\/b\/b_lunch_poll">/);
  assert.match(visible(productPageHtml(p, ctx, "plan")), /Monitor watcher every minute from 10:00 to 12:00 · chosen .* From version 1\.0\.0, t\.$/);
  assert.match(visible(productPageHtml(p, ctx, "activity")), /t v1\.0\.0 · Acceptance You accepted it\./);
  // A service without a boss: the Boss tab cannot be opened, so it shows Versions.
  assert.match(productPageHtml(p, ctx, "boss"), /class="tab on" aria-selected="true" data-ptab="versions"/);
  const none = { name: "x", builds: [], activity: [] };
  assert.match(visible(productPageHtml(none, {}, "versions")), /No builds yet\./);
  assert.match(visible(productPageHtml(none, {}, "plan")), /No run plan yet\. Deploy makes it\./);
  assert.match(visible(productPageHtml(none, {}, "activity")), /Nothing yet\./);
  // Another product's line in the menu: the service's words for where its latest build is.
  const products = (await get(d, "/v1/lifecycle/products")).body.products;
  const line = (name) => productLine(products.find((x) => x.name === name), { stageName: (s) => defs.get(s).name });
  assert.deepEqual(line("palindrome-judge"), { text: "Waiting on you at Code", wait: true });
  assert.deepEqual(line("lunch-poll"), { text: "Installed · conforms", wait: false });
  assert.deepEqual(productLine({ latest: { at: { stage: "test", state: "working" } } }, { stageName: (s) => defs.get(s).name }), { text: "Test · working", wait: false });
});

test("the demo's 0.4 answers have the contract's shape", async () => {
  const d = createDemoService();
  assert.deepEqual(checkProducts((await get(d, "/v1/lifecycle/products")).body), []);
  for (const { id } of (await get(d, "/v1/lifecycle/builds")).body.builds) {
    const b = (await get(d, `/v1/lifecycle/builds/${id}`)).body;
    assert.deepEqual(checkBuild(b, IDS), [], id);
    for (const s of usedStages(b.build)) {
      const w = await get(d, `/v1/lifecycle/builds/${id}/stages/${s.stage}`);
      assert.equal(w.status, 200, `${id} ${s.stage}`);
      assert.deepEqual(checkStageWorkspace(w.body, IDS, s.stage, b), [], `${id} ${s.stage}`);
      const m = await get(d, `/v1/lifecycle/products/${productOf(b.build)}/stages/${s.stage}/messages`);
      assert.deepEqual(checkMessages(m.body, s.stage), [], `${id} ${s.stage} messages`);
    }
    assert.deepEqual(checkProduct((await get(d, `/v1/lifecycle/products/${productOf(b.build)}`)).body, productOf(b.build)), [], id);
  }
  // A stage the build does not use, and a product that does not exist.
  assert.equal((await get(d, `${PJ}/stages/impact`)).status, 404);
  assert.equal((await get(d, "/v1/lifecycle/products/nobody")).status, 404);
  assert.equal((await d.handle("PUT", "/v1/lifecycle/products", new URLSearchParams(), {})).status, 405);
});

test("the standard's 0.4 checks, as the console uses them, catch a wrong artifact, workspace, product and message", () => {
  const ok = { id: "a", stage: "code", name: "The programs", by: "Claude Code", state: "made", kind: "programs", summary: { scripts: [{ path: "a.mjs", lines: 3 }] } };
  assert.deepEqual(checkArtifacts([ok], IDS), []);
  assert.ok(checkArtifacts([{ ...ok, state: "done" }], IDS).length);
  assert.ok(checkArtifacts([{ ...ok, kind: "binary" }], IDS).length);
  assert.ok(checkArtifacts([{ ...ok, summary: { scripts: [{ path: "a.mjs" }] } }], IDS).length);
  assert.ok(checkArtifacts([ok, ok], IDS).some((x) => /used twice/.test(x)));
  // The console's own rules on a build's artifacts: only stages it uses, in stage order.
  const tw = tallyWords();
  // Impact is left out of palindrome-judge's lifecycle (not_used); a stage the service does not run (not_offered) may still carry one not run.
  assert.ok(checkBuild({ build: { ...palindromeJudge(), artifacts: [{ ...ok, stage: "impact" }] } }, IDS).some((x) => /lifecycle uses/.test(x)));
  assert.ok(!checkBuild({ build: { ...tw, artifacts: [{ ...ok, id: "d", stage: "docs", state: "not_run", kind: "agentdoc", summary: { words: "Not run here." } }] } }, IDS).some((x) => /lifecycle uses/.test(x)));
  assert.ok(checkBuild({ build: { ...tw, artifacts: [{ ...ok, id: "b" }, { ...ok, stage: "requirements", kind: "other", summary: { words: "w" } }] } }, IDS).some((x) => /stage order/.test(x)));
  const ws = { stage: "code", name: "Code", state: "waiting_on_you", holder: { kind: "your_agent", name: "C", handle: "c@example.com" }, given: [], outputs: [ok], done_when: "words", gate: { actions: ["accept"], state: "open", who_may: "you" } };
  assert.deepEqual(checkStageWorkspace(ws, IDS, "code"), []);
  assert.ok(checkStageWorkspace({ ...ws, outputs: [{ ...ok, stage: "test" }] }, IDS, "code").some((x) => /not at code/.test(x)));
  assert.ok(checkStageWorkspace({ ...ws, gate: { actions: ["accept"], state: "open" } }, IDS, "code").some((x) => /who_may/.test(x)));
  assert.ok(checkStageWorkspace(ws, IDS, "code", { build: { actions: [], artifacts: [] } }).some((x) => /not an action the build offers/.test(x)));
  assert.ok(checkProducts({ products: [{ name: "a", latest: { build: "b", version: "1", state: "waiting", at: { stage: "code", state: "working" } }, versions: ["1"] }] }).length);
  assert.ok(checkProduct({ name: "a", builds: [], activity: [{ at: "x" }] }, "a").length);
  const m = { id: "m", at: "2026-11-08T10:00:00Z", from: { kind: "agent", name: "A", stage: "code" }, text: "hi", build: "b", version: "1" };
  assert.deepEqual(checkMessages({ messages: [m] }, "code"), []);
  assert.ok(checkMessages({ messages: [{ ...m, build: undefined }] }, "code").length);
  assert.ok(checkMessages({ messages: [{ ...m, from: { kind: "gate", name: "G", stage: "code" } }] }, "code").length);
  assert.ok(checkMessages({ messages: [m] }, "test").some((x) => /not the stage asked about/.test(x)));
  assert.ok(checkMessages({ messages: [{ ...m, at: "2026-11-08T11:00:00Z" }, m] }, "code").some((x) => /oldest first/.test(x)));
  const reply = { message: { ...m, from: { kind: "person", name: "you", stage: "code" } }, reply: { ...m, proposes: { action: "accept", needs: {} } } };
  assert.ok(checkMessageReply(reply, { build: { actions: [] } }).some((x) => /not an action the build offers now/.test(x)));
});

test("the proxy passes the 0.4 routes: products read, a stage's chat read and posted to, a stage's workspace read", async () => {
  const svc = await fakeService((req) => ({ status: req.url.includes("nothing") ? 404 : 200, body: req.url.includes("nothing") ? { error: "Nothing here." } : { ok: true } }));
  const keys = createKeyStore({ service: svc.url, env: { ADLC_KEY: "test-key-0123456789abcdef" }, dir: await tempDir("ws") });
  const app = createConsoleServer({ service: svc.url, keys, stages: DOC, version: "test" });
  const url = await app.listen(0);
  const host = new URL(url).host;
  try {
    for (const path of ["/v1/lifecycle/products", "/v1/lifecycle/products/word-counter", "/v1/lifecycle/products/word-counter/stages/code/messages", "/v1/lifecycle/builds/b1/stages/code"]) {
      const r = await hit(url, { path: `/api${path}`, headers: { host } });
      assert.equal(r.status, 200, path);
      assert.equal(svc.seen.at(-1).url, path);
    }
    const p = await hit(url, { method: "POST", path: "/api/v1/lifecycle/products/word-counter/stages/code/messages", headers: { host }, body: { text: "hi", build: "b1" } });
    assert.equal(p.status, 200);
    assert.equal(svc.seen.at(-1).body, JSON.stringify({ text: "hi", build: "b1" }));
    // The products list and a product are only read.
    assert.equal((await hit(url, { method: "POST", path: "/api/v1/lifecycle/products/word-counter", headers: { host }, body: {} })).status, 405);
    assert.equal((await hit(url, { path: "/api/v1/lifecycle/products/a/stages/code/other", headers: { host } })).status, 404);
    // A service without the routes answers 404, and the page takes that as no route.
    const none = await hit(url, { path: "/api/v1/lifecycle/products/nothing/stages/code/messages", headers: { host } });
    assert.equal(none.status, 404);
    assert.equal(messagesOffered(none.status), false);
  } finally { await app.close(); await svc.close(); }
});

test("the page's workspace module is served", async () => {
  const app = createConsoleServer({ demo: createDemoService(), stages: DOC, version: "test" });
  const url = await app.listen(0);
  try {
    const r = await hit(url, { path: "/workspace.js", headers: { host: new URL(url).host } });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /javascript/);
  } finally { await app.close(); }
});
