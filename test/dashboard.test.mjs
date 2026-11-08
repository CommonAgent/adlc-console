// The Dashboard's three readings, from build records alone: the median time
// per stage (build.timeline), send-backs per stage (rounds with back: true),
// and what is waiting now (the build list). Read from hand-made builds, where
// every number is known, and from the demo, with no browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { checkBuild, checkBuildList } from "../lib/contract.mjs";
import { median, span, stageTimes, sendBacks, waitingNow, dashboardHtml } from "../public/dashboard.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const STAGES = DOC.stages;
const MIN = 60_000;
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function demo() {
  const svc = createDemoService();
  const list = (await svc.handle("GET", "/v1/lifecycle/builds", new URLSearchParams("archived=1"), {})).body.builds;
  const full = [];
  for (const b of list) full.push((await svc.handle("GET", `/v1/lifecycle/builds/${b.id}`, new URLSearchParams(), {})).body);
  return { list, full };
}

// A timeline bar: minutes from an hour's start; end null while it is open.
const bar = (stage, kind, a, b, round = 1) => ({
  phase: `${stage}-step`, stage, round, holder: kind === "person" ? null : `${stage}.example`, kind,
  start: new Date(Date.UTC(2026, 10, 1, 12, a)).toISOString(), end: b === null ? null : new Date(Date.UTC(2026, 10, 1, 12, b)).toISOString(),
  duration_ms: b === null ? null : (b - a) * MIN, status: b === null ? "working" : "closed",
});
const round = (n, back) => ({ n, at: "2026-11-01T12:00:00Z", label: `Round ${n}`, verdict: back ? "Sent back" : "Passed", back, words: "" });
const stage = (id, rounds = []) => ({ stage: id, rounds });

test("median: the middle value, the mean of the two middle ones, or none", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 10]), 3.5);
  assert.equal(median([7]), 7);
  assert.equal(median([]), null);
  assert.equal(median([2, null, NaN, 4]), 3);
  assert.equal(span(4 * MIN), "4 min");
  assert.equal(span(125 * MIN), "2 h 5 min");
  assert.equal(span(35_000), "35 s");
});

test("time per stage: every closed bar of a stage adds up, and the median is across builds", () => {
  const builds = [
    // Requirements twice round (6 + 4) and a person's sign-off (20): 30 min. Code still open: not counted.
    { id: "a", timeline: [bar("requirements", "agent", 0, 6), bar("requirements", "agent", 7, 11, 2), bar("requirements", "person", 11, 31), bar("code", "agent", 31, null)] },
    { id: "b", timeline: [bar("requirements", "agent", 0, 10), bar("code", "agent", 10, 40)] },
    { id: "c", timeline: [bar("requirements", "agent", 0, 50), bar("code", "agent", 50, 60), bar("code", "person", 60, 70)] },
    // A bar with no stage is not counted, and a build with no staged bar is untimed.
    { id: "d", timeline: [{ ...bar("test", "agent", 0, 5), stage: undefined }] },
    { id: "e" },
  ];
  const t = stageTimes(builds, STAGES);
  assert.equal(t.timed, 3);
  assert.equal(t.untimed, 2);
  assert.deepEqual(t.rows.map((r) => [r.stage, r.builds, r.median_ms / MIN]), [
    ["requirements", 3, 30],
    ["code", 2, 25],
  ]);
  assert.equal(t.rows[0].name, "Requirements");
  // A stage stages.json does not name comes after, by its id.
  const odd = stageTimes([{ timeline: [bar("triage", "agent", 0, 3), bar("test", "agent", 3, 5)] }], STAGES);
  assert.deepEqual(odd.rows.map((r) => [r.stage, r.name]), [["test", "Test"], ["triage", "triage"]]);
  assert.deepEqual(stageTimes([], STAGES), { rows: [], timed: 0, untimed: 0 });
});

test("send-backs per stage: rounds with back: true, out of every round", () => {
  const builds = [
    { stages: [stage("requirements", [round(2, false), round(1, true)]), stage("code", [round(3, false), round(2, true), round(1, true)]), stage("test")] },
    { stages: [stage("requirements", [round(1, false)]), stage("code", [round(1, false)])] },
    { stages: [stage("security", [round(1, true)])] },
  ];
  assert.deepEqual(sendBacks(builds, STAGES), [
    { stage: "requirements", name: "Requirements", rounds: 3, back: 1, builds: 2 },
    { stage: "code", name: "Code", rounds: 4, back: 2, builds: 2 },
    { stage: "security", name: "Security review", rounds: 1, back: 1, builds: 1 },
  ]);
  assert.deepEqual(sendBacks([{}, { stages: null }], STAGES), []);
});

test("waiting now: on a person (waiting or refused) or an agent working; ended builds left out", () => {
  const item = (name, st, state, archived = false) => ({ id: name, name, at: { stage: st, state }, archived, updated: "2026-11-07T18:00:00Z" });
  const list = [
    item("a", "code", "waiting_on_you"), item("b", "code", "refused"), item("c", "code", "working"),
    item("d", "requirements", "working"), item("e", "package", "done"), item("f", "test", "working", true),
    item("g", "test", "stopped"), item("h", "review", "not_started"),
  ];
  const w = waitingNow(list, STAGES);
  assert.equal(w.person, 2);
  assert.equal(w.agent, 2);
  assert.deepEqual(w.rows, [
    { stage: "requirements", name: "Requirements", person: [], agent: ["d"] },
    { stage: "code", name: "Code", person: ["a", "b"], agent: ["c"] },
  ]);
});

test("the demo's builds carry rounds and timelines that read as the contract says", async () => {
  const { list, full } = await demo();
  assert.deepEqual(checkBuildList({ builds: list }), []);
  const ids = STAGES.map((s) => s.id);
  for (const body of full) assert.deepEqual(checkBuild(body, ids), [], body.build.id);
  const builds = full.map((x) => x.build);
  for (const b of builds.filter((x) => x.timeline)) {
    const starts = b.timeline.map((x) => Date.parse(x.start));
    assert.deepEqual(starts, [...starts].sort((x, y) => x - y), `${b.id}: bars ordered by start`);
    for (const x of b.timeline) assert.ok(ids.includes(x.stage), `${b.id}: ${x.stage}`);
  }

  const t = stageTimes(builds, STAGES);
  assert.ok(t.timed >= 10 && t.untimed > 0);
  for (const r of t.rows) assert.ok(r.median_ms > 0 && r.builds > 0, r.stage);
  // A stage a person signs off takes longer than one an agent does alone.
  const at = (id) => t.rows.find((r) => r.stage === id).median_ms;
  assert.ok(at("code") > at("package"));
  assert.ok(at("acceptance") > at("release"));

  const backs = sendBacks(builds, STAGES);
  const code = backs.find((r) => r.stage === "code");
  assert.ok(code.back >= 2 && code.back < code.rounds);
  assert.equal(backs.find((r) => r.stage === "package").back, 0);

  const w = waitingNow(list, STAGES);
  assert.deepEqual(w.rows.flatMap((r) => r.person).sort(), ["contract-check", "invoice-reader", "palindrome-judge", "release-notes", "uptime-watch"]);
  assert.deepEqual(w.rows.flatMap((r) => r.agent).sort(), ["currency-convert", "faq-answerer", "meeting-notes", "ticket-triage"]);
});

test("the page: three tables with bars, the untimed builds said, names as text", async () => {
  const { list, full } = await demo();
  const html = dashboardHtml(list, full.map((x) => x.build), STAGES);
  const text = visible(html);
  assert.match(text, /Dashboard/);
  for (const h of ["How long each stage takes", "How often work is sent back", "What is waiting now"]) assert.match(text, new RegExp(h));
  assert.match(text, /5 on a person · 4 with an agent working/);
  assert.match(text, /3 builds carry no timeline with stages and are not counted/);
  assert.match(html, /<span class="hb" aria-hidden="true"><i data-w="\d/);
  assert.match(html, /<span class="hb back"/);
  // While the builds are read, the waiting table is drawn from the list alone.
  const loading = visible(dashboardHtml(list, [], STAGES, { loading: true }));
  assert.match(loading, /Reading the builds/);
  assert.match(loading, /5 on a person/);
  // Nothing yet.
  assert.match(visible(dashboardHtml([], [], STAGES)), /No builds yet\. .*No stage has finished with a timeline yet\. .*No stage has run a round yet\. .*Nothing is waiting or working now\./);
  const odd = dashboardHtml([{ id: "x", name: "<b>bold</b>", at: { stage: "code", state: "working" }, updated: "2026-11-07T18:00:00Z" }], [], STAGES);
  assert.doesNotMatch(odd, /<b>bold<\/b>/);
  assert.match(odd, /&lt;b&gt;bold&lt;\/b&gt;/);
});
