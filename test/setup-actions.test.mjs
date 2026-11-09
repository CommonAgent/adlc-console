// The guided setup and the when-needed confirm cards (lifecycle API 0.4.4) in
// the console: a card per setup stage with its form, saved as the holder the
// roles route takes; and a confirm card before each when-needed action, with
// what will happen, what can't be undone, who may act and the needs, then the
// result. Against made-up answers in the contract's shape, and the demo.
import test from "node:test";
import assert from "node:assert/strict";
import { createDemoService } from "../lib/demo.mjs";
import { checkProduct } from "../lib/contract.mjs";
import { productPageHtml, setupHtml, guidedSetupHtml, setupDraftOf, setupHolder, fieldValue, whenConfirmHtml, whenResultHtml, runningHtml } from "../public/workspace.js";

const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = (d, path) => d.handle("GET", path, new URLSearchParams(), {});

const MONITOR_FORM = {
  ask: "Who should monitor word-counter?", reference_agent: "watcher",
  fields: [
    { name: "every_minutes", label: "Check every", kind: "number", unit: "minutes", default: 5, min: 1 },
    { name: "alert_after_minutes", label: "Alert after no answer for", kind: "number", unit: "minutes", default: 15, min: 1 },
    { name: "alert_where", label: "Alert where", kind: "text", default: "the console" },
  ],
  shares: "The watcher holds Monitor and Cost: one holder for both, each with its own settings.",
};
const items = () => [
  { stage: "monitor", name: "Monitor", role: "watcher", project: null, state: "chosen", holder: { kind: "reference_agent", name: "watcher" }, settings: { every_minutes: 10 }, since: "0.1.0", words: "Unchanged since 0.1.0", form: MONITOR_FORM },
  { stage: "eval", name: "Eval", role: "agent-critic", project: null, state: "not_chosen", holder: null, settings: {}, since: null, words: "Nobody chosen", form: { ask: "Who should grade word-counter, and against what?", reference_agent: null, fields: [{ name: "how_often", label: "How often", kind: "choice", options: ["each version", "weekly"], default: "each version" }] } },
  { stage: "source", name: "Source", role: "catalog", project: null, state: "not_used", holder: null, settings: {}, since: null, words: "Not part of this product's lifecycle", form: { fields: [] } },
];

test("the guided Setup tab: one card per stage, the first to do open as a small form with defaults and Ask the boss", () => {
  const html = setupHtml(items(), { chooseHref: () => "#" });
  assert.equal(html, guidedSetupHtml(items(), { chooseHref: () => "#" }));
  assert.match(visible(html), /^1 to do: a stage nobody holds\. Set up once for the product, on its first build/);
  // Eval is to do, so its card is open: who holds it (no reference agent for this role) and its setting.
  assert.match(html, /<li class="su todo open">/);
  assert.match(html, /<form class="suform" data-setup="eval">/);
  assert.doesNotMatch(html, /value="reference_agent"[^>]*>The reference agent/);
  assert.match(html, /<select id="su-eval-f-how_often" name="f\.how_often"><option selected>each version<\/option><option>weekly<\/option><\/select>/);
  assert.match(html, /data-setup-ask="eval">Ask the boss<\/button>/);
  assert.match(visible(html), /Not sure\? Ask the boss: “Who should grade word-counter, and against what\?”/);
  // Monitor is chosen and closed, with its holder, settings and since, and a way to change it.
  assert.match(visible(html), /1 of 2 Monitor watcher watcher, the reference agent every minutes: 10 Unchanged since 0\.1\.0 Change/);
  assert.match(html, /data-setup-open="monitor">Change<\/button>/);
  // Source is left out: no card to fill in.
  assert.doesNotMatch(html, /data-setup-open="source"/);
  // Opening Monitor: its settings start from what is saved, then the defaults; and it says the holder is shared.
  const mon = setupHtml(items(), { chooseHref: () => "#", open: "monitor" });
  assert.match(mon, /<option value="reference_agent" selected>The reference agent \(watcher\)<\/option>/);
  assert.match(mon, /name="f\.every_minutes" type="number" min="1" value="10"/);
  assert.match(mon, /name="f\.alert_after_minutes" type="number" min="1" value="15"/);
  assert.match(mon, /<span class="unit">minutes<\/span>/);
  assert.match(visible(mon), /The watcher holds Monitor and Cost: one holder for both/);
  // Your agent asks for a name and a handle; read only, nothing opens.
  const yours = setupHtml(items(), { chooseHref: () => "#", open: "monitor", drafts: { monitor: { kind: "your_agent" } } });
  assert.match(yours, /name="handle"/);
  assert.doesNotMatch(setupHtml(items(), { readOnly: true }), /<form|data-setup-open/);
  // Saving, an error in words, and the boss missing.
  assert.match(setupHtml(items(), { chooseHref: () => "#", saving: "eval" }), /disabled>Saving…<\/button>/);
  assert.match(visible(setupHtml(items(), { chooseHref: () => "#", error: { stage: "eval", words: "Say who the person is." } })), /Say who the person is\./);
  assert.match(setupHtml(items(), { chooseHref: () => "#", bossOffered: false }), /data-setup-ask="eval" disabled title="This service has no boss"/);
  assert.match(visible(setupHtml(items(), { chooseHref: () => "#", open: null, saved: "monitor" })), /Saved\. It holds from the next version\./);
});

test("a setup card saves as the holder the roles route takes: this stage's settings under its id, beside the role's others", () => {
  const [monitor, ev] = items();
  assert.deepEqual(setupDraftOf(monitor), { kind: "reference_agent", name: "watcher", handle: "", values: { every_minutes: 10, alert_after_minutes: 15, alert_where: "the console" } });
  const existing = { kind: "reference_agent", name: "watcher", settings: { cost: { monthly_ceiling: 50 } } };
  assert.deepEqual(setupHolder(monitor, { values: { every_minutes: "3" } }, existing), {
    holder: { kind: "reference_agent", name: "watcher", settings: { cost: { monthly_ceiling: 50 }, monitor: { every_minutes: 3, alert_after_minutes: 15, alert_where: "the console" } } },
  });
  assert.deepEqual(setupHolder(monitor, { kind: "your_agent", name: "Our watcher", handle: "w.ops@example.com" }).holder, { kind: "your_agent", name: "Our watcher", handle: "w.ops@example.com", settings: { monitor: { every_minutes: 10, alert_after_minutes: 15, alert_where: "the console" } } });
  // What is missing is said in words.
  assert.deepEqual(setupHolder(ev, { kind: "person", name: " " }), { error: "Say who the person is." });
  assert.deepEqual(setupHolder(monitor, { kind: "your_agent", name: "W" }), { error: "Give your agent's handle on the mesh." });
  assert.deepEqual(setupHolder(monitor, { values: { every_minutes: "" } }), { error: "Fill in check every." });
  assert.deepEqual(setupHolder(monitor, { values: { every_minutes: "0" } }), { error: "Check every is at least 1." });
  assert.equal(fieldValue({ kind: "number" }, "12"), 12);
  assert.equal(fieldValue({ kind: "text" }, " #ops "), "#ops");
});

const rollback = () => ({
  stage: "rollback", name: "Rollback", can_run: true,
  action: { build: "b2", name: "rollback", label: "Roll back", needs: [{ name: "to_version", label: "Go back to", kind: "choice", options: ["0.1.0"], default: "0.1.0" }, { name: "why", label: "Why", kind: "words" }] },
  confirm: {
    title: "Roll back word-counter to 0.1.0?", will: "The agent back on that version, why, and what can't be undone.", done_when: "It answers on the old version, and the side effects are named.",
    steps: ["Your runtime puts word-counter back on 0.1.0, with 0.1.0's own package and run plan."],
    who_may: "You may roll back word-counter. The lifecycle names Ana Lee (ana@example.com).", you_may: true,
    from_version: "0.2.0", to_version: "0.1.0", cannot_undo: ["What word-counter 0.2.0 did while it ran stays done: messages it sent are not taken back."],
  },
});

test("a when-needed action opens a confirm card: what will happen, what can't be undone, the needs, who may act", () => {
  const html = whenConfirmHtml(rollback());
  assert.match(html, /<form class="gcard wconfirm grave" data-when-form="rollback"/);
  assert.match(visible(html), /^Roll back word-counter to 0\.1\.0\? What will happen The agent back on that version, why, and what can't be undone\. Your runtime puts word-counter back on 0\.1\.0/);
  assert.match(visible(html), /What can't be undone What word-counter 0\.2\.0 did while it ran stays done/);
  assert.match(html, /<select id="wn-rollback-to_version" name="to_version"><option selected>0\.1\.0<\/option><\/select>/);
  assert.match(html, /<textarea id="wn-rollback-why" name="why"/);
  assert.match(visible(html), /Who may act You may roll back word-counter\. The lifecycle names Ana Lee/);
  assert.match(html, /<button class="btn p" type="submit">Confirm: Roll back<\/button>/);
  assert.match(visible(html), /Done when It answers on the old version, and the side effects are named\./);
  // Someone not allowed sees who may, and no confirm to press.
  const no = rollback(); Object.assign(no.confirm, { you_may: false, who_may: "Only Ana Lee (ana@example.com) may roll back word-counter." });
  assert.match(whenConfirmHtml(no), /<button class="btn p" type="button" disabled title="Only Ana Lee \(ana@example\.com\) may roll back word-counter\.">Confirm: Roll back<\/button>/);
  // Running, and a refusal in words.
  assert.match(whenConfirmHtml(rollback(), { pending: "rollback" }), /disabled>Running…<\/button>/);
  assert.match(visible(whenConfirmHtml(rollback(), { error: "Your runtime refused the rollback: read-only today." })), /Your runtime refused the rollback: read-only today\./);
  // Reconfigure says what changes.
  const rc = { stage: "reconfigure", name: "Reconfigure", can_run: true, action: { build: "b2", name: "reconfigure", label: "Reconfigure", needs: [] }, confirm: { title: "Reconfigure word-counter 0.2.0?", will: "The same agent on the same version.", who_may: "Anyone may.", you_may: true, cannot_undo: [], changes: [{ stage: "monitor", name: "Monitor", from: "watcher", to: "Our watcher (every minutes: 1)" }] } };
  assert.match(visible(whenConfirmHtml(rc)), /What changes Monitor watcher → Our watcher \(every minutes: 1\)/);
  // Not a card without one.
  assert.equal(whenConfirmHtml({ stage: "impact", can_run: false, why_not: "No." }), "");
});

test("the product page shows the open confirm card under the buttons, then the result, and which version runs", () => {
  const p = { name: "word-counter", builds: [{ id: "b2", version: "0.2.0", state: "done", at: { stage: "deploy", state: "done" } }], activity: [], when_needed: [rollback()], running: { build: "b2", version: "0.2.0", words: "0.2.0 runs" } };
  assert.match(visible(runningHtml(p)), /^Running 0\.2\.0 runs$/);
  assert.match(visible(runningHtml({ retired: { version: "0.2.0", why: "Replaced." } })), /^Retired at 0\.2\.0\. Replaced\.$/);
  assert.equal(runningHtml({}), "");
  const closed = productPageHtml(p, {}, "versions");
  assert.match(closed, /data-when-act="rollback">Roll back<\/button>/);
  assert.doesNotMatch(closed, /data-when-form/);
  assert.match(productPageHtml(p, { whenCard: { open: "rollback", draft: {} } }, "versions"), /data-when-form="rollback"/);
  const res = productPageHtml(p, { whenCard: { result: { stage: "impact", ok: true, words: "I compared word-counter 0.1.0 with 0.2.0.", report: "# What changing word-counter touches\n" } }, stageName: (id) => ({ impact: "Impact" })[id] ?? id }, "versions");
  assert.match(visible(res), /Impact: done I compared word-counter 0\.1\.0 with 0\.2\.0\. The report # What changing word-counter touches/);
  assert.match(visible(whenResultHtml({ stage: "rollback", ok: true, words: "Back on 0.1.0.", cannot_undo: ["Sent messages stay sent."] })), /What can't be undone Sent messages stay sent\./);
  assert.match(whenResultHtml({ stage: "decommission", ok: false, words: "Refused." }), /class="gcard wresult bad"/);
});

test("the demo gives each setup stage its form and its offered action a confirm card, held to the contract", async () => {
  const d = createDemoService();
  const p = (await get(d, "/v1/lifecycle/products/tally-words")).body;
  assert.deepEqual(checkProduct(p, "tally-words"), []);
  assert.ok(p.setup.every((x) => x.form && Array.isArray(x.form.fields)));
  const html = productPageHtml(p, { chooseHref: () => "#" }, "setup");
  assert.match(html, /<ul class="setup guided">/);
  assert.match(productPageHtml(p, { whenCard: { open: "decommission", draft: {} } }, "versions"), /Confirm: Decommission/);
});
