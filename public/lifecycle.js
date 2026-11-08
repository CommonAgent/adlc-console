// The Lifecycle page: which of the 24 stages the organization (or one project)
// uses, and who holds each stage's role. Everything here builds HTML from what
// the service answered (GET /stages and GET /roles) and nothing else, so the
// tests can read it without a browser (test/lifecycle.test.mjs).
//
// The console decides nothing here. Whether a stage may be left out, and why
// not, are the service's can_leave_out and why_not, drawn as they come.

import { esc, effectiveHolder, formatWords, needsHandle } from "./roles.js";

export const KIND_OPTIONS = [
  ["your_agent", "Your own agent…"],
  ["contracted", "A contracted supplier…"],
  ["person", "A person or team…"],
  ["outside_tool", "An outside tool…"],
];

/** The page's address for the organization, or for one project. */
export const lifecycleHash = (project) => (project ? `#/lifecycle?project=${encodeURIComponent(project)}` : "#/lifecycle");

/** Which lifecycle, in words: "the organization's lifecycle", "the lifecycle for the project finance". */
export function lifecycleWords(project) {
  return project ? `the lifecycle for the project ${project}` : "the organization's lifecycle";
}

const roleById = (rolesAnswer) => new Map((Array.isArray(rolesAnswer?.roles) ? rolesAnswer.roles : []).map((r) => [r.role, r]));

/** How a stage's roles are held: "ours" when every role is held by the
 *  service's own agent, "open" when any role has nobody, otherwise "others". */
export function heldBy(stage, roles) {
  const ids = Array.isArray(stage?.roles) ? stage.roles : [];
  if (!ids.length) return "open";
  let ours = true;
  for (const id of ids) {
    const r = roles.get(id);
    const h = r ? effectiveHolder(r) : null;
    if (!h) return "open";
    if (h.kind !== "reference_agent") ours = false;
  }
  return ours ? "ours" : "others";
}

/** The summary line's numbers, counted over the stages in use. */
export function lifecycleSummary(stagesAnswer, rolesAnswer) {
  const stages = Array.isArray(stagesAnswer?.stages) ? stagesAnswer.stages : [];
  const roles = roleById(rolesAnswer);
  const used = stages.filter((s) => s.used !== false);
  const out = { used: used.length, total: stages.length, ours: 0, others: 0, open: 0 };
  for (const s of used) out[heldBy(s, roles)] += 1;
  return out;
}

function summaryHtml(n) {
  return `<div class="lsum" id="lc-sum"><span><b>${n.used}</b>of ${n.total} stages used</span><span><b>${n.ours}</b>held by the service's own agents</span><span><b>${n.others}</b>held by others</span>${n.open ? `<span class="open"><b>${n.open}</b>not chosen</span>` : ""}</div>`;
}

/** The words beside the holder's select: its name and handle. The service's own agent needs none; the select names it. */
function holderNote(h) {
  if (!h || h.kind === "reference_agent") return "";
  const handle = typeof h.handle === "string" && h.handle.trim() && !["person", "outside_tool"].includes(h.kind) ? h.handle.trim() : "";
  const name = String(h.name ?? "").trim();
  return `${esc(name)}${handle ? ` · <code class="handle">${esc(handle)}</code>` : ""}`;
}

function holderLine(r, s, ctx, labelled) {
  const label = labelled ? `<span class="rl">${esc(r?.name ?? "")}</span>` : "";
  if (!r) return `<div class="hl">${label}<span class="hn none">The service did not list this role.</span></div>`;
  if (r.role === "requester") return `<div class="hl">${label}<span class="hn asked">The person who asked</span></div>`;
  const h = effectiveHolder(r);
  const ref = r.reference_agent && typeof r.reference_agent === "object" ? r.reference_agent : null;
  const opts = [];
  if (!h) opts.push(["", "Not chosen"]);
  if (ref) opts.push(["reference_agent", `The service's ${ref.name}`]);
  opts.push(...KIND_OPTIONS);
  const kind = h?.kind ?? "";
  // A holder of a kind this page does not know still shows, under its own name.
  if (h && !opts.some(([v]) => v === kind)) opts.unshift([kind, h.name ?? kind]);
  const cls = !h ? "none" : kind === "reference_agent" ? "ours" : "";
  const busy = ctx.pending === `role:${r.role}`;
  const ro = ctx.readOnly ? " disabled" : "";
  const sel = `<select data-role-kind="${esc(r.role)}" data-at="${esc(s.stage)}" class="${cls}" aria-label="${esc(`Who holds ${r.name ?? r.role}, for ${s.name ?? s.stage}`)}"${kind === "reference_agent" && h.handle ? ` title="${esc(h.handle)}"` : ""}${busy ? " disabled" : ro}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === kind ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const canReset = !ctx.readOnly && ((r.from === "project" && ctx.project) || (r.from === "org" && !ctx.project));
  const edit = !ctx.readOnly && h && kind !== "reference_agent" ? `<button class="linkbtn" type="button" data-edit-role="${esc(r.role)}" data-at="${esc(s.stage)}">Change</button>` : "";
  const reset = canReset ? `<button class="linkbtn" type="button" data-reset-role="${esc(r.role)}"${busy ? " disabled" : ""}>${ctx.project ? "Use the organization's" : "Go back to the default"}</button>` : "";
  const note = holderNote(h);
  const err = ctx.errors?.get(`role:${r.role}`);
  const side = note || edit || reset ? `<span class="hn">${note}${edit || reset ? `<span class="hx">${edit}${reset}</span>` : ""}</span>` : "";
  return `<div class="hl">${label}<div class="hold${side ? "" : " one"}">${sel}${side}</div>${err && !(ctx.editing?.role === r.role) ? `<div class="err" role="alert">${esc(err)}</div>` : ""}</div>`;
}

/** The form for a holder that needs words: its name, its handle on the mesh where one is needed, and its evidence. */
function holderForm(r, ctx) {
  const d = ctx.draft ?? {};
  const kind = d.kind;
  const id = (x) => `lc-${esc(r.role)}-${x}`;
  const formats = (ctx.formats ?? []).map((f) => f.id).filter(Boolean);
  const chosen = new Set(Array.isArray(d.formats) ? d.formats : []);
  const busy = ctx.pending === `role:${r.role}`;
  const what = KIND_OPTIONS.find(([k]) => k === kind)?.[1].replace("…", "") ?? "";
  const namePh = kind === "person" ? "A name or team, such as Our security team" : kind === "outside_tool" ? "Such as The scanner in our CI" : "A name people will know";
  return `<form class="lcbind form" data-role="${esc(r.role)}" data-kind="${esc(kind)}">
    <div class="err" role="alert">${esc(ctx.errors?.get(`role:${r.role}`) ?? "")}</div>
    <p class="lt">${esc(r.name ?? r.role)}: ${esc(what.toLowerCase())}</p>
    <div class="lrow">
      ${needsHandle(kind) ? `<label for="${id("handle")}">Its handle on the mesh<input type="text" class="mono" id="${id("handle")}" name="handle" value="${esc(d.handle ?? "")}" placeholder="name.owner@example.com" autocomplete="off" spellcheck="false" required></label>` : ""}
      <label for="${id("name")}">Name<input type="text" id="${id("name")}" name="name" value="${esc(d.name ?? "")}" placeholder="${esc(namePh)}" autocomplete="off" required></label>
    </div>
    ${formats.length ? `<fieldset><legend>Evidence it hands in <span>Optional</span></legend><div class="fmts">${formats.map((f) => `<label class="choice"><input type="checkbox" name="formats" value="${esc(f)}"${chosen.has(f) ? " checked" : ""}> ${esc(formatWords(f))}</label>`).join("")}</div></fieldset>` : ""}
    <label for="${id("where")}">Where its evidence can be read <span>Optional. Words or a web address.</span><input type="text" id="${id("where")}" name="where" value="${esc(d.where ?? "")}" autocomplete="off"></label>
    <div class="acts tight"><button class="btn p" type="submit"${busy ? " disabled" : ""}>${busy ? "Saving…" : "Save"}</button><button class="btn" type="button" data-cancel-lc>Cancel</button></div>
  </form>`;
}

function rowHtml(s, i, ctx, roles) {
  const used = s.used !== false;
  const number = ctx.number?.(s.stage) || i + 1;
  const ids = Array.isArray(s.roles) ? s.roles : [];
  const roleWords = ctx.roleWords?.(s.stage) || ids.map((id) => roles.get(id)?.name ?? id).join(" · ");
  const fixed = s.can_leave_out === false;
  const whyId = `why-${esc(s.stage)}`;
  const busy = ctx.pending === `use:${s.stage}`;
  const sw = ctx.noStages ? "<span></span>"
    : `<label class="sw"><input type="checkbox" data-use="${esc(s.stage)}"${used ? " checked" : ""}${fixed || busy || ctx.readOnly ? " disabled" : ""} aria-label="${esc(`Use ${s.name ?? s.stage}`)}"${fixed && s.why_not ? ` aria-describedby="${whyId}"` : ""}><i></i></label>`;
  const why = fixed && s.why_not ? `<span class="why" id="${whyId}">${esc(s.why_not)}</span>` : "";
  const useErr = ctx.errors?.get(`use:${s.stage}`);
  const lines = ids.map((id) => holderLine(roles.get(id), s, ctx, ids.length > 1)).join("");
  let h = `<div class="cols row${used ? "" : " off"}" id="lc-${esc(s.stage)}">
    <span class="num">${String(number).padStart(2, "0")}</span>
    ${sw}
    <span class="stn"><b>${esc(s.name ?? s.stage)}</b><span>${esc(roleWords)}</span>${why}${useErr ? `<span class="err" role="alert">${esc(useErr)}</span>` : ""}</span>
    <div class="holds">${lines}</div></div>`;
  const ed = ctx.editing;
  if (used && ed && ed.role !== "requester" && ed.stage === s.stage && ids.includes(ed.role) && roles.get(ed.role)) h += `<div class="lcform">${holderForm(roles.get(ed.role), ctx)}</div>`;
  return h;
}

/** The stage rows, from the stages answer; when the service has no stages
 *  answer, from stages.json (ctx.fallback), with no Use switch. */
function stageRows(stagesAnswer, ctx) {
  if (Array.isArray(stagesAnswer?.stages)) return stagesAnswer.stages;
  return (ctx.fallback ?? []).map((d) => ({ stage: d.id, name: d.name, phase: d.phase, roles: d.role_ids ?? [], used: true }));
}

/** The Lifecycle page. */
export function lifecyclePageHtml(stagesAnswer, rolesAnswer, ctx = {}) {
  const project = ctx.project ?? "";
  const roles = roleById(rolesAnswer);
  const stages = stageRows(stagesAnswer, ctx);
  const phases = ctx.phases ?? [];
  const scope = project ? "project" : "org";
  const canReset = !ctx.readOnly && !ctx.noStages && stages.some((s) => s.from === scope);
  const head = `<div class="err" role="alert">${esc(ctx.error ?? "")}</div>
    <div class="lhead"><div><h1>${project ? `Lifecycle for ${esc(project)}` : "The organization's lifecycle"}</h1>
    ${stages.length ? summaryHtml(lifecycleSummary({ stages }, rolesAnswer)) : ""}</div>
    ${canReset ? `<div class="acts tight"><button class="btn" type="button" data-reset-stages${ctx.pending === "reset" ? " disabled" : ""}>${ctx.pending === "reset" ? "Sending…" : project ? "Use the organization's stages" : "Go back to the default stages"}</button></div>` : ""}</div>
    ${project ? `<p class="does">Builds that name the project ${esc(project)} use this lifecycle. A stage or role not chosen here follows the organization's.</p>` : `<p class="does">Every build uses this lifecycle unless its project has one of its own.</p>`}
    ${ctx.noStages ? `<p class="does">This service does not let you choose stages yet. You can still choose who holds each role.</p>` : ""}`;
  if (!stages.length) return `<section class="sheet" aria-label="Lifecycle">${head}</section>`;
  const known = new Set(phases.map(([p]) => p));
  const groups = [...phases, ...[...new Set(stages.map((s) => s.phase))].filter((p) => !known.has(p)).map((p) => [p, p ?? ""])];
  const body = groups.map(([pid, pname]) => {
    const here = stages.map((s, i) => [s, i]).filter(([s]) => s.phase === pid);
    if (!here.length) return "";
    return `<div class="ph">${esc(pname)}</div>${here.map(([s, i]) => rowHtml(s, i, { ...ctx, project }, roles)).join("")}`;
  }).join("");
  return `<section class="sheet" aria-label="Lifecycle">${head}<div class="lc"><div class="cols colhead"><span>Stage</span><span>${ctx.noStages ? "" : "Use"}</span><span></span><span>Who holds the role</span></div>${body}</div></section>`;
}

/** A draft for the holder form: from the role's holder when the kind is the same, else empty. */
export function lifecycleDraft(r, kind) {
  const h = r ? effectiveHolder(r) : null;
  if (h && h.kind === kind) return { kind, name: h.name ?? "", handle: h.handle ?? "", formats: h.evidence?.formats ?? [], where: h.evidence?.where ?? "" };
  return { kind, name: "", handle: "", formats: [], where: "" };
}

/** The PUT /roles/{role} body that makes the service's own agent hold the role. */
export function referenceHolder(r) {
  const ref = r?.reference_agent;
  if (!ref || typeof ref !== "object") return null;
  const holder = { kind: "reference_agent", name: ref.name };
  if (typeof ref.handle === "string" && ref.handle) holder.handle = ref.handle;
  return { holder };
}

/** The stages a "go back" sends DELETE for: those chosen at this scope. */
export function stagesToReset(stagesAnswer, project) {
  const scope = project ? "project" : "org";
  return (Array.isArray(stagesAnswer?.stages) ? stagesAnswer.stages : []).filter((s) => s.from === scope).map((s) => s.stage);
}

/** What a build's stage page says for a stage its lifecycle leaves out. */
export function notUsedHtml(build, { day = (x) => x } = {}) {
  const lc = build?.lifecycle && typeof build.lifecycle === "object" ? build.lifecycle : null;
  const project = lc ? (typeof lc.project === "string" && lc.project ? lc.project : "") : (typeof build?.project === "string" ? build.project : "");
  const when = lc?.at && day(lc.at) ? `, as it was on ${day(lc.at)}` : "";
  return `<div class="sec nu"><p class="notyet">This stage is not part of this build's lifecycle. The build follows ${esc(lifecycleWords(project))}${esc(when)}.</p><p><a href="${esc(lifecycleHash(project))}">See that lifecycle</a></p></div>`;
}

/** The line under a build's name that says which lifecycle it follows. */
export function buildLifecycleHtml(build, { day = (x) => x } = {}) {
  const lc = build?.lifecycle && typeof build.lifecycle === "object" ? build.lifecycle : null;
  if (lc) {
    const project = typeof lc.project === "string" && lc.project ? lc.project : "";
    const when = lc.at && day(lc.at) ? `, as it was on ${day(lc.at)}` : "";
    const lead = project ? `Built for the project ${project}. It follows ${lifecycleWords(project)}` : `It follows ${lifecycleWords("")}`;
    return `<p class="projof">${esc(lead)}${esc(when)}. <a href="${esc(lifecycleHash(project))}">See that lifecycle</a></p>`;
  }
  if (typeof build?.project === "string" && build.project) {
    return `<p class="projof">Built for the project ${esc(build.project)}. <a href="${esc(lifecycleHash(build.project))}">Who holds its roles</a></p>`;
  }
  return "";
}
