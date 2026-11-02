// Who holds each role, in words, and the Roles page. Everything here builds
// HTML from what the service answered and nothing else, so the tests can read
// it without a browser (test/roles.test.mjs).

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
}

// The states the console draws. Any other state is drawn as not_offered.
export const STATES = ["done", "waiting_on_you", "not_started", "not_offered", "working", "refused", "stopped", "not_bound", "not_applicable"];
export const stateOf = (s) => (STATES.includes(s?.state) ? s.state : "not_offered");

export const KIND_CHOICES = [
  ["reference_agent", "Our reference agent"],
  ["your_agent", "Your own agent"],
  ["contracted", "A contracted supplier"],
  ["person", "A person"],
  ["outside_tool", "An outside tool"],
];
const WITH_HANDLE = new Set(["your_agent", "contracted"]);
export const needsHandle = (kind) => WITH_HANDLE.has(kind);

const FORMAT_WORDS = {
  sarif: "Security findings (SARIF)",
  cyclonedx: "Bill of materials (CycloneDX)",
  spdx: "Bill of materials (SPDX)",
  slsa: "Build provenance (SLSA)",
  "in-toto": "Signed statements about the build (in-toto)",
  "otel-genai": "Traces of model calls (OpenTelemetry)",
  pact: "Contract test results (Pact)",
};
export const formatWords = (id) => FORMAT_WORDS[id] ?? "Evidence in another format";

/** The holder and its kind, in words: "code-critic, our reference agent", "contracted: Harbor Builds". */
export function holderWords(h) {
  if (!h || typeof h !== "object") return "";
  const name = String(h.name ?? "").trim();
  switch (h.kind) {
    case "reference_agent": return name ? `${name}, our reference agent` : "our reference agent";
    case "your_agent": return name ? `${name}, your agent` : "your agent";
    case "contracted": return `contracted: ${name}`;
    case "person": return /^you$/i.test(name) ? "you" : name ? `${name}, a person` : "a person";
    case "outside_tool": return `outside tool: ${name}`;
    default: return name;
  }
}
/** The same, as HTML, with the handle when there is one. */
export function holderHtml(h) {
  const w = holderWords(h);
  if (!w) return "";
  const handle = typeof h.handle === "string" && h.handle.trim() && !["person", "outside_tool"].includes(h.kind) ? h.handle.trim() : "";
  return `${esc(w)}${handle ? ` · <code class="handle">${esc(handle)}</code>` : ""}`;
}

// A role's effective holder: the binding's holder, or the reference agent when it holds by default.
export function effectiveHolder(r) {
  const b = r?.binding;
  if (b && typeof b === "object") {
    if (b.holder && typeof b.holder === "object") return b.holder;
    if (typeof b.kind === "string") return b;
  }
  // Older answers may leave a default's binding out and name only the reference agent.
  if (r?.from === "default" && r.reference_agent) {
    const ref = r.reference_agent;
    return typeof ref === "string" ? { kind: "reference_agent", name: ref } : { kind: "reference_agent", ...ref };
  }
  return null;
}

/** What a stage page says for the two states that have no work to show. */
export function stageNoticeHtml(state, rolesHref = "#/roles") {
  if (state === "not_bound") return `<div class="sec"><p class="notyet">Nobody holds this role yet.</p><p><a href="${esc(rolesHref)}">Choose who holds it on the Roles page</a></p></div>`;
  if (state === "not_applicable") return `<div class="sec na"><p class="notyet">This stage doesn't apply to a process.</p></div>`;
  return "";
}

/** Stage.evidence: each item's name, its format in words, when, its summary, and the file. */
export function evidenceHtml(list, { when = (x) => x, fileHtml = null } = {}) {
  if (!Array.isArray(list) || !list.length) return "";
  return `<div class="sec"><h4>Evidence</h4><ul class="evidence">${list.map((e) => {
    const f = e?.file && typeof e.file === "object" ? e.file : null;
    const link = f ? safeUrl(f.link) : null;
    const file = f ? (fileHtml ? fileHtml(f) : "") + (link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open ${esc(f.path)}</a></p>` : "") : "";
    return `<li><div class="eh"><b>${esc(e?.name)}</b><span>${esc(when(e?.at))}</span></div><div class="ef">${esc(formatWords(e?.format))}</div>${e?.summary ? `<p>${esc(e.summary)}</p>` : ""}${file}</li>`;
  }).join("")}</ul></div>`;
}

function listWords(items) {
  if (items.length <= 1) return items.join("");
  // "Requirements, and Architecture and Design": a comma where a name holds "and" itself.
  const comma = items.length > 2 || items.some((i) => / and /.test(i)) ? "," : "";
  return `${items.slice(0, -1).join(", ")}${comma} and ${items.at(-1)}`;
}

function fromWords(r, project, day) {
  const b = r.binding && typeof r.binding === "object" ? r.binding : {};
  const when = b.since && day ? ` on ${day(b.since)}` : "";
  const by = typeof b.by === "string" && b.by ? ` by ${b.by}` : "";
  if (r.from === "project") return `Chosen for the project ${project || b.scope?.project || ""}${when}${by}.`.replace(" .", ".");
  if (r.from === "org") return `Chosen for the organization${when}${by}.`;
  if (r.from === "default") return "This is the default.";
  return "";
}

function bindForm(r, ctx) {
  const d = ctx.draft ?? {};
  const kinds = KIND_CHOICES.filter(([k]) => k !== "reference_agent" || r.reference_agent);
  const kind = kinds.some(([k]) => k === d.kind) ? d.kind : kinds[0][0];
  const id = (x) => `bind-${esc(r.role)}-${x}`;
  const formats = (ctx.formats ?? []).map((f) => f.id).filter(Boolean);
  const chosen = new Set(Array.isArray(d.formats) ? d.formats : []);
  const busy = ctx.pending === r.role;
  return `<form class="bind form" data-role="${esc(r.role)}">
    <div class="err" role="alert">${esc(ctx.errors?.get(r.role) ?? "")}</div>
    <fieldset><legend>Who holds it</legend>${kinds.map(([k, words]) => `<label class="choice"><input type="radio" name="kind" value="${esc(k)}"${k === kind ? " checked" : ""}> ${esc(words)}</label>`).join("")}</fieldset>
    <label for="${id("name")}">Name <span>Such as Our security team.</span><input type="text" id="${id("name")}" name="name" value="${esc(d.name ?? "")}" required autocomplete="off"></label>
    <label for="${id("handle")}" data-handle${needsHandle(kind) ? "" : " hidden"}>Its handle on the mesh <span>Such as reviewer.acme@example.com.</span><input type="text" id="${id("handle")}" name="handle" value="${esc(d.handle ?? "")}" autocomplete="off" spellcheck="false"></label>
    ${formats.length ? `<fieldset><legend>Evidence it hands in <span>Optional</span></legend>${formats.map((f) => `<label class="choice"><input type="checkbox" name="formats" value="${esc(f)}"${chosen.has(f) ? " checked" : ""}> ${esc(formatWords(f))}</label>`).join("")}</fieldset>` : ""}
    <label for="${id("where")}">Where its evidence can be read <span>Optional. Words or a web address.</span><input type="text" id="${id("where")}" name="where" value="${esc(d.where ?? "")}" autocomplete="off"></label>
    <div class="acts tight"><button class="btn p" type="submit"${busy ? " disabled" : ""}>${busy ? "Saving…" : "Save"}</button><button class="btn" type="button" data-cancel-bind>Cancel</button></div>
  </form>`;
}

/** A draft for the bind form, from the role's holder now. */
export function draftFor(r) {
  const h = effectiveHolder(r);
  if (!h) return { kind: r.reference_agent ? "reference_agent" : "your_agent", name: "", handle: "", formats: [], where: "" };
  return { kind: h.kind, name: h.name ?? "", handle: h.handle ?? "", formats: h.evidence?.formats ?? [], where: h.evidence?.where ?? "" };
}

/** The body PUT /roles/{role} takes, from the form's values. */
export function holderFrom(values) {
  const holder = { kind: values.kind, name: String(values.name ?? "").trim() };
  const handle = String(values.handle ?? "").trim();
  if (needsHandle(values.kind) && handle) holder.handle = handle;
  const formats = (values.formats ?? []).filter(Boolean);
  const where = String(values.where ?? "").trim();
  if (formats.length || where) holder.evidence = { formats, ...(where ? { where } : {}) };
  return { holder };
}

function roleHtml(r, ctx) {
  const stages = (r.stages ?? []).map((s) => ctx.stageName?.(s) ?? s);
  const contract = safeUrl(r.contract);
  let h = `<section class="role" id="role-${esc(r.role)}"><div class="rtop"><h2>${esc(r.name ?? r.role)}</h2>${contract ? `<a href="${esc(contract)}" target="_blank" rel="noopener noreferrer">Its contract</a>` : ""}</div>`;
  if (stages.length) h += `<p class="meta">Holds ${esc(listWords(stages))}.</p>`;
  if (r.role === "requester") return `${h}<p class="holder">The person who asked</p></section>`;
  const holder = effectiveHolder(r);
  h += holder ? `<p class="holder">Held by ${holderHtml(holder)}</p>` : `<p class="holder none">Nobody holds this role yet.</p>`;
  const from = fromWords(r, ctx.project, ctx.day);
  if (from) h += `<p class="meta">${esc(from)}</p>`;
  const ev = holder?.evidence;
  if (ev?.formats?.length) h += `<p class="meta">It hands in ${esc(listWords(ev.formats.map(formatWords)))}.</p>`;
  if (ev?.where) {
    const url = safeUrl(ev.where);
    h += `<p class="meta">Its evidence can be read ${url ? `at <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` : `at ${esc(ev.where)}`}.</p>`;
  }
  const editing = ctx.editing === r.role;
  const canReset = (r.from === "project" && ctx.project) || (r.from === "org" && !ctx.project);
  if (!editing && ctx.errors?.get(r.role)) h += `<div class="err" role="alert">${esc(ctx.errors.get(r.role))}</div>`;
  if (editing) h += bindForm(r, ctx);
  else if (!ctx.readOnly) {
    const busy = ctx.pending === r.role;
    h += `<div class="acts"><button class="btn" type="button" data-bind="${esc(r.role)}">Change who holds it</button>${canReset ? `<button class="btn" type="button" data-unbind="${esc(r.role)}"${busy ? " disabled" : ""}>${busy ? "Sending…" : "Go back to the default"}</button>` : ""}</div>`;
  }
  return `${h}</section>`;
}

/** The Roles page: a project field, then every role the service listed. */
export function rolesPageHtml(answer, ctx = {}) {
  const roles = Array.isArray(answer?.roles) ? answer.roles : [];
  const project = ctx.project ?? "";
  return `<div class="err" role="alert">${esc(ctx.error ?? "")}</div>
    <h1>Roles${project ? ` for ${esc(project)}` : ""}</h1>
    <form class="proj" id="project-form"><label for="r-project">Project <span>Leave it empty for the whole organization.</span></label><input type="text" id="r-project" value="${esc(project)}" autocomplete="off" spellcheck="false"><button class="btn" type="submit">Show</button>${project ? `<a class="btn" href="#/roles">The whole organization</a>` : ""}</form>
    <div class="roles">${roles.map((r) => roleHtml(r, { ...ctx, project, draft: ctx.editing === r.role ? ctx.draft : null })).join("")}</div>`;
}
