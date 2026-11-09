// Starting from an as-built record, and Send back to Requirements (stages.json
// 1.5.0, lifecycle API 0.4.7) in the console: New build offers "Start from an
// as-built record" and sends starting_point as-built-record with the record;
// a brought record says so where an adopted one says it was taken on; the
// build's starting point shows on Reverse engineering; and back_to_requirements
// draws through the generic action buttons with its words. Against made-up
// answers in the contract's shape, held to the lifecycle API's own check.
import test from "node:test";
import assert from "node:assert/strict";
import { newBuildHtml, newBuildBody, STARTS } from "../public/start.js";
import { actionButtonsHtml, asBuiltSource, buildSourceHtml, answeredWords, proposalHtml, confirmBody } from "../public/workspace.js";
import { validate, checkBuild, checkArtifacts, stageIds } from "../standards/lifecycle-api-check.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const IDS = stageIds();

test("New build offers Start from an as-built record: a folder of the record, or a repository, commit and path, and what the product is called", () => {
  assert.deepEqual(STARTS.map((s) => s.id), ["idea", "existing-code", "as-built-record"]);
  const idea = newBuildHtml({}, { from: "idea" });
  assert.match(idea, /data-start-from="as-built-record"[^>]*>Start from an as-built record</);
  const form = newBuildHtml({ name: "hn-reader", path: "as-built" }, { from: "as-built-record" });
  assert.match(form, /<form class="form" id="new-form" data-from="as-built-record">/);
  assert.match(form, /aria-selected="true" data-start-from="as-built-record"/);
  assert.match(visible(form), /without taking that code on: a rewrite, a port, or a clean-room rebuild/);
  assert.match(visible(form), /What the product is called .* The record's folder on the service's computer .* Or a repository .* Commit Optional\. .* Path in the repository Optional\./);
  assert.match(form, /id="n-path" value="as-built"/);
  assert.doesNotMatch(form, /id="n-does"/);

  const folder = newBuildBody({ name: " hn-reader ", folder: "/work/records/hn-reader", project: "readers" }, "as-built-record");
  assert.deepEqual(folder.body, { does: "Rebuild hn-reader from its as-built record", name: "hn-reader", starting_point: "as-built-record", source: { folder: "/work/records/hn-reader" }, project: "readers" });
  assert.deepEqual(validate("StartRequest", folder.body), []);
  const repo = newBuildBody({ name: "hn-reader", repository: "acme/records", commit: "9b1c2d4", path: "hn-reader/as-built" }, "as-built-record");
  assert.deepEqual(repo.body.source, { repository: "acme/records", commit: "9b1c2d4", path: "hn-reader/as-built" });
  assert.deepEqual(validate("StartRequest", repo.body), []);
  assert.deepEqual(newBuildBody({ folder: "/r" }, "as-built-record"), { error: "Say what the product is called." });
  assert.deepEqual(newBuildBody({ name: "w" }, "as-built-record"), { error: "Name the record's folder on the service's computer, or a repository that holds it." });
  assert.deepEqual(newBuildBody({ name: "w", repository: "x", folder: "y" }, "as-built-record"), { error: "Name a folder or a repository, not both." });
  assert.deepEqual(newBuildBody({ name: "w", folder: "/r", path: "as-built" }, "as-built-record"), { error: "A commit and a path go with a repository, not a folder." });
});

test("a brought record says where it came from, and the build's starting point shows on Reverse engineering", () => {
  const summary = {
    source: { repository: "file:///work/orig", commit: "bfecc9cea70c5df651db5cf2530416832c6fc68d", ran: false },
    trigger: "adoption",
    brought: { from: "/work/records/hn-reader", words: "Brought from /work/records/hn-reader. The code it describes is not taken on; Code writes the code fresh." },
    parts: ["behaviors", "architecture", "interfaces", "dependencies", "tests_and_gaps"].map((part) => ({ part, name: part, count: 0, words: "None.", items: [] })),
  };
  assert.deepEqual(checkArtifacts([{ id: "as_built", stage: "reverse-engineering", name: "As-built record", by: "the as-built record you brought", state: "made", kind: "as_built", summary }], IDS), []);
  assert.equal(asBuiltSource(summary), "file:///work/orig at bfecc9c, read only, not run. Brought from /work/records/hn-reader. The code it describes is not taken on; Code writes the code fresh.");
  assert.match(asBuiltSource({ ...summary, brought: { from: "/r" } }), /Brought from \/r; the code it describes is not taken on\.$/);
  const src = { starting_point: "as-built-record", repository: "file:///work/orig", commit: "bfecc9c", record: { folder: "/work/records/hn-reader" }, words: "Rebuilt from the as-built record of file:///work/orig at bfecc9c, read from /work/records/hn-reader. The code is not taken on." };
  assert.equal(visible(buildSourceHtml(src)), "Started from an as-built record: Rebuilt from the as-built record of file:///work/orig at bfecc9c, read from /work/records/hn-reader. The code is not taken on.");
  assert.match(visible(buildSourceHtml({ starting_point: "existing-code", words: "Taken on from acme/w at 3f2a9c1." })), /^Started from existing code: Taken on/);
  assert.equal(buildSourceHtml(null), "");
});

test("back_to_requirements draws through the generic action buttons, with a paragraph box for its words", () => {
  const words = { name: "changes", label: "What should change in the spec, for the spec writer", kind: "words" };
  const actions = [
    { stage: "code", name: "back_to_test", label: "Send back to Test", needs: [{ name: "changes", label: "What is wrong with the suite", kind: "words" }] },
    { stage: "code", name: "back_to_requirements", label: "Send back to Requirements", needs: [words] },
    { stage: "code", name: "stop", label: "Stop", needs: [] },
  ];
  const b = { id: "b1", name: "hn-reader", stages: [], actions };
  const plain = actionButtonsHtml(actions);
  assert.match(plain, /<button class="btn p" type="button" data-act="back_to_test" data-act-stage="code">Send back to Test<\/button><button class="btn" type="button" data-act="back_to_requirements" data-act-stage="code">Send back to Requirements<\/button>/);
  assert.doesNotMatch(plain, /<form/);
  const asked = actionButtonsHtml(actions, { asking: "code\nback_to_requirements" });
  assert.match(asked, /<form class="ask" data-ask="back_to_requirements" data-ask-stage="code"><label for="need-changes">What should change in the spec, for the spec writer<\/label><textarea id="need-changes" name="changes" required><\/textarea>/);
  assert.match(asked, /<button class="btn p" type="submit">Send back to Requirements<\/button>/);
  assert.match(actionButtonsHtml(actions, { pending: "back_to_requirements" }), /disabled>Sending…<\/button>/);
  // An answered gate names it, and a chat reply that proposes it confirms with its words.
  assert.match(answeredWords({ action: "back_to_requirements", by: "You" }, b), /^Sent back to Requirements by You/);
  const reply = { id: "m9", text: "I would declare the address setting.", proposes: { action: "back_to_requirements", needs: { changes: "Declare HN_API_BASE as a setting." } } };
  assert.match(visible(proposalHtml(reply, b)), /What should change in the spec, for the spec writer Declare HN_API_BASE as a setting\. Confirm: Send back to Requirements/);
  assert.deepEqual(confirmBody(b, reply.proposes), { stage: "code", name: "back_to_requirements", needs: { changes: "Declare HN_API_BASE as a setting." } });
});

test("the proxy passes a start from an as-built record and back_to_requirements through as they were sent", async () => {
  const svc = await fakeService((req) => ({ body: { echo: req.url } }));
  const keys = createKeyStore({ service: svc.url, env: { ADLC_KEY: "test-key-0123456789abcdef" }, dir: await tempDir("asbuilt") });
  const app = createConsoleServer({ service: svc.url, keys, version: "test" });
  const url = await app.listen(0);
  try {
    const h = { host: new URL(url).host, "content-type": "application/json", "x-adlc-console": "1" };
    const start = { does: "Rebuild hn-reader from its as-built record", name: "hn-reader", starting_point: "as-built-record", source: { folder: "/work/records/hn-reader" } };
    await hit(url, { path: "/api/v1/lifecycle/builds", method: "POST", body: JSON.stringify(start), headers: h });
    assert.deepEqual(JSON.parse(svc.seen.at(-1).body), start);
    const back = { changes: "Declare HN_API_BASE as a setting." };
    const r = await hit(url, { path: "/api/v1/lifecycle/builds/b1/actions/back_to_requirements", method: "POST", body: JSON.stringify(back), headers: h });
    assert.equal(r.status, 200);
    assert.deepEqual({ url: svc.seen.at(-1).url, body: JSON.parse(svc.seen.at(-1).body) }, { url: "/v1/lifecycle/builds/b1/actions/back_to_requirements", body: back });
  } finally { await app.close(); await svc.close(); }
});

test("a build answer with back_to_requirements at Code passes the lifecycle API's check", () => {
  const blank = (stage) => ({ stage, state: "not_offered", holder: null, runs: 0, rounds: [], given: "", handed_back: { words: [], files: [] }, done_when_met: null, log: [], where: null });
  const stages = IDS.map(blank);
  Object.assign(stages.find((s) => s.stage === "code"), { state: "working", holder: { kind: "your_agent", name: "your coding harness, on a pull request" }, runs: 1 });
  const build = { id: "b1", name: "hn-reader", does: "Reads the top stories.", version: "0.1.0", handle: "hn-reader.example", stages, actions: [{ stage: "code", name: "back_to_requirements", label: "Send back to Requirements", needs: [{ name: "changes", label: "What should change in the spec", kind: "words" }] }], log: [], can_try: { pull_request: false, installed: false } };
  assert.deepEqual(checkBuild({ build }, IDS, "b1"), []);
});
