// A stand-in lifecycle service for --demo. It answers the same paths, with
// the same shapes, as a real service (docs/contract.md), from memory, so the
// page can be shown and worked on with no service and no key.
//
// It is not a lifecycle: it moves the demo builds along just enough to show
// what each button does.

import { readFileSync } from "node:fs";
import { palindromeJudge, palindromeTries, tallyWords, wordTally, expenseCheck, blankStage, leaveOut, judge, STAGE_IDS, FIXTURE_FILES } from "./fixture.mjs";

const now = () => new Date().toISOString();
const DOC = JSON.parse(readFileSync(new URL("../standards/stages.json", import.meta.url), "utf8"));
const ROLES = DOC.roles ?? [];
const FORMATS = new Set((DOC.evidence_formats ?? []).map((f) => f.id));
const KINDS = ["reference_agent", "your_agent", "contracted", "person", "outside_tool"];

const NAMES = { architecture: "Architecture and Design", security: "Security review", incident: "Incident response" };
const nameOf = (id) => NAMES[id] ?? id[0].toUpperCase() + id.slice(1);

function liveStage(b) {
  return b.stages.find((s) => s.state === "waiting_on_you")
    ?? b.stages.find((s) => s.state === "working" || s.state === "stopped" || s.state === "refused")
    ?? [...b.stages].reverse().find((s) => s.state === "done")
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
  return { waiting_on_you: `Waiting on you at ${n}`, working: `Working at ${n}`, stopped: `Stopped at ${n}`, refused: `Refused at ${n}`, done: `${n} done` }[live.state] ?? "Not started";
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
  for (const b of [palindromeJudge(), tallyWords(), wordTally(), expenseCheck()]) builds.set(b.id, b);
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
  const bar = (phase, round, holder, kind, a, b, status) => ({ phase, round, holder, kind, start: t(a), end: b === null ? null : t(b), duration_ms: b === null ? null : (b - a) * 60_000, status });
  return [
    bar("write-the-architecture", 1, "solution-architect.example", "agent", 0, 4, "closed"),
    bar("write-the-spec", 1, "spec-writer.example", "agent", 0, 6, "closed"),
    bar("approve-the-spec", 1, null, "person", 6, 15, "closed"),
    bar("write-the-suite", 1, "test-writer.example", "agent", 15, 24, "closed"),
    bar("write-the-scripts", 1, "you.example", "external", 24, null, "working"),
  ];
}
