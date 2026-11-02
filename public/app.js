// The console page. It draws what the service says and offers only the
// actions the service offers. It talks only to the local server, which holds
// the key.

const PHASES = [
  ["define", "Define"], ["make", "Make"], ["ship", "Ship"], ["prove", "Prove"],
  ["use", "Use"], ["run", "Run"], ["change", "Change"],
];
import { esc, safeUrl, stateOf, holderWords, holderHtml, stageNoticeHtml, evidenceHtml, rolesPageHtml, draftFor, holderFrom, needsHandle } from "./roles.js";

const CLS = { done: "done", waiting_on_you: "wait", not_started: "todo", not_offered: "off", working: "work", refused: "bad", stopped: "stop", not_bound: "unb", not_applicable: "na" };
const MARK = { done: "✓", waiting_on_you: "!", not_started: "○", not_offered: "", working: "…", refused: "✕", stopped: "■", not_bound: "?", not_applicable: "" };
const WORD = { done: "Done", waiting_on_you: "Waiting on you", not_started: "Not started", not_offered: "Not offered", working: "Working", refused: "Refused", stopped: "Stopped", not_bound: "Nobody holds it", not_applicable: "Doesn't apply" };

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const sentence = (s) => { const t = String(s ?? "").trim(); return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?”"]$/.test(t) ? "" : ".") : ""; };
// A field from stages.json: its list items are lines starting with "- ".
function prose(text, lead = "") {
  const lines = String(text ?? "").split(/\r?\n/);
  const head = lines.filter((l) => !l.startsWith("- ")).join(" ").trim();
  const items = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  const first = sentence(`${lead}${head}`.trim());
  const p = first ? `<p>${esc(items.length ? first.replace(/[.:]?$/, ":") : first)}</p>` : "";
  return p + (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");
}
// One of the words a stage handed back: a bare web address becomes a link.
function wordsHtml(w) {
  const t = String(w).trim();
  const url = /^https?:\/\/\S+$/.test(t) ? safeUrl(t) : null;
  return url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>` : `<p>${esc(w)}</p>`;
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } },
};

const state = {
  status: null, stages: [], byId: new Map(), builds: [], build: null, tries: [],
  sel: null, view: "build", error: "", lastTry: null, checks: new Map(), files: new Map(), pending: null, asking: null, wrongFor: null,
  logAll: false, showArchived: false,
  roles: null, project: "", editingRole: null, roleDraft: null, roleErrors: new Map(), rolePending: null,
};

// ---------- talking to the local server ----------

class Problem extends Error {
  constructor(message, status, needKey) { super(message); this.status = status; this.needKey = needKey; }
}

async function call(path, { method = "GET", body, text = false } = {}) {
  const init = { method, headers: { accept: text ? "text/plain" : "application/json" } };
  if (method !== "GET") {
    init.headers["content-type"] = "application/json";
    init.headers["x-adlc-console"] = "1";
    if (method !== "DELETE") init.body = JSON.stringify(body ?? {});
  }
  let r;
  try { r = await fetch(path, init); } catch { throw new Problem("The console stopped answering. Is it still running?", 0); }
  if (text && r.ok) return r.text();
  let data = null;
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) {
    const words = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : null;
    if (r.status === 401 || r.status === 403) {
      throw new Problem(data?.need_key ? words : "The service turned down the key. Paste a new one.", r.status, true);
    }
    throw new Problem(words || `Something went wrong (${r.status}).`, r.status);
  }
  return data;
}
const api = (p, o) => call(`/api/v1/lifecycle${p}`, o);
const buildPath = (id, rest = "") => `/builds/${encodeURIComponent(id)}${rest}`;

// ---------- small formatters ----------

function when(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
function day(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const o = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  return d.toLocaleDateString([], o);
}
function size(n) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(0.1, n / 1024).toFixed(1)} KB`;
}
function prWords(url) {
  const m = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url || "");
  return m ? { text: `${m[1]}, pull request #${m[2]}`, short: `pull request #${m[2]}` } : { text: "The pull request", short: "the pull request" };
}
const def = (id) => state.byId.get(id) ?? { id, number: 0, phase: "", name: id, role: "", given: "", hands_back: "", done_when: "" };
const stageOf = (id) => state.build?.stages.find((s) => s.stage === id);
const prStage = () => state.build?.stages.find((s) => s.where?.kind === "pull_request");
const installed = () => stageOf("deploy")?.state === "done";

// ---------- routing ----------

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "roles") return { view: "roles", project: (parts[1] ?? "").trim() };
  if (parts[0] === "b" && parts[1]) return { view: "build", id: parts[1], sel: parts[2] || null };
  return { view: "build", id: null, sel: null };
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
const hashFor = (id, sel) => `#/b/${encodeURIComponent(id)}${sel ? `/${encodeURIComponent(sel)}` : ""}`;

async function route() {
  const h = parseHash();
  state.error = "";
  if (!state.status?.signed_in) return drawKey();
  if (h.view === "new") { state.view = "new"; drawRail(); return drawNew(); }
  if (h.view === "roles") {
    if (state.view !== "roles" || state.project !== h.project) { state.editingRole = null; state.roleErrors = new Map(); state.roles = null; }
    state.view = "roles"; state.project = h.project;
    drawRail();
    return loadRoles();
  }
  state.view = "build";
  const id = h.id || pickBuild();
  if (!id) { drawRail(); return drawEmpty(); }
  if (!state.build || state.build.id !== id) {
    state.tries = []; state.lastTry = null; state.logAll = false; state.asking = null; state.wrongFor = null;
    try {
      state.build = (await api(buildPath(id))).build;
    } catch (e) { return problem(e); }
  }
  state.sel = h.sel || defaultStage();
  if (state.sel === "try") await loadTries();
  draw();
}

function pickBuild() {
  const live = state.builds.filter((x) => !x.archived);
  const b = live.find((x) => x.at?.state === "waiting_on_you") ?? live[0];
  return b?.id ?? null;
}
function defaultStage() {
  const b = state.build;
  const s = b.stages.find((x) => x.state === "waiting_on_you")
    ?? b.stages.find((x) => x.state === "working" || x.state === "stopped" || x.state === "refused")
    // A read-only source has nothing coming next; open what it holds.
    ?? (state.status?.read_only ? b.stages.find((x) => x.state === "done") : null)
    ?? b.stages.find((x) => x.state === "not_started")
    ?? b.stages[0];
  return s?.stage ?? null;
}

function problem(e) {
  if (e.needKey) {
    state.status = { ...state.status, signed_in: false };
    state.error = e.message;
    return drawKey();
  }
  state.error = e.message;
  draw();
}

// ---------- drawing ----------

function drawTop() {
  const st = state.status;
  $("svc").textContent = st?.service ?? "";
  let who = "";
  if (st?.demo) who = "Made-up builds, for a look around";
  else if (st?.key_from === "saved") who = `Using your saved key · <button class="linkbtn" id="forget" type="button">Forget it</button>`;
  else if (st?.key_from === "environment") who = "Using the key from your environment";
  else if (st?.key_from === "key file") who = "Using the key from your key file";
  else if (st?.key_from === "github token") who = "Read-only · using your GitHub token";
  else if (st?.source === "github") who = "Read-only · reading without a GitHub token";
  $("who").innerHTML = who;
}

function railLine(b) {
  const name = def(b.at?.stage).name;
  if (state.status?.read_only && b.updated) return { text: `Updated ${day(b.updated)}`, wait: false };
  // The service's own words for where the build ended or is, when it gives them.
  if (typeof b.at?.summary === "string" && b.at.summary) return { text: b.at.summary, wait: b.at.state === "waiting_on_you", paused: /· paused/.test(b.at.summary) };
  if (b.at?.state === "stopped") return { text: `Stopped at ${name}`, wait: false };
  if (b.at?.state === "refused") return { text: `Refused at ${name}`, wait: false };
  return { text: `${name} · ${WORD[stateOf(b.at)].toLowerCase()}`, wait: b.at?.state === "waiting_on_you" };
}

function drawRail() {
  const cur = state.view === "build" ? state.build?.id : null;
  // Archived builds are hidden, behind a toggle at the foot of the list.
  const archived = state.builds.filter((b) => b.archived).length;
  const shown = state.showArchived ? state.builds : state.builds.filter((b) => !b.archived);
  $("builds").innerHTML = (shown.length
    ? shown.map((b) => {
      const l = railLine(b);
      return `<a class="b${b.id === cur ? " on" : ""}${b.archived ? " ar" : ""}" href="${hashFor(b.id)}" title="${esc(b.does)}"${b.id === cur ? ' aria-current="page"' : ""}><span class="n">${esc(b.name)}</span><span class="s${l.wait ? " w" : ""}${l.paused ? " p" : ""}">${b.archived ? "Archived · " : ""}${esc(l.text)}</span></a>`;
    }).join("")
    : `<p class="none">${archived ? "Every build is archived." : "No builds yet."}</p>`)
    + (archived ? `<button class="linkbtn archt" id="archt" type="button" aria-pressed="${state.showArchived}">${state.showArchived ? "Hide archived" : `Show archived (${archived})`}</button>` : "");
  $("new").classList.toggle("on", state.view === "new");
  $("new").hidden = Boolean(state.status?.read_only);
  // A read-only source holds no roles to choose.
  $("roles-link").classList.toggle("on", state.view === "roles");
  $("roles-link").hidden = Boolean(state.status?.read_only);
  if (state.view === "roles") $("roles-link").setAttribute("aria-current", "page"); else $("roles-link").removeAttribute("aria-current");
}

function layout(kind) {
  $("app").classList.toggle("solo", kind === "solo");
  $("app").classList.toggle("bare", kind === "bare");
}

function draw() {
  drawTop();
  drawRail();
  if (state.view !== "build" || !state.build) return;
  layout("full");
  const b = state.build;
  const canTry = state.status?.can_try !== false && (Boolean(prStage()) || installed());
  $("main").innerHTML = `
    <div class="err" role="alert">${esc(state.error)}</div>
    <div class="head"><h1>${esc(b.name)}</h1>${canTry ? `<button class="try${state.sel === "try" ? " on" : ""}" id="try" type="button">Try it</button>` : ""}</div>
    <p class="does">${esc(b.does)}</p>
    ${typeof b.project === "string" && b.project ? `<p class="projof">Built for the project ${esc(b.project)}. <a href="${rolesHash(b.project)}">Who holds its roles</a></p>` : ""}
    ${b.summary ? `<p class="sum${b.paused ? " paused" : ""}">${esc(b.summary)}${b.archived ? " · archived" : ""}</p>` : ""}
    ${b.paused ? `<p class="pausedwhy">Paused ${esc(when(b.paused.at))}. ${esc(b.paused.why)}</p>` : ""}
    <div id="phases">${phases()}</div>
    ${timeline()}
    ${buildLog()}`;
  // The bars placed through the CSSOM: the page's policy takes no style attribute.
  for (const i of document.querySelectorAll(".timeline .track i")) { i.style.left = `${i.dataset.l}%`; i.style.width = `${i.dataset.w}%`; }
  drawStage();
  if (b.stages.some((s) => s.state === "working")) schedule();
}

function phases() {
  const b = state.build;
  const known = new Map(b.stages.map((s) => [s.stage, s]));
  const rows = state.stages.length ? state.stages : b.stages.map((s, i) => ({ id: s.stage, number: i + 1, phase: "", name: s.stage }));
  return PHASES.map(([pid, pname]) => {
    const here = rows.filter((d) => d.phase === pid);
    if (!here.length) return "";
    return `<div class="phase"><span>${pname}</span><div class="st">${here.map((d) => {
      const s = known.get(d.id) ?? { stage: d.id, state: "not_offered", runs: 0 };
      const st = stateOf(s);
      const mark = MARK[st];
      const on = s.stage === state.sel;
      // The holder in words; one held by anyone but the reference agent says so on the chip too.
      const who = st === "not_offered" || st === "not_applicable" ? "" : holderWords(s.holder);
      const handle = s.holder?.handle ? ` · ${s.holder.handle}` : "";
      const shown = who && s.holder?.kind !== "reference_agent" ? `<small>${esc(who)}</small>` : "";
      return `<button class="c ${CLS[st]}${on ? " sel" : ""}" type="button" data-stage="${esc(d.id)}" aria-pressed="${on}"${who ? ` title="${esc(`Held by ${who}${handle}`)}"` : ""} aria-label="${esc(`${d.name}, ${WORD[st]}${who ? `, held by ${who}` : ""}${s.runs > 1 ? `, ran ${s.runs} times` : ""}`)}"><i>${pad(d.number)}</i><span class="cn">${esc(d.name)}${shown}</span>${mark ? `<b>${mark}</b>` : ""}${s.runs > 1 ? `<u>×${s.runs}</u>` : ""}</button>`;
    }).join("")}</div></div>`;
  }).join("");
}

/** "4 min", "35 s", "2 h 5 min": a duration as a person says it. */
function span(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const KIND = { agent: "an agent working", person: "waiting on a person", external: "waiting on something outside the run" };

/** The build's run, one row per step per round, ordered by start, with how
 *  long each took (build.timeline, added to the contract in 0.1). */
function timeline() {
  const bars = Array.isArray(state.build.timeline) ? state.build.timeline : [];
  if (!bars.length) return "";
  const t0 = Math.min(...bars.map((x) => Date.parse(x.start)));
  const t1 = Math.max(...bars.map((x) => (x.end ? Date.parse(x.end) : Date.now())));
  const whole = Math.max(1, t1 - t0);
  const rows = bars.map((x) => {
    const a = Date.parse(x.start);
    const e = x.end ? Date.parse(x.end) : Date.now();
    const left = ((a - t0) / whole) * 100;
    const width = Math.max(0.6, ((e - a) / whole) * 100);
    const took = x.duration_ms === null || x.duration_ms === undefined ? "still open, " + span(e - a) + " so far" : span(x.duration_ms);
    return '<li class="' + esc(x.kind) + '"><div class="bl"><b>' + esc(x.phase) + (x.round > 1 ? " · round " + x.round : "") + "</b><span>" + esc(took) + "</span></div>"
      + '<div class="track" aria-hidden="true"><i data-l="' + left.toFixed(2) + '" data-w="' + width.toFixed(2) + '"></i></div>'
      + '<div class="bk">' + esc(KIND[x.kind] ?? x.kind) + (x.holder ? " · " + esc(x.holder) : "") + " · " + esc(x.status) + "</div></li>";
  }).join("");
  return '<section class="timeline"><h2>How long each step took</h2><p class="does">' + esc(span(whole)) + " from the first step to the last. Steps that ran at the same time overlap.</p><ol class=\"bars\">" + rows + "</ol></section>";
}

function buildLog() {
  const log = state.build.log ?? [];
  if (!log.length) return "";
  const shown = state.logAll ? log : log.slice(0, 6);
  return `<section class="buildlog"><h2>What happened, newest first</h2><ul class="log">${shown.map((e) => `<li><time>${esc(when(e.at))}</time>${esc(e.said)}</li>`).join("")}</ul>${log.length > shown.length ? `<div class="acts"><button class="linkbtn" type="button" id="logall">Show all ${log.length}</button></div>` : ""}</section>`;
}

function actionsFor(stage) {
  return (state.build.actions ?? []).filter((a) => a.stage === stage);
}

function actionsHtml(stage) {
  const list = actionsFor(stage);
  if (!list.length) return "";
  const busy = state.pending !== null;
  // Stop is never drawn as the main action, even when it is the only one.
  const main = list.findIndex((a) => a.name !== "stop");
  let h = `<div class="acts">${list.map((a, i) => `<button class="btn${i === main ? " p" : ""}" type="button" data-act="${esc(a.name)}"${busy ? " disabled" : ""}>${esc(state.pending === a.name ? "Sending…" : a.label)}</button>`).join("")}</div>`;
  const ask = list.find((a) => a.name === state.asking && a.needs?.length);
  if (ask) {
    h += `<form class="ask" data-ask="${esc(ask.name)}">${ask.needs.map((n) => {
      const id = `need-${esc(n.name)}`;
      const long = /words|text|long|reason|why|comment/i.test(n.kind);
      // A need the service marks optional may be left empty, and is then not sent.
      const req = n.optional === true ? "" : " required";
      return `<label for="${id}">${esc(n.label)}${n.optional === true ? " <span>Optional</span>" : ""}</label>${long ? `<textarea id="${id}" name="${esc(n.name)}"${req}></textarea>` : `<input type="text" id="${id}" name="${esc(n.name)}"${req} autocomplete="off">`}`;
    }).join("")}<div class="acts tight"><button class="btn p" type="submit">${esc(ask.label)}</button><button class="btn" type="button" data-cancel>Cancel</button></div></form>`;
  }
  return h;
}

function filesHtml(list, openOne = true) {
  return `<div class="files">${list.map((f, i) => {
    const key = `${state.build.id}\n${f.path}`;
    const got = state.files.get(key);
    const open = openOne && list.length === 1 && i === 0;
    return `<details data-file="${esc(f.path)}"${open ? " open" : ""}><summary><b>${esc(f.path)}</b><span>${esc(size(f.size))}</span></summary><pre>${got === undefined ? "Loading…" : esc(got)}</pre></details>`;
  }).join("")}</div>`;
}

function localCheckHtml() {
  const id = state.build.id;
  const saved = store.get(`clone:${id}`) ?? "";
  const r = state.checks.get(id);
  let out;
  if (r === "running") out = "$ node .adlc/check.mjs\nRunning in your clone…";
  else if (r?.error) out = `<span class="no">${esc(r.error)}</span>`;
  else if (r) {
    const secs = (r.ms / 1000).toFixed(1);
    const verdict = r.passed
      ? `<span class="ok">It passed in your clone, in ${secs} s.</span>`
      : `<span class="no">${r.timed_out ? "It took too long and was stopped." : "It failed in your clone."}</span>`;
    out = `$ node .adlc/check.mjs\n${esc(r.output.trim())}\n${verdict}`;
  } else out = "$ node .adlc/check.mjs\nRuns the pull request's own check in your clone, so you see a failure before you push.";
  return `<form class="clone" id="clone-form"><label for="clone">The folder your clone is in</label><input type="text" id="clone" value="${esc(saved)}" autocomplete="off" spellcheck="false" placeholder="The whole path, from the top of the drive"><button class="btn" type="submit"${r === "running" ? " disabled" : ""}>Check my clone</button></form><div class="local" aria-live="polite">${out}</div>`;
}

function drawStage() {
  const el = $("stage");
  if (state.sel === "try") return drawTry();
  const s = stageOf(state.sel) ?? { stage: state.sel, state: "not_offered" };
  const st = stateOf(s);
  const d = def(state.sel);
  const phaseName = PHASES.find(([p]) => p === d.phase)?.[1] ?? "";
  let h = `<h2>Stage ${pad(d.number)}${phaseName ? ` · ${phaseName}` : ""}</h2>
    <h3>${esc(d.name)} <span class="pill ${CLS[st]}">${WORD[st]}</span></h3>`;
  if (st === "not_offered") {
    h += `<div class="sec">${d.hands_back ? prose(d.hands_back, "It hands back ") : ""}<p class="notyet">${esc(state.status?.source === "github" ? "A repository does not show this stage." : `${state.status?.demo ? "The demo" : state.status?.service ?? "This service"} does not run this stage yet.`)}</p></div>`;
    el.innerHTML = h;
    return;
  }
  if (st === "not_bound" || st === "not_applicable") {
    const project = typeof state.build.project === "string" && state.build.project ? `/${encodeURIComponent(state.build.project)}` : "";
    el.innerHTML = h + stageNoticeHtml(st, `#/roles${project}`);
    return;
  }
  const future = st === "not_started";
  const holder = holderHtml(s.holder);
  if (holder) h += `<p class="who">${future ? "Will be held by" : "Held by"} ${holder}</p>`;
  else if (d.reference_holder) h += `<p class="who">Its reference agent is ${esc(d.reference_holder)}</p>`;
  else if (d.role) h += `<p class="who">Its role: ${esc(d.role)}</p>`;
  const given = s.given ? `<p>${esc(s.given)}</p>` : prose(d.given);
  if (given) h += `<div class="sec"><h4>${future ? "Will be given" : "Given"}</h4>${given}</div>`;

  if (s.where?.kind === "pull_request") {
    const url = safeUrl(s.where.url);
    const pr = prWords(s.where.url);
    const c = s.where.check;
    // The check's own verdict colours its title; a stage still working on a refused push is not neutral.
    const tone = c?.passed === true ? "good" : c?.passed === false ? "back" : s.state === "waiting_on_you" || s.state === "done" ? "good" : s.state === "refused" ? "back" : "";
    h += `<div class="sec"><h4>Where</h4><p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(pr.text)}</a>` : esc(pr.text)}</p>
      ${c ? `<div class="check"><div class="t ${tone}">${esc(c.title)}</div>${esc(c.words)}${c.items?.length ? `<ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>` : ""}
      ${localCheckHtml()}
      ${actionsHtml(s.stage)}</div>`;
  }

  if (s.rounds?.length) {
    h += `<div class="sec"><h4>${s.rounds.length === 1 ? "1 round" : `${s.rounds.length} rounds, newest first`}</h4><ol class="rounds">${s.rounds.map((r) =>
      `<li class="${r.back ? "back" : "done"}"><div class="rh"><b>${esc(r.label)}</b><span>${esc(when(r.at))}</span></div><div class="rv">${r.back ? "↩ " : "✓ "}${esc(r.verdict)}</div>${r.words ? `<p>${esc(r.words)}</p>` : ""}</li>`).join("")}</ol></div>`;
  }

  const words = s.handed_back?.words ?? [];
  const files = s.handed_back?.files ?? [];
  if (words.length || files.length) {
    h += `<div class="sec"><h4>${future ? "Will hand back" : "Handed back"}</h4>${words.map(wordsHtml).join("")}${files.length ? filesHtml(files) : ""}</div>`;
  } else if (future && d.hands_back) {
    h += `<div class="sec"><h4>Will hand back</h4>${prose(d.hands_back)}</div>`;
  }
  // Evidence an outside holder handed in, as the service read it.
  h += evidenceHtml(s.evidence, { when, fileHtml: (f) => filesHtml([f], false) });

  if (!s.where) h += actionsHtml(s.stage);
  if (s.stage === "acceptance" && (prStage() || installed())) h += `<div class="acts"><button class="btn${actionsFor(s.stage).length ? "" : " p"}" type="button" data-tryit>Try it</button></div>`;

  if (d.done_when) {
    const met = s.done_when_met === true ? `<p class="met">✓ Met</p>` : s.done_when_met === false && !future ? `<p class="notyet">Not met yet</p>` : "";
    h += `<div class="sec"><h4>Done when</h4>${prose(d.done_when)}${met}</div>`;
  }
  if (s.log?.length) h += `<div class="sec"><h4>What happened</h4><ul class="log">${s.log.map((e) => `<li><time>${esc(when(e.at))}</time>${esc(e.said)}</li>`).join("")}</ul></div>`;
  el.innerHTML = h;
  for (const det of el.querySelectorAll("details[open][data-file]")) loadFile(det);
}

// ---------- Try it ----------

async function loadTries() {
  try { state.tries = (await api(buildPath(state.build.id, "/tries"))).tries ?? []; } catch (e) { state.error = e.message; }
}

function drawTry() {
  const b = state.build;
  const pr = prStage();
  const prw = pr ? prWords(pr.where.url) : null;
  const inst = installed();
  const coder = stageOf("code")?.holder?.kind === "your_agent" ? "your coding agent" : null;
  // Once the agent is installed it is what a person tries first; the pull request stays a choice.
  const choice = store.get(`against:${b.id}`) ?? (inst ? "installed" : "pull_request");
  const against = (choice === "pull_request" && pr) || (choice === "installed" && inst) ? choice : pr ? "pull_request" : "installed";
  let h = `<h2>Try it</h2><h3>${esc(b.name)}</h3><p class="who">Send it what a person would, and see what it answers.</p>`;
  if (!pr && !inst) {
    el(h + `<div class="sec"><p class="notyet">There is nothing to try yet. Once there is a pull request, or the agent is installed, you can send it something here.</p></div>`);
    return;
  }
  h += `<form class="sec tin" id="try-form"><label for="tsay"><h4>Send</h4></label>
      <textarea id="tsay" placeholder="What a person would send it" required>${esc(state.draft ?? "")}</textarea>
      <label class="meta" for="twhere">Send it to</label>
      <select id="twhere">
        ${pr ? `<option value="pull_request"${against === "pull_request" ? " selected" : ""}>The scripts on ${esc(prw.short)}, in the sandbox</option>` : `<option disabled>The pull request's scripts (there is no pull request)</option>`}
        ${inst ? `<option value="installed"${against === "installed" ? " selected" : ""}>The installed agent, ${esc(b.handle)}</option>` : `<option disabled>The installed agent (not installed yet)</option>`}
      </select>
      <div class="acts tight"><button class="btn p" type="submit"${state.pending === "try" ? " disabled" : ""}>${state.pending === "try" ? "Sending…" : "Send"}</button></div></form>`;

  const latest = state.lastTry ?? state.tries[0] ?? null;
  if (latest) {
    const listed = state.tries.find((t) => t.id === latest.id) ?? latest;
    const where = latest.against === "installed" ? "from the installed agent" : `from ${prw?.short ?? "the pull request"} in the sandbox`;
    const meta = Number.isFinite(latest.ms) ? `${(latest.ms / 1000).toFixed(1)} s, ${where}` : `Tried at ${when(latest.at)}, ${where}`;
    let acts;
    if (listed.kept) acts = `<p class="meta">Kept as a test.</p>`;
    else if (listed.sent_back) acts = `<p class="meta">Sent back${coder ? ` to ${coder}` : ""}.</p>`;
    else {
      // Keep writes a test on the open pull request, so it is offered only for a try of the
      // pull request's scripts while Code still waits on it (the contract: never for a try of the installed agent).
      const keepable = latest.against === "pull_request" && ["working", "waiting_on_you"].includes(stageOf("code")?.state);
      acts = `<div class="acts">${keepable ? `<button class="btn" type="button" data-keep="${esc(latest.id)}">Keep as a test</button>` : ""}<button class="btn" type="button" data-wrong="${esc(latest.id)}">That's wrong</button></div>`;
      if (state.wrongFor === latest.id) {
        acts += `<form class="ask" id="wrong-form" data-tid="${esc(latest.id)}"><label for="why">What should it have said? You can leave this empty.</label><textarea id="why"></textarea><div class="acts tight"><button class="btn p" type="submit">Send it back</button><button class="btn" type="button" data-cancel>Cancel</button></div></form>`;
      }
      acts += `<p class="meta">${keepable ? "Keep as a test adds it to the suite, so every later push is checked against it. " : ""}That's wrong sends it back${coder ? ` to ${coder}` : ""} as a comment on the pull request.</p>`;
    }
    h += `<div class="sec"><h4>It answered</h4><p class="meta">You sent: ${esc(latest.say)}</p><div class="reply">${esc(latest.answer)}</div><div class="meta">${esc(meta)}</div>${acts}</div>`;
  }
  const earlier = state.tries.filter((t) => t.id !== latest?.id);
  if (earlier.length) {
    h += `<div class="sec"><h4>Earlier tries</h4><ul class="tries">${earlier.map((t) => {
      const tag = t.kept ? " · kept as a test" : t.sent_back ? " · sent back" : "";
      return `<li><span>${esc(t.say)}</span><code>${esc(t.answer)}${tag ? `<em>${tag}</em>` : ""}</code></li>`;
    }).join("")}</ul></div>`;
  }
  el(h);
}
function el(h) { $("stage").innerHTML = h; }

// ---------- the key, a new build, nothing yet ----------

function drawKey() {
  drawTop();
  layout("bare");
  const st = state.status;
  $("main").innerHTML = `<div class="card">
    <h1>Give the console a key</h1>
    <p>The console reads your builds from ${esc(st?.service ?? "the service")}. It needs a key you made for your own account there; the service says how to make one.</p>
    <p>Paste it here once. It is kept in a file on this computer that only you can read, and it is never shown in this page again. You can also start the console with the key in <code>ADLC_KEY</code>, or with <code>--key-file</code>.</p>
    <div class="err" role="alert">${esc(state.error)}</div>
    <form class="form" id="key-form"><label for="key">Your key<input type="password" id="key" autocomplete="off" spellcheck="false" required></label>
    <div class="acts tight"><button class="btn p" type="submit">Keep this key</button></div></form></div>`;
  $("stage").innerHTML = "";
}

function drawNew() {
  drawTop();
  const kept = state.newDraft ?? {};
  layout("solo");
  $("main").innerHTML = `<div class="err" role="alert">${esc(state.error)}</div>
    <h1>New build</h1><p class="does">Say what the agent should do, in your own words. The service takes it from there, and comes back to you at the gates that are yours.</p>
    <form class="form" id="new-form">
      <label for="n-does">What should it do?<textarea id="n-does" required placeholder="Say whether a sentence is a palindrome, ignoring spaces, punctuation and letter case.">${esc(kept.does ?? "")}</textarea></label>
      <label for="n-refuses">What should it refuse to do? <span>Optional</span><textarea id="n-refuses">${esc(kept.refuses ?? "")}</textarea></label>
      <label for="n-more">Anything else it should know <span>Optional</span><textarea id="n-more">${esc(kept.more ?? "")}</textarea></label>
      <label for="n-name">Its name <span>Optional. Lowercase words joined by hyphens, such as palindrome-judge.</span><input type="text" id="n-name" value="${esc(kept.name ?? "")}" autocomplete="off" spellcheck="false"></label>
      <label for="n-project">Project <span>Optional. The roles chosen for this project hold its stages.</span><input type="text" id="n-project" value="${esc(kept.project ?? "")}" autocomplete="off" spellcheck="false"></label>
      <div class="acts tight"><button class="btn p" type="submit"${state.pending === "new" ? " disabled" : ""}>${state.pending === "new" ? "Starting…" : "Start the build"}</button><a class="btn" href="#/">Cancel</a></div>
    </form>`;
  $("stage").innerHTML = "";
}

function drawEmpty() {
  drawTop();
  layout("solo");
  $("main").innerHTML = state.status?.read_only
    ? `<div class="err" role="alert">${esc(state.error)}</div><h1>No agents here</h1><p class="does">${state.error ? "" : `${esc(state.status.service)} has no agent repositories: none holds agent-repo.json, a package descriptor, or spec.json.`}</p>`
    : `<div class="err" role="alert">${esc(state.error)}</div><h1>No builds yet</h1><p class="does">Start one with New build. Say what the agent should do, and follow it through the stages here.</p>`;
  $("stage").innerHTML = "";
}

// ---------- doing things ----------

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (document.hidden || state.view !== "build" || !state.build || state.pending) return schedule();
    try {
      state.build = (await api(buildPath(state.build.id))).build;
      await refreshBuilds();
      draw();
    } catch { schedule(); }
  }, 5000);
}

async function refreshBuilds() {
  try { state.builds = (await api("/builds?archived=1")).builds ?? []; } catch (e) { if (e.needKey) throw e; state.error = e.message; }
}

async function loadFile(det) {
  const path = det.dataset.file;
  const key = `${state.build.id}\n${path}`;
  if (state.files.has(key)) return;
  state.files.set(key, "Loading…");
  let body;
  try {
    body = await call(`/api/v1/lifecycle${buildPath(state.build.id, `/files?path=${encodeURIComponent(path)}`)}`, { text: true });
    if (body.includes("\u0000")) body = "This file is not text, so it is not shown here.";
  } catch (e) {
    state.files.delete(key);
    body = e.message;
  }
  if (state.files.has(key)) state.files.set(key, body);
  const pre = det.querySelector("pre");
  if (pre) pre.textContent = body;
}

async function act(name, needs = {}) {
  state.pending = name; drawStage();
  try {
    const r = await api(buildPath(state.build.id, `/actions/${encodeURIComponent(name)}`), { method: "POST", body: needs });
    if (r?.build) state.build = r.build;
    else state.build = (await api(buildPath(state.build.id))).build;
    state.asking = null; state.error = "";
    await refreshBuilds();
  } catch (e) {
    state.pending = null;
    return problem(e);
  }
  state.pending = null;
  // When the gate just answered is closed and another one now waits on the
  // person, open that one.
  const next = state.build.stages.find((s) => s.state === "waiting_on_you");
  if (next && next.stage !== state.sel && !actionsFor(state.sel).length) return go(hashFor(state.build.id, next.stage));
  draw();
}

async function sendTry(say, against) {
  state.pending = "try"; state.draft = say; drawTry();
  try {
    const r = await api(buildPath(state.build.id, "/try"), { method: "POST", body: { say, against } });
    state.lastTry = r.try; state.draft = ""; state.error = "";
    await loadTries();
  } catch (e) { state.pending = null; return problem(e); }
  state.pending = null;
  draw();
}

async function markTry(tid, what, body) {
  try {
    await api(buildPath(state.build.id, `/tries/${encodeURIComponent(tid)}/${what}`), { method: "POST", body });
    state.wrongFor = null;
    await loadTries();
    state.build = (await api(buildPath(state.build.id))).build;
  } catch (e) { return problem(e); }
  draw();
}

async function runLocalCheck(folder) {
  const id = state.build.id;
  store.set(`clone:${id}`, folder);
  state.checks.set(id, "running"); drawStage();
  try {
    const r = await call("/local/check", { method: "POST", body: { folder, agent: state.build?.name ?? "" } });
    state.checks.set(id, r.result);
  } catch (e) {
    state.checks.set(id, { error: e.message });
  }
  if (state.build?.id === id && state.sel !== "try") drawStage();
}

// ---------- the Roles page ----------

const rolesPath = (role = "") => `/roles${role ? `/${encodeURIComponent(role)}` : ""}${state.project ? `?project=${encodeURIComponent(state.project)}` : ""}`;
const rolesHash = (project) => (project ? `#/roles/${encodeURIComponent(project)}` : "#/roles");

async function loadRoles() {
  try {
    state.roles = await api(rolesPath());
  } catch (e) {
    if (e.needKey) return problem(e);
    state.roles = null;
    state.error = e.message;
  }
  drawRoles();
}

function drawRoles() {
  drawTop();
  layout("solo");
  $("main").innerHTML = rolesPageHtml(state.roles, {
    project: state.project, error: state.error, editing: state.editingRole, draft: state.roleDraft,
    errors: state.roleErrors, pending: state.rolePending, readOnly: Boolean(state.status?.read_only),
    formats: state.evidenceFormats, stageName: (id) => def(id).name, day,
  });
  $("stage").innerHTML = "";
}

function formValues(f) {
  return {
    kind: f.querySelector("[name=kind]:checked")?.value ?? "",
    name: f.querySelector("[name=name]")?.value ?? "",
    handle: f.querySelector("[name=handle]")?.value ?? "",
    formats: [...f.querySelectorAll("[name=formats]:checked")].map((x) => x.value),
    where: f.querySelector("[name=where]")?.value ?? "",
  };
}

// PUT or DELETE one role. The service's refusal is shown on that role, in its own words.
async function changeRole(role, method, body) {
  state.rolePending = role; state.roleErrors.delete(role); drawRoles();
  try {
    state.roles = await api(rolesPath(role), { method, body });
    state.editingRole = null; state.roleDraft = null; state.error = "";
  } catch (e) {
    state.rolePending = null;
    if (e.needKey) return problem(e);
    state.roleErrors.set(role, e.message);
    return drawRoles();
  }
  state.rolePending = null;
  drawRoles();
}

// ---------- events ----------

document.addEventListener("click", async (e) => {
  const t = e.target;
  const chip = t.closest("[data-stage]");
  if (chip) {
    go(hashFor(state.build.id, chip.dataset.stage));
    if (matchMedia("(max-width:820px)").matches) requestAnimationFrame(() => $("stage").scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (t.closest("#try") || t.closest("[data-tryit]")) {
    go(hashFor(state.build.id, "try"));
    if (matchMedia("(max-width:820px)").matches) requestAnimationFrame(() => $("stage").scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (t.closest("#new")) return go("#/new");
  const bind = t.closest("[data-bind]");
  if (bind) {
    const r = state.roles?.roles?.find((x) => x.role === bind.dataset.bind);
    if (!r) return;
    state.editingRole = r.role; state.roleDraft = draftFor(r); state.roleErrors.delete(r.role);
    drawRoles();
    $("main").querySelector(`form.bind input[name=name]`)?.focus();
    return;
  }
  const unbind = t.closest("[data-unbind]");
  if (unbind) return changeRole(unbind.dataset.unbind, "DELETE");
  if (t.closest("[data-cancel-bind]")) { state.roleErrors.delete(state.editingRole); state.editingRole = null; state.roleDraft = null; return drawRoles(); }
  if (t.closest("#logall")) { state.logAll = true; return draw(); }
  if (t.closest("#archt")) { state.showArchived = !state.showArchived; return drawRail(); }
  if (t.closest("#forget")) {
    try { state.status = await call("/local/forget-key", { method: "POST" }); } catch (err) { state.error = err.message; }
    state.build = null; state.builds = [];
    return route();
  }
  const a = t.closest("[data-act]");
  if (a) {
    const action = actionsFor(state.sel).find((x) => x.name === a.dataset.act);
    if (!action) return;
    if (action.needs?.length) { state.asking = action.name; drawStage(); $("stage").querySelector(".ask textarea, .ask input")?.focus(); return; }
    return act(action.name);
  }
  if (t.closest("[data-cancel]")) { state.asking = null; state.wrongFor = null; return state.sel === "try" ? drawTry() : drawStage(); }
  const keep = t.closest("[data-keep]");
  if (keep) return markTry(keep.dataset.keep, "keep", {});
  const wrong = t.closest("[data-wrong]");
  if (wrong) { state.wrongFor = wrong.dataset.wrong; drawTry(); $("why")?.focus(); }
});

document.addEventListener("toggle", (e) => {
  const det = e.target;
  if (det.matches?.("details[data-file]") && det.open) loadFile(det);
}, true);

document.addEventListener("change", (e) => {
  if (e.target.id === "twhere" && state.build) store.set(`against:${state.build.id}`, e.target.value);
  // The handle is asked for only for your own agent or a contracted supplier.
  if (e.target.name === "kind" && e.target.closest("form.bind")) {
    const label = e.target.closest("form.bind").querySelector("[data-handle]");
    if (label) label.hidden = !needsHandle(e.target.value);
  }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "key-form") {
    try {
      state.status = await call("/local/key", { method: "POST", body: { key: $("key").value } });
      state.error = "";
      await start();
    } catch (err) { state.error = err.message; drawKey(); }
    return;
  }
  if (f.id === "new-form") {
    const body = { does: $("n-does").value.trim() };
    for (const [k, id] of [["refuses", "n-refuses"], ["more", "n-more"], ["name", "n-name"], ["project", "n-project"]]) {
      const v = $(id).value.trim();
      if (v) body[k] = v;
    }
    state.pending = "new";
    // What the person wrote stays in the form if the service refuses the start.
    state.newDraft = { does: $("n-does").value, refuses: $("n-refuses").value, more: $("n-more").value, name: $("n-name").value, project: $("n-project").value };
    try {
      const r = await api("/builds", { method: "POST", body });
      state.pending = null;
      state.newDraft = null;
      await refreshBuilds();
      state.build = r.build;
      return go(hashFor(r.build.id));
    } catch (err) { state.pending = null; state.error = err.message; if (err.needKey) return problem(err); return drawNew(); }
  }
  if (f.id === "project-form") return go(rolesHash($("r-project").value.trim()));
  if (f.matches("form.bind")) {
    const values = formValues(f);
    state.roleDraft = values;
    return changeRole(f.dataset.role, "PUT", holderFrom(values));
  }
  if (f.id === "try-form") return sendTry($("tsay").value, $("twhere").value);
  if (f.id === "wrong-form") {
    const why = $("why").value.trim();
    return markTry(f.dataset.tid, "wrong", why ? { why } : {});
  }
  if (f.id === "clone-form") return runLocalCheck($("clone").value);
  if (f.dataset.ask) {
    const needs = {};
    for (const x of f.querySelectorAll("[name]")) if (x.value.trim() || x.required) needs[x.name] = x.value;
    return act(f.dataset.ask, needs);
  }
});

window.addEventListener("hashchange", route);

async function start() {
  try {
    state.status = await call("/local/status");
    const doc = await call("/local/stages");
    state.stages = (Array.isArray(doc) ? doc : doc.stages ?? []).slice().sort((a, b) => a.number - b.number);
    if (Array.isArray(doc.phases) && doc.phases.length) PHASES.splice(0, PHASES.length, ...doc.phases.map((p) => [p.id, p.name]));
    state.byId = new Map(state.stages.map((s) => [s.id, s]));
    state.evidenceFormats = Array.isArray(doc.evidence_formats) ? doc.evidence_formats : [];
  } catch (e) {
    $("main").innerHTML = `<div class="err" role="alert">${esc(e.message)}</div>`;
    return;
  }
  drawTop();
  if (!state.status.signed_in) return drawKey();
  try { await refreshBuilds(); } catch (e) { return problem(e); }
  route();
}

start();
