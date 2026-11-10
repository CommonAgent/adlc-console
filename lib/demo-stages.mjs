// The demo's answers to the lifecycle API 0.4 routes: products, one stage's
// workspace (from 0.4.9 with its holder's skills), and each product's chat
// with a stage's agent (docs/contract.md).
// It stands in for a service the way lib/demo.mjs does: made-up content, the
// same every time, shaped exactly like a service's answers.
//
// palindrome-judge (waiting at Code) and lunch-poll (finished) carry artifacts
// and a written chat; the other builds get a chat made from their rounds.

import { readFileSync } from "node:fs";
import { FIXTURE_FILES } from "./fixture.mjs";

const DOC = JSON.parse(readFileSync(new URL("../standards/stages.json", import.meta.url), "utf8"));
const DEF = new Map(DOC.stages.map((s) => [s.id, s]));
const ROLE = new Map((DOC.roles ?? []).map((r) => [r.id, r]));
const OFF = new Set(["not_used", "not_offered", "not_applicable"]);
/** The kind of artifact that is a stage's asset (0.4.11), where a stage makes more than one kind. */
const ASSET_KIND = { requirements: ["spec", "statement"], architecture: ["architecture"], test: ["suite"], code: ["programs"], review: ["findings"], security: ["security"], package: ["package"], release: ["build_record"], deploy: ["run_plan"], conformance: ["attestation"], docs: ["agentdoc"], "reverse-engineering": ["as_built"] };
const now = () => new Date().toISOString();
export const productOf = (b) => b.product ?? b.name;
export const used = (b) => b.stages.filter((s) => !OFF.has(s.state));

const t = (hhmm) => `2026-10-31T${hhmm}:00Z`;
const PR = "https://github.com/AgentMesh-Dev-Test/handoff-proof/pull/5";
const file = (path) => ({ path, size: Buffer.byteLength(FIXTURE_FILES[path] ?? "", "utf8"), link: `${PR}/files#${encodeURIComponent(path)}` });

/** The role a stage's holder holds: the one whose reference agent it is, else the stage's first. */
export function roleIdOf(s) {
  const ids = DEF.get(s?.stage)?.role_ids ?? [];
  return ids.find((r) => s?.holder?.kind === "reference_agent" && ROLE.get(r)?.reference_agent === s.holder.name) ?? ids[0] ?? null;
}

/** What a holder is called in a chat: the role's name for the service's own agent, the holder's name otherwise. */
export function agentName(s) {
  const h = s?.holder;
  if (!h) return "";
  if (h.kind === "reference_agent") return ROLE.get(roleIdOf(s))?.name ?? h.name;
  return h.kind === "person" && /^you$/i.test(h.name) ? "You" : h.name;
}

// ---------- the holders' skills (lifecycle API 0.4.9) ----------

/** One skill as a SKILL.md says it: frontmatter with its name and description, then what it does. */
const skill = (name, description, how) => ({
  name, description,
  text: `---
name: ${name}
description: ${description}
---

# ${name[0].toUpperCase()}${name.slice(1).replace(/-/g, " ")}

## When to use this

${description}

## How to do it

${how}
`,
});

/** The demo's reference agents' skills, a few of each, in the names the reference agents use. package-maker has none of its own. */
const SKILLS = {
  "spec-writer": [
    skill("read-what-was-asked", "the first step of writing a spec, before anything is drafted", "Record what the person asked for in their own words, and each thing they left open, before anything is drafted."),
    skill("draft-the-spec", "once the request is recorded, to write the spec it describes and the agent's own files from it", "Write each feature with its requirements and at least one acceptance scenario a test can check. Invent nothing the person did not say: what is unsettled goes to the open questions."),
    skill("ask-what-is-missing", "last, to write the reply and put the open questions to the person", "Write the reply in plain words, and put each open question to the person once."),
  ],
  "test-writer": [
    skill("read-the-spec", "the first step, before anything is written", "Read every acceptance scenario of the spec, and the interfaces that must be kept."),
    skill("write-the-suite", "once the declaration is recorded, to write the tests", "Write one test per acceptance scenario, each named by the scenario it checks, such as [F1.A1]."),
    skill("check-the-suite", "once a suite exists, to run it against nothing and, when the scripts exist, against them", "Run the suite with no scripts in place: every test must fail. Then run it against the scripts, when there are any."),
  ],
  "code-critic": [
    skill("read-the-change", "the first step, before anything is judged", "Read the diff, the scripts and the tests, changed files first."),
    skill("check-the-house-rules", "the second step, before any model reads the change", "Hold the change to the house rules a program can check, and write a finding for each one broken."),
    skill("write-the-findings", "the last step, once the findings are checked", "Write each finding with its place, the rule, the claim and the consequence."),
  ],
  "security-reviewer": [
    skill("read-the-package", "first, on every review: before anything is traced or judged", "Read the package's declarations: what it says it reaches, spends and never does."),
    skill("trace-the-programs", "second, once the declaration is read: to see what the programs reach that the declaration may not name", "Trace every call the scripts make to the network, the disk and the environment."),
    skill("write-the-review", "last, on every review: to apply the role's rules and write the statement or the refusal", "Write what the package may reach, spend and never do, and why, or refuse it in words."),
  ],
  "package-maker": [],
};

/** A stage's holder as the stage workspace gives it: a reference agent with its skills, an agent the person runs with the sentence that says they are its own. */
export function holderWithSkills(h) {
  if (!h) return h;
  if (h.kind === "reference_agent" && SKILLS[h.name]) return { ...h, skills: SKILLS[h.name] };
  if (h.kind === "your_agent" || h.kind === "contracted") return { ...h, skills_note: `Its skills are whatever ${h.name} has installed; this service cannot see them.` };
  return h;
}

// ---------- artifacts ----------

/** palindrome-judge's artifacts: made through Security review, the rest to come. */
export function palindromeArtifacts() {
  const A = (id, stage, name, by, kind, state, extra = {}) => ({ id, stage, name, by, kind, state, ...extra });
  return [
    A("pj-spec", "requirements", "Spec", "spec writer", "spec", "made", {
      version: "v3", at: t("15:05"), digest: "sha256:9c1e4b7f20aa61d3",
      summary: {
        product: "palindrome-judge 0.1.0",
        purpose: "Says whether a sentence is a palindrome, ignoring spaces, punctuation and letter case, for anyone who sends it one sentence.",
        features: [{
          id: "F1", name: "Judge a sentence", does: "Replies yes or no, with the letters it compared.",
          requirements: [
            { id: "F1.R1", shall: "The agent shall keep only the letters and digits of the sentence, lowered, and compare them with their reverse.", kind: "behavior" },
            { id: "F1.R2", shall: "The agent shall reply yes or no, with the letters it compared.", kind: "output", exact: ["yes", "no"] },
            { id: "F1.R3", shall: "The agent shall reply no to a sentence with no letters or digits.", kind: "behavior" },
          ],
          acceptance: [
            { id: "F1.A1", gherkin: "Scenario: a palindrome with spaces and capitals\n  Given the sentence \"Never odd or even\"\n  When it is judged\n  Then the reply is \"yes\"\n  And it carries the letters \"neveroddoreven\"" },
            { id: "F1.A2", gherkin: "Scenario: nothing to compare\n  Given the sentence \"?!\"\n  When it is judged\n  Then the reply is \"no\"" },
          ],
        }],
        interfaces: [{ id: "I1", kind: "command", name: "judge-a-sentence", keep: false }],
        constraints: ["C1 (runtime): The agent shall run on Node 22 or later and reach nothing outside its own folder."],
        systems: [], settings: [], price: "free", open: [],
      },
    }),
    A("pj-agent", "architecture", "The agent's own files", "spec writer", "statement", "made", {
      version: "v1", at: t("15:05"),
      summary: { agent: "palindrome-judge 0.1.0", offerings: [{ name: "Judge a sentence", does: "Replies yes or no, with the letters it compared." }], refuses: ["judging anything but the letters and digits it was sent"], records: ["the letters it compared, with each answer"], price: "free", open: [] },
      files: [file("agent-descriptor.json"), file("agent-runtime-requirements.json"), file("skills/judge-a-sentence/SKILL.md")],
    }),
    A("pj-design", "architecture", "Design", "spec writer", "architecture", "made", {
      version: "v1", at: t("15:02"),
      summary: { words: "One step, a program: scripts/judge.mjs takes the sentence and hands back the verdict. No system to bind in any environment: it reaches nothing." },
    }),
    A("pj-suite", "test", "The suite", "test writer", "suite", "made", {
      version: "14 tests", at: t("15:10"),
      summary: { count: 14, tests: ["a palindrome with spaces and capitals is a yes", "punctuation is ignored", "a sentence that is not one is a no", "digits count as letters", "accented capitals are lowered", "an empty sentence is a no, with nothing to compare", "the reply carries the letters it compared", "the four agent files agree with each other", "a sentence of one letter is a yes", "a long sentence is judged in full", "letters in two scripts are compared as written", "a reply never carries the sentence back", "it refuses more than one sentence", "it answers in under a second"] },
      files: [file("test/judge.test.mjs"), file("test/declarations.test.mjs")],
    }),
    A("pj-programs", "code", "The programs", "Claude Code, your coding agent", "programs", "made", {
      version: "0da3161", at: t("15:38"),
      summary: { scripts: [{ path: "scripts/judge.mjs", lines: 7, does: "keeps the letters and digits, lowers them, and compares them with their reverse" }], commit: "0da3161", pr: { number: 5, url: PR } },
      files: [file("scripts/judge.mjs")],
    }),
    A("pj-findings", "review", "Review findings", "code critic", "findings", "made", {
      version: "on 0da3161", at: t("15:40"),
      summary: { open: [], verdict: "Nothing open. One thing noted and left: letters with accents are compared as they are, and the spec does not decide it." },
      files: [file("review-findings.md")],
    }),
    A("pj-security", "security", "Security record", "security reviewer", "security", "made", {
      version: "on 0da3161", at: t("15:41"),
      summary: { reach: [], spend: "up to 10 USD per day", never: ["reach an address", "read a credential", "write a file outside its own folder"], verdict: "passed" },
      files: [file("security-statement.json")],
    }),
    A("pj-package", "package", "The package", "package maker", "package", "next"),
    A("pj-record", "release", "Signed build record", "package maker", "build_record", "later"),
    A("pj-runplan", "deploy", "Run plan", "deployment manager", "run_plan", "later"),
    A("pj-attest", "conformance", "Conformance attestation", "conformance checker", "attestation", "later"),
  ];
}

// What an artifact still to come holds once its stage makes it (the demo moves builds along).
const WHEN_MADE = {
  "pj-package": { version: "0.1.0", digest: "sha256:4f1c9a0e7b3d2256", summary: { file: "palindrome-judge-0.1.0.tar.gz", digest: "sha256:4f1c9a0e7b3d2256", validated: true } },
  "pj-record": { version: "signed", summary: { words: "Names who held each stage, including your coding agent at Code, and the digest of the package it records." } },
  "pj-runplan": { version: "v1", summary: runPlan() },
  "pj-attest": { version: "conforms", summary: { words: "It does what it declared and nothing it refused: 14 checks against the running agent, none failed." } },
};

function runPlan() {
  return {
    stages: [
      { stage: "monitor", name: "Monitor", holder: "Datadog watcher", settings: "every 5 minutes", reads: "chosen" },
      { stage: "eval", name: "Eval", holder: null, settings: "", reads: "not chosen" },
      { stage: "incident", name: "Incident response", holder: "incident recorder", settings: "opens on 3 failed checks", reads: "chosen" },
      { stage: "cost", name: "Cost", holder: "Datadog watcher", settings: "daily, cap 10 USD", reads: "chosen" },
      { stage: "update", name: "Update", holder: "deployment manager", settings: "your approval", reads: "chosen" },
      { stage: "rollback", name: "Rollback", holder: "deployment manager", settings: "on a failed update", reads: "chosen" },
      { stage: "decommission", name: "Decommission", holder: "deployment manager", settings: "your approval", reads: "chosen" },
    ],
  };
}

/** lunch-poll's artifacts: every one made, in a finished build. */
export function lunchPollArtifacts(end) {
  const at = (mins) => new Date(Date.parse(end) - mins * 60_000).toISOString();
  const A = (id, stage, name, by, kind, mins, extra) => ({ id, stage, name, by, kind, state: "made", at: at(mins), ...extra });
  return [
    A("lp-spec", "requirements", "Spec", "spec writer", "spec", 400, { version: "v2", summary: {
      product: "lunch-poll 1.0.0", purpose: "Runs the team's lunch poll each day and names the winner.",
      features: [
        { id: "F1", name: "Run the poll", does: "Posts today's choices to the team channel and collects votes until 11:30.", offering: "Run the poll",
          requirements: [{ id: "F1.R1", shall: "The agent shall stop counting votes at 11:30.", kind: "limit", exact: ["11:30"] }, { id: "F1.R2", shall: "The agent shall post only to the team channel.", kind: "refusal" }],
          acceptance: [{ id: "F1.A1", gherkin: "Scenario: a late vote\n  Given the poll is open\n  When a vote comes at 11:31\n  Then it is not counted" }] },
        { id: "F2", name: "Announce the winner", does: "Names the place with the most votes, and breaks a tie by the earliest vote.", offering: "Announce the winner",
          requirements: [{ id: "F2.R1", shall: "The agent shall break a tie by the earliest vote.", kind: "order" }],
          acceptance: [{ id: "F2.A1", gherkin: "Scenario: a tie\n  Given two places with 3 votes each\n  When the winner is named\n  Then it is the place voted for first" }] },
      ],
      interfaces: [], constraints: [], systems: ["The team channel (write): where the poll and the winner are posted."], settings: [], price: "free", open: [],
    } }),
    A("lp-design", "architecture", "Design", "solution architect", "architecture", 380, { version: "v1", summary: { words: "Two steps: a program posts the poll and counts the votes; a second program announces the winner at 11:30. It reaches only the team channel." } }),
    A("lp-suite", "test", "The suite", "test writer", "suite", 330, { version: "22 tests", summary: { count: 22, tests: ["the poll lists today's choices", "a second vote from the same person replaces the first", "a tie goes to the earliest vote", "votes after 11:30 are not counted", "it never posts outside the team channel", "an empty poll says nobody voted"] } }),
    A("lp-programs", "code", "The programs", "code writer", "programs", 250, { version: "a41e9c2", summary: { scripts: [{ path: "scripts/poll.mjs", lines: 96, does: "posts the choices and counts the votes" }, { path: "scripts/announce.mjs", lines: 41, does: "names the winner" }], commit: "a41e9c2" } }),
    A("lp-findings", "review", "Review findings", "code critic", "findings", 230, { version: "on a41e9c2", summary: { open: [], verdict: "Nothing open.", outside: [{ place: "scripts/announce.mjs:12", claim: "The winner line could name the vote count too." }] } }),
    A("lp-security", "security", "Security record", "security reviewer", "security", 220, { version: "on a41e9c2", summary: { reach: ["the team channel"], spend: "nothing", never: ["read a credential it was not given", "post outside the team channel"], verdict: "passed" } }),
    A("lp-package", "package", "The package", "package maker", "package", 200, { version: "1.0.0", digest: "sha256:0b7d2e91c4f8a355", summary: { file: "lunch-poll-1.0.0.tar.gz", digest: "sha256:0b7d2e91c4f8a355", validated: true } }),
    A("lp-record", "release", "Signed build record", "package maker", "build_record", 190, { version: "signed", summary: { words: "Names who held each stage and the digest of the package it records." } }),
    A("lp-runplan", "deploy", "Run plan", "deployment manager", "run_plan", 120, { version: "v1", summary: { stages: [
      { stage: "monitor", name: "Monitor", holder: "watcher", settings: "every minute from 10:00 to 12:00", reads: "chosen" },
      { stage: "eval", name: "Eval", holder: null, settings: "", reads: "not used" },
      { stage: "incident", name: "Incident response", holder: "incident recorder", settings: "opens when a poll is not posted by 10:05", reads: "chosen" },
      { stage: "cost", name: "Cost", holder: "watcher", settings: "weekly", reads: "chosen" },
      { stage: "update", name: "Update", holder: "deployment manager", settings: "your approval", reads: "chosen" },
      { stage: "rollback", name: "Rollback", holder: "deployment manager", settings: "on a failed update", reads: "chosen" },
    ] } }),
    A("lp-attest", "conformance", "Conformance attestation", "conformance checker", "attestation", 60, { version: "conforms", summary: { words: "It does what it declared and nothing it refused." } }),
  ];
}

/** After an action: an artifact still to come is made once its stage is done; the first still to come is next. */
export function settleArtifacts(b) {
  if (!Array.isArray(b.artifacts)) return;
  const stageState = new Map(b.stages.map((s) => [s.stage, s.state]));
  let next = false;
  b.artifacts = b.artifacts.map((a) => {
    if ((a.state === "next" || a.state === "later") && stageState.get(a.stage) === "done") return { ...a, ...(WHEN_MADE[a.id] ?? {}), state: "made", at: now() };
    return a;
  }).map((a) => {
    if (a.state !== "next" && a.state !== "later") return a;
    const s = next ? "later" : "next";
    next = true;
    return { ...a, state: s };
  });
}

// What each stage reads from the stages before it, by the kind of artifact.
const READS = {
  architecture: ["spec"], test: ["spec", "statement"], code: ["spec", "statement", "architecture", "suite"],
  review: ["spec", "suite", "programs"], security: ["spec", "programs"], package: ["statement", "programs"],
  release: ["package"], deploy: ["package", "build_record"], conformance: ["spec", "package"], acceptance: ["spec", "package"],
  docs: ["spec", "package"],
};

// ---------- chats ----------

/** palindrome-judge's chats, by stage: the request and its answers, the questions asked, the pushes on the pull request. */
export function palindromeChats(b) {
  const v = { build: b.id, version: b.version };
  const me = (id, at, stage, text) => ({ id, at: t(at), from: { kind: "person", name: "you", stage }, to: { role: "x" }, text, ...v });
  const ag = (id, at, name, role, stage, text, attachments) => ({ id, at: t(at), from: { kind: "agent", name, role, stage }, text, ...(attachments ? { attachments } : {}), ...v });
  const sys = (id, at, stage, text) => ({ id, at: t(at), from: { kind: "system", name: "Product Factory", stage }, text, ...v });
  const fix = (m, role) => { if (m.to) m.to = { role }; return m; };
  const sw = (id, at, text, att) => ag(id, at, "Spec writer", "spec-writer", "requirements", text, att);
  return {
    requirements: [
      { id: "pj-r0", at: t("14:52"), from: { kind: "person", name: "you", stage: "requirements" }, text: "Say whether a sentence is a palindrome, ignoring spaces, punctuation and letter case. Reply yes or no.", ...v },
      sw("pj-r1", "14:56", "Here's the spec: one offering, Judge a sentence. It takes one sentence and replies yes or no.\n\nTwo things I won't guess: what should it be called, and what's the price?", ["pj-spec"]),
      fix(me("pj-r2", "14:58", "requirements", "Say which letters it compared, not only yes or no."), "spec-writer"),
      sw("pj-r3", "15:02", "Done: the reply now carries the letters it compared. Still open: its name and its price.", ["pj-spec"]),
      fix(me("pj-r4", "15:04", "requirements", "Call it palindrome-judge. It's free."), "spec-writer"),
      sw("pj-r5", "15:04", "Done. Nothing is left open.", ["pj-spec"]),
      sys("pj-r6", "15:05", "requirements", "You approved the spec."),
    ],
    architecture: [
      ag("pj-a1", "15:02", "Spec writer", "spec-writer", "architecture", "One step, a program: scripts/judge.mjs takes the sentence and hands back the verdict. It reaches nothing, so there is no system to bind anywhere.", ["pj-design"]),
    ],
    test: [
      sys("pj-t0", "15:06", "test", "The test writer was asked, with the approved spec and the agent's own files, and nothing else."),
      ag("pj-t1", "15:10", "Test writer", "test-writer", "test", "14 tests in 2 files, written from the approved spec before any code. They all failed against empty stand-ins, so the suite can tell a real script from nothing.", ["pj-suite"]),
      fix(me("pj-t2", "15:11", "test", "Does it count digits as letters?"), "test-writer"),
      ag("pj-t3", "15:11", "Test writer", "test-writer", "test", "Yes. \"digits count as letters\" checks that 12321 is a yes, in test/judge.test.mjs."),
    ],
    code: [
      { ...sys("pj-c0", "15:12", "code", "The build folder went to pull request #5 on AgentMesh-Dev-Test/handoff-proof for your coding agent."), link: PR },
      ag("pj-c1", "15:19", "Claude Code", "code-writer", "code", "Pushed c5a1e02."),
      sys("pj-c2", "15:19", "code", "3 tests failed: punctuation is ignored, digits count as letters, accented capitals are lowered. Sent back to your coding agent."),
      ag("pj-c3", "15:27", "Claude Code", "code-writer", "code", "Pushed b2f9d10. All 14 tests pass."),
      sys("pj-c4", "15:29", "code", "The code critic refused b2f9d10: an empty sentence says yes, so a message of only punctuation is called a palindrome. Sent back as a comment on the pull request."),
      ag("pj-c5", "15:38", "Claude Code", "code-writer", "code", "Pushed 0da3161. An empty sentence is now a no, with nothing to compare. All 14 tests pass.", ["pj-programs"]),
      sys("pj-c6", "15:41", "code", "The check says ready for your OK: the code critic left nothing open and the security reviewer passed it."),
    ],
    review: [
      ag("pj-v1", "15:29", "Code critic", "code-critic", "review", "One finding open on b2f9d10: scripts/judge.mjs line 4. An empty sentence says yes, so a message of only punctuation is called a palindrome. Back to Code."),
      ag("pj-v2", "15:40", "Code critic", "code-critic", "review", "Nothing open on 0da3161. One thing noted and left: accented letters are compared as they are, and the spec does not decide it.", ["pj-findings"]),
    ],
    security: [
      ag("pj-s1", "15:41", "Security reviewer", "security-reviewer", "security", "It passes: it reaches nothing, reads no credential, and grants nothing.", ["pj-security"]),
    ],
  };
}

/** A chat made from a build's own record, for builds with no written chat: the request, then the stage's rounds. */
export function chatFromRecord(b, stage) {
  const s = b.stages.find((x) => x.stage === stage);
  if (!s) return [];
  const v = { build: b.id, version: b.version };
  const out = [];
  if (used(b)[0]?.stage === stage) out.push({ id: `${b.id}-${stage}-req`, at: b.lifecycle?.at ?? now(), from: { kind: "person", name: "you", stage }, text: b.does, ...v });
  const name = agentName(s) || DEF.get(stage)?.name || stage;
  const made = (b.artifacts ?? []).filter((a) => a.stage === stage && a.state === "made").map((a) => a.id);
  const rounds = [...(s.rounds ?? [])].reverse();
  rounds.forEach((r, i) => out.push({
    id: `${b.id}-${stage}-r${r.n}`, at: r.at, from: { kind: "agent", name, stage }, text: `${r.label}: ${r.verdict}.${r.words ? ` ${r.words}` : ""}`,
    ...(i === rounds.length - 1 && made.length ? { attachments: made } : {}), ...v,
  }));
  if (!rounds.length && s.state === "done") {
    const words = (s.handed_back?.words ?? []).join(" ") || `${DEF.get(stage)?.name ?? stage} is done.`;
    out.push({ id: `${b.id}-${stage}-done`, at: s.log?.[0]?.at ?? b.lifecycle?.at ?? now(), from: { kind: "agent", name, stage }, text: words, ...(made.length ? { attachments: made } : {}), ...v });
  }
  return out;
}

// ---------- the routes ----------

/** The words for where a build is, as the build list says it. */
function latestOf(list) {
  return list.filter((b) => !b.archived).at(-1) ?? list.at(-1);
}

/** cadence (0.4.2): product(builds, newest first) gives { setup, when_needed }; carried(b, stage) a setup stage carried forward, or null. */
export function createStageRoutes({ builds, summary, words, cadence = null }) {
  const chats = new Map(); // `${product}\n${stage}` -> messages kept beside what each build's record says
  const answers = new Map(); // build id -> [{ stage, action, at }]
  let seq = 0;
  const key = (product, stage) => `${product}\n${stage}`;

  function seed(b, byStage) {
    for (const [stage, ms] of Object.entries(byStage)) chats.set(key(productOf(b), stage), ms);
  }
  const productBuilds = (name) => [...builds.values()].filter((b) => productOf(b) === name);

  function chatFor(name, stage) {
    const k = key(name, stage);
    if (chats.has(k)) return chats.get(k);
    const out = productBuilds(name).flatMap((b) => chatFromRecord(b, stage));
    chats.set(k, out);
    return out;
  }

  function stageWords(b, s, said) {
    chatFor(productOf(b), s.stage).push({ id: `sys${++seq}`, at: now(), from: { kind: "system", name: "Product Factory", stage: s.stage }, text: said, build: b.id, version: b.version });
  }

  function answered(b, stage, action) {
    if (!answers.has(b.id)) answers.set(b.id, []);
    answers.get(b.id).push({ stage, action, at: now() });
  }

  const standing = (b) => {
    const st = summary(b).at.state;
    return ["waiting_on_you", "refused", "stopped", "done"].includes(st) ? st : "working";
  };
  const newestFirst = (list) => [...list].reverse();

  function products() {
    const names = [...new Set([...builds.values()].map(productOf))];
    return {
      products: names.map((name) => {
        const list = productBuilds(name);
        const latest = latestOf(list);
        return { name, latest: { build: latest.id, version: latest.version, state: standing(latest), at: summary(latest).at }, versions: newestFirst(list).map((b) => b.version), ...(list.every((b) => b.archived) ? { archived: true } : {}) };
      }).filter((p) => !p.archived).map(({ archived, ...p }) => p),
    };
  }

  function product(name) {
    const list = productBuilds(name);
    if (!list.length) return null;
    const latest = latestOf(list);
    const plan = (latest.artifacts ?? []).find((a) => a.kind === "run_plan" && a.state === "made");
    // One line per stage event: what the log said, and each round's verdict.
    const activity = list.flatMap((b) => b.stages.flatMap((s) => [
      ...(s.log ?? []).map((e) => ({ at: e.at, build: b.id, version: b.version, stage: s.stage, words: e.said })),
      ...(s.rounds ?? []).map((r) => ({ at: r.at, build: b.id, version: b.version, stage: s.stage, words: `${agentName(s) || "The holder"}: ${r.verdict.toLowerCase()}${r.words ? `. ${r.words}` : "."}` })),
    ])).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 40);
    return {
      name,
      builds: newestFirst(list).map((b) => ({ id: b.id, version: b.version, state: standing(b), at: summary(b).at, ...(b.lifecycle?.at ? { created: b.lifecycle.at } : {}) })),
      ...(plan ? { run_plan: { build: latest.id, version: latest.version, at: plan.at ?? null, summary: plan.summary, files: plan.files ?? [] } } : {}),
      activity,
      ...(cadence ? cadence.product(newestFirst(list)) : {}),
    };
  }

  // A product's documents (0.4.11): one per stage of stages.json that names an asset, in its order, each
  // with the copy that stands now (the newest build's made artifact at that stage, whichever version made it)
  // and every version that made one, newest first.
  function documents(name) {
    const list = productBuilds(name);
    if (!list.length) return null;
    const newest = newestFirst(list);
    return {
      product: name,
      documents: DOC.stages.filter((d) => typeof d.asset === "string" && d.asset).map((d) => {
        // One copy per build: the made artifact at the stage whose kind is the stage's asset, else the last one made there.
        const made = newest.flatMap((b) => {
          const at = (b.artifacts ?? []).filter((a) => a.stage === d.id && a.state === "made");
          const a = at.find((x) => ASSET_KIND[d.id]?.includes(x.kind)) ?? at.at(-1);
          return a ? [{ build: b.id, version: b.version, artifact: a }] : [];
        });
        const cur = made[0] ?? null;
        const st = newest[0].stages.find((s) => s.stage === d.id)?.state;
        const state = cur ? "made" : st === "not_used" ? "not_used" : "not_made";
        return {
          stage: d.id, name: d.asset, cadence: d.cadence ?? "every_build", state,
          current: cur ? { build: cur.build, version: cur.version, artifact: cur.artifact, carried: cur.build !== newest[0].id } : null,
          history: made.map((m) => ({ build: m.build, version: m.version, artifact: m.artifact.id, ...(m.artifact.at ? { at: m.artifact.at } : {}) })),
          ...(state === "not_used" ? { words: `The lifecycle leaves ${d.name} out.` } : state === "not_made" ? { words: `${d.name} has not made it yet.` } : {}),
        };
      }),
    };
  }

  function workspace(b, stage) {
    const s = b.stages.find((x) => x.stage === stage);
    if (!s || OFF.has(s.state)) return null;
    const arts = b.artifacts ?? [];
    const reads = READS[stage] ?? [];
    // Given: only what the earlier stages have made.
    const given = arts.filter((a) => reads.includes(a.kind) && a.stage !== stage && a.state === "made").map((a) => a.id);
    const live = b.actions.filter((a) => a.stage === stage);
    const last = (answers.get(b.id) ?? []).filter((x) => x.stage === stage).at(-1);
    let gate;
    if (live.length) gate = { actions: live.map((a) => a.name), state: "open", who_may: "you" };
    else if (last) gate = { actions: [last.action], state: "answered", answered: { by: "you", at: last.at, action: last.action }, who_may: "you" };
    else if (s.state === "done" && DEF.get(stage)?.person_gate) {
      const at = s.rounds?.[0]?.at ?? s.log?.[0]?.at ?? b.lifecycle?.at;
      const action = stage === "code" || stage === "acceptance" ? "accept" : "approve";
      gate = { actions: [action], state: "answered", answered: { by: "you", at, action }, who_may: "you" };
    }
    return {
      stage, name: DEF.get(stage)?.name ?? stage, state: s.state, holder: holderWithSkills(s.holder), given,
      outputs: arts.filter((a) => a.stage === stage),
      ...(gate ? { gate } : {}),
      done_when: DEF.get(stage)?.done_when ?? "",
      cadence: DEF.get(stage)?.cadence ?? "every_build",
      ...(cadence?.carried(b, stage) ? { carried: cadence.carried(b, stage) } : {}),
    };
  }

  // The agent answers in plain words from what the stage read and made; a change request
  // proposes the build's own action for that stage, which the person confirms. Nothing changes here.
  function reply(b, s, text) {
    const arts = b.artifacts ?? [];
    const outs = arts.filter((a) => a.stage === s.stage && a.state === "made");
    const name = agentName(s);
    const live = b.actions.filter((a) => a.stage === s.stage);
    // A question is answered; a sentence asking for something different is a change request.
    const change = !/\?\s*$/.test(text) && /\b(change|should|instead|make it|add|remove|rather|wrong|fix|please)\b/i.test(text);
    const base = { id: `m${++seq}`, at: now(), from: { kind: "agent", name, stage: s.stage }, build: b.id, version: b.version };
    if (change) {
      const pick = live.find((a) => a.name === "back_to_test" && /\btests?\b|suite/i.test(text))
        ?? live.find((a) => a.name === "send_back" || a.name === "changes");
      if (pick) {
        return { ...base, text: `I can make that change. Confirm it below and it goes back through ${DEF.get(s.stage)?.name ?? s.stage}'s gate as "${pick.label}". Until you confirm, nothing changes.`, proposes: { action: pick.name, needs: { words: text } } };
      }
      const at = b.stages.find((x) => x.state === "waiting_on_you" || x.state === "working");
      return { ...base, text: `${DEF.get(s.stage)?.name ?? s.stage} is ${s.state === "done" ? "done" : "not open for changes now"}, so I can't change it from here.${at ? ` The build is at ${DEF.get(at.stage)?.name ?? at.stage}: say it there and it goes back through that gate.` : " A change now starts a new version."}` };
    }
    const suite = arts.find((a) => a.kind === "suite" && a.state === "made");
    if (/\btests?\b|suite/i.test(text) && suite) {
      return { ...base, text: `The suite has ${suite.summary?.count ?? "its"} tests. Among them: ${(suite.summary?.tests ?? []).slice(0, 3).join("; ")}.`, attachments: [suite.id] };
    }
    return { ...base, text: outs.length ? `I answer from what this stage read and made: ${outs.map((a) => a.name.toLowerCase()).join(", ")}. Ask about any line of it, or say what should change.` : `Nothing is made here yet. When ${DEF.get(s.stage)?.name ?? s.stage} runs, I'll answer from what it makes.`, ...(outs.length ? { attachments: outs.map((a) => a.id) } : {}) };
  }

  function post(name, stage, body) {
    const text = String(body?.text ?? "").trim();
    if (!text) return { status: 400, body: { error: "Say something to send." } };
    const list = productBuilds(name);
    const b = body?.build ? list.find((x) => x.id === body.build) : latestOf(list);
    if (!b) return { status: 400, body: { error: "That build is not one of this product's." } };
    const s = b.stages.find((x) => x.stage === stage);
    if (!s || OFF.has(s.state)) return { status: 400, body: { error: "This build does not use that stage." } };
    if (!s.holder) return { status: 400, body: { error: "Nobody holds this stage yet, so there is no agent to answer." } };
    if (s.holder.kind === "person") return { status: 400, body: { error: "A person holds this stage, so there is no agent here to answer." } };
    if (s.holder.kind === "outside_tool") return { status: 400, body: { error: `${s.holder.name} is an outside tool. It hands in evidence, and does not answer here.` } };
    const message = { id: `m${++seq}`, at: now(), from: { kind: "person", name: "you", stage }, to: { role: roleIdOf(s) }, text, build: b.id, version: b.version };
    const r = reply(b, s, text);
    const chat = chatFor(name, stage);
    // The proposal is answered as it is made; the chat keeps it too, so a reload still shows the button.
    chat.push(message, r);
    return { status: 200, body: { message, reply: r } };
  }

  return {
    seed, stageWords, answered, products, product, documents, workspace, post,
    /** A message another part of the demo posts into a stage's chat, such as the boss's (demo-boss.mjs). */
    push: (name, stage, m) => { chatFor(name, stage).push(m); },
    messages: (name, stage) => ({ messages: chatFor(name, stage) }),
  };
}
