// The lifecycle with no service: one lifecycle document, a file at a path
// (--lifecycle). The store makes it, changes it, keeps project choices apart,
// adds the organization's own stages, writes atomically and says in words when
// the file is not valid; the local server answers the page's routes from it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createLifecycleFile, idFrom } from "../lib/lifecycle-file.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { checkStages, checkRoles } from "../lib/contract.mjs";
import { lifecyclePageHtml } from "../public/lifecycle.js";
import { hit, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STAGES = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const q = (s = "") => new URLSearchParams(s);
const LEGAL = {
  name: "Legal review", phase: "make", after: "security", role_name: "Legal reviewer",
  given: "The pull request", hands_back: "A signed legal opinion", done_when: "Legal has signed off", person_gate: true,
  holder: { kind: "person", name: "Our legal team" },
};

async function store(name = "lc") {
  const dir = await tempDir(name);
  const path = join(dir, "lifecycle.json");
  return { dir, path, f: createLifecycleFile({ path, stagesDoc: STAGES }), read: async () => JSON.parse(await readFile(path, "utf8")) };
}
const ids = (answer) => answer.stages.map((s) => s.stage);
const one = (answer, id) => answer.stages.find((s) => s.stage === id);

test("a missing file is made, with every stage used and the reference agents holding the roles", async () => {
  const { f, read } = await store();
  const r = await f.handle("GET", "/v1/lifecycle/stages", q(), {});
  assert.equal(r.status, 200);
  assert.deepEqual(ids(r.body), STAGES.stages.map((s) => s.id));
  assert.ok(r.body.stages.every((s) => s.used && s.from === "default" && s.can_leave_out));
  assert.deepEqual(checkStages(r.body, { stages: STAGES.stages, project: null }), []);
  const doc = await read();
  assert.equal(doc.version, "0.1");
  assert.deepEqual(doc.organization, { used: {}, holders: {}, added_stages: [] });
  const roles = (await f.handle("GET", "/v1/lifecycle/roles", q(), {})).body;
  assert.deepEqual(checkRoles(roles, STAGES.roles.map((x) => x.id)), []);
  assert.deepEqual(roles.roles.find((x) => x.role === "code-writer").binding.holder, { kind: "reference_agent", name: "code-writer" });
});

test("a change is saved in the file, and set back with DELETE", async () => {
  const { f, read } = await store();
  const put = await f.handle("PUT", "/v1/lifecycle/stages/impact", q(), { used: false });
  assert.equal(put.status, 200);
  assert.deepEqual([one(put.body, "impact").used, one(put.body, "impact").from], [false, "org"]);
  assert.deepEqual((await read()).organization.used, { impact: false });
  const role = await f.handle("PUT", "/v1/lifecycle/roles/security-reviewer", q(), { holder: { kind: "outside_tool", name: "Our CI scanner", evidence: { formats: ["sarif"] } } });
  assert.equal(role.status, 200);
  assert.equal((await read()).organization.holders["security-reviewer"].name, "Our CI scanner");
  assert.equal((await f.handle("PUT", "/v1/lifecycle/roles/code-writer", q(), { holder: { kind: "your_agent", name: "Mine" } })).status, 400);
  assert.equal((await f.handle("PUT", "/v1/lifecycle/stages/nope", q(), { used: false })).status, 400);
  assert.equal((await f.handle("PUT", "/v1/lifecycle/stages/impact", q(), { used: "no" })).status, 400);
  const del = await f.handle("DELETE", "/v1/lifecycle/stages/impact", q(), {});
  assert.deepEqual([one(del.body, "impact").used, one(del.body, "impact").from], [true, "default"]);
});

test("a holder's settings for its role are kept in the file as they are given", async () => {
  const { f, read } = await store();
  const settings = { every_minutes: 5, alert: { to: "ops" } };
  const r = await f.handle("PUT", "/v1/lifecycle/roles/watcher", q(), { holder: { kind: "your_agent", name: "Our watcher", handle: "watcher.ops@example.com", settings } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.roles.find((x) => x.role === "watcher").binding.holder.settings, settings);
  assert.deepEqual((await read()).organization.holders.watcher.settings, settings);
  assert.deepEqual(checkRoles(r.body, STAGES.roles.map((x) => x.id)), []);
  assert.equal((await f.handle("PUT", "/v1/lifecycle/roles/watcher", q(), { holder: { kind: "person", name: "Ops", settings: [5] } })).status, 400);
  assert.equal((await f.handle("GET", "/v1/lifecycle/roles", q(), {})).status, 200);
});

test("a project's choice overrides the organization's, for that project only", async () => {
  const { f, read } = await store();
  await f.handle("PUT", "/v1/lifecycle/stages/eval", q(), { used: false });
  const p = await f.handle("PUT", "/v1/lifecycle/stages/eval", q("project=finance"), { used: true });
  assert.equal(p.body.project, "finance");
  assert.deepEqual([one(p.body, "eval").used, one(p.body, "eval").from], [true, "project"]);
  assert.deepEqual(checkStages(p.body, { stages: STAGES.stages, project: "finance" }), []);
  assert.equal(one((await f.handle("GET", "/v1/lifecycle/stages", q("project=web"), {})).body, "eval").from, "org");
  assert.equal(one((await f.handle("GET", "/v1/lifecycle/stages", q(), {})).body, "eval").used, false);
  await f.handle("PUT", "/v1/lifecycle/roles/test-writer", q("project=finance"), { holder: { kind: "person", name: "Finance QA" } });
  const roles = (await f.handle("GET", "/v1/lifecycle/roles", q("project=finance"), {})).body;
  assert.equal(roles.roles.find((x) => x.role === "test-writer").from, "project");
  assert.equal((await f.handle("GET", "/v1/lifecycle/roles", q(), {})).body.roles.find((x) => x.role === "test-writer").from, "default");
  const doc = await read();
  assert.deepEqual(doc.projects.finance, { used: { eval: true }, holders: { "test-writer": { kind: "person", name: "Finance QA" } } });
});

test("a stage of the organization's own is added in place, changed, chosen per project and removed", async () => {
  const { f, read } = await store();
  const add = await f.handleAdded("POST", null, q(), LEGAL);
  assert.equal(add.status, 201, add.body.error);
  const list = ids(add.body.stages);
  assert.equal(list.length, 26);
  assert.equal(list[list.indexOf("security") + 1], "legal-review");
  const s = one(add.body.stages, "legal-review");
  assert.deepEqual([s.name, s.phase, s.roles, s.used, s.from], ["Legal review", "make", ["legal-reviewer"], true, "default"]);
  assert.deepEqual(s.added, { scope: "org", after: "security", given: "The pull request", hands_back: "A signed legal opinion", done_when: "Legal has signed off", person_gate: true, role_name: "Legal reviewer" });
  assert.ok(STAGES.stages.every((d) => !one(add.body.stages, d.id).added));
  const role = add.body.roles.roles.find((x) => x.role === "legal-reviewer");
  assert.deepEqual([role.name, role.stages, role.from, role.binding.holder.name, role.added], ["Legal reviewer", ["legal-review"], "org", "Our legal team", true]);
  assert.equal(idFrom("Legal review!"), "legal-review");

  // Same name twice, a new role with nobody to hold it, a missing field: refused in words.
  assert.match((await f.handleAdded("POST", null, q(), LEGAL)).body.error, /already a stage/);
  assert.match((await f.handleAdded("POST", null, q(), { ...LEGAL, name: "Other", role_name: "Brand new", holder: undefined })).body.error, /who holds the new role/);
  assert.match((await f.handleAdded("POST", null, q(), { ...LEGAL, name: "Other", given: "" })).body.error, /what the stage is given/);
  assert.match((await f.handleAdded("POST", null, q(), { ...LEGAL, name: "Other", after: "deploy" })).body.error, /phase/);

  // A second stage on an existing role, first in its phase, and one after the added stage.
  const pre = await f.handleAdded("POST", null, q(), { ...LEGAL, name: "Threat model", phase: "make", after: null, role: "security-reviewer", role_name: undefined, holder: undefined });
  assert.equal(pre.status, 201, pre.body.error);
  assert.equal(ids(pre.body.stages)[ids(pre.body.stages).indexOf("source") + 1], "threat-model");
  assert.ok(pre.body.roles.roles.find((x) => x.role === "security-reviewer").stages.includes("threat-model"));
  const next = await f.handleAdded("POST", null, q(), { ...LEGAL, name: "Export check", after: "legal-review", role: "legal-reviewer", role_name: undefined, holder: undefined });
  assert.equal(next.status, 201, next.body.error);
  assert.deepEqual(ids(next.body.stages).slice(ids(next.body.stages).indexOf("security"), ids(next.body.stages).indexOf("security") + 4), ["security", "legal-review", "export-check", "package"]);

  // Edit: new words and a new place.
  const edit = await f.handleAdded("PUT", "legal-review", q(), { ...LEGAL, name: "Legal sign-off", after: "code", person_gate: false });
  assert.equal(edit.status, 200, edit.body.error);
  const e = one(edit.body.stages, "legal-review");
  assert.deepEqual([e.name, e.added.after, e.added.person_gate], ["Legal sign-off", "code", false]);
  assert.equal(ids(edit.body.stages)[ids(edit.body.stages).indexOf("code") + 1], "legal-review");

  // A project leaves it out, as any stage.
  const off = await f.handle("PUT", "/v1/lifecycle/stages/legal-review", q("project=web"), { used: false });
  assert.deepEqual([one(off.body, "legal-review").used, one(off.body, "legal-review").from], [false, "project"]);
  assert.equal(one((await f.handle("GET", "/v1/lifecycle/stages", q(), {})).body, "legal-review").used, true);
  // A project cannot change the organization's stage.
  assert.match((await f.handleAdded("PUT", "legal-review", q("project=web"), LEGAL)).body.error, /organization's own/);

  // Remove: the stage after it moves up, its choices go, and its role stays while another stage names it.
  const rm = await f.handleAdded("DELETE", "legal-review", q(), {});
  assert.equal(rm.status, 200, rm.body.error);
  assert.ok(!ids(rm.body.stages).includes("legal-review"));
  let doc = await read();
  assert.equal(doc.organization.added_stages.find((x) => x.id === "export-check").after, "code");
  assert.ok(!("legal-review" in doc.projects.web.used));
  assert.ok("legal-reviewer" in doc.organization.holders);
  await f.handleAdded("DELETE", "export-check", q(), {});
  doc = await read();
  assert.ok(!("legal-reviewer" in doc.organization.holders), "a new role no stage names is gone");
  assert.deepEqual(doc.organization.added_stages.map((x) => x.id), ["threat-model"]);
});

test("the file is written whole to a temporary file and then put in place", async () => {
  const { dir, path, f } = await store("atomic");
  await f.handle("PUT", "/v1/lifecycle/stages/impact", q(), { used: false });
  assert.deepEqual(await readdir(dir), ["lifecycle.json"], "no temporary file is left behind");
  const before = await readFile(path, "utf8");
  // A failed rename leaves the file as it was, and the temporary file is cleaned up.
  const seen = [];
  const broken = createLifecycleFile({
    path, stagesDoc: STAGES,
    fsImpl: { readFile, writeFile: async (p, ...rest) => { seen.push(p); return writeFile(p, ...rest); }, rename: async () => { throw Object.assign(new Error("disk"), { code: "EIO" }); }, mkdir: async () => {}, unlink: (await import("node:fs/promises")).unlink },
  });
  const r = await broken.handle("PUT", "/v1/lifecycle/stages/eval", q(), { used: false });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /could not be saved \(EIO\)/);
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0], path, "it writes to another file first");
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual(await readdir(dir), ["lifecycle.json"]);
  // And the real rename puts the new file in place.
  const ok = createLifecycleFile({ path, stagesDoc: STAGES, fsImpl: { readFile, writeFile, rename: async (a, b) => { assert.notEqual(a, path); return rename(a, b); }, mkdir: async () => {}, unlink: async () => {} } });
  assert.equal((await ok.handle("PUT", "/v1/lifecycle/stages/eval", q(), { used: false })).status, 200);
  assert.equal(JSON.parse(await readFile(path, "utf8")).organization.used.eval, false);
});

test("an invalid file is refused with the problem in words, and left as it is", async () => {
  const { path, f } = await store("bad");
  const cases = [
    ["{ not json", /is not valid JSON/],
    [JSON.stringify({ version: "9", organization: {} }), /version must be "0\.1"/],
    [JSON.stringify({ version: "0.1", organization: { used: { impact: "no" } } }), /organization\.used\.impact must be true or false/],
    [JSON.stringify({ version: "0.1", organization: { colour: 1 } }), /organization has "colour", which the format does not have/],
    [JSON.stringify({ version: "0.1", organization: { used: { nope: false } } }), /there is no stage "nope"/],
    [JSON.stringify({ version: "0.1", organization: { holders: { requester: { kind: "your_agent", name: "x", handle: "x" } } } }), /requester is always the person who asked/],
    [JSON.stringify({ version: "0.1", organization: { added_stages: [{ ...LEGAL, id: "legal", role: "legal-reviewer", holder: undefined, after: "deploy" }] } }), /is in the phase "make", but "deploy" is not/],
    [JSON.stringify({ version: "0.1", organization: { added_stages: [{ id: "x", name: "X", phase: "make", after: "y", role: "code-writer", given: "a", hands_back: "b", done_when: "c", person_gate: false }, { id: "y", name: "Y", phase: "make", after: "x", role: "code-writer", given: "a", hands_back: "b", done_when: "c", person_gate: false }] } }), /in a circle/],
    [JSON.stringify({ version: "0.1", organization: { added_stages: [{ id: "x", name: "X", phase: "make", after: null, role: "brand-new", given: "a", hands_back: "b", done_when: "c" }] } }), /missing "person_gate"/],
  ];
  for (const [text, words] of cases) {
    await writeFile(path, text);
    const r = await f.handle("GET", "/v1/lifecycle/stages", q(), {});
    assert.equal(r.status, 409, text);
    assert.match(r.body.error, /^The lifecycle file .*lifecycle\.json is not/, text);
    assert.match(r.body.error, words, text);
    assert.equal((await f.handle("PUT", "/v1/lifecycle/stages/impact", q(), { used: false })).status, 409);
    assert.equal(await readFile(path, "utf8"), text, "an invalid file is never written over");
    assert.match(await f.check(), words);
  }
});

async function server() {
  const { f, path, read } = await store("srv");
  const dir = await tempDir("srv-keys");
  const keys = createKeyStore({ service: "http://unused.example", env: {}, dir });
  const app = createConsoleServer({ service: "http://unused.example", keys, source: f, stages: STAGES, version: "test" });
  const url = await app.listen(0);
  const host = new URL(url).host;
  return { url, host, path, read, h: { host, "x-adlc-console": "1", "content-type": "application/json" }, done: () => app.close() };
}

test("the local server answers the page's routes from the file, and says where it is", async () => {
  const s = await server();
  try {
    const st = await hit(s.url, { path: "/local/status", headers: { host: s.host } });
    assert.deepEqual([st.json.source, st.json.signed_in, st.json.can_try, st.json.read_only, st.json.lifecycle_file], ["file", true, false, false, s.path]);
    const builds = await hit(s.url, { path: "/api/v1/lifecycle/builds?archived=1", headers: { host: s.host } });
    assert.deepEqual([builds.status, builds.json], [200, { builds: [] }]);
    const start = await hit(s.url, { method: "POST", path: "/api/v1/lifecycle/builds", headers: s.h, body: { does: "x" } });
    assert.equal(start.status, 409);
    assert.match(start.json.error, /no builds here/);

    const put = await hit(s.url, { method: "PUT", path: "/api/v1/lifecycle/stages/retract?project=web", headers: s.h, body: { used: false } });
    assert.equal(put.status, 200);
    assert.equal(one(put.json, "retract").from, "project");
    assert.equal((await s.read()).projects.web.used.retract, false);
    const role = await hit(s.url, { method: "PUT", path: "/api/v1/lifecycle/roles/code-writer", headers: s.h, body: { holder: { kind: "your_agent", name: "Our coder", handle: "coder.eng@example.com" } } });
    assert.equal(role.status, 200);
    assert.equal(role.json.roles.find((x) => x.role === "code-writer").from, "org");

    const add = await hit(s.url, { method: "POST", path: "/local/added-stages", headers: s.h, body: LEGAL });
    assert.equal(add.status, 201, add.json?.error);
    assert.ok(add.json.stages.stages.some((x) => x.stage === "legal-review" && x.added));
    const got = await hit(s.url, { path: "/api/v1/lifecycle/stages", headers: { host: s.host } });
    assert.equal(got.json.stages.length, 26);
    const edit = await hit(s.url, { method: "PUT", path: "/local/added-stages/legal-review", headers: s.h, body: { ...LEGAL, name: "Legal sign-off" } });
    assert.equal(one(edit.json.stages, "legal-review").name, "Legal sign-off");
    const off = await hit(s.url, { method: "PUT", path: "/api/v1/lifecycle/stages/legal-review", headers: s.h, body: { used: false } });
    assert.equal(one(off.json, "legal-review").used, false);
    // Only from the page.
    assert.equal((await hit(s.url, { method: "POST", path: "/local/added-stages", headers: { host: s.host, "x-adlc-console": "0", "content-type": "application/json" }, body: LEGAL })).status, 403);
    const rm = await hit(s.url, { method: "DELETE", path: "/local/added-stages/legal-review", headers: s.h });
    assert.equal(rm.status, 200);
    assert.equal(rm.json.stages.stages.length, 25);
  } finally { await s.done(); }
});

test("a service has no route for stages of your own", async () => {
  const { createDemoService } = await import("../lib/demo.mjs");
  const dir = await tempDir("demo-added");
  const keys = createKeyStore({ service: "http://unused.example", env: {}, dir });
  const app = createConsoleServer({ service: "http://unused.example", keys, demo: createDemoService(), stages: STAGES, version: "test" });
  const url = await app.listen(0);
  const host = new URL(url).host;
  try {
    const r = await hit(url, { method: "POST", path: "/local/added-stages", headers: { host, "x-adlc-console": "1", "content-type": "application/json" }, body: LEGAL });
    assert.equal(r.status, 404);
    assert.equal((await hit(url, { path: "/local/status", headers: { host } })).json.lifecycle_file, undefined);
  } finally { await app.close(); }
});

test("the page draws an added stage in place, as the organization's own, and offers Add a stage only with a file", async () => {
  const { f } = await store("page");
  await f.handleAdded("POST", null, q(), LEGAL);
  const stages = (await f.handle("GET", "/v1/lifecycle/stages", q(), {})).body;
  const roles = (await f.handle("GET", "/v1/lifecycle/roles", q(), {})).body;
  const phases = STAGES.phases.map((p) => [p.id, p.name]);
  const html = lifecyclePageHtml(stages, roles, { phases, canAdd: true, local: true });
  assert.equal((html.match(/class="cols row/g) ?? []).length, 26);
  const order = [...html.matchAll(/id="lc-([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(order[order.indexOf("security") + 1], "legal-review");
  assert.match(html, /data-add-stage>Add a stage</);
  assert.match(html, /The organization's own · a person says yes/);
  assert.match(html, /data-edit-added="legal-review"/);
  assert.match(html, /data-remove-added="legal-review"/);
  // On a project's page it is the organization's: no edit there.
  const prj = lifecyclePageHtml({ ...stages, project: "web" }, roles, { phases, canAdd: true, local: true, project: "web" });
  assert.doesNotMatch(prj, /data-edit-added/);
  // A service: no Add a stage.
  assert.doesNotMatch(lifecyclePageHtml(stages, roles, { phases }), /data-add-stage|data-edit-added/);
  // The form, open.
  const form = lifecyclePageHtml(stages, roles, { phases, canAdd: true, local: true, adding: { name: "", place: "", role: "new", role_name: "", kind: "your_agent", holder_name: "", handle: "", given: "", hands_back: "", done_when: "", person_gate: false } });
  for (const n of ["name", "place", "role", "role_name", "kind", "holder_name", "handle", "given", "hands_back", "done_when", "person_gate"]) assert.match(form, new RegExp(`name="${n}"`), n);
  assert.doesNotMatch(form, /—/);
});
