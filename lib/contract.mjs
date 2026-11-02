// The lifecycle API's answers, as checks. Each function returns a list of
// problems; an empty list means the answer has the contract's shape
// (docs/contract.md). The tests run the demo data through these, and they
// are what a service author can run against their own answers.

// not_bound and not_applicable, contracted and outside_tool were added in 0.2.
export const STATES = ["not_started", "working", "waiting_on_you", "done", "refused", "stopped", "not_offered", "not_bound", "not_applicable"];
export const HOLDER_KINDS = ["reference_agent", "your_agent", "contracted", "person", "outside_tool"];
export const EVIDENCE_FORMATS = ["sarif", "cyclonedx", "spdx", "slsa", "in-toto", "otel-genai", "pact"];
export const AGAINST = ["pull_request", "installed"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string";
const isTime = (v) => isStr(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));

function need(problems, cond, where, what) {
  if (!cond) problems.push(`${where}: ${what}`);
  return cond;
}

function checkLog(p, log, where) {
  if (!need(p, Array.isArray(log), where, "log is a list")) return;
  log.forEach((e, i) => {
    need(p, isObj(e) && isTime(e.at), `${where}.log[${i}]`, "has an ISO 8601 at");
    need(p, isObj(e) && isStr(e.said), `${where}.log[${i}]`, "has said as words");
  });
}

export function checkBuildList(body) {
  const p = [];
  if (!need(p, isObj(body) && Array.isArray(body.builds), "body", "has builds as a list")) return p;
  body.builds.forEach((b, i) => {
    const w = `builds[${i}]`;
    for (const k of ["id", "name", "does", "version"]) need(p, isStr(b?.[k]), w, `${k} is words`);
    need(p, isObj(b?.at) && isStr(b.at.stage), w, "at.stage is a stage id");
    need(p, isObj(b?.at) && STATES.includes(b.at.state), w, "at.state is a known state");
    // Added in 0.1: the build's end state in words, and whether it is archived. Optional.
    if (isObj(b?.at) && "summary" in b.at) need(p, isStr(b.at.summary), w, "at.summary is words");
    if (isObj(b) && "archived" in b) need(p, typeof b.archived === "boolean", w, "archived is true or false");
    need(p, isTime(b?.updated), w, "updated is an ISO 8601 time");
  });
  return p;
}

export function checkStage(s, w, stageIds) {
  const p = [];
  if (!need(p, isObj(s), w, "is an object")) return p;
  need(p, isStr(s.stage) && (!stageIds || stageIds.includes(s.stage)), w, "stage is an id from stages.json");
  need(p, STATES.includes(s.state), w, `state is one of ${STATES.join(", ")}`);
  if (s.holder !== null) {
    need(p, isObj(s.holder) && HOLDER_KINDS.includes(s.holder.kind), w, `holder.kind is one of ${HOLDER_KINDS.join(", ")}`);
    need(p, isObj(s.holder) && isStr(s.holder.name), w, "holder.name is words");
    if (isObj(s.holder) && "handle" in s.holder) need(p, isStr(s.holder.handle), w, "holder.handle is words");
  }
  // Added in 0.2, optional: evidence an outside holder handed in, read by the service.
  if ("evidence" in s && need(p, Array.isArray(s.evidence), w, "evidence is a list")) {
    s.evidence.forEach((e, i) => {
      const ew = `${w}.evidence[${i}]`;
      need(p, EVIDENCE_FORMATS.includes(e?.format), ew, "format is a known evidence format");
      need(p, isStr(e?.name), ew, "name is words");
      need(p, isTime(e?.at), ew, "at is an ISO 8601 time");
      need(p, isStr(e?.summary), ew, "summary is words");
      if (e?.file !== undefined && e?.file !== null) need(p, isObj(e.file) && isStr(e.file.path) && Number.isInteger(e.file.size) && isStr(e.file.link), ew, "file has path, size and link");
    });
  }
  need(p, Number.isInteger(s.runs) && s.runs >= 0, w, "runs is a count");
  if (need(p, Array.isArray(s.rounds), w, "rounds is a list")) {
    s.rounds.forEach((r, i) => {
      const rw = `${w}.rounds[${i}]`;
      need(p, Number.isInteger(r?.n), rw, "n is a number");
      need(p, isTime(r?.at), rw, "at is an ISO 8601 time");
      for (const k of ["label", "verdict", "words"]) need(p, isStr(r?.[k]), rw, `${k} is words`);
      need(p, typeof r?.back === "boolean", rw, "back is true or false");
      if (i > 0) need(p, r.n < s.rounds[i - 1].n, rw, "rounds are newest first");
    });
  }
  need(p, isStr(s.given), w, "given is words");
  if (need(p, isObj(s.handed_back), w, "handed_back is an object")) {
    need(p, Array.isArray(s.handed_back.words) && s.handed_back.words.every(isStr), w, "handed_back.words is a list of words");
    if (need(p, Array.isArray(s.handed_back.files), w, "handed_back.files is a list")) {
      s.handed_back.files.forEach((f, i) => {
        const fw = `${w}.handed_back.files[${i}]`;
        need(p, isStr(f?.path) && f.path.length > 0, fw, "path is words");
        need(p, Number.isInteger(f?.size) && f.size >= 0, fw, "size is a count of bytes");
        need(p, isStr(f?.link), fw, "link is words");
      });
    }
  }
  need(p, s.done_when_met === true || s.done_when_met === false || s.done_when_met === null, w, "done_when_met is true, false or null");
  checkLog(p, s.log, w);
  if (s.where !== null) {
    if (need(p, isObj(s.where) && s.where.kind === "pull_request", w, "where is null or a pull request")) {
      need(p, isStr(s.where.url), w, "where.url is words");
      const c = s.where.check;
      if (c !== null && c !== undefined) {
        need(p, isObj(c) && isStr(c.title) && isStr(c.words), w, "where.check has title and words");
        need(p, isObj(c) && Array.isArray(c.items) && c.items.every(isStr), w, "where.check.items is a list of words");
      }
    }
  }
  return p;
}

export function checkAction(a, w) {
  const p = [];
  for (const k of ["stage", "name", "label"]) need(p, isStr(a?.[k]), w, `${k} is words`);
  if (need(p, Array.isArray(a?.needs), w, "needs is a list")) {
    a.needs.forEach((n, i) => {
      for (const k of ["name", "label", "kind"]) need(p, isStr(n?.[k]), `${w}.needs[${i}]`, `${k} is words`);
      if (n && "optional" in n) need(p, typeof n.optional === "boolean", `${w}.needs[${i}]`, "optional is true or false");
    });
  }
  return p;
}

export function checkBuild(body, stageIds) {
  const p = [];
  if (!need(p, isObj(body) && isObj(body.build), "body", "has build")) return p;
  const b = body.build;
  for (const k of ["id", "name", "does", "version", "handle"]) need(p, isStr(b[k]), "build", `${k} is words`);
  // Added in 0.1, optional: the end state in words, the installed agent's pause, and archived.
  if ("summary" in b) need(p, isStr(b.summary), "build", "summary is words");
  if ("archived" in b) need(p, typeof b.archived === "boolean", "build", "archived is true or false");
  // Added in 0.2, optional: the project whose role bindings the build sees.
  if ("project" in b) need(p, isStr(b.project), "build", "project is words");
  if ("paused" in b && b.paused !== null) need(p, isObj(b.paused) && isTime(b.paused.at) && isStr(b.paused.why), "build", "paused is null, or has an ISO 8601 at and why as words");
  if (need(p, Array.isArray(b.stages), "build", "stages is a list")) {
    b.stages.forEach((s, i) => p.push(...checkStage(s, `build.stages[${i}]`, stageIds)));
    const ids = b.stages.map((s) => s.stage);
    need(p, new Set(ids).size === ids.length, "build.stages", "each stage appears once");
  }
  if (need(p, Array.isArray(b.actions), "build", "actions is a list")) {
    b.actions.forEach((a, i) => p.push(...checkAction(a, `build.actions[${i}]`)));
  }
  checkLog(p, b.log, "build");
  return p;
}

export function checkTry(body) {
  const p = [];
  if (!need(p, isObj(body) && isObj(body.try), "body", "has try")) return p;
  const t = body.try;
  for (const k of ["id", "say", "answer"]) need(p, isStr(t[k]), "try", `${k} is words`);
  need(p, AGAINST.includes(t.against), "try", "against is pull_request or installed");
  need(p, typeof t.ms === "number" && t.ms >= 0, "try", "ms is a number of milliseconds");
  need(p, isTime(t.at), "try", "at is an ISO 8601 time");
  return p;
}

export function checkTries(body) {
  const p = [];
  if (!need(p, isObj(body) && Array.isArray(body.tries), "body", "has tries as a list")) return p;
  body.tries.forEach((t, i) => {
    const w = `tries[${i}]`;
    for (const k of ["id", "say", "answer"]) need(p, isStr(t?.[k]), w, `${k} is words`);
    need(p, AGAINST.includes(t?.against), w, "against is pull_request or installed");
    need(p, isTime(t?.at), w, "at is an ISO 8601 time");
    need(p, typeof t?.kept === "boolean", w, "kept is true or false");
    need(p, typeof t?.sent_back === "boolean", w, "sent_back is true or false");
  });
  return p;
}

// Added in 0.2: who holds each role (GET/PUT/DELETE /v1/lifecycle/roles).
export const ROLE_FROM = ["project", "org", "default", "unbound"];

function checkHolder(p, h, w) {
  if (!need(p, isObj(h) && HOLDER_KINDS.includes(h.kind), w, `kind is one of ${HOLDER_KINDS.join(", ")}`)) return;
  need(p, isStr(h.name), w, "name is words");
  if (h.kind === "your_agent" || h.kind === "contracted") need(p, isStr(h.handle) && h.handle.length > 0, w, "handle is given for your_agent and contracted");
  if (h.kind === "person" || h.kind === "outside_tool") need(p, !("handle" in h), w, "handle is absent for person and outside_tool");
  if ("handle" in h && h.kind !== "person" && h.kind !== "outside_tool") need(p, isStr(h.handle), w, "handle is words");
  if ("role" in h) need(p, isStr(h.role), w, "role is words");
  if ("evidence" in h && h.evidence !== null) {
    if (need(p, isObj(h.evidence), w, "evidence is an object")) {
      need(p, Array.isArray(h.evidence.formats) && h.evidence.formats.every((f) => EVIDENCE_FORMATS.includes(f)), w, "evidence.formats is a list of known formats");
      if ("where" in h.evidence) need(p, isStr(h.evidence.where), w, "evidence.where is words");
    }
  }
}

export function checkRoles(body, roleIds) {
  const p = [];
  if (!need(p, isObj(body) && Array.isArray(body.roles), "body", "has roles as a list")) return p;
  body.roles.forEach((r, i) => {
    const w = `roles[${i}]`;
    need(p, isStr(r?.role) && (!roleIds || roleIds.includes(r.role)), w, "role is a role id");
    for (const k of ["name", "contract", "offering"]) need(p, isStr(r?.[k]), w, `${k} is words`);
    need(p, Array.isArray(r?.stages) && r.stages.every(isStr), w, "stages is a list of stage ids");
    need(p, ROLE_FROM.includes(r?.from), w, `from is one of ${ROLE_FROM.join(", ")}`);
    // reference_agent is a Holder or null; binding is null exactly when from is unbound.
    if (r?.reference_agent !== null) {
      need(p, isObj(r?.reference_agent) && r.reference_agent.kind === "reference_agent" && isStr(r.reference_agent.name), w, "reference_agent is null or a holder of kind reference_agent");
    }
    need(p, (r?.binding === null) === (r?.from === "unbound"), w, "binding is null exactly when from is unbound");
    if (isObj(r?.binding)) {
      need(p, r.binding.role === r.role, `${w}.binding`, "role is the role's id");
      checkHolder(p, r.binding.holder, `${w}.binding.holder`);
      if (r.from === "project" || r.from === "org") {
        need(p, isObj(r.binding.scope), `${w}.binding`, "scope says the organization or the project");
        if ("since" in r.binding) need(p, isTime(r.binding.since), `${w}.binding`, "since is an ISO 8601 time");
      }
      if (r.role === "requester") need(p, r.binding.holder?.kind === "person", w, "the requester is always a person");
    }
  });
  return p;
}
