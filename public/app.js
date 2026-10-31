// The console page. It draws what the service says and offers only the
// actions the service offers. It talks only to the local server, which holds
// the key.

const PHASES = [
  ["define", "Define"], ["make", "Make"], ["ship", "Ship"], ["prove", "Prove"],
  ["use", "Use"], ["run", "Run"], ["change", "Change"],
];
const CLS = { done: "done", waiting_on_you: "wait", not_started: "todo", not_offered: "off", working: "work", refused: "bad", stopped: "stop" };
const MARK = { done: "✓", waiting_on_you: "!", not_started: "○", not_offered: "", working: "…", refused: "✕", stopped: "■" };
const WORD = { done: "Done", waiting_on_you: "Waiting on you", not_started: "Not started", not_offered: "Not offered", working: "Working", refused: "Refused", stopped: "Stopped" };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  logAll: false,
};

// ---------- talking to the local server ----------

class Problem extends Error {
  constructor(message, status, needKey) { super(message); this.status = status; this.needKey = needKey; }
}

async function call(path, { method = "GET", body, text = false } = {}) {
  const init = { method, headers: { accept: text ? "text/plain" : "application/json" } };
  if (method === "POST") {
    init.headers["content-type"] = "application/json";
    init.headers["x-adlc-console"] = "1";
    init.body = JSON.stringify(body ?? {});
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
function safeUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
}
function prWords(url) {
  const m = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url || "");
  return m ? { text: `${m[1]}, pull request #${m[2]}`, short: `pull request #${m[2]}` } : { text: "The pull request", short: "the pull request" };
}
function holderWords(h) {
  if (!h) return "";
  if (h.kind === "person" && /^you$/i.test(h.name)) return "you";
  return h.name;
}
const def = (id) => state.byId.get(id) ?? { id, number: 0, phase: "", name: id, role: "", given: "", hands_back: "", done_when: "" };
const stageOf = (id) => state.build?.stages.find((s) => s.stage === id);
const prStage = () => state.build?.stages.find((s) => s.where?.kind === "pull_request");
const installed = () => stageOf("deploy")?.state === "done";

// ---------- routing ----------

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "new") return { view: "new" };
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
  const b = state.builds.find((x) => x.at?.state === "waiting_on_you") ?? state.builds[0];
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
  if (b.at?.state === "stopped") return { text: `Stopped at ${name}`, wait: false };
  if (b.at?.state === "refused") return { text: `Refused at ${name}`, wait: false };
  return { text: `${name} · ${(WORD[b.at?.state] ?? "").toLowerCase()}`, wait: b.at?.state === "waiting_on_you" };
}

function drawRail() {
  const cur = state.view === "build" ? state.build?.id : null;
  $("builds").innerHTML = state.builds.length
    ? state.builds.map((b) => {
      const l = railLine(b);
      return `<a class="b${b.id === cur ? " on" : ""}" href="${hashFor(b.id)}" title="${esc(b.does)}"${b.id === cur ? ' aria-current="page"' : ""}><span class="n">${esc(b.name)}</span><span class="s${l.wait ? " w" : ""}">${esc(l.text)}</span></a>`;
    }).join("")
    : `<p class="none">No builds yet.</p>`;
  $("new").classList.toggle("on", state.view === "new");
  $("new").hidden = Boolean(state.status?.read_only);
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
    <div id="phases">${phases()}</div>
    ${buildLog()}`;
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
      const cls = CLS[s.state] ?? "todo";
      const mark = MARK[s.state] ?? "";
      const on = s.stage === state.sel;
      return `<button class="c ${cls}${on ? " sel" : ""}" type="button" data-stage="${esc(d.id)}" aria-pressed="${on}" aria-label="${esc(`${d.name}, ${WORD[s.state] ?? ""}${s.runs > 1 ? `, ran ${s.runs} times` : ""}`)}"><i>${pad(d.number)}</i>${esc(d.name)}${mark ? `<b>${mark}</b>` : ""}${s.runs > 1 ? `<u>×${s.runs}</u>` : ""}</button>`;
    }).join("")}</div></div>`;
  }).join("");
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

function filesHtml(list) {
  return `<div class="files">${list.map((f, i) => {
    const key = `${state.build.id}\n${f.path}`;
    const got = state.files.get(key);
    const open = list.length === 1 && i === 0;
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
  const d = def(state.sel);
  const phaseName = PHASES.find(([p]) => p === d.phase)?.[1] ?? "";
  let h = `<h2>Stage ${pad(d.number)}${phaseName ? ` · ${phaseName}` : ""}</h2>
    <h3>${esc(d.name)} <span class="pill ${CLS[s.state] ?? ""}">${WORD[s.state] ?? ""}</span></h3>`;
  if (s.state === "not_offered") {
    h += `<div class="sec">${d.hands_back ? prose(d.hands_back, "It hands back ") : ""}<p class="notyet">${esc(state.status?.source === "github" ? "A repository does not show this stage." : `${state.status?.demo ? "The demo" : state.status?.service ?? "This service"} does not run this stage yet.`)}</p></div>`;
    el.innerHTML = h;
    return;
  }
  const future = s.state === "not_started";
  const holder = holderWords(s.holder);
  if (holder) h += `<p class="who">${future ? "Will be held by" : "Held by"} ${esc(holder)}</p>`;
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
  try { state.builds = (await api("/builds")).builds ?? []; } catch (e) { if (e.needKey) throw e; state.error = e.message; }
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
    const r = await call("/local/check", { method: "POST", body: { folder } });
    state.checks.set(id, r.result);
  } catch (e) {
    state.checks.set(id, { error: e.message });
  }
  if (state.build?.id === id && state.sel !== "try") drawStage();
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
  if (t.closest("#logall")) { state.logAll = true; return draw(); }
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
    for (const [k, id] of [["refuses", "n-refuses"], ["more", "n-more"], ["name", "n-name"]]) {
      const v = $(id).value.trim();
      if (v) body[k] = v;
    }
    state.pending = "new";
    // What the person wrote stays in the form if the service refuses the start.
    state.newDraft = { does: $("n-does").value, refuses: $("n-refuses").value, more: $("n-more").value, name: $("n-name").value };
    try {
      const r = await api("/builds", { method: "POST", body });
      state.pending = null;
      state.newDraft = null;
      await refreshBuilds();
      state.build = r.build;
      return go(hashFor(r.build.id));
    } catch (err) { state.pending = null; state.error = err.message; if (err.needKey) return problem(err); return drawNew(); }
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
