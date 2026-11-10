// The demo's version whose features are each made in a run of their own
// (lifecycle API 0.4.10): word-stats 0.1.0, its spec approved, gathering its
// three features. F1 Count words was accepted, F2 Count lines waits for your
// OK on its pull request, and F3 Longest word is at Code, waiting for your
// coding agent's push to its own pull request.
//
// Each run keeps its own Test and Code, actions, pull request, log and
// timeline. compose() reads the version from them as a service answers it:
// its Test and Code across the runs, its actions each open run's and then its
// own, its timeline its own bars and each run's, naming the run. The version
// waits until every run has closed, then goes on to Package.

import { blankStage, leaveOut, STAGE_IDS } from "./fixture.mjs";

const t = (hhmm) => `2026-11-02T${hhmm}:00Z`;
const REPO = "https://github.com/AgentMesh-Dev-Test/word-stats/pull";
const ID = "b_word_stats";

/** The files the runs handed back, by the path the build answer links them at (runs/<run id>/<path>). */
export const RUN_FILES = {
  "runs/F1/test/f1.test.mjs": `import test from "node:test";
import assert from "node:assert/strict";
import { count } from "../scripts/count.mjs";

test("[F1.A1] a passage of five words counts five", () => {
  assert.equal(count("the cat sat on mats"), 5);
});
test("[F1.A2] an empty passage counts none", () => {
  assert.equal(count("   "), 0);
});
`,
  "runs/F1/scripts/count.mjs": `// count.mjs: how many words a passage holds.
export function count(text) {
  return String(text ?? "").split(/\\s+/).filter(Boolean).length;
}
`,
  "runs/F2/test/f2.test.mjs": `import test from "node:test";
import assert from "node:assert/strict";
import { lines } from "../scripts/lines.mjs";

test("[F2.A1] three lines count three", () => {
  assert.equal(lines("one\\ntwo\\nthree"), 3);
});
test("[F2.A2] a blank last line is not counted", () => {
  assert.equal(lines("one\\ntwo\\n"), 2);
});
`,
  "runs/F2/scripts/lines.mjs": `// lines.mjs: how many lines a passage holds, a blank last line left out.
export function lines(text) {
  const all = String(text ?? "").split(/\\r?\\n/);
  return all.at(-1) === "" ? all.length - 1 : all.length;
}
`,
  "runs/F3/test/f3.test.mjs": `import test from "node:test";
import assert from "node:assert/strict";
import { longest } from "../scripts/longest.mjs";

test("[F3.A1] the longest word is named", () => {
  assert.equal(longest("a quick brown fox"), "quick");
});
`,
};

const file = (run, path) => ({ path, size: Buffer.byteLength(RUN_FILES[`runs/${run}/${path}`] ?? "", "utf8"), link: `/v1/lifecycle/builds/${ID}/files?path=${encodeURIComponent(`runs/${run}/${path}`)}` });
const stage = (id, fields) => ({ ...blankStage(id, "not_started"), ...fields });
const testWriter = { kind: "reference_agent", name: "test-writer" };
const coder = { kind: "your_agent", name: "Claude Code" };
const bar = (run, phase, stageId, holder, kind, a, b, status) => ({ phase, stage: stageId, round: 1, holder, kind, start: t(a), end: b === null ? null : t(b), duration_ms: b === null ? null : (Date.parse(t(b)) - Date.parse(t(a))), status, ...(run ? { run } : {}) });
const pr = (n, head, check) => ({ kind: "pull_request", url: `${REPO}/${n}`, head, check });
const needsWords = (label) => [{ name: "changes", label, kind: "words" }];

/** The actions a run waiting for your OK offers, each naming it. */
function okActions(run) {
  return [
    { stage: "code", name: "accept", label: `OK the code: ${run}`, needs: [], run },
    { stage: "code", name: "back_to_test", label: `Send back to Test: ${run}`, needs: needsWords("What is wrong with the suite, for the test writer"), run },
    { stage: "code", name: "stop", label: `Stop: ${run}`, needs: [], run },
  ];
}

function runs() {
  const suite = (run, at, n, words) => stage("test", {
    state: "done", holder: testWriter, runs: 1, done_when_met: true,
    rounds: [{ n: 1, at: t(at), label: "Round 1", verdict: "Suite written", back: false, words }],
    given: "The approved spec, for this feature alone.",
    handed_back: { words: [`${n} ${n === 1 ? "test" : "tests"} for this feature, each failing against an empty stand-in.`], files: [file(run, `test/${run.toLowerCase()}.test.mjs`)] },
    log: [{ at: t(at), said: "The suite came back." }],
  });
  return [
    {
      id: "F1", feature: "F1", name: "F1 Count words", started: t("15:05"), by: "you", ended: true,
      at: { stage: "code", state: "done", summary: "You OK'd the code on pull request #7" },
      stages: [
        suite("F1", "15:09", 2, "2 tests, from the scenarios F1.A1 and F1.A2."),
        stage("code", {
          state: "done", holder: coder, runs: 1, done_when_met: true,
          rounds: [{ n: 1, at: t("15:31"), label: "Push 1 · a41c2e0", verdict: "OK'd by you", back: false, words: "Both tests passed." }],
          given: "The spec, the agent's own files and this feature's suite, on pull request #7.",
          handed_back: { words: ["Merged into the version's base."], files: [file("F1", "scripts/count.mjs")] },
          log: [{ at: t("15:31"), said: "You OK'd the code. Pull request #7 was merged." }, { at: t("15:24"), said: "Your coding agent pushed a41c2e0." }],
          where: pr(7, "a41c2e0", { title: "Merged", words: "You OK'd it, and it was merged into the version's base.", items: [], passed: true }),
        }),
      ],
      actions: [], pull_request: pr(7, "a41c2e0", { title: "Merged", words: "You OK'd it, and it was merged into the version's base.", items: [], passed: true }),
      log: [{ at: t("15:31"), said: "You OK'd the code. Pull request #7 was merged." }, { at: t("15:05"), said: "The run started with the spec's approval." }],
      timeline: [bar(null, "write-the-suite", "test", "test-writer.platform@agentmesh.ai", "agent", "15:05", "15:09", "closed"), bar(null, "write-the-scripts", "code", null, "external", "15:09", "15:24", "closed"), bar(null, "ok-the-feature", "code", null, "person", "15:24", "15:31", "closed")],
    },
    {
      id: "F2", feature: "F2", name: "F2 Count lines", started: t("15:05"), by: "you", ended: false,
      at: { stage: "code", state: "waiting_on_you", summary: "Waiting on you at Code" },
      stages: [
        suite("F2", "15:10", 2, "2 tests, from the scenarios F2.A1 and F2.A2."),
        stage("code", {
          state: "waiting_on_you", holder: coder, runs: 2, done_when_met: true,
          rounds: [
            { n: 2, at: t("15:44"), label: "Push 2 · 9be07d1", verdict: "Ready for your OK", back: false, words: "All 4 tests passed, F1's among them." },
            { n: 1, at: t("15:27"), label: "Push 1 · 5d2a8f3", verdict: "1 test failed", back: true, words: "“a blank last line is not counted”. Sent back to your coding agent." },
          ],
          given: "The spec, the agent's own files and this feature's suite, on pull request #8, brought up to date with F1 once it was accepted.",
          handed_back: { words: ["Ready for your OK (9be07d1)."], files: [file("F2", "scripts/lines.mjs")] },
          log: [{ at: t("15:44"), said: "The code waits for your OK." }, { at: t("15:33"), said: "F1 was accepted, so pull request #8 was brought up to date with it." }, { at: t("15:27"), said: "1 test failed on 5d2a8f3." }],
          where: pr(8, "9be07d1", { title: "Ready for your OK", words: "All 4 tests passed, F1's among them. By feature: F1 2 of 2 pass; F2 2 of 2 pass.", items: [], passed: true }),
        }),
      ],
      actions: okActions("F2"), pull_request: pr(8, "9be07d1", { title: "Ready for your OK", words: "All 4 tests passed, F1's among them. By feature: F1 2 of 2 pass; F2 2 of 2 pass.", items: [], passed: true }),
      log: [{ at: t("15:44"), said: "The code waits for your OK." }, { at: t("15:05"), said: "The run started with the spec's approval." }],
      timeline: [bar(null, "write-the-suite", "test", "test-writer.platform@agentmesh.ai", "agent", "15:05", "15:10", "closed"), bar(null, "write-the-scripts", "code", null, "external", "15:10", "15:44", "closed"), bar(null, "ok-the-feature", "code", null, "person", "15:44", null, "waiting")],
    },
    {
      id: "F3", feature: "F3", name: "F3 Longest word", started: t("15:20"), by: "you", ended: false,
      at: { stage: "code", state: "working", summary: "Working at Code: waiting for a push to pull request #9" },
      stages: [
        suite("F3", "15:26", 1, "1 test, from the scenario F3.A1."),
        stage("code", {
          state: "working", holder: coder, runs: 1,
          given: "The spec, the agent's own files and this feature's suite, on pull request #9.",
          log: [{ at: t("15:27"), said: "Code is on pull request #9, for your coding agent." }],
          where: pr(9, "c07e4b2", { title: "Waiting for a push", words: "Your coding agent has not pushed to it yet.", items: [], passed: false }),
        }),
      ],
      actions: [{ stage: "code", name: "stop", label: "Stop: F3", needs: [], run: "F3" }], pull_request: pr(9, "c07e4b2", { title: "Waiting for a push", words: "Your coding agent has not pushed to it yet.", items: [], passed: false }),
      log: [{ at: t("15:27"), said: "Code is on pull request #9, for your coding agent." }, { at: t("15:20"), said: "You approved F3 after the spec, so its run started then." }],
      timeline: [bar(null, "write-the-suite", "test", "test-writer.platform@agentmesh.ai", "agent", "15:20", "15:26", "closed"), bar(null, "write-the-scripts", "code", null, "external", "15:26", null, "working")],
    },
  ];
}

/** The version's own timeline before its runs: the spec, its approval, and the gathering of the features. */
const OWN_BARS = [
  bar(null, "write-the-spec", "requirements", "spec-writer.platform@agentmesh.ai", "agent", "14:52", "14:58", "closed"),
  bar(null, "approve-the-spec", "requirements", null, "person", "14:58", "15:05", "closed"),
  bar(null, "gather-the-features", "code", null, "external", "15:05", null, "working"),
];

/** word-stats 0.1.0, gathering its three features. */
export function wordStats() {
  const S = {
    requirements: stage("requirements", {
      state: "done", holder: { kind: "reference_agent", name: "spec-writer" }, runs: 1, done_when_met: true,
      rounds: [{ n: 1, at: t("15:05"), label: "Round 1", verdict: "Approved", back: false, words: "The spec with two features; F3 was approved after it." }],
      given: "What you wrote in the boxes when you started the build.",
      handed_back: { words: ["The spec: count the words and the lines of a passage, and name its longest word."], files: [] },
      log: [{ at: t("15:20"), said: "You approved F3 Longest word." }, { at: t("15:05"), said: "You approved the spec." }],
    }),
    test: stage("test", { holder: { kind: "reference_agent", name: "test-writer" } }),
    code: stage("code", { holder: coder }),
    package: stage("package", { holder: { kind: "reference_agent", name: "package-maker" }, given: "The scripts as merged, once every feature's run has closed." }),
    release: stage("release", { holder: { kind: "reference_agent", name: "package-maker" } }),
    deploy: stage("deploy", { holder: { kind: "reference_agent", name: "deployment-manager" } }),
    conformance: stage("conformance", { holder: { kind: "reference_agent", name: "conformance-checker" } }),
    acceptance: stage("acceptance", { holder: { kind: "person", name: "you" } }),
  };
  const stages = leaveOut(STAGE_IDS.map((s) => S[s] ?? blankStage(s)), ["impact", "source", "retract", "reconfigure"]);
  const b = {
    id: ID, lifecycle: { project: null, at: t("14:52") }, name: "word-stats", version: "0.1.0", handle: "word-stats.platform@agentmesh.ai",
    does: "Counts the words and the lines of a passage, and names its longest word.",
    stages, can_try: { pull_request: false, installed: false }, own: [{ stage: "code", name: "stop", label: "Stop", needs: [] }], own_timeline: OWN_BARS, feature_runs: runs(), log: [],
  };
  return compose(b);
}

const stageIn = (fr, id) => fr.stages.find((s) => s.stage === id);
/** The runs still open. */
export const open = (b) => b.feature_runs.filter((fr) => !fr.ended);

/**
 * The version as a service answers it, read from its runs: its Test and Code
 * across them (each round labeled with its run, the open run waiting on you
 * leading), its actions each open run's and then its own, its timeline its own
 * bars and each run's naming it, and its log every run's too. Once every run has
 * closed, Test and Code are done and the version goes on.
 */
export function compose(b) {
  const runsNow = b.feature_runs;
  const live = open(b);
  for (const id of ["test", "code"]) {
    const s = b.stages.find((x) => x.stage === id);
    const mine = runsNow.map((fr) => [fr, stageIn(fr, id)]).filter(([, x]) => x);
    const states = mine.filter(([fr]) => !fr.ended).map(([, x]) => x.state);
    const rounds = mine.flatMap(([fr, x]) => x.rounds.map((r) => ({ ...r, label: `${fr.id} · ${r.label}` }))).sort((x, y) => y.at.localeCompare(x.at));
    const lead = mine.find(([fr, x]) => !fr.ended && x.state === "waiting_on_you") ?? mine.find(([fr]) => !fr.ended) ?? mine.at(-1);
    Object.assign(s, {
      state: states.includes("waiting_on_you") ? "waiting_on_you" : states.includes("working") ? "working" : mine.every(([, x]) => x.state === "done" || x.state === "stopped") ? "done" : "not_started",
      runs: mine.reduce((n, [, x]) => n + x.runs, 0),
      rounds: rounds.map((r, i) => ({ ...r, n: rounds.length - i })),
      given: id === "test" ? "The approved spec, one feature at a time." : "The spec, the agent's own files and each feature's suite, each feature on its own pull request.",
      handed_back: { words: [], files: mine.flatMap(([, x]) => x.handed_back.files) },
      done_when_met: null,
      log: mine.flatMap(([fr, x]) => x.log.map((e) => ({ ...e, said: `${fr.id}: ${e.said}` }))).sort((x, y) => y.at.localeCompare(x.at)),
      where: lead?.[1]?.where ?? null,
    });
    if (s.state === "done") s.done_when_met = true;
  }
  b.actions = [...live.flatMap((fr) => fr.actions), ...b.own];
  b.timeline = [...b.own_timeline, ...runsNow.flatMap((fr) => fr.timeline.map((x) => ({ ...x, run: fr.id })))].sort((x, y) => x.start.localeCompare(y.start));
  b.log = [...b.stages.find((s) => s.stage === "requirements").log, ...runsNow.flatMap((fr) => fr.log.map((e) => ({ ...e, said: `${fr.id}: ${e.said}` })))].sort((x, y) => y.at.localeCompare(x.at));
  return b;
}

/** Where the version is, in words, while it gathers its features; null once every run has closed. */
export function gatheringWords(b) {
  const live = Array.isArray(b?.feature_runs) ? open(b) : [];
  if (!live.length) return null;
  const waiting = live.filter((fr) => fr.at.state === "waiting_on_you").length;
  return `Making ${live.length === 1 ? "1 feature" : `${live.length} features`}, each in a run of its own${waiting ? `: ${waiting} ${waiting === 1 ? "waits" : "wait"} on you` : ""}`;
}

/** A run as a card on the build list (FeatureRunCard). */
export const runCard = (fr) => ({ id: fr.id, feature: fr.feature, name: fr.name, started: fr.started, at: fr.at, ended: fr.ended });

/** A run as the build answer gives it (FeatureRun). */
export const runView = (fr) => ({ ...runCard(fr), by: fr.by, stages: fr.stages, actions: fr.actions, pull_request: fr.pull_request, log: fr.log, timeline: fr.timeline });

const now = () => new Date().toISOString();

/**
 * An action on a version with feature runs: the run named (run), else the
 * version's own action of that name, else the first run offering it. Returns
 * { run, offered } or null when nothing offers it; take() then moves that run
 * along just enough to show what the button does.
 */
export function pick(b, name, runId) {
  if (runId) {
    const fr = b.feature_runs.find((x) => x.id === runId);
    const offered = fr?.actions.find((a) => a.name === name);
    return offered ? { run: fr, offered } : null;
  }
  const own = b.own.find((a) => a.name === name);
  if (own) return { run: null, offered: own };
  const fr = open(b).find((x) => x.actions.some((a) => a.name === name));
  return fr ? { run: fr, offered: fr.actions.find((a) => a.name === name) } : null;
}

/** One run's action taken: OK merges its pull request and closes it, Send back to Test reopens its suite, Stop closes it. */
export function take(b, fr, name, body) {
  const code = stageIn(fr, "code");
  const test = stageIn(fr, "test");
  const said = (words) => { const e = { at: now(), said: words }; fr.log.unshift(e); return e; };
  const n = fr.pull_request ? /\/pull\/(\d+)/.exec(fr.pull_request.url)?.[1] : null;
  if (name === "accept") {
    code.state = "done"; code.done_when_met = true;
    code.rounds[0] = { ...code.rounds[0], verdict: "OK'd by you" };
    code.log.unshift(said(`You OK'd the code. Pull request #${n} was merged.`));
    fr.ended = true; fr.actions = [];
    fr.at = { stage: "code", state: "done", summary: `You OK'd the code on pull request #${n}` };
    fr.pull_request = { ...fr.pull_request, check: { title: "Merged", words: "You OK'd it, and it was merged into the version's base.", items: [], passed: true } };
    code.where = fr.pull_request;
  } else if (name === "back_to_test") {
    test.state = "working"; code.state = "not_started";
    test.log.unshift(said(`You sent it back to Test: “${String(body?.changes ?? "").trim()}”`));
    fr.actions = [{ stage: "test", name: "stop", label: `Stop: ${fr.id}`, needs: [], run: fr.id }];
    fr.at = { stage: "test", state: "working", summary: "Working at Test: the test writer is revising the suite" };
  } else if (name === "stop") {
    const s = [test, code].find((x) => x.state === "working" || x.state === "waiting_on_you") ?? code;
    s.state = "stopped";
    s.log.unshift(said(`You stopped ${fr.name}.`));
    fr.ended = true; fr.actions = [];
    fr.at = { stage: s.stage, state: "stopped", summary: `Stopped at ${s.stage === "test" ? "Test" : "Code"}` };
  }
}

/** A file of the version's runs, by the path asked for: runs/<run id>/<path>, or the version's own Test or Code path, found in the run that made it. */
export function runFile(b, p) {
  if (!Array.isArray(b?.feature_runs)) return null;
  const at = [p, ...b.feature_runs.map((fr) => `runs/${fr.id}/${p}`)].find((x) => x in RUN_FILES);
  return at ? RUN_FILES[at] : null;
}
