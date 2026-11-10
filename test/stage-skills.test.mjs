// The holder's skills (lifecycle API 0.4.9) and the full text in the
// Artifacts reader. A stage page's Skills tab lists each skill of the agent
// holding the stage, by name with its one-line description, and opens the
// chosen one's SKILL.md in full; a holder whose skills the service cannot see
// shows the service's one sentence, and one with none of its own shows no tab.
// The reader puts an artifact's files under a Full text heading, with an
// artifact's only file open, and a suite's summary names every test it has.
// Against the demo service and made-up answers held to the lifecycle API's
// own check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { artifactBodyHtml, artifactsTabHtml, stageWorkspace, hasSkills, skillsOf, skillsTabHtml } from "../public/workspace.js";
import { checkStageWorkspace } from "../standards/lifecycle-api-check.mjs";
import { createDemoService } from "../lib/demo.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const get = (d, path) => d.handle("GET", path, new URLSearchParams(), {});
const PJ = "/v1/lifecycle/builds/b_palindrome_judge";

const skill = (name, description, body = "Do the thing.") => ({ name, description, text: `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n` });

test("the demo's stage workspaces carry their holders' skills, and meet the lifecycle API's check", async () => {
  const d = createDemoService();
  const b = (await get(d, PJ)).body;
  const at = async (stage) => {
    const ws = (await get(d, `${PJ}/stages/${stage}`)).body;
    assert.deepEqual(checkStageWorkspace(ws, IDS, stage, b), [], stage);
    return ws.holder;
  };
  // A reference agent lists its skills, each with its SKILL.md.
  const spec = await at("requirements");
  assert.deepEqual(spec.skills.map((x) => x.name), ["read-what-was-asked", "draft-the-spec", "ask-what-is-missing"]);
  assert.match(spec.skills[1].text, /^---\nname: draft-the-spec\ndescription: once the request is recorded/);
  // The person's coding agent keeps its own: one sentence says so.
  const code = await at("code");
  assert.equal(code.kind, "your_agent");
  assert.equal(code.skills, undefined);
  assert.equal(code.skills_note, "Its skills are whatever Claude Code has installed; this service cannot see them.");
  // The package maker has no skills of its own.
  assert.deepEqual((await at("package")).skills, []);
  // The build's stages leave them out, where every stage would repeat them.
  assert.ok(b.build.stages.every((s) => !s.holder?.skills && !s.holder?.skills_note));
});

test("the Skills tab: each skill by name with its description, and the chosen one's SKILL.md in full", async () => {
  const d = createDemoService();
  const b = (await get(d, PJ)).body.build;
  const ws = stageWorkspace(b, "test", (await get(d, `${PJ}/stages/test`)).body, { defs });
  assert.ok(hasSkills(ws.holder));
  assert.equal(skillsOf(ws.holder).length, 3);
  const html = skillsTabHtml(ws.holder);
  const v = visible(html);
  // With nothing chosen, the first is open; every skill is listed with its one line.
  assert.match(v, /^read-the-spec SKILL\.md as written --- name: read-the-spec/);
  assert.match(v, /3 skills read-the-spec the first step, before anything is written write-the-suite once the declaration is recorded, to write the tests check-the-suite once a suite exists/);
  assert.match(html, /<button class="arow sel" type="button" data-skill="read-the-spec" aria-pressed="true">/);
  assert.match(html, /<pre class="skilltext">/);
  // Choosing one opens its text, in full, and marks it.
  const chosen = skillsTabHtml(ws.holder, "check-the-suite");
  assert.match(chosen, /data-skill="check-the-suite" aria-pressed="true"/);
  assert.ok(visible(chosen).includes(visible(skillsOf(ws.holder)[2].text.replace(/</g, "&lt;"))));
  // A name the holder does not have opens the first.
  assert.match(skillsTabHtml(ws.holder, "nope"), /data-skill="read-the-spec" aria-pressed="true"/);
});

test("a holder whose skills cannot be seen says so in one sentence; one with none, a person, or a service before 0.4.9 has no Skills tab", () => {
  const note = { kind: "your_agent", name: "Claude Code", skills_note: "Its skills are whatever your coding harness has installed; Product Factory cannot see them." };
  assert.ok(hasSkills(note));
  assert.equal(visible(skillsTabHtml(note)), "Its skills are whatever your coding harness has installed; Product Factory cannot see them.");
  assert.equal(hasSkills({ kind: "reference_agent", name: "package-maker", skills: [] }), false);
  assert.equal(hasSkills({ kind: "person", name: "you" }), false);
  assert.equal(hasSkills({ kind: "reference_agent", name: "spec-writer" }), false);
  assert.equal(hasSkills(null), false);
  // A skill with no SKILL.md text or no name is not listed; its description may be absent.
  const h = { kind: "reference_agent", name: "x", skills: [{ name: "a" }, { name: "", text: "t" }, { name: "b", text: "B" }] };
  assert.deepEqual(skillsOf(h).map((x) => x.name), ["b"]);
  assert.equal(visible(skillsTabHtml(h)), "b SKILL.md as written B 1 skill b");
  // HTML in a skill is shown as text.
  assert.doesNotMatch(skillsTabHtml({ skills: [skill("<b>x</b>", "<i>y</i>", "<script>z</script>")] }), /<script>|<b>x|<i>y/);
});

test("the reader puts an artifact's files under Full text, with its only file open, and a suite names every test", async () => {
  const d = createDemoService();
  const b = (await get(d, PJ)).body.build;
  const ws = stageWorkspace(b, "code", (await get(d, `${PJ}/stages/code`)).body, { defs });
  const seen = [];
  const files = (f, openOne = false) => { seen.push([f.length, openOne]); return `<files n=${f.length}${openOne ? " open" : ""}>`; };
  const html = artifactsTabHtml(ws, "pj-suite", { stageName: (s) => defs.get(s).name, filesHtml: files });
  assert.match(html, /<section class="vfiles" aria-label="Full text"><h4 class="ft">Full text <span>2 files, as written<\/span><\/h4><files n=2 open><\/section>/);
  assert.deepEqual(seen, [[2, true]]);
  // The suite: all 14 tests, none left behind an "and more".
  const v = visible(html);
  assert.match(v, /14 tests\. a palindrome with spaces and capitals is a yes .* it answers in under a second Full text/);
  assert.doesNotMatch(v, /and \d+ more/);
  // A summary that names more than eight tests lists each one.
  const twelve = Array.from({ length: 12 }, (_, i) => `test ${i + 1}`);
  assert.equal(visible(artifactBodyHtml({ kind: "suite", summary: { count: 12, tests: twelve } })), `12 tests. ${twelve.join(" ")}`);
  // A count beyond the names the service gives still says how many it did not name.
  assert.equal(visible(artifactBodyHtml({ kind: "suite", summary: { count: 3, tests: ["t1"] } })), "3 tests. t1 and 2 more");
  // One file reads as one file.
  const one = { ...ws, outputs: [{ ...ws.outputs[0], files: [ws.outputs[0].files?.[0] ?? { path: "a.mjs", size: 3 }] }] };
  assert.match(artifactsTabHtml(one, one.outputs[0].id, { filesHtml: files }), /Full text <span>1 file, as written<\/span>/);
  // An artifact with no files has no Full text heading.
  assert.doesNotMatch(artifactsTabHtml({ ...ws, outputs: [{ ...ws.outputs[0], files: [] }] }, ws.outputs[0].id, { filesHtml: files }), /Full text/);
});
