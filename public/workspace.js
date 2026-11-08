// The build page, one stage at a time. The left menu is the product: its
// build's stages as a spine, then the other products. The rest is the
// selected stage: a header that stays put (its name, its tabs, and its gate
// when it waits on you), then the tab below it. Chat is the session with the
// agent holding the stage, kept per product across builds. Artifacts is what
// the stage read (Given) and made (Outputs), each opened in a reader per kind.
// A product page has tabs for its versions, run plan and activity.
//
// Each stage has a cadence (stages.json 1.3.0, lifecycle API 0.4.2). The spine
// is the build's steps: the every-build stages it runs. The stages set up once
// per product are the product page's Setup checklist, and the when-needed
// actions are buttons on the product page, enabled only when the service says
// it can run them.
//
// Everything here builds HTML from what the service answered and nothing else,
// so the tests can read it without a browser (test/workspace.test.mjs). The
// routes it reads are lifecycle API 0.4 additions (docs/contract.md); a service
// without them still gets each stage, made from the build answer (fallback*).

import { esc, safeUrl } from "./roles.js";

// The stages a build's lifecycle does not use, or the service does not run: not on the spine.
const OFF = new Set(["not_used", "not_offered", "not_applicable"]);
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const words = (v) => list(v).map(str).filter(Boolean);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The stages this build uses, in the build's order. */
export function usedStages(build) {
  return list(build?.stages).filter((s) => s && !OFF.has(s.state));
}

/** A stage's cadence: the build's word for it (0.4.2), else stages.json's, else every_build (a service from before cadences). */
export function cadenceOf(stage, defs = new Map()) {
  const c = str(stage?.cadence) || str(defs.get?.(stage?.stage)?.cadence);
  return ["every_build", "setup", "when_needed"].includes(c) ? c : "every_build";
}

/** The build's steps: the every-build stages it runs, in the build's order. Setup and when-needed stages are the product's, not a build's. */
export function stepStages(build, defs = new Map()) {
  return usedStages(build).filter((s) => cadenceOf(s, defs) === "every_build");
}

/** The stage the build is at now, or null when every step it runs is done. */
export function currentStage(build, defs = new Map()) {
  const used = stepStages(build, defs);
  return used.find((s) => s.state === "waiting_on_you")
    ?? used.find((s) => ["working", "stopped", "refused"].includes(s.state))
    ?? used.find((s) => s.state !== "done")
    ?? null;
}

/** The stage a build opens at: the one it is at now, or its last step when it is done. */
export function openingStage(build, defs = new Map()) {
  return (currentStage(build, defs) ?? stepStages(build, defs).at(-1) ?? null)?.stage ?? null;
}

/** The product a build belongs to: the build's own product when it names one, else its name. */
export const productOf = (build) => str(build?.product) || str(build?.name);

/** "pull request #5", from a pull request's address. */
export function prShort(url) {
  const m = /\/pull\/(\d+)/.exec(String(url ?? ""));
  return m ? `pull request #${m[1]}` : "the pull request";
}
function prRepo(url) {
  const m = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\//.exec(String(url ?? ""));
  return m ? m[1] : "";
}

/** The role a stage's holder holds: the holder's own role when it names one, else the stage's role the reference agent fills, else its first role. */
export function roleOf(stage, def, roleDefs = []) {
  if (typeof stage?.holder?.role === "string" && stage.holder.role) return stage.holder.role;
  const ids = list(def?.role_ids);
  if (stage?.holder?.kind === "reference_agent") {
    const hit = ids.find((id) => roleDefs.find((r) => r.id === id)?.reference_agent === stage.holder.name);
    if (hit) return hit;
  }
  return ids[0] ?? null;
}

/** What a holder is called: the role's name for the service's own agent, the holder's own name otherwise. */
export function holderName(holder, stage, def, roleDefs = []) {
  const h = holder;
  if (!isObj(h)) return "";
  if (h.kind === "reference_agent") {
    const r = roleDefs.find((x) => x.id === roleOf({ ...stage, holder: h }, def, roleDefs));
    return r?.name ?? cap(String(h.name ?? "").replace(/-/g, " "));
  }
  if (h.kind === "person" && /^you$/i.test(String(h.name ?? ""))) return "You";
  return str(h.name);
}

/** Whether there is an agent to talk to at a stage: a holder that is neither a person nor an outside tool. */
export const canTalkTo = (holder) => isObj(holder) && !["person", "outside_tool"].includes(holder.kind);

// ---------- the spine ----------

/** The build's steps for the spine: each every-build stage it runs, numbered, marked done, now or next, with a short line. */
export function steps(build, { defs = new Map(), roleDefs = [], when = (x) => x } = {}) {
  const used = stepStages(build, defs);
  const now = currentStage(build, defs);
  let firstNext = true;
  return used.map((s, i) => {
    const def = defs.get(s.stage) ?? {};
    const mark = s.state === "done" ? "done" : s === now ? "now" : "next";
    let line;
    if (s.state === "not_bound") line = "nobody holds it";
    else if (mark === "done") {
      const r = list(s.rounds)[0];
      const art = list(build.artifacts).filter((a) => a?.stage === s.stage && a.state === "made").at(-1);
      line = r?.verdict ? `${r.verdict.toLowerCase()}${r.at && when(r.at) ? ` ${when(r.at)}` : ""}` : art?.version ? str(art.version) : "done";
    } else if (mark === "now") {
      if (s.state === "waiting_on_you") {
        const main = list(build.actions).find((a) => a?.stage === s.stage && a.name !== "stop");
        line = s.where?.kind === "pull_request" ? `your OK on ${prShort(s.where.url)}` : main?.label ? `waiting on you: ${main.label.toLowerCase()}` : "waiting on you";
      } else line = { working: "working", stopped: "stopped", refused: "refused", not_started: "next" }[s.state] ?? "";
    } else {
      line = firstNext ? "next" : def.person_gate ? "your approval" : holderName(s.holder, s, def, roleDefs).toLowerCase() || "later";
      firstNext = false;
    }
    return { stage: s.stage, name: def.name ?? cap(s.stage), number: i + 1, mark, state: s.state, line };
  });
}

/** The line under the product's name: "Step 4 of 11 · waiting on you", or where the build ended. */
export function stepHeader(build, spine) {
  const at = spine.findIndex((x) => x.mark === "now");
  if (at < 0) return { text: str(build?.summary) || `Done · ${spine.length} ${spine.length === 1 ? "step" : "steps"}`, tone: "ok" };
  const s = spine[at];
  const state = { waiting_on_you: "waiting on you", working: "working", stopped: "stopped", refused: "refused", not_bound: "nobody holds it" }[s.state] ?? "next";
  return { text: `Step ${at + 1} of ${spine.length} · ${state}`, tone: s.state === "waiting_on_you" || s.state === "not_bound" ? "wait" : s.state === "refused" || s.state === "stopped" ? "bad" : "" };
}

/** The product at the top of the menu, then its build's stages: selecting one opens it. */
export function spineHtml(build, spine, { sel = null, href = (s) => `#${s}`, productHref = "#", onProduct = false } = {}) {
  const head = stepHeader(build, spine);
  const items = spine.map((x) => {
    const on = x.stage === sel;
    const dot = x.mark === "done" ? "✓" : String(x.number);
    return `<a class="rs ${x.mark}${on ? " sel" : ""}" href="${esc(href(x.stage))}"${on ? ' aria-current="page"' : ""} aria-label="${esc(`${x.number}. ${x.name}: ${x.line}`)}"><span class="dot" aria-hidden="true">${esc(dot)}</span><span class="rn">${esc(x.name)}</span><small>${esc(x.line)}</small></a>`;
  }).join("");
  return `<a class="rb${onProduct ? " on" : ""}" href="${esc(productHref)}"${onProduct ? ' aria-current="page"' : ""} title="The product: its versions, run plan and activity"><b>${esc(productOf(build))} ${build.version ? `<span>${esc(build.version)}</span>` : ""}</b><small class="${head.tone}">${esc(head.text)}</small></a><div class="spine">${items}</div>`;
}

/** What another product waits on, from the products answer's latest build: "Waiting on you at Code". */
export function productLine(p, { stageName = (x) => x } = {}) {
  const at = isObj(p?.latest?.at) ? p.latest.at : null;
  const name = at ? stageName(str(at.stage)) : "";
  const said = str(at?.summary);
  if (!at) return { text: p?.latest?.version ? `Version ${p.latest.version}` : "", wait: false };
  if (said) return { text: said, wait: at.state === "waiting_on_you" };
  if (at.state === "waiting_on_you") return { text: `Waiting on you at ${name}`, wait: true };
  if (at.state === "done") return { text: "Done", wait: false };
  if (at.state === "stopped") return { text: `Stopped at ${name}`, wait: false };
  if (at.state === "refused") return { text: `Refused at ${name}`, wait: false };
  if (at.state === "working") return { text: `${name} · working`, wait: false };
  return { text: `${name} · next`, wait: false };
}

// ---------- the stage ----------

/**
 * The selected stage as one shape, from GET /builds/:id/stages/:stage when the
 * service answers it, else made from the build answer: the stage's state,
 * holder, rounds and handed-back words and files, its live actions as the gate,
 * and stages.json's done-when.
 */
export function stageWorkspace(build, stageId, answer = null, { defs = new Map() } = {}) {
  const s = list(build?.stages).find((x) => x.stage === stageId) ?? { stage: stageId, state: "not_offered", holder: null };
  const def = defs.get(stageId) ?? {};
  const arts = new Map(list(build?.artifacts).filter((a) => a && typeof a.id === "string").map((a) => [a.id, a]));
  const live = list(build?.actions).filter((a) => a?.stage === stageId);
  const base = {
    stage: stageId, name: def.name ?? cap(stageId), where: s.where ?? null, rounds: list(s.rounds), log: list(s.log),
    givenWords: str(s.given), handedBack: isObj(s.handed_back) ? s.handed_back : { words: [], files: [] }, evidence: list(s.evidence),
    youMay: s.gate?.you_may_answer, whoWords: str(s.gate?.words),
  };
  if (isObj(answer) && answer.stage === stageId) {
    return {
      ...base, from: "service", name: str(answer.name) || base.name,
      state: str(answer.state) || s.state, holder: isObj(answer.holder) ? answer.holder : s.holder ?? null,
      given: words(answer.given).map((id) => arts.get(id)).filter(Boolean),
      outputs: list(answer.outputs).filter((a) => a && typeof a.id === "string"),
      gate: isObj(answer.gate) ? answer.gate : live.length ? { actions: live.map((a) => a.name), state: "open" } : null,
      doneWhen: str(answer.done_when) || str(def.done_when),
    };
  }
  return {
    ...base, from: "build",
    state: s.state, holder: s.holder ?? null,
    given: [],
    outputs: [...arts.values()].filter((a) => a.stage === stageId),
    gate: live.length ? { actions: live.map((a) => a.name), state: "open" } : null,
    doneWhen: str(def.done_when),
  };
}

/** A done-when from stages.json, as one line: its list items joined. */
function doneWhenWords(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines.filter((l) => !l.startsWith("- ")).join(" ");
  const items = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  return [head.replace(/:$/, ""), items.join("; ")].filter(Boolean).join(": ");
}

const ACTION_DONE = { approve: "Approved", accept: "Accepted", changes: "Changes asked for", back_to_test: "Sent back to Test", send_back: "Sent back", stop: "Stopped", resume: "Resumed", archive: "Archived" };
/** An answered gate's words: "Approved by you · 2:21 PM". */
export function answeredWords(answered, build, when = (x) => x) {
  const a = isObj(answered) ? answered : {};
  const live = list(build?.actions).find((x) => x?.name === a.action);
  const did = ACTION_DONE[a.action] ?? (live?.label || cap(String(a.action ?? "answered").replace(/_/g, " ")));
  const by = str(a.by);
  return `${did}${by ? ` by ${by}` : ""}${a.at && when(a.at) ? ` · ${when(a.at)}` : ""}`;
}

/**
 * The gate card pinned at the top of a stage: open with the build's live
 * actions when it waits on you, in a done style once answered, and the words
 * for who may answer when this person may not.
 */
export function gateCardHtml(ws, build, ctx = {}) {
  const g = ws.gate;
  const when = ctx.when ?? ((x) => x);
  const dw = ws.doneWhen ? `<p class="dw"><span>Done when</span> ${esc(doneWhenWords(ws.doneWhen))}</p>` : "";
  if (!g) return "";
  if (g.state === "answered" && !isObj(g.answered)) {
    return `<div class="gcard" id="gate"><h4>${esc(ws.name)}: closed</h4>${dw}<p>${esc(str(g.closed) || "It closed without an answer.")}</p></div>`;
  }
  if (g.state === "answered") {
    return `<div class="gcard done" id="gate"><h4>${esc(ws.name)}: answered</h4>${dw}<div class="acts"><span class="btn used">${esc(answeredWords(g.answered, build, when))}</span></div></div>`;
  }
  const check = ws.where?.kind === "pull_request" ? ws.where.check : null;
  const items = words(check?.items);
  const chips = items.length ? (items.every((x) => x.length <= 40) ? `<div class="chips">${items.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : `<ul class="citems">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`) : "";
  const url = ws.where?.kind === "pull_request" ? safeUrl(ws.where.url) : null;
  const acts = ctx.actionsHtml ? ctx.actionsHtml(ws.stage) : "";
  const who = words(g.who_may).length ? words(g.who_may).join(", ") : str(g.who_may);
  const may = !acts && (ws.whoWords || who) ? `<p class="whomay" role="note">${esc(ws.whoWords || `${cap(who)} may answer this gate.`)}</p>` : "";
  const title = check?.title ? `${cap(prShort(ws.where.url))}: ${check.title}` : acts ? "Waiting on you" : "Waiting at this gate";
  return `<div class="gcard${acts ? " gate" : ""}" id="gate"><h4>${esc(title)}</h4>${check?.words ? `<p>${esc(check.words)}</p>` : ""}${chips}${dw}${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open ${esc(prShort(url))}</a></p>` : ""}${acts}${may}${acts && url && ctx.checkHtml ? `<details class="clonecheck"${ctx.cloneOpen ? " open" : ""}><summary>Run its check in your clone</summary>${ctx.checkHtml()}</details>` : ""}</div>`;
}

// ---------- the chat ----------

/** Whether a messages answer means the service has the route: a 404, 405 or 501 means it does not. */
export const messagesOffered = (status) => ![404, 405, 501].includes(status);

/** A stage's chat for a service without the messages route: made from the stage's rounds, log and hand-back. Read only. */
export function fallbackChat(build, stageId, { defs = new Map(), roleDefs = [] } = {}) {
  const s = list(build?.stages).find((x) => x.stage === stageId);
  if (!s) return [];
  const def = defs.get(stageId);
  const name = holderName(s.holder, s, def, roleDefs) || def?.name || stageId;
  const from = { kind: "agent", name, stage: stageId };
  const v = { build: build.id, version: str(build.version) };
  const out = [];
  if (usedStages(build)[0]?.stage === stageId && str(build.does)) {
    out.push({ id: "f-request", at: build.lifecycle?.at ?? null, from: { kind: "person", name: "you" }, text: str(build.does), ...v });
  }
  const evs = [];
  list(s.rounds).forEach((r, i) => evs.push({ id: `f-r${i}`, at: r.at, from, text: `${r.label}: ${r.verdict}.${r.words ? ` ${r.words}` : ""}`, ...v }));
  list(s.log).forEach((e, i) => evs.push({ id: `f-l${i}`, at: e.at, from: { kind: "system", name: "" }, text: str(e.said), ...v }));
  evs.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
  if (s.where?.kind === "pull_request") {
    const repo = prRepo(s.where.url);
    out.push({ id: "f-pr", at: evs[0]?.at ?? null, from: { kind: "system", name: "" }, text: `${cap(prShort(s.where.url))}${repo ? ` on ${repo}` : ""}.`, link: s.where.url, ...v });
  }
  out.push(...evs);
  return out;
}

export function initials(name) {
  const w = String(name ?? "").trim().split(/[\s-]+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}

function paras(text) {
  const parts = String(text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** A proposed change in an agent's reply: a confirm button that takes the build's own action, with the needs filled. */
export function proposalHtml(m, build, { done = false, pending = null } = {}) {
  const p = m?.proposes;
  if (!isObj(p) || typeof p.action !== "string") return "";
  const live = list(build?.actions).find((a) => a?.name === p.action);
  const needs = isObj(p.needs) ? p.needs : {};
  const shown = Object.entries(needs).filter(([, v]) => str(v)).map(([k, v]) => {
    const label = list(live?.needs).find((n) => n.name === k)?.label ?? cap(k.replace(/_/g, " "));
    return `<p class="pn"><span>${esc(label)}</span>${esc(str(v))}</p>`;
  }).join("");
  const title = live?.label ?? cap(p.action.replace(/_/g, " "));
  if (done) return `<div class="gcard done"><h4>${esc(title)}</h4>${shown}<div class="acts"><span class="btn used">Confirmed</span></div></div>`;
  if (!live) return `<div class="gcard"><h4>${esc(title)}</h4>${shown}<p class="hint">The build does not offer that now.</p></div>`;
  return `<div class="gcard prop"><h4>${esc(title)}?</h4>${shown}<div class="acts"><button class="btn p" type="button" data-confirm="${esc(m.id)}"${pending !== null ? " disabled" : ""}>${esc(pending === live.name ? "Sending…" : `Confirm: ${title}`)}</button></div><p class="hint">It goes back through this stage's gate.</p></div>`;
}

/** What the actions route is sent when a proposal is confirmed, or null when the build does not offer it now. */
export function confirmBody(build, proposes) {
  const live = list(build?.actions).find((a) => a?.name === proposes?.action);
  if (!live) return null;
  const needs = {};
  for (const [k, v] of Object.entries(isObj(proposes.needs) ? proposes.needs : {})) if (str(v)) needs[k] = str(v);
  return { stage: live.stage, name: live.name, needs };
}

/** One message of a stage's chat, marked with the version it was said in. */
export function messageHtml(m, ctx = {}) {
  const k = m?.from?.kind;
  const when = ctx.when ?? ((x) => x);
  const at = m.at && when(m.at) ? `<em>${esc(when(m.at))}</em>` : "";
  const ver = str(m.version) ? `<i class="vt" title="Said while building version ${esc(str(m.version))}">v${esc(str(m.version))}</i>` : "";
  if (k === "system") {
    const url = m.link ? safeUrl(m.link) : null;
    return `<div class="tsys">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(m.text)}</a>` : esc(m.text)}${ver ? ` ${ver}` : ""}${at ? ` ${at}` : ""}</div>`;
  }
  if (k === "person") {
    const name = str(m.from?.name);
    const me = /^you$/i.test(name) || (ctx.me && name === ctx.me);
    const shown = me ? "You" : name || "Someone";
    const av = me ? (ctx.me ? initials(ctx.me) : "You") : initials(name);
    return `<div class="msg mine"><div class="av me" aria-hidden="true">${esc(av)}</div><div><div class="mwho">${esc(shown)}${ver}${at}</div><div class="mbody"><span class="bubble">${esc(m.text).replace(/\n/g, "<br>")}</span>${attHtml(m.attachments, ctx)}</div></div></div>`;
  }
  const name = str(m.from?.name) || "The agent";
  return `<div class="msg"><div class="av${ctx.theirs ? " cc" : ""}" aria-hidden="true">${esc(initials(name))}</div><div><div class="mwho">${esc(name)}${ver}${at}</div><div class="mbody">${paras(m.text)}${attHtml(m.attachments, ctx)}${proposalHtml(m, ctx.build, { done: ctx.confirmed?.has(m.id), pending: ctx.pending ?? null })}</div></div></div>`;
}

function attHtml(ids, ctx) {
  const arts = ctx.artifacts ?? new Map();
  return list(ids).map((id) => {
    const a = arts.get(id);
    if (!a) return "";
    const tag = a.state === "made" ? str(a.version) : STATE_TAG[a.state]?.toLowerCase() ?? "";
    return `<button class="att${ctx.selected === id ? " sel" : ""}" type="button" data-art="${esc(id)}">${esc(a.name)}${tag ? ` <i>${esc(tag)}</i>` : ""}</button>`;
  }).join("");
}

/** The chat: oldest first, each message marked with its version, with a line where a new version's build begins. */
export function chatHtml(messages, ctx = {}) {
  const ms = list(messages).filter((m) => isObj(m) && !m.gate && m.from?.kind !== "gate");
  if (!ms.length) return `<div class="tsys empty">${esc(ctx.empty ?? "Nothing has been said here yet.")}</div>`;
  let last = null;
  return ms.map((m) => {
    const v = str(m.version);
    const sep = v && last !== null && v !== last ? `<div class="ver">Version ${esc(v)}</div>` : "";
    if (v) last = v;
    return sep + messageHtml(m, ctx);
  }).join("");
}

/** The composer, addressed to the agent holding the stage. */
export function composerHtml(agent, { draft = "", pending = false, error = "" } = {}) {
  return `<div class="compose" id="compose"><div class="to">To <b>${esc(agent)}</b></div>
    <form class="box" id="say-form"><label class="sr" for="say">Your message to ${esc(agent)}</label><input id="say" type="text" value="${esc(draft)}" autocomplete="off" placeholder="Ask about what it read or made, or say what should change. A change goes back through the gate."><button class="btn p" type="submit"${pending ? " disabled" : ""}>${pending ? "Sending…" : "Send"}</button></form>
    ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}<div class="hint">Answering changes nothing. A change is proposed here for you to confirm.</div></div>`;
}

// ---------- artifacts ----------

const STATE_TAG = { next: "Next", later: "Later", not_made: "Not made", not_run: "Not run" };
const STATE_SAID = {
  next: "It is made next.",
  later: "It is made later in this build.",
  not_made: "This build did not make it.",
  not_run: "This stage is in the lifecycle, but nothing ran it.",
};

const dl = (rows, cls = "") => {
  const r = rows.filter(([, v]) => v);
  return r.length ? `<dl${cls ? ` class="${cls}"` : ""}>${r.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : "";
};

/** An artifact's summary, readably, per kind. Only the fields each kind names are read, and only as words: never raw JSON. */
export function artifactBodyHtml(a, { stageName = (x) => x } = {}) {
  const s = isObj(a?.summary) ? a.summary : null;
  if (!s) return "";
  switch (a.kind) {
    case "statement": {
      const offers = list(s.offerings).filter(isObj).map((o) => `<b>${esc(str(o.name))}</b>${str(o.does) ? `: ${esc(str(o.does))}` : ""}`);
      const open = words(s.open);
      return dl([
        ["Agent", esc(str(s.agent))],
        [offers.length > 1 ? "Offerings" : "Offering", offers.join("<br>")],
        ["Refuses", esc(words(s.refuses).join("; "))],
        ["Records", esc(words(s.records).join("; "))],
        ["Price", esc(str(s.price))],
      ]) + (open.length ? `<p class="open"><b>Still open:</b></p><ul class="open">${open.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : "");
    }
    case "suite": {
      const tests = words(s.tests);
      const count = Number.isInteger(s.count) ? s.count : tests.length;
      const shown = tests.slice(0, 8);
      const more = count - shown.length;
      return `<p>${count} ${count === 1 ? "test" : "tests"}.</p>${shown.length ? `<ul>${shown.map((t) => `<li>${esc(t)}</li>`).join("")}${more > 0 ? `<li class="more">and ${more} more</li>` : ""}</ul>` : ""}`;
    }
    case "programs": {
      const rows = list(s.scripts).filter(isObj).map((x) => {
        const n = Number.isInteger(x.lines) ? `${x.lines} ${x.lines === 1 ? "line" : "lines"}` : "";
        return [str(x.path), esc([n, str(x.does)].filter(Boolean).join(": ")) || "&nbsp;"];
      });
      const pr = isObj(s.pr) ? s.pr : str(s.pr) ? { url: str(s.pr) } : null;
      const prUrl = pr ? safeUrl(str(pr.url)) : null;
      const prName = Number.isInteger(pr?.number) ? `pull request #${pr.number}` : prUrl ? prShort(prUrl) : "";
      const where = [str(s.commit) ? `Commit <code>${esc(str(s.commit))}</code>` : "", prName ? (prUrl ? `on <a href="${esc(prUrl)}" target="_blank" rel="noopener noreferrer">${esc(prName)}</a>` : `on ${esc(prName)}`) : ""].filter(Boolean).join(" ");
      return `${dl(rows, "mono")}${where ? `<p>${where}.</p>` : ""}`;
    }
    case "findings": {
      const open = list(s.open).filter(isObj);
      const outside = list(s.outside).filter(isObj);
      const notes = outside.length ? `<p class="said">Noted outside the change, holding nothing up:</p><ul>${outside.map((f) => `<li>${str(f.place) ? `<code>${esc(str(f.place))}</code> ` : ""}${esc(str(f.claim))}</li>`).join("")}</ul>` : "";
      return notes + `${open.length ? `<p><b>${open.length} open</b></p><ul>${open.map((f) => `<li>${str(f.place) ? `<code>${esc(str(f.place))}</code> ` : ""}${esc(str(f.claim))}${str(f.consequence) ? ` ${esc(str(f.consequence))}` : ""}</li>`).join("")}</ul>` : `<p><b>Nothing open.</b></p>`}${str(s.verdict) ? `<p>${esc(str(s.verdict))}</p>` : ""}`;
    }
    case "security":
      return dl([
        ["May reach", esc(words(s.reach).join("; ") || "nothing")],
        ["May spend", esc(str(s.spend))],
        ["Must never", esc(words(s.never).join("; "))],
      ]) + (str(s.verdict) ? `<p><b>${esc(cap(str(s.verdict)))}</b></p>` : "");
    case "package":
      return dl([
        ["File", esc(str(s.file))],
        ["Digest", str(s.digest) ? `<code>${esc(str(s.digest))}</code>` : ""],
        ["Validated", s.validated === true ? "yes, with no problems" : s.validated === false ? "no" : ""],
      ]);
    case "run_plan":
      return runPlanHtml(s, { stageName });
    default:
      return str(s.words) ? `<p>${esc(str(s.words))}</p>` : "";
  }
}

/** A run plan: who runs each stage once the agent is installed, and what it reads. */
export function runPlanHtml(plan, { stageName = (x) => x } = {}) {
  const rows = list(plan?.stages).filter(isObj).map((x) => {
    const who = str(x.holder) || (isObj(x.holder) ? str(x.holder.name) : "");
    const extra = [str(x.settings), str(x.reads) || words(x.reads).join(", ")].filter(Boolean).join(" · ");
    return [str(x.name) || stageName(str(x.stage)), `${who ? esc(who) : `<span class="none">nobody chosen</span>`}${extra ? `<small>${esc(extra)}</small>` : ""}`];
  });
  return rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>` : "";
}

/** The artifact the panel opens first: the newest output made, else the first output, else the first given. */
export function defaultArtifact(ws) {
  const outs = list(ws?.outputs);
  return (outs.filter((a) => a.state === "made").at(-1) ?? outs[0] ?? list(ws?.given)[0])?.id ?? null;
}

/** A tab bar: [{ id, label, count?, disabled?, title? }], one of them active. data-attr names what a click sets. */
export function tabsHtml(tabs, active, { attr = "tab", label = "Stage" } = {}) {
  return `<div class="tabs" role="tablist" aria-label="${esc(label)}">${tabs.map((t) => {
    const on = t.id === active;
    return `<button type="button" role="tab" class="tab${on ? " on" : ""}" aria-selected="${on}"${t.disabled ? ` disabled title="${esc(t.title ?? "")}"` : ` data-${attr}="${esc(t.id)}"`}>${esc(t.label)}${Number.isInteger(t.count) ? ` <span>${t.count}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

/** How many artifacts the Artifacts tab holds, for its count; null when it shows only words handed back, or nothing. */
export function artifactCount(ws) {
  const n = list(ws?.given).length + list(ws?.outputs).length;
  return n || null;
}

/**
 * The Artifacts tab: Given (what the stage read) and Outputs (what it made),
 * with the chosen artifact open in the reader beside them. A stage with no
 * artifacts from the service shows the words and files it was given and
 * handed back instead, or says there is nothing.
 */
export function artifactsTabHtml(ws, selId, ctx = {}) {
  const stageName = ctx.stageName ?? ((x) => x);
  const given = list(ws.given);
  const outputs = list(ws.outputs);
  const hb = ws.handedBack ?? {};
  const files = ctx.filesHtml ?? (() => "");
  if (!given.length && !outputs.length) {
    const w = words(hb.words);
    const f = list(hb.files);
    if (!w.length && !f.length && !ws.givenWords) return `<div class="atab none"><p class="gw">${esc(ws.name)} has no artifacts yet.</p></div>`;
    return `<div class="atab plain">${ws.givenWords ? `<div class="grp">Given</div><p class="gw">${esc(ws.givenWords)}</p>` : ""}${w.length || f.length ? `<div class="grp">Handed back</div>${w.map((x) => `<p class="gw">${esc(x)}</p>`).join("")}${f.length ? files(f) : ""}` : ""}</div>`;
  }
  const all = [...given, ...outputs];
  const sel = all.find((a) => a.id === selId) ?? all.find((a) => a.id === defaultArtifact(ws)) ?? all[0];
  const meta = [stageName(sel.stage), str(sel.by), str(sel.version), sel.at && ctx.when ? ctx.when(sel.at) : ""].filter(Boolean).join(" · ");
  const said = sel.state && sel.state !== "made" ? `<p class="said">${esc(STATE_SAID[sel.state] ?? "")}</p>` : "";
  const fl = list(sel.files).length ? `<div class="vfiles">${files(list(sel.files))}</div>` : "";
  const viewer = `<h3>${esc(sel.name)}</h3><div class="vm">${esc(meta)}${str(sel.digest) ? ` · <code>${esc(str(sel.digest).slice(0, 19))}</code>` : ""}</div>${said}${artifactBodyHtml(sel, { stageName })}${fl}`;
  const row = (a) => {
    const right = a.state === "made" || !a.state ? (str(a.version) ? `<span class="v">${esc(str(a.version))}</span>` : "") : `<span class="need ${esc(a.state)}">${esc(STATE_TAG[a.state] ?? a.state)}</span>`;
    const by = [given.includes(a) ? stageName(a.stage) : "", str(a.by)].filter(Boolean).join(" · ");
    return `<button class="arow${a.state === "made" || !a.state ? "" : " missing"}${a.id === sel.id ? " sel" : ""}" type="button" data-art="${esc(a.id)}" aria-pressed="${a.id === sel.id}"><b>${esc(a.name)}</b>${right}<small>${esc(by)}</small></button>`;
  };
  const made = outputs.filter((a) => a.state === "made").length;
  return `<div class="atab"><div class="viewer" id="reader">${viewer}</div><div class="alist"><p class="acount">${given.length} given · ${made} of ${outputs.length} made</p>
    <div class="grp">Given</div>${given.length ? given.map(row).join("") : `<p class="gw">${esc(ws.givenWords || "Nothing from an earlier stage.")}</p>`}
    <div class="grp">Outputs</div>${outputs.length ? outputs.map(row).join("") : `<p class="gw">Nothing yet.</p>`}</div></div>`;
}

// ---------- the product page ----------

/** A product page for a service without the products routes: its builds from the list, the run plan from the latest build's artifacts, the activity from its log. */
export function productFromBuilds(name, builds, latest = null) {
  const mine = list(builds).filter((b) => (str(b.product) || str(b.name)) === name);
  const plan = list(latest?.artifacts).find((a) => a?.kind === "run_plan" && a.state === "made");
  return {
    name,
    builds: [...mine].reverse().map((b) => ({ id: b.id, version: str(b.version), state: ["waiting_on_you", "refused", "stopped", "done"].includes(b.at?.state) ? b.at.state : "working", at: b.at ?? { stage: "requirements", state: "not_started" } })),
    ...(plan?.summary ? { run_plan: { build: latest.id, version: str(latest.version), at: plan.at ?? null, summary: plan.summary, files: list(plan.files) } } : {}),
    activity: list(latest?.stages).flatMap((s) => list(s.log).map((e) => ({ at: e.at, build: latest.id, version: str(latest.version), stage: s.stage, words: str(e.said) })))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))),
  };
}

export const PRODUCT_TABS = [
  { id: "boss", label: "Boss" },
  { id: "versions", label: "Versions" },
  { id: "setup", label: "Setup" },
  { id: "plan", label: "Run plan" },
  { id: "activity", label: "Activity" },
];

// ---------- setup and when needed (lifecycle API 0.4.2) ----------

/** A holder's settings as words: "every minutes: 5; alert after failures: 3". Never raw JSON. */
export function settingsWords(settings) {
  const out = [];
  const walk = (v, path) => {
    if (isObj(v)) { for (const [k, x] of Object.entries(v)) walk(x, [...path, k.replace(/_/g, " ")]); return; }
    const val = Array.isArray(v) ? v.map((x) => (isObj(x) ? Object.values(x).join(" ") : String(x))).join(", ") : String(v);
    out.push(`${path.join(" ")}: ${val}`);
  };
  if (isObj(settings)) walk(settings, []);
  return out.join("; ");
}

/** What a setup row says about when its choice holds from, when the service gave no words. */
function setupWords(x, roleName) {
  if (x.state === "not_chosen") return `To do: choose who holds the ${roleName(str(x.role))} role`;
  if (str(x.words)) return str(x.words);
  if (x.state === "not_used") return "Not part of this product's lifecycle";
  return str(x.since) ? `Unchanged since ${str(x.since)}` : "Chosen: it holds from the next version";
}

/** How many setup stages wait on a holder: nobody chosen. */
export const setupToDo = (items) => list(items).filter((x) => isObj(x) && x.state === "not_chosen").length;

/**
 * The Setup tab: each stage set up once per product, with its holder, its
 * settings and since when it has held. "Nobody chosen" is marked to do, with
 * a link to choose a holder on the Lifecycle page, which sets it with the
 * roles routes. ctx.chooseHref(role, stage, project): that link; none when
 * the page cannot change the lifecycle (read only).
 */
export function setupHtml(items, ctx = {}) {
  const stageName = ctx.stageName ?? ((x) => x);
  const roleName = ctx.roleName ?? ((x) => x);
  const rows = list(items).filter((x) => isObj(x) && str(x.stage));
  if (!rows.length) return `<p class="gw">This service lists no stages set up once.</p>`;
  const todo = setupToDo(rows);
  const row = (x) => {
    const mark = x.state === "chosen" ? "ok" : x.state === "not_chosen" ? "todo" : "off";
    const dot = mark === "ok" ? "✓" : mark === "todo" ? "!" : "–";
    const h = isObj(x.holder) ? x.holder : null;
    const who = h ? (h.kind === "reference_agent" ? `${roleName(str(x.role))}, the reference agent` : str(h.name)) : "";
    const set = settingsWords(x.settings);
    const href = ctx.chooseHref && x.state !== "not_used" ? ctx.chooseHref(str(x.role), str(x.stage), x.project ?? null) : null;
    const act = href ? `<a class="${mark === "todo" ? "btn p" : "linkbtn"}" href="${esc(href)}">${mark === "todo" ? "Choose a holder" : "Change"}</a>` : "";
    const holderLine = x.state === "chosen" ? `<p class="sh">${esc(who)}${set ? ` <small>${esc(set)}</small>` : " <small>No settings</small>"}</p>` : x.state === "not_chosen" ? `<p class="sh none">Nobody chosen</p>` : "";
    return `<li class="su ${mark}"><span class="dot" aria-hidden="true">${dot}</span><div class="sb"><b>${esc(str(x.name) || stageName(str(x.stage)))}</b> <span class="role">${esc(roleName(str(x.role)))}</span>${holderLine}<p class="since">${esc(setupWords(x, roleName))}</p></div>${act}</li>`;
  };
  return `<p class="gw sutop">${todo ? `${todo} to do: ${todo === 1 ? "a stage nobody holds" : "stages nobody holds"}.` : "Every stage set up once has a holder, or is left out."} Each is set up once for the product and carried forward to each new version until you change it.</p><ul class="setup">${rows.map(row).join("")}</ul>`;
}

/**
 * The when-needed actions as buttons: enabled only where the service says it
 * can run one, and then it takes the build's own action (data-when-act); every
 * other is disabled, with the service's words for why. No list, no buttons.
 */
export function whenNeededHtml(items, { stageName = (x) => x, pending = null } = {}) {
  const rows = list(items).filter((x) => isObj(x) && str(x.stage));
  if (!rows.length) return "";
  const can = (x) => x.can_run === true && isObj(x.action) && str(x.action.build) && str(x.action.name);
  const name = (x) => str(x.name) || stageName(str(x.stage));
  const btns = rows.map((x) => (can(x)
    ? `<button class="btn" type="button" data-when-act="${esc(str(x.stage))}"${pending !== null ? " disabled" : ""}>${esc(pending === str(x.stage) ? "Sending…" : str(x.action.label) || name(x))}</button>`
    : `<button class="btn" type="button" disabled title="${esc(str(x.why_not))}" aria-describedby="wn-${esc(str(x.stage))}">${esc(name(x))}</button>`)).join("");
  const off = rows.filter((x) => !can(x));
  const why = off.length ? `<details class="wnwhy"><summary>Why ${off.length === rows.length ? "they are" : off.length === 1 ? "one is" : "some are"} off</summary><dl>${off.map((x) => `<dt>${esc(name(x))}</dt><dd id="wn-${esc(str(x.stage))}">${esc(str(x.why_not) || "The service does not say.")}</dd>`).join("")}</dl></details>` : "";
  return `<div class="wneed" role="group" aria-label="When needed"><span class="wl">When needed</span>${btns}</div>${why}`;
}

/** The when-needed action a button takes: { build, name }, or null when the service does not say it can run it now. */
export function whenNeededAction(items, stage) {
  const x = list(items).find((i) => isObj(i) && i.stage === stage);
  return x && x.can_run === true && isObj(x.action) && str(x.action.build) && str(x.action.name) ? { build: str(x.action.build), name: str(x.action.name) } : null;
}

// ---------- the boss (lifecycle API 0.4.1) ----------

// A proposed action's name in words before its build offers it (once it does, the build's own label).
const ACTION_LABEL = { changes: "Ask for changes", back_to_test: "Send back to Test", resume: "Run it again", stop: "Stop" };

/** Where a routed message went: the stage's chat on its build. */
export const stageChatHref = (build, stage) => `#/b/${encodeURIComponent(build)}/${encodeURIComponent(stage)}/chat`;

/** A plan: the stages in order, what each must do, and the gate the person meets there. */
export function planHtml(plan, { stageName = (x) => x } = {}) {
  const steps = list(plan).filter((s) => isObj(s) && str(s.stage));
  if (!steps.length) return "";
  return `<ol class="plan">${steps.map((s) => `<li><b>${esc(stageName(str(s.stage)))}</b> ${esc(str(s.words))}${str(s.gate) ? `<small class="pgate"><span>Gate</span> ${esc(str(s.gate))}</small>` : ""}</li>`).join("")}</ol>`;
}

/**
 * A proposal in a boss reply, as a confirm button. start_version is confirmed
 * with the boss (data-boss-confirm); a build's own action with the actions route
 * (data-boss-act), and only once that build offers it. builds: the builds the
 * page has read, by id, for their live actions.
 */
export function bossProposalHtml(m, { builds = new Map(), confirmed = new Set(), pending = null } = {}) {
  const p = m?.proposes;
  if (!isObj(p) || !str(p.action) || !str(p.id)) return "";
  const done = confirmed.has(p.id) || p.state === "taken";
  const start = p.action === "start_version";
  const version = str(p.needs?.version);
  const b = builds.get(str(p.build));
  const live = start ? null : list(b?.actions).find((a) => a?.name === p.action);
  const title = start ? `Start version ${version}` : live?.label ?? ACTION_LABEL[p.action] ?? cap(p.action.replace(/_/g, " "));
  const shown = start ? "" : Object.entries(isObj(p.needs) ? p.needs : {}).filter(([, v]) => str(v)).map(([k, v]) => {
    const label = list(live?.needs).find((n) => n.name === k)?.label ?? cap(k.replace(/_/g, " "));
    return `<p class="pn"><span>${esc(label)}</span>${esc(str(v))}</p>`;
  }).join("");
  const ask = str(p.words) || `${title}?`;
  if (done) return `<div class="gcard done"><h4>${esc(ask)}</h4>${shown}<div class="acts"><span class="btn used">Confirmed</span></div></div>`;
  if (p.state === "declined") return `<div class="gcard done"><h4>${esc(ask)}</h4>${shown}<div class="acts"><span class="btn used">Declined</span></div></div>`;
  if (p.state === "closed") return `<div class="gcard"><h4>${esc(ask)}</h4>${shown}<p class="hint">Closed: it can no longer be taken.</p></div>`;
  if (start) {
    return `<div class="gcard prop"><h4>${esc(ask)}</h4><div class="acts"><button class="btn p" type="button" data-boss-confirm="${esc(p.id)}"${pending !== null ? " disabled" : ""}>${esc(pending === p.id ? "Starting…" : `Confirm: ${title}`)}</button></div><p class="hint">Nothing starts until you confirm.</p></div>`;
  }
  if (!live) {
    return `<div class="gcard prop"><h4>${esc(ask)}</h4>${shown}<div class="acts"><button class="btn p" type="button" disabled>${esc(`Confirm: ${title}`)}</button></div><p class="hint">${esc(str(p.when) || "The build does not offer that now.")}</p></div>`;
  }
  return `<div class="gcard prop"><h4>${esc(ask)}</h4>${shown}<div class="acts"><button class="btn p" type="button" data-boss-act="${esc(m.id)}"${pending !== null ? " disabled" : ""}>${esc(pending === p.id ? "Sending…" : `Confirm: ${title}`)}</button></div><p class="hint">It goes back through the stage's gate.</p></div>`;
}

/** One message of the boss's conversation: a person's words, or the boss's reply with where it went, its plan and its proposal. */
export function bossMessageHtml(m, ctx = {}) {
  const k = m?.from?.kind;
  if (k === "person" || k === "system") return messageHtml({ ...m, version: "" }, ctx);
  const stageName = ctx.stageName ?? ((x) => x);
  const when = ctx.when ?? ((x) => x);
  const at = m.at && when(m.at) ? `<em>${esc(when(m.at))}</em>` : "";
  const routed = isObj(m.routed) && str(m.routed.stage) && str(m.routed.build)
    ? `<p class="routed"><a href="${esc(stageChatHref(m.routed.build, m.routed.stage))}">Open the ${esc(stageName(m.routed.stage))} chat</a></p>` : "";
  const dropped = list(m.dropped).filter((d) => isObj(d) && str(d.stage) && str(d.build)).map((d) => `<a href="${esc(stageChatHref(d.build, d.stage))}">${esc(stageName(d.stage))}</a>`);
  const started = isObj(m.started) && str(m.started.build) ? `<p class="routed"><a href="#/b/${esc(encodeURIComponent(m.started.build))}">Open version ${esc(str(m.started.version))}</a></p>` : "";
  return `<div class="msg boss"><div class="av bs" aria-hidden="true">B</div><div><div class="mwho">${esc(str(m.from?.name) || "The boss")}${at}</div><div class="mbody">${paras(m.text)}${routed}${dropped.length ? `<p class="routed">Told: ${dropped.join(", ")}</p>` : ""}${planHtml(m.plan, { stageName })}${started}${bossProposalHtml(m, ctx)}</div></div></div>`;
}

/** The boss's conversation, oldest first. */
export function bossChatHtml(messages, ctx = {}) {
  const ms = list(messages).filter(isObj);
  if (!ms.length) return `<div class="tsys empty">Ask the boss anything about this product: where it is, why it waits, what a stage made. Say what should change, and it routes it to the right stage or plans it across them.</div>`;
  return ms.map((m) => bossMessageHtml(m, ctx)).join("");
}

/** The composer addressed to the boss. */
export function bossComposerHtml({ draft = "", pending = false, error = "" } = {}) {
  return `<div class="compose" id="compose"><div class="to">To <b>the boss</b></div>
    <form class="box" id="boss-form"><label class="sr" for="boss-say">Your message to the boss</label><input id="boss-say" type="text" value="${esc(draft)}" autocomplete="off" placeholder="Ask about the product, or say what should change. The boss routes it or plans it."><button class="btn p" type="submit"${pending ? " disabled" : ""}>${pending ? "Sending…" : "Send"}</button></form>
    ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}<div class="hint">The boss never answers a gate. Every change is proposed here for you to confirm.</div></div>`;
}

/** The open proposals whose build the page must read for its live actions. */
export function bossBuildsToRead(messages) {
  return [...new Set(list(messages).map((m) => m?.proposes).filter((p) => isObj(p) && p.action !== "start_version" && (p.state ?? "open") === "open" && str(p.build)).map((p) => p.build))];
}

/** The product page: its name and its when-needed actions, then tabs for the boss, its versions, its setup, its run plan and its activity. ctx.boss: { offered, messages, ... } when the service has the boss. */
export function productPageHtml(p, ctx = {}, tab = null) {
  const stageName = ctx.stageName ?? ((x) => x);
  const when = ctx.when ?? ((x) => x);
  const href = ctx.buildHref ?? ((id) => `#/b/${encodeURIComponent(id)}`);
  const builds = list(p?.builds).filter(isObj);
  const versionOf = new Map(builds.map((b) => [b.id, str(b.version)]));
  const vers = builds.map((b) => {
    const at = isObj(b.at) ? b.at : null;
    const line = productLine({ latest: { at, version: b.version } }, { stageName });
    return `<li><a href="${esc(href(b.id))}"><b>${esc(str(b.version) || b.id)}</b><span class="${line.wait ? "w" : ""}">${esc(line.text)}</span>${b.created && when(b.created) ? `<small>started ${esc(when(b.created))}</small>` : ""}</a></li>`;
  }).join("");
  const rp = isObj(p?.run_plan?.summary) ? p.run_plan : isObj(p?.run_plan) ? { summary: p.run_plan } : null;
  const plan = rp ? `${runPlanHtml(rp.summary, { stageName })}${str(rp.version) ? `<p class="gw">From version ${esc(str(rp.version))}${rp.at && when(rp.at) ? `, ${esc(when(rp.at))}` : ""}.</p>` : ""}` : "";
  const acts = list(p?.activity).filter(isObj).slice(0, 40).map((e) => `<li><time>${esc(when(e.at))}</time><span class="st">${esc([str(e.version) || versionOf.get(e.build) ? `v${str(e.version) || versionOf.get(e.build)}` : "", e.stage ? stageName(str(e.stage)) : ""].filter(Boolean).join(" · "))}</span>${esc(str(e.words))}</li>`).join("");
  // The boss is the default place to talk, when the service has one.
  const boss = isObj(ctx.boss) && ctx.boss.offered ? ctx.boss : null;
  const hasSetup = Array.isArray(p?.setup);
  const todo = setupToDo(p?.setup);
  const tabs = PRODUCT_TABS.map((t) => ({
    ...t,
    ...(t.id === "boss" && !boss ? { disabled: true, title: "This service has no boss" } : {}),
    ...(t.id === "setup" && !hasSetup ? { disabled: true, title: "This service does not say how the product is set up" } : {}),
    count: t.id === "versions" ? builds.length : t.id === "activity" ? list(p?.activity).length : t.id === "setup" && todo ? todo : undefined,
  }));
  const want = tab ?? (boss ? "boss" : "versions");
  const on = tabs.some((t) => t.id === want && !t.disabled) ? want : "versions";
  const body = on === "boss" ? `<div class="thread" id="thread">${bossChatHtml(boss.messages, { ...ctx, ...boss, stageName, when })}</div>`
    : on === "setup" ? setupHtml(p.setup, { stageName, roleName: ctx.roleName, chooseHref: ctx.chooseHref })
    : on === "plan" ? (plan || `<p class="gw">No run plan yet. Deploy makes it.</p>`)
      : on === "activity" ? (acts ? `<ul class="feed">${acts}</ul>` : `<p class="gw">Nothing yet.</p>`)
        : (vers ? `<ul class="vers">${vers}</ul>` : `<p class="gw">No builds yet.</p>`);
  return `<section class="thread-wrap work product"><div class="whead"><div class="hd"><div><h1>${esc(str(p?.name))}</h1>${ctx.does ? `<p class="sub">${esc(ctx.does)}</p>` : ""}${ctx.extra ?? ""}${whenNeededHtml(p?.when_needed, { stageName, pending: ctx.whenPending ?? null })}</div></div>${tabsHtml(tabs, on, { attr: "ptab", label: "Product" })}</div>
    <div class="wbody${on === "boss" ? " tab-chat" : ""}" id="tabbody"><div class="err" role="alert">${esc(ctx.error ?? "")}</div><div class="ptab ${on}">${body}</div></div>${on === "boss" ? bossComposerHtml(boss.composer ?? {}) : ""}</section>`;
}
