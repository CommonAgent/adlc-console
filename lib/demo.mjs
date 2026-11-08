// A stand-in lifecycle service for --demo. It answers the same paths, with
// the same shapes, as a real service (docs/contract.md), from memory, so the
// page can be shown and worked on with no service and no key.
//
// It is not a lifecycle: it moves the demo builds along just enough to show
// what each button does.

import { readFileSync } from "node:fs";
import { palindromeJudge, palindromeTries, tallyWords, wordTally, expenseCheck, boardBuilds, blankStage, leaveOut, judge, STAGE_IDS, FIXTURE_FILES } from "./fixture.mjs";

const now = () => new Date().toISOString();
const DOC = JSON.parse(readFileSync(new URL("../standards/stages.json", import.meta.url), "utf8"));
const ROLES = DOC.roles ?? [];
const FORMATS = new Set((DOC.evidence_formats ?? []).map((f) => f.id));
const KINDS = ["reference_agent", "your_agent", "contracted", "person", "outside_tool"];

const NAMES = { architecture: "Architecture and Design", security: "Security review", incident: "Incident response" };
const nameOf = (id) => NAMES[id] ?? id[0].toUpperCase() + id.slice(1);

// The stage a build is at. With nothing waiting, working, stopped or refused,
// it is the next stage to start after the last one done; a build with none
// left to start is at the last one done, where it finished.
function liveStage(b) {
  const last = b.stages.findLastIndex((s) => s.state === "done");
  return b.stages.find((s) => s.state === "waiting_on_you")
    ?? b.stages.find((s) => s.state === "working" || s.state === "stopped" || s.state === "refused")
    ?? (last >= 0 ? b.stages.slice(last + 1).find((s) => s.state === "not_started") ?? b.stages[last] : null)
    ?? b.stages[0];
}

// Where a build ended, or where it is, in words (the contract's summary).
function words(b) {
  const at = (id) => b.stages.find((s) => s.stage === id);
  if (at("deploy")?.state === "done") {
    if (b.paused) return "Installed · paused: failed conformance";
    const c = at("conformance")?.state;
    return c === "done" ? "Installed · conforms" : c === "refused" ? "Installed · fails conformance" : "Installed · not checked for conformance yet";
  }
  const live = liveStage(b);
  const n = nameOf(live.stage);
  return { waiting_on_you: `Waiting on you at ${n}`, working: `Working at ${n}`, stopped: `Stopped at ${n}`, refused: `Refused at ${n}`, done: `${n} done`, not_started: `${n} not started yet` }[live.state] ?? "Not started";
}

// A build as the service answers it, with the fields added in 0.1.
const view = (b) => ({ ...b, summary: words(b), paused: b.paused ?? null, archived: Boolean(b.archived) });

function summary(b) {
  const live = liveStage(b);
  const updated = b.log[0]?.at ?? now();
  return { id: b.id, name: b.name, does: b.does, version: b.version, at: { stage: live.stage, state: live.state, summary: words(b) }, archived: Boolean(b.archived), updated };
}

function slug(words) {
  return String(words).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).join("-") || "new-agent";
}

// Who holds each role: bindings for the organization, and per project, as the
// lifecycle API 0.2 answers them (GET, PUT and DELETE /v1/lifecycle/roles).
function createRoles() {
  const org = new Map();
  const projects = new Map();
  const bound = (role, holder, scope, at) => ({ role, holder, scope, since: at, by: "jeff@example.com" });
  org.set("security-reviewer", bound("security-reviewer", { kind: "outside_tool", name: "The scanner in our CI", evidence: { formats: ["sarif"], where: "The CI run's saved files" } }, { org: true }, "2026-11-01T15:00:00Z"));
  // The approved mock's example: your own coding agent at Code, your own watcher at Monitor and Cost.
  org.set("code-writer", bound("code-writer", { kind: "your_agent", name: "Claude Code", handle: "claude-code.eng@example.com" }, { org: true }, "2026-10-30T12:00:00Z"));
  org.set("watcher", bound("watcher", { kind: "your_agent", name: "Datadog watcher", handle: "datadog-watcher.ops@example.com", evidence: { formats: ["otel-genai"], where: "https://ops.example.com/traces" } }, { org: true }, "2026-10-30T12:00:00Z"));
  org.set("package-maker", bound("package-maker", { kind: "contracted", name: "Harbor Builds", handle: "builds.harbor@example.com", evidence: { formats: ["cyclonedx", "slsa"], where: "https://harbor.example.com/builds" } }, { org: true }, "2026-11-01T15:02:00Z"));
  projects.set("finance", new Map([
    ["test-writer", bound("test-writer", { kind: "your_agent", name: "Our test writer", handle: "test-writer.finance@example.com" }, { project: "finance" }, "2026-11-01T15:05:00Z")],
    ["code-writer", bound("code-writer", { kind: "your_agent", name: "Our finance coder", handle: "coder.finance@example.com" }, { project: "finance" }, "2026-11-01T15:05:00Z")],
  ]));

  // The demo's reference agent for a role, as a Holder (a Lane note on INTERFACE.md), or null.
  const refHolder = (r) => (r.reference_agent ? { kind: "reference_agent", name: r.reference_agent, handle: `${r.reference_agent}.platform@agentmesh.ai` } : null);
  // binding is null exactly when from is unbound; a default binding carries only role and holder.
  function effective(r, project) {
    if (r.id === "requester") return { binding: { role: r.id, holder: { kind: "person", name: "the person who asked" } }, from: "default" };
    const p = project ? projects.get(project)?.get(r.id) : null;
    if (p) return { binding: p, from: "project" };
    const o = org.get(r.id);
    if (o) return { binding: o, from: "org" };
    const ref = refHolder(r);
    return ref ? { binding: { role: r.id, holder: ref }, from: "default" } : { binding: null, from: "unbound" };
  }
  const answer = (project) => ({
    roles: ROLES.map((r) => ({ role: r.id, name: r.name, contract: r.contract, offering: r.offering, stages: r.stages, ...effective(r, project), reference_agent: refHolder(r) })),
  });

  // What PUT refuses, in the words the page shows as they are.
  function refuse(r, holder) {
    if (!r) return "There is no role by that name.";
    if (!holder || typeof holder !== "object" || !KINDS.includes(holder.kind)) return "Say who holds it: our reference agent, your own agent, a contracted supplier, a person or an outside tool.";
    if (r.id === "requester" && holder.kind !== "person") return "The requester is always the person who asked, so it cannot be given to anything else.";
    if (holder.kind === "reference_agent" && !r.reference_agent) return "The demo runs no reference agent for this role.";
    if (!String(holder.name ?? "").trim()) return "Give it a name people will know.";
    if ((holder.kind === "your_agent" || holder.kind === "contracted") && !String(holder.handle ?? "").trim()) {
      return holder.kind === "your_agent" ? "Give your agent's handle on the mesh, so the stage's work can be sent to it." : "Give the supplier's handle on the mesh, so the stage's work can be sent to it.";
    }
    const formats = holder.evidence?.formats ?? [];
    if (!Array.isArray(formats) || formats.some((f) => !FORMATS.has(f))) return "The demo cannot read evidence in one of those formats.";
    return null;
  }

  return {
    answer,
    handle(method, role, project, body) {
      if (!role) return method === "GET" ? { status: 200, body: answer(project) } : { status: 405, body: { error: "Not allowed." } };
      const r = ROLES.find((x) => x.id === role);
      if (method === "GET") return r ? { status: 200, body: answer(project) } : { status: 400, body: { error: "There is no role by that name." } };
      const scope = project ? (projects.get(project) ?? projects.set(project, new Map()).get(project)) : org;
      if (method === "DELETE") {
        if (!r) return { status: 400, body: { error: "There is no role by that name." } };
        scope.delete(r.id);
        return { status: 200, body: answer(project) };
      }
      if (method === "PUT") {
        const why = refuse(r, body?.holder);
        if (why) return { status: 400, body: { error: why } };
        const h = body.holder;
        const holder = { kind: h.kind, name: String(h.name).trim() };
        if (h.handle && h.kind !== "person" && h.kind !== "outside_tool") holder.handle = String(h.handle).trim();
        if (h.evidence) holder.evidence = { formats: h.evidence.formats ?? [], ...(h.evidence.where ? { where: String(h.evidence.where) } : {}) };
        if (r.id !== "requester") scope.set(r.id, { role: r.id, holder, scope: project ? { project } : { org: true }, since: now(), by: "you" });
        return { status: 200, body: answer(project) };
      }
      return { status: 405, body: { error: "Not allowed." } };
    },
  };
}

// Which stages the lifecycle uses, for the organization and per project, as
// the lifecycle API 0.3 answers them (GET, PUT and DELETE /v1/lifecycle/stages).
// Whether a stage may be left out is the demo's own answer, standing in for a
// service's; the console only draws it.
const NEEDED = {
  requirements: "Every later stage works from the spec Requirements writes; this service cannot build without it.",
  test: "Code is written to Test's suite; this service cannot build without it.",
  code: "Code writes the scripts the build is for; this service cannot build without it.",
  package: "Release, Deploy and Conformance work from the package; this service cannot build without it.",
  release: "Deploy installs the signed build record Release makes; this service cannot build without it.",
  deploy: "Conformance and Acceptance check the installed agent; this service cannot build without it.",
  acceptance: "A build ends when the person who asked accepts it; this service cannot build without it.",
};
function createStages() {
  const choice = (used, at) => ({ used, at, by: "jeff@example.com" });
  // The approved mock's example: Impact, Source, Retract and Reconfigure left out.
  const org = new Map(["impact", "source", "retract", "reconfigure"].map((id) => [id, choice(false, "2026-10-30T12:00:00Z")]));
  // The finance project uses Impact again, and leaves out Eval.
  const projects = new Map([["finance", new Map([["impact", choice(true, "2026-10-30T12:10:00Z")], ["eval", choice(false, "2026-10-30T12:10:00Z")]])]]);

  function entry(d, project) {
    const p = project ? projects.get(project)?.get(d.id) : null;
    const o = org.get(d.id);
    const c = p ?? o ?? null;
    const fixed = d.id in NEEDED;
    const e = { stage: d.id, name: d.name, phase: d.phase, roles: d.role_ids ?? [], used: fixed ? true : c ? c.used : true, from: p ? "project" : o ? "org" : "default", can_leave_out: !fixed };
    if (fixed) e.why_not = NEEDED[d.id];
    return e;
  }
  function answer(project) {
    const read = [...org.values(), ...(project ? projects.get(project)?.values() ?? [] : [])].map((c) => c.at).sort();
    return { project: project ?? null, stages: DOC.stages.map((d) => entry(d, project)), ...(read.length ? { updated_at: read.at(-1) } : {}) };
  }
  /** The stage ids a build started now under this project leaves out. */
  const unused = (project) => answer(project).stages.filter((s) => !s.used).map((s) => s.stage);

  return {
    answer, unused,
    handle(method, stage, project, body) {
      if (!stage) return method === "GET" ? { status: 200, body: answer(project) } : { status: 405, body: { error: "Not allowed." } };
      const d = DOC.stages.find((x) => x.id === stage);
      if (!d) return { status: 400, body: { error: "There is no stage by that name." } };
      if (method === "GET") return { status: 200, body: answer(project) };
      const scope = project ? (projects.get(project) ?? projects.set(project, new Map()).get(project)) : org;
      if (method === "DELETE") { scope.delete(d.id); return { status: 200, body: answer(project) }; }
      if (method === "PUT") {
        if (typeof body?.used !== "boolean") return { status: 400, body: { error: "Say whether the lifecycle uses the stage." } };
        if (!body.used && d.id in NEEDED) return { status: 400, body: { error: NEEDED[d.id] } };
        scope.set(d.id, { used: body.used, at: now(), by: "you" });
        return { status: 200, body: answer(project) };
      }
      return { status: 405, body: { error: "Not allowed." } };
    },
  };
}

export function createDemoService() {
  const builds = new Map();
  const tries = new Map();
  const roles = createRoles();
  const lifecycle = createStages();
  // The made-up builds the Board spreads across its phases.
  const board = boardBuilds();
  for (const b of [palindromeJudge(), tallyWords(), wordTally(), expenseCheck(), ...board]) builds.set(b.id, b);
  for (const b of board) tries.set(b.id, []);
  // Their past: rounds at each stage they ran, and a timeline, for the Dashboard.
  board.forEach((b, i) => withHistory(b, i));
  // Its run, one bar per step per round (build.timeline, contract 0.1).
  builds.get("b_palindrome_judge").timeline = demoTimeline();
  tries.set("b_palindrome_judge", palindromeTries());
  tries.set("b_tally_words", []);
  tries.set("b_word_tally", []);
  let seq = 0;

  const json = (status, body) => ({ status, type: "application/json", body });
  const nope = (status, error) => json(status, { error });
  const stageOf = (b, id) => b.stages.find((s) => s.stage === id);
  const say = (b, s, said) => {
    const e = { at: now(), said };
    if (s) s.log.unshift(e);
    b.log.unshift(e);
  };

  function act(b, name, body) {
    const offered = b.actions.find((a) => a.name === name);
    if (!offered) return nope(409, "This build does not offer that now.");
    for (const n of offered.needs) {
      if (!String(body?.[n.name] ?? "").trim()) return nope(400, `${n.label} is needed.`);
    }
    const code = stageOf(b, "code");
    if (name === "accept") {
      code.state = "done";
      say(b, code, "You accepted the pull request.");
      for (const id of ["package", "release"]) {
        const s = stageOf(b, id);
        s.state = "done"; s.runs = 1; s.done_when_met = true;
        say(b, s, `${s.holder.name} finished ${id === "package" ? "the package" : "the signed build record"}.`);
      }
      const d = stageOf(b, "deploy");
      d.state = "waiting_on_you";
      say(b, d, "The install is waiting for your approval.");
      b.actions = [{ stage: "deploy", name: "approve", label: "Approve the install", needs: [] }, { stage: "deploy", name: "stop", label: "Stop", needs: [] }];
    } else if (name === "approve") {
      const d = stageOf(b, "deploy");
      d.state = "done"; d.runs = 1; d.done_when_met = true;
      say(b, d, `The agent is installed and answering as ${b.handle}.`);
      const c = stageOf(b, "conformance");
      c.state = "done"; c.runs = 1; c.done_when_met = true;
      say(b, c, "It conforms: it does what it declared and nothing it refused.");
      const a = stageOf(b, "acceptance");
      a.state = "waiting_on_you";
      b.actions = [];
    } else if (name === "stop") {
      const s = b.stages.find((x) => x.state === "waiting_on_you" || x.state === "working");
      if (s) { s.state = "stopped"; say(b, s, `You stopped the build at ${s.stage[0].toUpperCase() + s.stage.slice(1)}.`); }
      b.actions = [{ stage: s?.stage ?? "code", name: "resume", label: "Resume", needs: [] }, { stage: s?.stage ?? "code", name: "archive", label: "Archive", needs: [] }];
    } else if (name === "archive" || name === "unarchive") {
      b.archived = name === "archive";
      say(b, null, b.archived ? "You archived the build." : "You put the build back in the list.");
      b.actions = b.actions.map((x) => (x.name === name ? { ...x, name: b.archived ? "unarchive" : "archive", label: b.archived ? "Put back in the list" : "Archive" } : x));
    } else if (name === "resume") {
      const s = b.stages.find((x) => x.state === "stopped");
      if (s) { s.state = "waiting_on_you"; say(b, s, "You resumed the build."); }
      b.actions = s?.stage === "code" && s.where
        ? [{ stage: "code", name: "accept", label: "Accept the pull request", needs: [] }, { stage: "code", name: "stop", label: "Stop", needs: [] }]
        : [{ stage: s?.stage ?? "code", name: "stop", label: "Stop", needs: [] }];
    } else if (name === "changes") {
      const s = stageOf(b, offered.stage);
      s.state = "working";
      say(b, s, `You asked for changes: “${String(body.words).trim()}”`);
    }
    return json(200, { build: view(b) });
  }

  function create(body) {
    const does = String(body?.does ?? "").trim();
    if (!does) return nope(400, "Say what the agent should do.");
    const id = `b_new_${++seq}`;
    const name = String(body?.name ?? "").trim() || slug(does);
    const offered = new Set(["requirements", "architecture", "test", "code", "review", "security", "package", "release", "deploy", "conformance", "acceptance"]);
    const stages = STAGE_IDS.map((s) => (offered.has(s) ? blankStage(s, "not_started") : blankStage(s)));
    stages[0].state = "working";
    stages[0].holder = { kind: "reference_agent", name: "spec-writer" };
    stages[0].given = [does, body.refuses, body.more].filter((x) => x && String(x).trim()).join(" ");
    const b = { id, name, does, version: "0.1.0", handle: `${name}.example`, stages, actions: [{ stage: "requirements", name: "stop", label: "Stop", needs: [] }], log: [] };
    // StartRequest.project (0.2): the roles chosen for that project hold its stages.
    const project = String(body?.project ?? "").trim();
    if (project) b.project = project;
    // The build keeps the lifecycle in effect now (0.3): the stages it leaves out read not_used.
    b.lifecycle = { project: project || null, at: now() };
    b.stages = leaveOut(b.stages, lifecycle.unused(project || null), project || null);
    say(b, stages[0], "The spec writer was asked.");
    builds.set(id, b);
    tries.set(id, []);
    return json(201, { build: view(b) });
  }

  function tryIt(b, body) {
    const text = String(body?.say ?? "");
    if (!text.trim()) return nope(400, "Say what to send it.");
    const against = body?.against;
    if (against !== "pull_request" && against !== "installed") return nope(400, "Say whether to try the pull request or the installed agent.");
    if (against === "pull_request" && !b.stages.some((s) => s.where?.kind === "pull_request")) return nope(409, "There is no pull request to try.");
    if (against === "installed" && stageOf(b, "deploy")?.state !== "done") return nope(409, "The agent is not installed yet.");
    const t = { id: `t${Date.now().toString(36)}`, say: text, against, answer: judge(text), ms: 380 + (text.length % 60), at: now() };
    tries.get(b.id).unshift({ id: t.id, say: t.say, against, answer: t.answer, at: t.at, kept: false, sent_back: false });
    return json(200, { try: t });
  }

  return {
    kind: "demo", label: "the demo", readOnly: false, canTry: true, keyFrom: null,
    // method: "GET" | "POST"; path: the service path, e.g. /v1/lifecycle/builds/x
    async handle(method, path, query, body) {
      const parts = path.replace(/^\/v1\/lifecycle\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] === "roles" && parts.length <= 2) {
        const r = roles.handle(method, parts[1] ?? null, (query.get("project") ?? "").trim() || null, body);
        return json(r.status, r.body);
      }
      if (parts[0] === "stages" && parts.length <= 2) {
        const r = lifecycle.handle(method, parts[1] ?? null, (query.get("project") ?? "").trim() || null, body);
        return json(r.status, r.body);
      }
      // Analytics, as Product Factory answers it (outside the lifecycle API standard): made-up weeks.
      if (parts[0] === "analytics" && parts.length === 1) {
        if (method !== "GET") return nope(405, "Not allowed.");
        const w = query.get("window") || "30d";
        if (!(w in WINDOW_DAYS)) return nope(400, "window is 7d, 30d or all.");
        return json(200, demoAnalytics(w, (query.get("project") ?? "").trim() || null));
      }
      if (parts[0] !== "builds") return nope(404, "Nothing here.");
      if (parts.length === 1) {
        // Archived builds are listed only when asked for (?archived=1).
        if (method === "GET") return json(200, { builds: [...builds.values()].filter((b) => !b.archived || query.get("archived") === "1").map(summary) });
        if (method === "POST") return create(body);
        return nope(405, "Not allowed.");
      }
      const b = builds.get(parts[1]);
      if (!b) return nope(404, "There is no build with that id.");
      const rest = parts.slice(2);
      if (rest.length === 0 && method === "GET") return json(200, { build: view(b) });
      if (rest[0] === "files" && method === "GET") {
        const p = query.get("path");
        const known = b.stages.some((s) => s.handed_back.files.some((f) => f.path === p) || (s.evidence ?? []).some((e) => e.file?.path === p));
        if (!known || !(p in FIXTURE_FILES)) return nope(404, "There is no file at that path.");
        return { status: 200, type: "text/plain; charset=utf-8", body: FIXTURE_FILES[p] };
      }
      if (rest[0] === "actions" && rest[1] && method === "POST") return act(b, rest[1], body);
      if (rest[0] === "try" && method === "POST") return tryIt(b, body);
      if (rest[0] === "tries" && rest.length === 1 && method === "GET") return json(200, { tries: tries.get(b.id) });
      if (rest[0] === "tries" && rest[1] && method === "POST" && (rest[2] === "keep" || rest[2] === "wrong")) {
        const t = tries.get(b.id).find((x) => x.id === rest[1]);
        if (!t) return nope(404, "There is no try with that id.");
        if (rest[2] === "keep") {
          t.kept = true;
          say(b, stageOf(b, "test"), `“${t.say}” was kept as a test.`);
        } else {
          t.sent_back = true;
          const why = String(body?.why ?? "").trim();
          say(b, stageOf(b, "code"), `“${t.say}” went back to your coding agent${why ? `: ${why}` : ""}.`);
        }
        return json(200, { try: t });
      }
      return nope(404, "Nothing here.");
    },
  };
}

/** A made-up run: the architect beside the spec writer, the gate, the suite, two pushes on the pull request. */
function demoTimeline() {
  const t = (m) => new Date(Date.UTC(2026, 9, 31, 15, m)).toISOString();
  const bar = (stage, phase, round, holder, kind, a, b, status) => ({ phase, stage, round, holder, kind, start: t(a), end: b === null ? null : t(b), duration_ms: b === null ? null : (b - a) * 60_000, status });
  return [
    bar("architecture", "write-the-architecture", 1, "solution-architect.example", "agent", 0, 4, "closed"),
    bar("requirements", "write-the-spec", 1, "spec-writer.example", "agent", 0, 6, "closed"),
    bar("requirements", "approve-the-spec", 1, null, "person", 6, 15, "closed"),
    bar("test", "write-the-suite", 1, "test-writer.example", "agent", 15, 24, "closed"),
    bar("code", "write-the-scripts", 1, "you.example", "external", 24, null, "working"),
  ];
}

// ---------- made-up history for the Board's builds ----------

// Each stage's step in the run, the minutes its agent typically works, and,
// where a person signs off, that step and the minutes it typically waits.
const STEP = {
  requirements: ["write-the-spec", 6, "approve-the-spec", 38], architecture: ["write-the-architecture", 5],
  test: ["write-the-suite", 9], code: ["write-the-scripts", 24, "ok-the-code", 52], review: ["review-the-code", 7],
  security: ["review-security", 12], package: ["make-the-package", 4], release: ["sign-the-release", 3],
  deploy: ["install", 6, "approve-the-install", 22], conformance: ["check-conformance", 8], acceptance: [null, 0, "accept-it", 95],
  docs: ["write-the-docs", 7], publish: ["publish", 2], monitor: ["watch", 30], incident: ["record-the-incident", 14, "say-what-happened", 41],
  cost: ["count-the-cost", 5], update: ["install-the-update", 6], rollback: ["roll-back", 4],
};
// Where work tends to go back for another round, and why.
const BACK = {
  requirements: "The spec left the refusals open.", code: "Two tests in the suite still fail.", review: "The critic asked for smaller functions.",
  security: "The scripts read any file path they are sent.", conformance: "It answered a question it declared it refuses.",
};

/**
 * Gives a made-up build its past, the same every time: one or more rounds at
 * each stage it ran (back: true on the ones sent back) and a timeline, one bar
 * per step per round, ending when the build last moved (its log's newest time).
 * The stage it is at now ends in an open bar when it is working or waiting.
 */
function withHistory(b, seed) {
  const ran = b.stages.filter((s) => s.runs > 0 || s.state === "done");
  const vary = (k) => 0.55 + ((seed * 7 + k * 13) % 10) / 10; // 0.55 to 1.45
  const bars = [];
  let m = 0;
  ran.forEach((s, k) => {
    const [step, agentMin, gate, gateMin] = STEP[s.stage] ?? [s.stage, 5];
    const handle = s.holder?.kind === "reference_agent" ? `${s.holder.name}.platform@agentmesh.ai` : null;
    const live = s.state !== "done";
    const h = seed * 3 + k;
    const backs = BACK[s.stage] ? h % 7 === 0 ? 2 : h % 4 === 0 ? 1 : 0 : 0;
    const total = backs + 1;
    const rounds = [];
    for (let r = 1; r <= total; r++) {
      const last = r === total;
      if (step) {
        const len = Math.round(agentMin * vary(k + r));
        const open = last && live && s.state === "working";
        bars.push({ phase: step, stage: s.stage, round: r, holder: handle, kind: "agent", a: m, b: open ? null : m + len, status: open ? "working" : r < total ? "superseded" : s.state === "stopped" ? "stopped" : "closed" });
        if (open) break;
        m += len;
      }
      const refused = last && s.state === "refused";
      if (!last || refused) {
        rounds.push({ n: r, at: m, label: `Round ${r}`, verdict: refused ? "Refused" : "Sent back for another round", back: true, words: BACK[s.stage] });
        m += 1;
        continue;
      }
      if (gate) {
        const len = Math.round(gateMin * vary(k + 5));
        const open = live && s.state === "waiting_on_you";
        bars.push({ phase: gate, stage: s.stage, round: r, holder: null, kind: "person", a: m, b: open ? null : m + len, status: open ? "waiting" : "closed" });
        if (!open) m += len;
      }
      if (s.state === "done") rounds.push({ n: r, at: m, label: `Round ${r}`, verdict: "Passed", back: false, words: "" });
    }
    s.rounds = rounds.reverse();
    s.runs = Math.max(1, total);
    m += 2;
  });
  // Minutes from the start, laid so the last thing that happened is the build's newest log time.
  const lastAt = Math.max(0, ...bars.map((x) => x.b ?? x.a), ...ran.flatMap((s) => s.rounds.map((r) => r.at)));
  const end = Date.parse(b.log[0]?.at ?? b.lifecycle?.at);
  const iso = (min) => new Date(end - (lastAt - min) * 60_000).toISOString();
  for (const s of ran) s.rounds = s.rounds.map((r) => ({ ...r, at: iso(r.at) }));
  b.timeline = bars.map((x) => ({ phase: x.phase, stage: x.stage, round: x.round, holder: x.holder, kind: x.kind, start: iso(x.a), end: x.b === null ? null : iso(x.b), duration_ms: x.b === null ? null : (x.b - x.a) * 60_000, status: x.status }));
  if (b.lifecycle) b.lifecycle = { ...b.lifecycle, at: iso(0) };
  return b;
}

// ---------- made-up analytics ----------

const WINDOW_DAYS = { "7d": 7, "30d": 30, all: null };
const DAY = 86_400_000;
const DEMO_PROJECTS = ["finance", "web"];
// The made-up history starts twelve weeks back.
const DEMO_WEEKS = 12;

/** The Monday (UTC) of the week a time falls in, as YYYY-MM-DD. */
function weekOf(t) {
  const d = new Date(t);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
}

/**
 * GET /v1/lifecycle/analytics in the demo: made-up weeks, the same every time
 * for the same week, so the page has something to show. Each project (and
 * the organization's own builds) has its own made-up numbers; with no project
 * they add up.
 */
export function demoAnalytics(window, project, at = Date.now()) {
  const to = new Date(at).toISOString();
  const days = WINDOW_DAYS[window];
  const thisWeek = Date.parse(`${weekOf(at)}T00:00:00Z`);
  const firstWeek = days ? Date.parse(`${weekOf(at - days * DAY)}T00:00:00Z`) : thisWeek - (DEMO_WEEKS - 1) * 7 * DAY;
  const weeks = [];
  for (let t = firstWeek; t <= thisWeek; t += 7 * DAY) weeks.push(weekOf(t));
  const scopes = project ? (DEMO_PROJECTS.includes(project) ? [project] : []) : [null, ...DEMO_PROJECTS];
  // A number from 0.55 to 1.45, fixed by the week, the scope and what is counted.
  const vary = (week, scope, k) => {
    let h = k * 31 + (scope ? scope.length * 7 : 3);
    for (const c of week) h = (h * 33 + c.charCodeAt(0)) % 9973;
    return 0.55 + (h % 91) / 100;
  };
  const SIZE = { null: 2, finance: 3, web: 4 };
  const builds = weeks.map((week) => {
    let started = 0; let finished = 0; let stopped = 0;
    for (const sc of scopes) {
      started += Math.round(SIZE[sc] * vary(week, sc, 1));
      finished += Math.round(SIZE[sc] * 0.8 * vary(week, sc, 2));
      stopped += vary(week, sc, 3) > 1.3 ? 1 : 0;
    }
    return { week, started, finished, stopped };
  });
  const stageTimes = [];
  for (const [stage, def] of Object.entries(STEP)) {
    const [, agentMin, , gateMin = 0] = def;
    if (!["requirements", "architecture", "test", "code", "review", "security", "package", "deploy", "acceptance"].includes(stage)) continue;
    const rows = [];
    for (const week of weeks) {
      const per = scopes.map((sc) => (agentMin + gateMin) * vary(week, sc, stage.length) * 60_000);
      if (!per.length) continue;
      const n = scopes.reduce((t, sc) => t + Math.max(1, Math.round(SIZE[sc] * 0.8 * vary(week, sc, 2))), 0);
      rows.push({ week, median_ms: Math.round(per.sort((a, b) => a - b)[per.length >> 1] / 60_000) * 60_000, builds: n });
    }
    if (rows.length) stageTimes.push({ stage, name: nameOf(stage), weeks: rows });
  }
  const sendBacks = [];
  for (const stage of ["requirements", "architecture", "test", "code", "review", "security", "package", "deploy", "acceptance"]) {
    let rounds = 0; let back = 0; let n = 0;
    for (const week of weeks) {
      for (const sc of scopes) {
        const b = Math.round(SIZE[sc] * 0.8 * vary(week, sc, 2));
        const extra = BACK[stage] ? Math.round(b * 0.45 * vary(week, sc, stage.length + 4)) : 0;
        rounds += b + extra; back += extra; n += b;
      }
    }
    if (rounds) sendBacks.push({ stage, name: nameOf(stage), rounds, back, rate: back / rounds, builds: n });
  }
  const waiting = weeks.map((week) => {
    let person = 0; let agent = 0;
    for (const sc of scopes) {
      const b = SIZE[sc] * vary(week, sc, 2);
      person += Math.round(b * 210 * vary(week, sc, 5)) * 60_000;
      agent += Math.round(b * 95 * vary(week, sc, 6)) * 60_000;
    }
    return { week, person_ms: person, agent_ms: agent };
  });
  return {
    window, project, from: days ? new Date(at - days * DAY).toISOString() : null, to, weeks, projects: DEMO_PROJECTS,
    builds, stage_times: stageTimes, send_backs: sendBacks, waiting,
  };
}
