// Who holds each role, in words, and the words a stage page shows for the
// states that have no work. Everything here builds HTML from what the service
// answered and nothing else, so the tests can read it without a browser
// (test/roles.test.mjs). The Lifecycle page is public/lifecycle.js.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
}

// The states the console draws. Any other state is drawn as not_offered.
// not_used (lifecycle API 0.3): the build's lifecycle leaves the stage out.
export const STATES = ["done", "waiting_on_you", "not_started", "not_offered", "working", "refused", "stopped", "not_bound", "not_applicable", "not_used"];
export const stateOf = (s) => (STATES.includes(s?.state) ? s.state : "not_offered");
// Each state in words, as the stage page and the Board say it.
export const WORD = { done: "Done", waiting_on_you: "Waiting on you", not_started: "Not started", not_offered: "Not offered", working: "Working", refused: "Refused", stopped: "Stopped", not_bound: "Nobody holds it", not_applicable: "Doesn't apply", not_used: "Not used" };

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
export function stageNoticeHtml(state, lifecycleHref = "#/lifecycle") {
  if (state === "not_bound") return `<div class="sec"><p class="notyet">Nobody holds this role yet.</p><p><a href="${esc(lifecycleHref)}">Choose who holds it on the Lifecycle page</a></p></div>`;
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
