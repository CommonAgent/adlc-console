// The Board, drawn from the build list alone: builds placed into the column
// of their phase, the Waiting on me filter, and the Done column. Read from the
// demo's list answer and from a list shaped like Product Factory's, with no
// browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { checkBuildList } from "../lib/contract.mjs";
import { boardColumns, boardHtml, cardWords, isDone, waitsOnMe } from "../public/board.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const STAGES = DOC.stages;
const PHASES = DOC.phases.map((p) => [p.id, p.name]);
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function demoList() {
  const r = await createDemoService().handle("GET", "/v1/lifecycle/builds", new URLSearchParams("archived=1"), {});
  return r.body.builds;
}
const ids = (col) => col.builds.map((b) => b.id);
const byId = (cols) => Object.fromEntries(cols.map((c) => [c.id, c]));

test("one column per phase in order, then Done", async () => {
  const cols = boardColumns(await demoList(), STAGES, PHASES);
  assert.deepEqual(cols.map((c) => c.name), ["Define", "Make", "Ship", "Prove", "Use", "Run", "Change", "Done"]);
});

test("each build goes in the column of the phase its current stage belongs to", async () => {
  const list = await demoList();
  assert.deepEqual(checkBuildList({ builds: list }), []);
  const c = byId(boardColumns(list, STAGES, PHASES));
  assert.deepEqual(ids(c.define), ["b_invoice_reader", "b_meeting_notes"]);
  assert.deepEqual(ids(c.make), ["b_palindrome_judge", "b_release_notes"]);
  assert.deepEqual(ids(c.ship), ["b_ticket_triage", "b_expense_check"]);
  assert.deepEqual(ids(c.prove), ["b_tally_words", "b_contract_check"]);
  assert.deepEqual(ids(c.use), ["b_faq_answerer"]);
  assert.deepEqual(ids(c.run), ["b_uptime_watch"]);
  assert.deepEqual(ids(c.change), ["b_currency_convert"]);
  // The demo fills every phase, in more than one state.
  const states = new Set(list.filter((b) => !isDone(b)).map((b) => b.at.state));
  for (const s of ["waiting_on_you", "working", "refused", "not_started"]) assert.ok(states.has(s), s);
});

test("finished, stopped and archived builds go in Done, with their end state", async () => {
  const list = await demoList();
  const c = byId(boardColumns(list, STAGES, PHASES));
  assert.deepEqual(ids(c.done), ["b_word_tally", "b_lunch_poll", "b_greeter"]);
  const words = (id) => cardWords(list.find((b) => b.id === id), STAGES);
  assert.equal(words("b_word_tally").state, "Stopped at Code");
  assert.equal(words("b_lunch_poll").state, "Installed · conforms");
  assert.equal(words("b_greeter").archived, true);
  // With no summary, the end state is said from the stage and state.
  const bare = (state, archived = false) => cardWords({ id: "x", name: "x", at: { stage: "package", state }, archived }, STAGES).state;
  assert.equal(bare("done"), "Finished at Package");
  assert.equal(bare("stopped"), "Stopped at Package");
  assert.equal(bare("working", true), "Archived at Package");
  assert.ok(isDone({ at: { state: "working" }, archived: true }));
  assert.ok(!isDone({ at: { state: "refused" } }));
  const html = boardHtml(list, STAGES, PHASES);
  const done = html.slice(html.indexOf('aria-label="Done"'));
  assert.match(visible(done), /word-tally 0\.1\.0 Stopped at Code/);
  assert.match(visible(done), /greeter 0\.1\.0 Stopped at Test Archived/);
});

test("a card shows the name and version, the stage, the state in words, and who it waits on", async () => {
  const list = await demoList();
  const html = boardHtml(list, STAGES, PHASES);
  const card = (id) => {
    const m = new RegExp(`<a class="bc[^"]*" href="#/b/${id}"[^>]*>(.*?)</a>`).exec(html);
    assert.ok(m, id);
    return visible(m[1]).trim();
  };
  assert.equal(card("b_palindrome_judge"), "palindrome-judge 0.1.0 06 · Code Waiting on you at Code");
  assert.equal(card("b_meeting_notes"), "meeting-notes 0.1.0 02 · Architecture and Design Working");
  assert.equal(card("b_release_notes"), "release-notes 0.3.0 08 · Security review Refused");
  // The service's own words are added when they say more than the state.
  assert.equal(card("b_tally_words"), "tally-words 0.2.0 12 · Conformance Not started Installed · not checked for conformance yet");
  // Each card opens that build's page.
  assert.match(html, /href="#\/b\/b_uptime_watch"/);
  assert.match(html, /<a class="bc wait" href="#\/b\/b_invoice_reader"/);
});

test("Waiting on me shows only the builds waiting on you", async () => {
  const list = await demoList();
  const cols = boardColumns(list, STAGES, PHASES, { mine: true });
  const shown = cols.flatMap(ids).sort();
  assert.deepEqual(shown, ["b_contract_check", "b_invoice_reader", "b_palindrome_judge", "b_uptime_watch"]);
  for (const id of shown) assert.ok(waitsOnMe(list.find((b) => b.id === id)));
  assert.equal(byId(cols).done.builds.length, 0);
  // The columns stay, empty.
  assert.equal(cols.length, 8);
  const html = boardHtml(list, STAGES, PHASES, { mine: true });
  assert.match(html, /aria-pressed="true">Waiting on me \(4\)/);
  assert.doesNotMatch(html, /b_meeting_notes/);
  assert.match(visible(boardHtml(list.filter((b) => !waitsOnMe(b)), STAGES, PHASES, { mine: true })), /Nothing is waiting on you\./);
});

test("a list shaped like Product Factory's: done and stopped builds end, refused stays in its phase", () => {
  const item = (id, stage, state, summary, archived = false) => ({ id, name: id, does: "x", version: "0.1.0", kind: "agent", at: { stage, state, summary }, archived, updated: "2026-11-07T18:00:00Z" });
  const list = [
    item("a", "requirements", "waiting_on_you", "Waiting on you at Requirements"),
    item("b", "code", "refused", "Refused at Code: waiting on you"),
    item("c", "test", "working", "Working at Test"),
    item("d", "package", "done", "Packed and validated · d 0.1.0"),
    item("e", "code", "stopped", "Stopped at Code", true),
  ];
  assert.deepEqual(checkBuildList({ builds: list }), []);
  const c = byId(boardColumns(list, STAGES, PHASES));
  assert.deepEqual(ids(c.define), ["a"]);
  assert.deepEqual(ids(c.make), ["c", "b"]);
  assert.deepEqual(ids(c.done), ["d", "e"]);
  assert.equal(cardWords(list[1], STAGES).note, "Refused at Code: waiting on you");
  assert.equal(cardWords(list[3], STAGES).state, "Packed and validated · d 0.1.0");
  // A stage stages.json does not name gets a column of its own, only when a build is at one.
  const odd = boardColumns([item("f", "triage", "working")], STAGES, PHASES);
  assert.deepEqual(odd.map((x) => x.id).slice(-2), ["other", "done"]);
  assert.deepEqual(ids(odd.find((x) => x.id === "other")), ["f"]);
  assert.equal(boardColumns(list, STAGES, PHASES).some((x) => x.id === "other"), false);
});

test("names from the service are shown as text", () => {
  const html = boardHtml([{ id: "x\"y", name: "<b>bold</b>", version: "1", at: { stage: "code", state: "working" }, updated: "2026-11-07T18:00:00Z" }], STAGES, PHASES);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.match(html, /href="#\/b\/x%22y"/);
});
