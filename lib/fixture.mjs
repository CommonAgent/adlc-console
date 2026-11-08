// Demo data, shaped exactly like the lifecycle API's answers (see
// docs/contract.md). The content is the palindrome-judge build from the
// approved design mock.

const FILES = {
  "agent-descriptor.json": `{
  "format": "agent-descriptor-v1",
  "version": "0.1.0",
  "does": "Says whether a sentence is a palindrome, ignoring spaces, punctuation and letter case.",
  "offerings": [{
    "id": "judge-a-sentence",
    "name": "Judge a sentence",
    "does": "Replies yes or no, with the letters it compared.",
    "inputs": [{ "name": "sentence", "type": "text" }],
    "outputs": [{ "name": "verdict", "type": "text" }],
    "how": "program"
  }],
  "will_not": ["Judge anything but the letters and digits it was sent"],
  "price": "free"
}
`,
  "agent-runtime-requirements.json": `{
  "format": "agent-runtime-requirements-v1",
  "kind": "plugin-on-harness",
  "systems": [],
  "calls_model": false
}
`,
  "skills/judge-a-sentence/SKILL.md": `---
name: judge-a-sentence
---
When a sentence arrives, run scripts/judge.mjs with it.
Reply with its answer as it is. Never add a verdict of your own.
`,
  "test/judge.test.mjs": `import test from "node:test";
import assert from "node:assert/strict";
import { judge } from "../scripts/judge.mjs";

test("a palindrome with spaces and capitals is a yes", () => {
  assert.equal(judge("Never odd or even"), "yes: neveroddoreven");
});
test("punctuation is ignored", () => {
  assert.equal(judge("A man, a plan, a canal: Panama!"), "yes: amanaplanacanalpanama");
});
test("a sentence that is not one is a no", () => {
  assert.equal(judge("Hello there"), "no: hellothere");
});
// ... 11 more
`,
  "test/declarations.test.mjs": `// checks the four agent files agree with each other
// ... 4 tests
`,
  "scripts/judge.mjs": `// judge.mjs: yes or no, with the letters and digits compared.
export function judge(sentence) {
  const kept = String(sentence ?? "").toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, "");
  if (!kept) return "no: nothing to compare";
  const same = kept === [...kept].reverse().join("");
  return \`\${same ? "yes" : "no"}: \${kept}\`;
}
`,
  "evidence/scan.sarif": `{
  "version": "2.1.0",
  "runs": [{
    "tool": { "driver": { "name": "ci-scanner" } },
    "results": [
      { "ruleId": "js/path-injection", "level": "warning", "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "scripts/read-claim.mjs" }, "region": { "startLine": 12 } } }] },
      { "ruleId": "js/insecure-randomness", "level": "note", "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "scripts/ids.mjs" }, "region": { "startLine": 3 } } }] }
    ]
  }]
}
`,
  "evidence/bom.cdx.json": `{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "components": [
    { "type": "library", "name": "expense-rules", "version": "2.3.1" },
    { "type": "library", "name": "currency-table", "version": "2026.10" }
  ]
}
`,
  "review-findings.md": `# Review of palindrome-judge 0.1.0, pull request #5 at 0da3161
open: 0
noted: 1

## Noted
- scripts/judge.mjs:3. Letters with accents are kept as they are, so
  "Ésope reste ici et se repose" compares é with e and says no. The spec
  does not say either way; left as written.
`,
  "security-statement.json": `{
  "verdict": "pass",
  "reaches": [],
  "secrets_read": [],
  "spend_ceiling": "10 USD per day",
  "never_dos": [
    "reaches no address",
    "reads no credential",
    "writes no file outside its own folder"
  ],
  "grants": "nothing"
}
`,
};

export function judge(sentence) {
  const kept = String(sentence ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (!kept) return "no: nothing to compare";
  const same = kept === [...kept].reverse().join("");
  return `${same ? "yes" : "no"}: ${kept}`;
}

export const STAGE_IDS = [
  "requirements", "architecture", "impact", "source",
  "test", "code", "review", "security",
  "package", "release", "deploy",
  "conformance", "acceptance",
  "docs", "publish", "retract",
  "monitor", "eval", "incident", "cost",
  "update", "reconfigure", "rollback", "decommission",
];

// Times are 2026-10-31 in UTC; 15:04Z is 9:04 AM in Mountain time.
const t = (hhmm) => `2026-10-31T${hhmm}:00Z`;

const PR = "https://github.com/AgentMesh-Dev-Test/handoff-proof/pull/5";

function file(path) {
  const bytes = Buffer.byteLength(FILES[path] ?? "", "utf8");
  return { path, size: bytes, link: `${PR}/files#${encodeURIComponent(path)}` };
}

export function blankStage(stage, state = "not_offered") {
  return {
    stage, state, holder: null, runs: 0, rounds: [], given: "",
    handed_back: { words: [], files: [] }, done_when_met: null, log: [], where: null,
  };
}

// The stages a build's lifecycle leaves out (lifecycle API 0.3): each reads
// not_used, with no holder, no runs and no action. A stage that does not apply
// to the kind of build stays not_applicable.
export function leaveOut(stages, ids, project = null) {
  const which = project ?? "org default";
  return stages.map((s) => (ids.includes(s.stage) && s.state !== "not_applicable"
    ? { ...blankStage(s.stage, "not_used"), given: `Not part of this build's lifecycle (${which}).` }
    : s));
}

function entry(stage, fields) {
  return { ...blankStage(stage, "not_started"), ...fields };
}

export function palindromeJudge() {
  const id = "b_palindrome_judge";
  const f = (p) => file(p);
  const S = {
    requirements: entry("requirements", {
      state: "done", holder: { kind: "reference_agent", name: "spec-writer" }, runs: 2,
      rounds: [
        { n: 2, at: t("15:04"), label: "Round 2", verdict: "Approved", back: false, words: "The spec writer added the cleaned letters to the reply. You answered its 2 questions: the name and the price." },
        { n: 1, at: t("14:58"), label: "Round 1", verdict: "You asked for changes", back: true, words: "“Say which letters it compared, not only yes or no.”" },
      ],
      given: "What you wrote in the boxes when you started the build.",
      handed_back: {
        words: ["The statement of the job: what it does, takes, hands back and will not do. It reaches nothing outside its own folder and is free."],
        files: [f("agent-descriptor.json"), f("agent-runtime-requirements.json"), f("skills/judge-a-sentence/SKILL.md")],
      },
      done_when_met: true,
      log: [
        { at: t("15:05"), said: "You approved the statement of the job." },
        { at: t("15:04"), said: "You answered the spec writer's 2 questions: its name and its price." },
        { at: t("15:02"), said: "The spec came back." },
      ],
    }),
    architecture: entry("architecture", {
      state: "done", holder: { kind: "reference_agent", name: "spec-writer" }, runs: 1,
      given: "The statement of the job.",
      handed_back: {
        words: ["One step, a program: scripts/judge.mjs takes the sentence and hands back the verdict.", "No system to bind in any environment: it reaches nothing."],
        files: [],
      },
      done_when_met: true,
      log: [{ at: t("15:02"), said: "The design came back with the spec." }],
    }),
    test: entry("test", {
      state: "done", holder: { kind: "reference_agent", name: "test-writer" }, runs: 1,
      given: "The statement of the job, without the design or any code.",
      handed_back: {
        words: ["The suite: 2 test files, 14 tests.", "It failed all 14 against empty stand-ins, so it can tell a real script from nothing."],
        files: [f("test/judge.test.mjs"), f("test/declarations.test.mjs")],
      },
      done_when_met: true,
      log: [{ at: t("15:10"), said: "2 test files came back." }, { at: t("15:06"), said: "The test writer was asked." }],
    }),
    code: entry("code", {
      state: "waiting_on_you", holder: { kind: "your_agent", name: "Claude Code" }, runs: 3,
      rounds: [
        { n: 3, at: t("15:38"), label: "Push 3 · 0da3161", verdict: "Ready for your OK", back: false, words: "All 14 tests passed. Both reviewers passed it." },
        { n: 2, at: t("15:27"), label: "Push 2 · b2f9d10", verdict: "code-critic refused", back: true, words: "scripts/judge.mjs:4. An empty sentence says “yes”, so a message with only punctuation is called a palindrome. Sent back to your coding agent as a comment on the pull request." },
        { n: 1, at: t("15:19"), label: "Push 1 · c5a1e02", verdict: "3 tests failed", back: true, words: "“punctuation is ignored”, “digits count as letters”, “accented capitals are lowered”. The security reviewer was not asked: the tests come first." },
      ],
      given: "The statement, the suite and a stub of each script, as a build folder on a branch.",
      handed_back: { words: [], files: [f("scripts/judge.mjs")] },
      done_when_met: true,
      log: [
        { at: t("15:41"), said: "The check said Ready for your OK." },
        { at: t("15:38"), said: "Your coding agent pushed 1 script." },
        { at: t("15:12"), said: "The build folder went to pull request #5." },
      ],
      where: {
        kind: "pull_request", url: PR,
        check: {
          title: "Ready for your OK",
          words: "All 14 tests passed. Blanking the 1 script made the suite fail.",
          items: ["code-critic reviewed the scripts and left nothing open.", "The security reviewer passed it."],
        },
      },
    }),
    review: entry("review", {
      state: "done", holder: { kind: "reference_agent", name: "code-critic" }, runs: 2,
      rounds: [
        { n: 2, at: t("15:40"), label: "On push 3", verdict: "Nothing open", back: false, words: "One thing noted and left." },
        { n: 1, at: t("15:29"), label: "On push 2", verdict: "1 finding open", back: true, words: "An empty sentence says yes. Back to Code." },
      ],
      given: "The pull request's scripts at 0da3161, with the diff from the stubs.",
      handed_back: { words: ["Nothing open. One thing noted and left, because the spec does not decide it."], files: [f("review-findings.md")] },
      done_when_met: true,
      log: [{ at: t("15:40"), said: "code-critic reviewed the scripts and left nothing open." }],
    }),
    security: entry("security", {
      state: "done", holder: { kind: "reference_agent", name: "security-reviewer" }, runs: 2,
      rounds: [
        { n: 2, at: t("15:41"), label: "On push 3", verdict: "Passed", back: false, words: "Nothing changed in what it reaches." },
        { n: 1, at: t("15:29"), label: "On push 2", verdict: "Passed", back: false, words: "It reaches nothing and reads no credential." },
      ],
      given: "The package at 0da3161 and its spending limit.",
      handed_back: { words: ["It passes: it reaches nothing, reads no credential, and grants nothing."], files: [f("security-statement.json")] },
      done_when_met: true,
      log: [{ at: t("15:41"), said: "The security reviewer passed it." }],
    }),
    package: entry("package", {
      holder: { kind: "reference_agent", name: "package-maker" },
      given: "The merged commit, once you accept the pull request.",
      handed_back: { words: ["The package, packed the same way every time, so anyone can repack it and compare."], files: [] },
    }),
    release: entry("release", {
      holder: { kind: "reference_agent", name: "package-maker" },
      given: "The package.",
      handed_back: { words: ["A signed build record naming who held each stage, including your coding agent at Code."], files: [] },
    }),
    deploy: entry("deploy", {
      holder: { kind: "reference_agent", name: "deployment-manager" },
      given: "The package and your approval of the install.",
      handed_back: { words: ["The agent running as palindrome-judge.platform@agentmesh.ai, and a signed deployment record."], files: [] },
    }),
    conformance: entry("conformance", {
      holder: { kind: "reference_agent", name: "conformance-checker" },
      given: "The running agent and its declaration.",
      handed_back: { words: ["A signed verdict: conforms, does not conform, or inconclusive."], files: [] },
    }),
    acceptance: entry("acceptance", {
      holder: { kind: "person", name: "you" },
      given: "The running agent, or before that the pull request's scripts in the sandbox.",
      handed_back: { words: ["Your word that it is what you asked for, and any tries you kept as tests."], files: [] },
    }),
  };
  // It started under the organization's lifecycle, which leaves out Impact, Source, Retract and Reconfigure.
  const stages = leaveOut(STAGE_IDS.map((s) => S[s] ?? blankStage(s)), ["impact", "source", "retract", "reconfigure"]);
  const log = stages.flatMap((s) => s.log).sort((a, b) => b.at.localeCompare(a.at));
  return {
    id,
    lifecycle: { project: null, at: "2026-10-31T14:58:00Z" },
    name: "palindrome-judge",
    does: "Says whether a sentence is a palindrome, ignoring spaces, punctuation and letter case. Replies yes or no with the cleaned letters.",
    version: "0.1.0",
    handle: "palindrome-judge.platform@agentmesh.ai",
    stages,
    actions: [
      { stage: "code", name: "accept", label: "Accept the pull request", needs: [] },
      { stage: "code", name: "stop", label: "Stop", needs: [] },
    ],
    log,
  };
}

export function palindromeTries() {
  return [
    { id: "t4", say: "Was it a car or a cat I saw?", against: "pull_request", answer: "yes: wasitacaroracatisaw", at: t("15:44"), kept: false, sent_back: false },
    { id: "t3", say: "Step on no pets", against: "pull_request", answer: "yes: steponnopets", at: t("15:43"), kept: true, sent_back: false },
    { id: "t2", say: "...!!!", against: "pull_request", answer: "no: nothing to compare", at: t("15:42"), kept: false, sent_back: false },
    { id: "t1", say: "Ésope reste ici et se repose", against: "pull_request", answer: "no: ésoperesteicietserepose", at: t("15:42"), kept: false, sent_back: true },
  ];
}

// A build through Deploy: the agent installed, Conformance and Acceptance to come.
export function tallyWords() {
  const done = (s, name, kind = "reference_agent") => ({
    ...blankStage(s, "done"), holder: { kind, name }, runs: 1, done_when_met: true,
    given: "The stage before it.", log: [{ at: "2026-10-30T20:15:00Z", said: `${name} finished.` }],
  });
  const holders = {
    requirements: "spec-writer", architecture: "spec-writer", test: "test-writer", code: "code-writer",
    review: "code-critic", security: "security-reviewer", package: "package-maker", release: "package-maker",
    deploy: "deployment-manager", conformance: "conformance-checker",
  };
  const stages = STAGE_IDS.map((s) =>
    s === "acceptance" ? { ...done(s, "you", "person"), state: "not_started", runs: 0, done_when_met: null, log: [] }
      : s === "conformance" ? { ...done(s, holders[s]), state: "not_started", runs: 0, done_when_met: null, log: [] }
      : holders[s] ? done(s, holders[s]) : blankStage(s));
  return {
    id: "b_tally_words", lifecycle: { project: null, at: "2026-10-29T16:00:00Z" }, name: "tally-words", does: "Counts the words in a passage and lists the ten most used.",
    version: "0.2.0", handle: "tally-words.platform@agentmesh.ai", stages,
    actions: [], log: [{ at: "2026-10-30T20:15:00Z", said: "The agent is installed and answering as tally-words.platform@agentmesh.ai." }],
  };
}

// A build stopped at Code, which can be resumed.
export function wordTally() {
  const base = tallyWords();
  const order = STAGE_IDS;
  const stages = base.stages.map((s) => {
    const i = order.indexOf(s.stage);
    if (s.state === "not_offered") return s;
    if (i < order.indexOf("code")) return s;
    if (s.stage === "code") return { ...s, state: "stopped", holder: { kind: "your_agent", name: "Claude Code" }, done_when_met: false, log: [{ at: "2026-10-29T17:02:00Z", said: "You stopped the build at Code." }] };
    return { ...blankStage(s.stage, "not_started"), holder: s.holder };
  });
  return {
    id: "b_word_tally", lifecycle: { project: null, at: "2026-10-29T15:30:00Z" }, name: "word-tally", does: "Counts the words in a passage.", version: "0.1.0",
    handle: "word-tally.platform@agentmesh.ai", stages,
    actions: [{ stage: "code", name: "resume", label: "Resume", needs: [] }, { stage: "code", name: "archive", label: "Archive", needs: [] }],
    log: [{ at: "2026-10-29T17:02:00Z", said: "You stopped the build at Code." }],
  };
}

// A process held partly outside the service: its organization's own agents,
// an outside tool at Security and a contracted supplier at Package and Release,
// each handing in evidence the service read. Review does not apply to a
// process, and nobody holds Impact or Eval yet.
export function expenseCheck() {
  const at = (hhmm) => `2026-11-01T${hhmm}:00Z`;
  const ev = (path) => ({ path, size: Buffer.byteLength(FILES[path], "utf8"), link: `https://ci.example.com/expense-check/runs/88/${path}` });
  const held = (s, state, holder, extra = {}) => ({
    ...blankStage(s, state), holder, runs: state === "done" ? 1 : 0, done_when_met: state === "done" ? true : null,
    given: state === "done" ? "The stage before it." : "", ...extra,
  });
  const ref = (name) => ({ kind: "reference_agent", name, handle: `${name}.platform@agentmesh.ai` });
  const harbor = { kind: "contracted", name: "Harbor Builds", handle: "builds.harbor@example.com", evidence: { formats: ["cyclonedx", "slsa"], where: "https://harbor.example.com/builds" } };
  const S = {
    requirements: held("requirements", "done", ref("spec-writer")),
    architecture: held("architecture", "done", ref("spec-writer")),
    impact: blankStage("impact", "not_bound"),
    test: held("test", "done", { kind: "your_agent", name: "Our test writer", handle: "test-writer.finance@example.com" }),
    code: held("code", "done", { kind: "your_agent", name: "Our finance coder", handle: "coder.finance@example.com" }),
    review: blankStage("review", "not_applicable"),
    security: held("security", "done", { kind: "outside_tool", name: "The scanner in our CI", evidence: { formats: ["sarif"], where: "The CI run's saved files" } }, {
      evidence: [{ format: "sarif", name: "CI scan of scripts", at: at("16:20"), summary: "No errors. 1 warning (js/path-injection at scripts/read-claim.mjs line 12) and 1 note.", file: ev("evidence/scan.sarif") }],
      log: [{ at: at("16:20"), said: "The scanner in our CI handed in its findings." }],
    }),
    package: held("package", "done", harbor, {
      evidence: [{ format: "cyclonedx", name: "Bill of materials", at: at("16:31"), summary: "2 components: expense-rules 2.3.1 and currency-table 2026.10.", file: ev("evidence/bom.cdx.json") }],
      log: [{ at: at("16:31"), said: "Harbor Builds handed in the bill of materials." }],
    }),
    release: held("release", "not_started", harbor, { given: "The package, from Harbor Builds." }),
    deploy: held("deploy", "not_started", ref("deployment-manager")),
    conformance: held("conformance", "not_started", ref("conformance-checker")),
    acceptance: held("acceptance", "not_started", { kind: "person", name: "you" }),
    eval: blankStage("eval", "not_bound"),
  };
  // The finance project's lifecycle: the organization's, with Impact used again and Eval left out.
  const stages = leaveOut(STAGE_IDS.map((s) => S[s] ?? blankStage(s)), ["source", "retract", "reconfigure", "eval"], "finance");
  const log = stages.flatMap((s) => s.log).sort((a, b) => b.at.localeCompare(a.at));
  return {
    id: "b_expense_check", name: "expense-check", project: "finance", lifecycle: { project: "finance", at: "2026-11-01T15:40:00Z" },
    does: "A process that checks an expense claim against the travel policy and says which lines break it.",
    version: "0.1.0", handle: "expense-check.finance@example.com", stages, actions: [], log,
  };
}

// Made-up builds for the Board, so it shows cards in every phase and in each
// state: each is at one stage, with the stages before it done and the ones
// after it to come. A build that finished has nothing after it.
const BOARD_OFFERED = new Set(["requirements", "architecture", "test", "code", "review", "security", "package", "release", "deploy", "conformance", "acceptance", "docs", "publish", "monitor", "incident", "cost", "update", "rollback"]);
const BOARD_REF = {
  requirements: "spec-writer", architecture: "solution-architect", test: "test-writer", code: "code-writer", review: "code-critic",
  security: "security-reviewer", package: "package-maker", release: "package-maker", deploy: "deployment-manager", conformance: "conformance-checker",
  docs: "documenter", publish: "publisher", monitor: "watcher", incident: "incident-recorder", cost: "watcher", update: "deployment-manager", rollback: "deployment-manager",
};
function madeUp({ id, name, does, version, at, state, when, said, actions = [{ stage: at, name: "stop", label: "Stop", needs: [] }], archived = false }) {
  const i = STAGE_IDS.indexOf(at);
  const holderOf = (s) => (s === "acceptance" ? { kind: "person", name: "you" } : { kind: "reference_agent", name: BOARD_REF[s] });
  const stages = STAGE_IDS.map((s, j) => {
    if (s === at) {
      return { ...blankStage(s, state), holder: holderOf(s), runs: 1, given: "The stage before it.", done_when_met: state === "done" ? true : state === "refused" ? false : null, log: [{ at: when, said }] };
    }
    if (!BOARD_OFFERED.has(s)) return blankStage(s);
    if (j < i) return { ...blankStage(s, "done"), holder: holderOf(s), runs: 1, given: "The stage before it.", done_when_met: true };
    return state === "done" ? blankStage(s) : { ...blankStage(s, "not_started"), holder: holderOf(s) };
  });
  return {
    id, name, does, version, handle: `${name}.platform@agentmesh.ai`, lifecycle: { project: null, at: when },
    stages, actions, log: [{ at: when, said }], ...(archived ? { archived: true } : {}),
  };
}

export function boardBuilds() {
  const at = (day, hhmm) => `2026-11-0${day}T${hhmm}:00Z`;
  return [
    madeUp({
      id: "b_invoice_reader", name: "invoice-reader", version: "0.1.0", at: "requirements", state: "waiting_on_you", when: at(2, "16:10"),
      does: "Reads a supplier invoice and lists its lines, totals and due date.", said: "The spec is ready for your approval.",
      actions: [{ stage: "requirements", name: "changes", label: "Ask for changes", needs: [{ name: "words", label: "What should change", kind: "words" }] }, { stage: "requirements", name: "stop", label: "Stop", needs: [] }],
    }),
    madeUp({ id: "b_meeting_notes", name: "meeting-notes", version: "0.1.0", at: "architecture", state: "working", when: at(2, "16:20"), does: "Turns a meeting transcript into decisions and action items.", said: "The solution architect is writing the design." }),
    madeUp({ id: "b_release_notes", name: "release-notes", version: "0.3.0", at: "security", state: "refused", when: at(2, "14:05"), does: "Writes release notes from the merged pull requests.", said: "The security reviewer refused: the scripts read any file path they are sent." }),
    madeUp({ id: "b_ticket_triage", name: "ticket-triage", version: "0.2.0", at: "package", state: "working", when: at(2, "16:25"), does: "Sorts new support tickets by product and urgency.", said: "The package maker is packing the agent." }),
    madeUp({ id: "b_contract_check", name: "contract-check", version: "1.0.0", at: "acceptance", state: "waiting_on_you", when: at(2, "15:30"), does: "Compares a contract with the company's standard terms and lists the differences.", said: "It conforms. It is waiting for you to accept it." }),
    madeUp({ id: "b_faq_answerer", name: "faq-answerer", version: "0.4.0", at: "docs", state: "working", when: at(2, "15:50"), does: "Answers questions from the product FAQ, and says when it does not know.", said: "The documenter is writing the agent's page." }),
    madeUp({ id: "b_uptime_watch", name: "uptime-watch", version: "1.2.0", at: "incident", state: "waiting_on_you", when: at(2, "13:40"), does: "Checks the status pages every minute and opens an incident when one fails.", said: "An incident is open. It is waiting for you to say what happened." }),
    madeUp({ id: "b_currency_convert", name: "currency-convert", version: "2.0.1", at: "update", state: "working", when: at(2, "16:00"), does: "Converts an amount between currencies at the day's rate.", said: "The deployment manager is installing 2.0.1." }),
    madeUp({ id: "b_lunch_poll", name: "lunch-poll", version: "1.0.0", at: "acceptance", state: "done", when: at(1, "18:00"), does: "Runs the team's lunch poll and announces the winner.", said: "You accepted it.", actions: [{ stage: "acceptance", name: "archive", label: "Archive", needs: [] }] }),
    madeUp({
      id: "b_greeter", name: "greeter", version: "0.1.0", at: "test", state: "stopped", when: at(1, "11:15"), does: "Says hello in the language it was greeted in.", said: "You stopped the build at Test.", archived: true,
      actions: [{ stage: "test", name: "resume", label: "Resume", needs: [] }, { stage: "test", name: "unarchive", label: "Put back in the list", needs: [] }],
    }),
  ];
}

export const FIXTURE_FILES = FILES;
