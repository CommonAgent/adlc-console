// The demo's answers have exactly the contract's shape, so the page built
// against the demo works against a real service.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { STAGE_IDS, palindromeJudge } from "../lib/fixture.mjs";
import { checkBuildList, checkBuild, checkTry, checkTries } from "../lib/contract.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const get = (d, path, q = "") => d.handle("GET", path, new URLSearchParams(q), {});
const post = (d, path, body = {}) => d.handle("POST", path, new URLSearchParams(), body);

test("stages.json holds the 24 stages, with the plan's fields", () => {
  assert.equal(DOC.stages.length, 24);
  assert.match(DOC.source, /agenticdevelopment\.ai|CommonAgent\/adlc/);
  const phases = ["define", "make", "ship", "prove", "use", "run", "change"];
  DOC.stages.forEach((s, i) => {
    assert.equal(s.number, i + 1);
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
  assert.equal(r.body.builds.length, 3);
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
  assert.equal(r.body.build.stages[0].state, "working");
  assert.equal((await post(d, "/v1/lifecycle/builds", {})).status, 400);
});

test("the checks notice a build that breaks the contract", () => {
  const b = palindromeJudge();
  b.stages[0].state = "finished";
  b.stages[5].rounds.reverse();
  b.stages[1].handed_back.files.push({ path: "x", size: "1 KB", link: "" });
  delete b.actions[0].needs;
  const problems = checkBuild({ build: b }, IDS);
  assert.ok(problems.some((p) => p.includes("state is one of")));
  assert.ok(problems.some((p) => p.includes("newest first")));
  assert.ok(problems.some((p) => p.includes("size is a count")));
  assert.ok(problems.some((p) => p.includes("needs is a list")));
});
