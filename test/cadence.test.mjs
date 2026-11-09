// Each stage's cadence (stages.json 1.3.0, lifecycle API 0.4.2) in the
// console: the spine is the build's every-build stages; the product page has a
// Setup checklist and the when-needed actions as buttons, enabled only where
// the service says it can run one. Against the demo, and against made-up
// answers in the contract's shape.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { checkBuild, checkProduct, checkStageWorkspace } from "../lib/contract.mjs";
import { steps, stepStages, cadenceOf, openingStage, productPageHtml, setupHtml, setupToDo, settingsWords, whenNeededHtml, whenNeededAction } from "../public/workspace.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = (d, path) => d.handle("GET", path, new URLSearchParams(), {});
const post = (d, path, body = {}) => d.handle("POST", path, new URLSearchParams(), body);
const put = (d, path, body = {}) => d.handle("PUT", path, new URLSearchParams(), body);
const roleName = (id) => DOC.roles.find((r) => r.id === id)?.name ?? id;
const one = (list, stage) => list.find((x) => x.stage === stage);

test("the spine holds only the every-build stages a build runs, whatever state the others are in", async () => {
  const d = createDemoService();
  const b = (await get(d, "/v1/lifecycle/builds/b_palindrome_judge")).body.build;
  // The demo's build answers carry each stage's cadence, and Review and Security review read done.
  assert.deepEqual(Object.fromEntries(b.stages.map((s) => [s.stage, s.cadence])), Object.fromEntries(DOC.stages.map((s) => [s.id, s.cadence])));
  assert.deepEqual(["review", "security"].map((id) => one(b.stages, id).state), ["done", "done"]);
  const spine = steps(b, { defs });
  assert.ok(spine.every((x) => defs.get(x.stage).cadence === "every_build"));
  assert.ok(spine.some((x) => x.stage === "review" && x.mark === "done") && spine.some((x) => x.stage === "security" && x.mark === "done"));

  // A build at a run stage (uptime-watch waits at Incident response): Incident is not a step, so it is not drawn as one.
  const up = (await get(d, "/v1/lifecycle/builds/b_uptime_watch")).body.build;
  const us = steps(up, { defs });
  assert.ok(!us.some((x) => ["incident", "monitor", "publish", "update", "rollback"].includes(x.stage)), us.map((x) => x.stage).join(", "));
  assert.ok(us.length > 0 && us.every((x) => x.mark === "done"));

  // A service from before cadences: stages.json's cadence is used, and with neither every stage is a step.
  const old = { ...b, stages: b.stages.map(({ cadence, ...s }) => s) };
  assert.deepEqual(stepStages(old, defs).map((s) => s.stage), spine.map((x) => x.stage));
  assert.equal(stepStages(old).length, old.stages.filter((s) => !["not_used", "not_offered", "not_applicable"].includes(s.state)).length);
  assert.equal(cadenceOf({ stage: "monitor" }, defs), "setup");
  assert.equal(cadenceOf({ stage: "monitor", cadence: "nonsense" }), "every_build");
  assert.equal(openingStage(b, defs), "code");
});

test("the demo's products list their setup stages and when-needed actions, held to the contract", async () => {
  const d = createDemoService();
  for (const { name } of (await get(d, "/v1/lifecycle/products")).body.products) {
    const p = (await get(d, `/v1/lifecycle/products/${name}`)).body;
    assert.deepEqual(checkProduct(p, name), [], name);
    assert.deepEqual(p.setup.map((x) => x.stage), DOC.stages.filter((s) => s.cadence === "setup").map((s) => s.id), name);
    assert.deepEqual(p.when_needed.map((x) => x.stage), DOC.stages.filter((s) => s.cadence === "when_needed").map((s) => s.id), name);
  }
  const p = (await get(d, "/v1/lifecycle/products/palindrome-judge")).body;
  assert.deepEqual((({ form, ...x }) => x)(one(p.setup, "monitor")), { stage: "monitor", name: "Monitor", role: "watcher", project: null, state: "chosen", holder: { kind: "your_agent", name: "Datadog watcher", handle: "datadog-watcher.ops@example.com" }, settings: { every_minutes: 5, alert_after_failures: 3 }, since: "0.1.0", words: "Chosen at 0.1.0" });
  assert.equal(one(p.setup, "monitor").form.fields[0].name, "every_minutes");
  assert.equal(one(p.setup, "eval").state, "not_chosen");
  assert.equal(one(p.setup, "source").state, "not_used");
  assert.deepEqual(p.when_needed.map((x) => x.can_run), [false, false, false, false, false, false]);
  assert.equal(one(p.when_needed, "rollback").why_not, "Nothing of this product is running yet, so there is nothing to roll back.");
  assert.equal(one(p.when_needed, "impact").why_not, "This product's lifecycle leaves Impact out.");
});

test("a new version carries its setup forward: unchanged since the first version, and a new holder holds from the next", async () => {
  const d = createDemoService();
  // The boss's plan proposes starting 0.2.0; confirming it starts the build.
  const proposal = (await get(d, "/v1/lifecycle/products/palindrome-judge/boss/messages")).body.messages.map((m) => m.proposes).find((x) => x?.action === "start_version" && x.state === "open");
  const started = await post(d, "/v1/lifecycle/products/palindrome-judge/boss/messages", { text: "Yes.", confirms: proposal.id });
  assert.equal(started.status, 200);
  const fresh = (await get(d, `/v1/lifecycle/builds/${started.body.reply.started.build}`)).body;
  assert.equal(fresh.build.version, "0.2.0");
  assert.deepEqual(checkBuild(fresh, IDS), []);
  assert.deepEqual(one(fresh.build.stages, "monitor").carried, { since: "0.1.0", build: "b_palindrome_judge", words: "Unchanged since 0.1.0" });
  assert.equal(one(fresh.build.stages, "eval").carried, undefined);
  assert.equal(one(fresh.build.stages, "requirements").carried, undefined);
  const ws = (await get(d, `/v1/lifecycle/builds/${fresh.build.id}/stages/requirements`)).body;
  assert.deepEqual(checkStageWorkspace(ws, IDS, "requirements", fresh), []);
  assert.equal(ws.cadence, "every_build");

  let p = (await get(d, "/v1/lifecycle/products/palindrome-judge")).body;
  assert.deepEqual(checkProduct(p, "palindrome-judge"), []);
  assert.deepEqual([one(p.setup, "monitor").since, one(p.setup, "monitor").words], ["0.1.0", "Unchanged since 0.1.0"]);
  const html = productPageHtml(p, { stageName: (s) => defs.get(s).name, roleName, chooseHref: (role, stage) => `#/lifecycle?edit=${role}&at=${stage}` }, "setup");
  assert.match(visible(html), /Monitor Watcher Datadog watcher every minutes: 5; alert after failures: 3 Unchanged since 0\.1\.0 Change/);

  // Choosing a holder through the roles route: it holds from the next version.
  assert.equal((await put(d, "/v1/lifecycle/roles/agent-critic", { holder: { kind: "person", name: "Our eval team" } })).status, 200);
  p = (await get(d, "/v1/lifecycle/products/palindrome-judge")).body;
  assert.deepEqual(checkProduct(p, "palindrome-judge"), []);
  assert.deepEqual([one(p.setup, "eval").state, one(p.setup, "eval").since, one(p.setup, "eval").words], ["chosen", null, "Chosen: it holds from the next version"]);
  assert.equal(setupToDo(p.setup), 0);
});

test("the Setup tab: a checklist with each holder and since when, Nobody chosen marked to do with a way to choose one", () => {
  const items = [
    { stage: "monitor", name: "Monitor", role: "watcher", project: "web", state: "chosen", holder: { kind: "your_agent", name: "Our watcher", handle: "w.ops@example.com" }, settings: { every_minutes: 5, alert: { after_failures: 3 } }, since: "0.1.0", words: "Unchanged since 0.1.0" },
    { stage: "eval", name: "Eval", role: "agent-critic", project: "web", state: "not_chosen", holder: null, settings: {}, since: null },
    { stage: "update", name: "Update", role: "deployment-manager", project: "web", state: "chosen", holder: { kind: "reference_agent", name: "deployment-manager" }, settings: {}, since: null },
    { stage: "source", name: "Source", role: "catalog", project: "web", state: "not_used", holder: null, settings: {}, since: null },
  ];
  const href = (role, stage, project) => `#/lifecycle?project=${project}&edit=${role}&at=${stage}`;
  const html = setupHtml(items, { roleName, chooseHref: href });
  assert.match(visible(html), /^1 to do: a stage nobody holds\./);
  assert.match(html, /<li class="su todo"><span class="dot" aria-hidden="true">!<\/span>/);
  assert.match(html, /<a class="btn p" href="#\/lifecycle\?project=web&amp;edit=agent-critic&amp;at=eval">Choose a holder<\/a>/);
  assert.match(visible(html), /Eval Agent critic Nobody chosen To do: choose who holds the Agent critic role Choose a holder/);
  assert.match(visible(html), /Monitor Watcher Our watcher every minutes: 5; alert after failures: 3 Unchanged since 0\.1\.0 Change/);
  assert.match(visible(html), /Update Deployment manager Deployment manager, the reference agent No settings Chosen: it holds from the next version Change/);
  assert.match(visible(html), /Source Catalog Not part of this product's lifecycle/);
  assert.doesNotMatch(html, /edit=catalog/);
  assert.doesNotMatch(html, /[{}]/);
  // Read only: no way to change the lifecycle, so no links.
  assert.doesNotMatch(setupHtml(items, { roleName }), /<a /);
  assert.equal(settingsWords({ a_b: [1, 2], c: { d: "e" } }), "a b: 1, 2; c d: e");
  // The tab: its count is what is to do, and a service without the list has it disabled.
  const p = { name: "x", builds: [], activity: [], setup: items };
  assert.match(productPageHtml(p, { roleName }, "versions"), /data-ptab="setup">Setup <span>1<\/span>/);
  assert.match(productPageHtml({ name: "x", builds: [], activity: [] }, {}, "setup"), /disabled title="This service does not say how the product is set up">Setup<\/button>/);
});

test("the when-needed actions: a button enabled only where the service can run it, the rest disabled with its words", async () => {
  const items = [
    { stage: "impact", name: "Impact", can_run: false, why_not: "This service does not run Impact yet." },
    { stage: "rollback", name: "Rollback", can_run: true, action: { build: "b1", name: "rollback", label: "Roll back to 0.1.0" } },
    { stage: "decommission", name: "Decommission", can_run: true },
  ];
  const html = whenNeededHtml(items);
  assert.match(html, /<button class="btn" type="button" disabled title="This service does not run Impact yet\." aria-describedby="wn-impact">Impact<\/button>/);
  assert.match(html, /<button class="btn" type="button" data-when-act="rollback">Roll back to 0\.1\.0<\/button>/);
  // Said it can run but named no action: no fake button.
  assert.match(html, /disabled title="" aria-describedby="wn-decommission">Decommission<\/button>/);
  assert.match(visible(html), /Why some are off Impact This service does not run Impact yet\. Decommission The service does not say\./);
  assert.deepEqual(whenNeededAction(items, "rollback"), { build: "b1", name: "rollback" });
  assert.equal(whenNeededAction(items, "impact"), null);
  assert.equal(whenNeededAction(items, "decommission"), null);
  assert.equal(whenNeededHtml([]), "");
  assert.match(whenNeededHtml(items, { pending: "rollback" }), /data-when-act="rollback" disabled>Sending…/);

  // The demo: tally-words is installed and its build offers Decommission, so that one runs.
  const d = createDemoService();
  let p = (await get(d, "/v1/lifecycle/products/tally-words")).body;
  assert.deepEqual(checkProduct(p, "tally-words"), []);
  const dc = one(p.when_needed, "decommission");
  assert.deepEqual([dc.can_run, dc.action.build, dc.action.name, dc.action.label], [true, "b_tally_words", "decommission", "Decommission"]);
  assert.equal(dc.confirm.title, "Decommission tally-words?");
  assert.equal(one(p.when_needed, "rollback").why_not, "There is no earlier installed version to roll back to.");
  assert.match(productPageHtml(p, {}, "versions"), /data-when-act="decommission">Decommission<\/button>/);
  const a = whenNeededAction(p.when_needed, "decommission");
  const taken = await post(d, `/v1/lifecycle/builds/${a.build}/actions/${a.name}`);
  assert.equal(taken.status, 200);
  assert.deepEqual(checkBuild(taken.body, IDS), []);
  assert.equal(one(taken.body.build.stages, "decommission").state, "done");
  p = (await get(d, "/v1/lifecycle/products/tally-words")).body;
  assert.deepEqual(checkProduct(p, "tally-words"), []);
  assert.deepEqual([one(p.when_needed, "decommission").can_run, one(p.when_needed, "decommission").why_not], [false, "It is decommissioned: nothing of it is running."]);
  assert.doesNotMatch(productPageHtml(p, {}, "versions"), /data-when-act/);
});
