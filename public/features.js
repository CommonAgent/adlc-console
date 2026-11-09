// Features (lifecycle API 0.4.3) on the page. The statement of the job carries
// a feature list; a stage's agent or the boss proposes a new or changed feature
// on its reply, and the person answers each one there: Approve feature (a gate
// decision of Requirements for that feature alone), Not now (a backlog item),
// or, for someone who may not answer Requirements, Ask <approver> to approve.
// The Requirements gate then asks only what is still open, and to start
// building with the features. The Features matrix holds each feature against
// the spec, the tests, the code, the review and the docs; a cell opens that
// artifact at that feature, and a row opens the feature's history.
//
// Everything here builds HTML from what the service answered and nothing else,
// so the tests read it without a browser (test/features.test.mjs).

import { esc } from "./roles.js";

const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The matrix's columns, in their order, with their headings. */
export const FEATURE_COLUMNS = [["spec", "Spec"], ["tests", "Tests"], ["code", "Code"], ["review", "Review"], ["docs", "Docs"]];

/** The features a test names: the ids in square brackets its name starts with ("[F3] ..." or "[F1, F2] ..."). */
export function featuresOfTest(name) {
  const m = /^\s*\[([^\]]+)\]/.exec(String(name ?? ""));
  if (!m) return [];
  const ids = m[1].split(",").map((s) => s.trim());
  return ids.every((id) => /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(id)) ? [...new Set(ids)] : [];
}

/** An approver as a button names them: "Ana Lee" from "Ana Lee (ana@example.com)", and "an approver in the team web" as it is. */
const shortName = (who) => str(who).replace(/\s*\([^)]*@[^)]*\)\s*$/, "");

/** The names on an Ask button: "Ana Lee", "Ana Lee or Bo Park", or "an approver". */
export function approverWords(approvers) {
  const names = list(approvers).map(shortName).filter(Boolean);
  if (!names.length) return "an approver";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

const when0 = (x) => x;

/**
 * One feature proposal on a reply, with its answer: Approve feature and Not now
 * for someone who may approve; Ask <approver> to approve and Not now for
 * someone who may not; and, once answered, who answered and how.
 * m: the message (its build and id go with the answer). pending: the
 * "<proposal> <decision>" being sent.
 */
export function featureProposalHtml(p, m, { when = when0, pending = null } = {}) {
  if (!isObj(p) || !str(p.proposal) || !str(p.feature)) return "";
  const data = (decision) => `data-feat="${esc(decision)}" data-feat-id="${esc(p.feature)}" data-feat-proposal="${esc(p.proposal)}" data-feat-build="${esc(str(m?.build))}" data-feat-message="${esc(str(m?.id))}"`;
  const busy = pending !== null;
  const btn = (decision, label, main = false) => `<button class="btn${main ? " p" : ""}" type="button" ${data(decision)}${busy ? " disabled" : ""}>${esc(pending === `${p.proposal} ${decision}` ? "Sending…" : label)}</button>`;
  const head = `<h4><span class="fid">${esc(p.feature)}</span> ${p.change === "changed" ? "Changed feature" : "New feature"}</h4>`;
  const body = `<p class="fname"><b>${esc(str(p.name))}</b>${str(p.offering) ? ` <small>in ${esc(str(p.offering))}</small>` : ""}</p><p class="fdoes">${esc(str(p.does))}</p>${isObj(p.was) ? `<p class="fwas"><span>Was</span> ${esc(str(p.was.name))}: ${esc(str(p.was.does))}</p>` : ""}`;
  const at = (x) => (x?.at && when(x.at) ? ` · ${when(x.at)}` : "");
  if (p.state === "approved") return `<div class="gcard done feat">${head}${body}<div class="acts"><span class="btn used">${esc(`Approved${p.answered?.by ? ` by ${p.answered.by}` : ""}${at(p.answered)}`)}</span></div></div>`;
  if (p.state === "replaced") return `<div class="gcard feat">${head}${body}<p class="hint">A newer proposal of ${esc(p.feature)} replaced this one.</p></div>`;
  const asked = isObj(p.asked) ? `<p class="hint">${esc(`${p.asked.by ?? "Someone"} asked ${approverWords(p.asked.to)} to approve it${at(p.asked)}.`)}</p>` : "";
  if (p.state === "not_now") {
    const later = `<p class="hint">${esc(`Not now${p.answered?.by ? `, said ${p.answered.by}` : ""}${at(p.answered)}: it stays proposed, in the backlog.`)}</p>`;
    return `<div class="gcard feat later">${head}${body}${later}<div class="acts">${p.you_may_approve ? btn("approve", "Approve feature") : btn("ask", `Ask ${approverWords(p.approvers)} to approve`)}</div></div>`;
  }
  if (p.you_may_approve) return `<div class="gcard prop feat">${head}${body}<div class="acts">${btn("approve", "Approve feature", true)}${btn("not_now", "Not now")}</div>${asked}<p class="hint">Approving it is your Requirements decision for this feature alone. The statement of the job gets a new version with it.</p></div>`;
  if (p.state === "asked") return `<div class="gcard feat">${head}${body}<div class="acts"><span class="btn used">${esc(`Waiting on ${approverWords(p.asked?.to ?? p.approvers)}`)}</span>${btn("not_now", "Not now")}</div>${asked}</div>`;
  return `<div class="gcard prop feat">${head}${body}<div class="acts">${btn("ask", `Ask ${approverWords(p.approvers)} to approve`, true)}${btn("not_now", "Not now")}</div><p class="hint">${esc(`Only ${approverWords(p.approvers)} may approve features. Asking tells them, and they see this same proposal.`)}</p></div>`;
}

/** Every feature a reply proposes, each with its own answer. ctx.featPending: the answer being sent. */
export function featureProposalsHtml(m, ctx = {}) {
  return list(m?.features).map((p) => featureProposalHtml(p, m, { when: ctx.when ?? when0, pending: ctx.featPending ?? null })).join("");
}

/** What the person answers a feature with: the route's path and body, from a button's data. */
export function featureDecision(d) {
  if (!isObj(d) || !["approve", "not_now", "ask"].includes(d.feat) || !str(d.featId) || !str(d.featProposal) || !str(d.featBuild)) return null;
  return {
    path: `/builds/${encodeURIComponent(d.featBuild)}/features/${encodeURIComponent(d.featId)}/${d.feat}`,
    body: { proposal: d.featProposal, ...(str(d.featMessage) ? { message: d.featMessage } : {}) },
  };
}

/**
 * The Requirements gate when the build carries features: only what the
 * statement still leaves open, the features it starts building with (those
 * approved in a chat marked so, not asked again), the ones left for later,
 * and the build's own actions, its approve labelled "Start building with
 * these features". ctx.actionsHtml(stage, { labels }): the gate's buttons.
 */
export function requirementsGateHtml(ws, g, ctx = {}) {
  const f = isObj(g.features) ? g.features : { approved: [], to_approve: [], backlog: [] };
  const one = (x, said) => `<li><span class="fid">${esc(str(x.id))}</span> ${esc(str(x.name))}${said ? ` <small>${esc(said)}</small>` : ""}</li>`;
  const open = list(g.open).map(str).filter(Boolean);
  const building = [...list(f.approved).map((x) => one(x, "approved")), ...list(f.to_approve).map((x) => one(x, "approved when you start"))];
  const acts = ctx.actionsHtml ? ctx.actionsHtml(ws.stage, { labels: { approve: "Start building with these features" } }) : "";
  const who = str(g.who_may);
  const may = !acts && (ws.whoWords || who) ? `<p class="whomay" role="note">${esc(ws.whoWords || who)}</p>` : "";
  return `<div class="gcard${acts ? " gate" : ""} rgate" id="gate"><h4>${esc(acts ? "Ready to build" : "Waiting at this gate")}</h4>
    ${open.length ? `<p class="gl">Still open</p><ul class="open">${open.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : `<p class="gl">Nothing is still open.</p>`}
    <p class="gl">Start building with these features</p>${building.length ? `<ul class="fgate">${building.join("")}</ul>` : `<p class="hint">None yet.</p>`}
    ${list(f.backlog).length ? `<p class="hint">Not now: ${list(f.backlog).map((x) => `${esc(str(x.id))} ${esc(str(x.name))}`).join(", ")}.</p>` : ""}${acts}${may}</div>`;
}

/** The line above a reader opened at a feature: "At F3: Empty passage". */
export function focusHtml(a, feature, name = "") {
  if (!feature || !isObj(a)) return "";
  return `<p class="ffocus">At <b>${esc(feature)}</b>${name ? `: ${esc(name)}` : ""} <button class="linkbtn" type="button" data-feat-unfocus>Show all</button></p>`;
}

const CELL_WORD = { done: "Done", stale: "Stale", missing: "Missing", failing: "Failing" };
const BADGE_WORD = { new: "New", changed: "Changed", unchanged: "Unchanged" };

/**
 * The Features matrix: one row per feature, one cell per column. A cell opens
 * its artifact at that feature (data-feat-cell); a row's name opens its
 * history (data-feat-row). With filter, a version filter above it
 * (data-feat-version). ctx.selected: the feature whose history is open;
 * ctx.history: that history's answer.
 */
export function featuresMatrixHtml(m, ctx = {}) {
  if (ctx.error && !isObj(m)) return `<p class="gw err">${esc(ctx.error)}</p>`;
  if (!isObj(m)) return `<p class="gw">Loading…</p>`;
  const rows = list(m.features).filter((x) => isObj(x) && str(x.id));
  const versions = list(m.versions).filter((v) => isObj(v) && str(v.version));
  const filter = ctx.filter && versions.length ? `<label class="fver">Version <select data-feat-version>${versions.map((v) => `<option value="${esc(v.version)}"${v.version === m.version ? " selected" : ""}>${esc(v.version)}</option>`).join("")}</select></label>` : "";
  const counts = rows.reduce((n, r) => { for (const [k] of FEATURE_COLUMNS) { const s = r.cells?.[k]?.state; if (s) n[s] = (n[s] ?? 0) + 1; } return n; }, {});
  const sum = rows.length ? `<p class="fsum">${rows.length} ${rows.length === 1 ? "feature" : "features"} in ${esc(str(m.version))}${counts.failing ? ` · <span class="c-failing">${counts.failing} failing</span>` : ""}${counts.stale ? ` · <span class="c-stale">${counts.stale} stale</span>` : ""}</p>` : "";
  const head = `<div class="fhead">${sum}${filter}</div>`;
  if (!rows.length) return `${head}<p class="gw">${esc(str(m.words) || "No features yet.")}</p>`;
  const cell = (r, k) => {
    const c = isObj(r.cells?.[k]) ? r.cells[k] : { state: "missing", words: "" };
    const st = CELL_WORD[c.state] ? c.state : "missing";
    const l = isObj(c.link) && str(c.link.artifact) && str(c.link.build) ? c.link : null;
    const inner = `<span class="cs" aria-hidden="true"></span><span class="cw">${esc(str(c.words) || CELL_WORD[st])}</span>`;
    const label = `${r.id} ${k}: ${CELL_WORD[st]}${str(c.words) ? `, ${str(c.words)}` : ""}`;
    return `<td class="fc ${st}">${l ? `<button type="button" class="fcell" data-feat-cell="${esc(r.id)}" data-cell-build="${esc(l.build)}" data-cell-stage="${esc(str(l.stage))}" data-cell-artifact="${esc(l.artifact)}" aria-label="${esc(`${label}. Open it.`)}">${inner}</button>` : `<span class="fcell" aria-label="${esc(label)}">${inner}</span>`}</td>`;
  };
  const tr = (r) => {
    const badge = BADGE_WORD[r.badge] ? `<span class="fb b-${esc(r.badge)}">${BADGE_WORD[r.badge]}</span>` : "";
    const state = r.state === "proposed" ? `<span class="fb b-prop">${r.backlog ? "Not now" : "Proposed"}</span>` : "";
    const on = r.id === ctx.selected;
    return `<tr class="${on ? "sel" : ""}"><th scope="row"><button type="button" class="frow" data-feat-row="${esc(r.id)}" aria-expanded="${on}" title="${esc(str(r.does))}"><span class="fid">${esc(r.id)}</span><span class="fn">${esc(str(r.name))}</span></button>${badge}${state}${str(r.offering) ? `<small>${esc(str(r.offering))}</small>` : ""}</th>${FEATURE_COLUMNS.map(([k]) => cell(r, k)).join("")}</tr>`;
  };
  const table = `<div class="fmx-scroll"><table class="fmx"><thead><tr><th scope="col">Feature</th>${FEATURE_COLUMNS.map(([, h]) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(tr).join("")}</tbody></table></div>`;
  const legend = `<p class="flegend">${Object.entries(CELL_WORD).map(([k, w]) => `<span class="fc ${k}"><span class="cs" aria-hidden="true"></span>${w}</span>`).join("")}</p>`;
  const hist = ctx.selected ? featureHistoryHtml(ctx.history, { when: ctx.when ?? when0, stageName: ctx.stageName, product: str(m.product), error: ctx.historyError }) : "";
  return `${head}${table}${legend}${hist}`;
}

const KIND_WORD = { proposed: "Proposed", approved: "Approved", not_now: "Not now", asked: "Asked", spec: "Spec", tests: "Tests", code: "Code", review: "Review", docs: "Docs" };

/** Where a history entry's link goes: the chat it was said in, or the artifact at the feature. */
export function historyHref(e, product) {
  const l = isObj(e?.link) ? e.link : null;
  if (!l) return null;
  const b = encodeURIComponent(str(e.build));
  if (l.kind === "message") return str(l.stage) ? `#/b/${b}/${encodeURIComponent(l.stage)}/chat` : `#/p/${encodeURIComponent(product)}/boss`;
  if (l.kind === "artifact") return null;
  return null;
}

/** One feature's history, oldest first: each entry with when, what, who and its link. */
export function featureHistoryHtml(h, { when = when0, stageName = (x) => x, product = "", error = "" } = {}) {
  if (error) return `<div class="fhist"><p class="gw err">${esc(error)}</p></div>`;
  if (!isObj(h)) return `<div class="fhist"><p class="gw">Loading its history…</p></div>`;
  const f = isObj(h.feature) ? h.feature : {};
  const items = list(h.history).filter(isObj).map((e) => {
    const href = historyHref(e, product);
    const art = isObj(e.link) && e.link.kind === "artifact" && str(e.link.artifact)
      ? `<button type="button" class="linkbtn" data-feat-cell="${esc(str(f.id))}" data-cell-build="${esc(str(e.build))}" data-cell-stage="" data-cell-artifact="${esc(e.link.artifact)}">Open it</button>` : "";
    const link = href ? `<a href="${esc(href)}">Open the message</a>` : art;
    return `<li class="fh ${esc(str(e.kind))}"><time>${esc(when(e.at))}</time><span class="fk">${esc(KIND_WORD[e.kind] ?? cap(str(e.kind)))}</span><span class="fv">v${esc(str(e.version))}</span><p>${esc(str(e.words))}${str(e.by) ? ` <small>${esc(str(e.by))}</small>` : ""}</p>${link}</li>`;
  }).join("");
  return `<div class="fhist" aria-label="${esc(`The history of ${str(f.id)}`)}"><h4><span class="fid">${esc(str(f.id))}</span> ${esc(str(f.name))}</h4><p class="fdoes">${esc(str(f.does))}${str(f.offering) ? ` <small>in ${esc(str(f.offering))}</small>` : ""}</p>${items ? `<ol class="fhl">${items}</ol>` : `<p class="gw">Nothing has happened to it yet.</p>`}</div>`;
}

/** The stage an artifact is made at, for a cell whose link names no stage. */
export const ARTIFACT_STAGE = { statement: "requirements", architecture: "architecture", suite: "test", programs: "code", findings: "review", security: "security", package: "package", build_record: "release", run_plan: "deploy", attestation: "conformance", agentdoc: "docs" };

/** Where a cell opens: the build, the stage and the artifact, at the feature. */
export function cellTarget(d) {
  if (!isObj(d) || !str(d.featCell) || !str(d.cellBuild) || !str(d.cellArtifact)) return null;
  const stage = str(d.cellStage) || ARTIFACT_STAGE[d.cellArtifact] || null;
  if (!stage) return null;
  return { build: d.cellBuild, stage, artifact: d.cellArtifact, feature: d.featCell, hash: `#/b/${encodeURIComponent(d.cellBuild)}/${encodeURIComponent(stage)}/artifacts` };
}
