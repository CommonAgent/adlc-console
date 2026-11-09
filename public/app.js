// The console page. It draws what the service says and offers only the
// actions the service offers. It talks only to the local server, which holds
// the key.

const PHASES = [
  ["define", "Define"], ["make", "Make"], ["ship", "Ship"], ["prove", "Prove"],
  ["use", "Use"], ["run", "Run"], ["change", "Change"],
];
import { esc, stateOf, holderHtml, evidenceHtml, holderFrom, effectiveHolder, WORD } from "./roles.js";
import { lifecyclePageHtml, lifecycleHash, lifecycleDraft, referenceHolder, stagesToReset, buildLifecycleHtml, addedDraft, addedBody } from "./lifecycle.js";
import { boardHtml } from "./board.js";
import { dashboardHtml, span } from "./dashboard.js";
import { analyticsHtml, analyticsOffered, analyticsQuery, analyticsHash, analyticsPath } from "./analytics.js";
import { meWords, whoMayHtml, peoplePageHtml } from "./people.js";
import { featuresMatrixHtml, featureDecision, cellTarget } from "./features.js";
import { steps, spineHtml, stageWorkspace, gateCardHtml, chatHtml, composerHtml, artifactsTabHtml, artifactCount, tabsHtml, fallbackChat, messagesOffered, confirmBody, stepStages, openingStage, productOf, productLine, productPageHtml, productFromBuilds, holderName, canTalkTo, bossBuildsToRead, whenNeededAction, setupHolder } from "./workspace.js";

// A stage's state as the pill beside its name.
const CLS = { done: "done", waiting_on_you: "wait", working: "work", refused: "bad", not_bound: "unb" };

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } },
  list(k) { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []; } catch { return []; } },
};

const state = {
  status: null, stages: [], byId: new Map(), builds: [], build: null, tries: [],
  sel: null, view: "build", error: "", lastTry: null, checks: new Map(), files: new Map(), pending: null, asking: null, wrongFor: null,
  logAll: false, showArchived: false, boardMine: store.get("board-mine") === "1",
  // The Dashboard: each build as GET /builds/:id answered it, kept by id with the list's updated time.
  full: new Map(), fullLoaded: false,
  // Analytics: whether the service answers it (null until asked), the page's choices, and its answer.
  analytics: null, anQuery: { window: "30d", project: "" }, anData: null,
  // The Lifecycle page: the stages answer, the roles answer, the holder form open, errors by row, the request in flight.
  lcStages: null, lcRoles: null, noStages: false, project: "", lcEditing: null, lcDraft: null, lcErrors: new Map(), lcPending: null,
  // Who the key belongs to (GET /me), and the People page (GET /people), when the service keeps people.
  me: null, people: null, hasPeople: false,
  // The open build's selected stage: the service's workspace for it (null when it has no such route),
  // its chat with the stage's agent (null without the route), the artifact open on the right, the
  // composer's draft, the proposals confirmed, and whether Try it is open on the right.
  roleDefs: [], stageSel: null, wsAnswer: null, chat: null, hasChat: false, art: null, sayDraft: "", sayPending: false, sayError: "", confirmed: new Set(), tab: "chat", ptab: null, chatScroll: null, drawnKey: null,
  // The products (GET /products, null without the route) and the open product page.
  products: null, product: null,
  // The when-needed action being taken from the product page (0.4.2), and a role the Setup tab sent the
  // Lifecycle page to choose a holder for: { role, at }.
  whenPending: null, lcWant: null,
  // The guided setup (0.4.4): the card open (undefined: the first to do), each card's draft, the card
  // being saved, its error in words, and the card just saved. The when-needed confirm card or the
  // result of the action just taken: { open, draft, pending, error, result }.
  setupUi: { open: undefined, drafts: {}, saving: null, error: null, saved: null }, whenCard: null,
  // Features (0.4.3): whether the service keeps them (null until asked), the product's matrix for the
  // version chosen, the feature whose history is open and that history, the build's own matrix for its
  // Requirements stage, the answer being sent, and the feature a reader is opened at.
  feat: { has: null, name: null, version: null, answer: null, error: "", sel: null, history: null, historyError: "" },
  bfeat: { build: null, answer: null, sel: null, history: null, historyError: "" },
  featPending: null, featFocus: null, openAt: null,
  // The product's boss (0.4.1): whether the service has it (null until asked), whose conversation is
  // held, the builds its open proposals name (for their live actions), the composer, and the proposal
  // being confirmed.
  boss: { has: null, name: null, messages: [], builds: new Map(), draft: "", sending: false, error: "", pending: null, confirmed: new Set() },
};

// ---------- talking to the local server ----------

class Problem extends Error {
  constructor(message, status, needKey) { super(message); this.status = status; this.needKey = needKey; }
}

// own403: a change the Lifecycle page makes on a key the service already took,
// so a 403 with words is the service's refusal (a member who is not an admin),
// shown as written, and not a bad key.
async function call(path, { method = "GET", body, text = false, own403 = false } = {}) {
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
    if (r.status === 401 || (r.status === 403 && !(own403 && words && !data?.need_key))) {
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
  const raw = location.hash.replace(/^#\/?/, "");
  // The Lifecycle page, for the organization or for ?project=<name>.
  if (/^lifecycle(\?|$)/.test(raw)) {
    const q = new URLSearchParams(raw.split("?")[1] ?? "");
    return { view: "lifecycle", project: (q.get("project") ?? "").trim(), edit: (q.get("edit") ?? "").trim() || null, at: (q.get("at") ?? "").trim() || null };
  }
  // Analytics, for ?window=7d|30d|all and ?project=<name>.
  if (/^analytics(\?|$)/.test(raw)) return { view: "analytics", ...analyticsQuery(raw) };
  const parts = raw.split("/").map(decodeURIComponent);
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "board") return { view: "board" };
  if (parts[0] === "dashboard") return { view: "dashboard" };
  if (parts[0] === "people") return { view: "people" };
  // The Roles page is now part of the Lifecycle page; an old link still lands there.
  if (parts[0] === "roles") return { view: "lifecycle", project: (parts[1] ?? "").trim() };
  // #/b/<id>/<stage>/<tab> opens a stage at one of its tabs; #/p/<name>/<tab> a product page at one of its tabs.
  if (parts[0] === "b" && parts[1]) return { view: "build", id: parts[1], sel: parts[2] || null, tab: ["chat", "artifacts", "try"].includes(parts[3]) ? parts[3] : null };
  if (parts[0] === "p" && parts[1]) return { view: "product", name: parts[1], tab: ["boss", "versions", "features", "setup", "plan", "activity"].includes(parts[2]) ? parts[2] : null };
  return { view: "build", id: null, sel: null };
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
const hashFor = (id, sel) => `#/b/${encodeURIComponent(id)}${sel ? `/${encodeURIComponent(sel)}` : ""}`;
const productHash = (name) => `#/p/${encodeURIComponent(name)}`;

async function route() {
  const h = parseHash();
  state.error = "";
  if (!state.status?.signed_in) return drawKey();
  if (state.analytics === null) await probeAnalytics();
  if (h.view === "analytics") {
    if (!state.analytics) return go("#/");
    const same = state.anQuery.window === h.window && state.anQuery.project === h.project;
    if (!same) state.anData = null;
    state.view = "analytics"; state.anQuery = { window: h.window, project: h.project };
    drawRail(); drawAnalytics();
    try { state.anData = await api(analyticsPath(state.anQuery)); } catch (e) { if (e.needKey) return problem(e); state.error = e.message; }
    if (state.view === "analytics") { drawRail(); drawAnalytics(); }
    return;
  }
  if (h.view === "new" && state.status?.source !== "file") { state.view = "new"; drawRail(); return drawNew(); }
  if (h.view === "board" && state.status?.source !== "file") {
    state.view = "board"; drawRail(); drawBoard();
    // Drawn at once from the list in hand, then again from a fresh one.
    try { await refreshBuilds(); } catch (e) { return problem(e); }
    if (state.view === "board") { drawRail(); drawBoard(); }
    return;
  }
  if (h.view === "dashboard" && state.status?.source !== "file") {
    state.view = "dashboard"; drawRail(); drawDashboard();
    try { await refreshBuilds(); await loadFull(); } catch (e) { return problem(e); }
    if (state.view === "dashboard") { drawRail(); drawDashboard(); }
    return;
  }
  if (h.view === "people" && state.hasPeople) {
    state.view = "people"; drawRail(); drawPeople();
    try { state.people = await api("/people"); state.error = ""; } catch (e) { return problem(e); }
    if (state.view === "people") drawPeople();
    return;
  }
  if (h.view === "lifecycle") {
    if (state.status?.read_only) return go("#/");
    if (state.view !== "lifecycle" || state.project !== h.project) { state.lcEditing = null; state.lcDraft = null; state.lcAdding = null; state.lcErrors = new Map(); state.lcStages = null; state.lcRoles = null; }
    state.view = "lifecycle"; state.project = h.project;
    state.lcWant = h.edit ? { role: h.edit, at: h.at } : null;
    if (h.project) remember(h.project);
    drawRail();
    return loadLifecycle();
  }
  // A lifecycle file has no builds: its page is the Lifecycle page.
  if (state.status?.source === "file") return go(lifecycleHash(""));
  // A product page opens at the boss, the default place to talk, unless the link names a tab.
  if (h.view === "product") { state.ptab = h.tab; return openProduct(h.name); }
  state.view = "build";
  const id = h.id || pickBuild();
  if (!id) { drawRail(); return drawEmpty(); }
  if (!(await openBuild(id))) return;
  // Whether the service has a boss, asked once, so the menu can offer it.
  if (state.boss.has === null) { try { await loadBoss(productOf(state.build)); } catch (e) { if (e.needKey) return problem(e); } }
  // Opening a build opens the stage it is at now. An old link to Try it opens it beside that stage.
  if (h.sel === "try") state.tab = "try";
  if (h.tab) state.tab = h.tab;
  const used = stepStages(state.build, defs()).map((s) => s.stage);
  const stage = used.includes(h.sel) ? h.sel : openingStage(state.build, defs());
  if (stage !== state.stageSel) {
    state.stageSel = stage; state.art = null; state.featFocus = null; state.sayDraft = ""; state.sayError = ""; state.asking = null;
    try { await loadStage(); } catch (e) { return problem(e); }
  }
  // A Features cell opened this stage: its artifact, at its feature.
  if (state.openAt && state.openAt.build === state.build.id && state.openAt.stage === stage) {
    state.art = state.openAt.artifact; state.featFocus = state.openAt.feature; state.tab = "artifacts";
  }
  state.openAt = null;
  if (state.tab === "try") await loadTries();
  draw();
}

async function openBuild(id) {
  if (state.build && state.build.id === id) return true;
  state.tries = []; state.lastTry = null; state.asking = null; state.wrongFor = null; if (state.tab === "try") state.tab = "chat";
  state.stageSel = null; state.wsAnswer = null; state.chat = null; state.hasChat = false; state.art = null; state.confirmed = new Set();
  try { state.build = (await api(buildPath(id))).build; } catch (e) { problem(e); return false; }
  return true;
}

// The selected stage: the service's workspace for it, and its chat with the stage's agent. A service
// without those routes (404, 405 or 501) gets the stage made from the build answer, and no composer.
async function loadStage() {
  const b = state.build;
  const stage = state.stageSel;
  if (!b || !stage) return;
  const [ws, chat] = await Promise.allSettled([
    api(buildPath(b.id, `/stages/${encodeURIComponent(stage)}`)),
    api(`/products/${encodeURIComponent(productOf(b))}/stages/${encodeURIComponent(stage)}/messages`),
  ]);
  if (state.build?.id !== b.id || state.stageSel !== stage) return;
  for (const r of [ws, chat]) if (r.status === "rejected" && r.reason?.needKey) throw r.reason;
  state.wsAnswer = ws.status === "fulfilled" ? ws.value : null;
  // At Requirements, the build's features matrix (0.4.3) for its Artifacts tab; a service without it has none.
  if (stage === "requirements") {
    try { state.bfeat = { ...state.bfeat, build: b.id, answer: await api(buildPath(b.id, "/features")) }; } catch (e) { if (e.needKey) throw e; state.bfeat = { build: b.id, answer: null, sel: null, history: null, historyError: "" }; }
  }
  state.hasChat = chat.status === "fulfilled";
  state.chat = state.hasChat && Array.isArray(chat.value?.messages) ? chat.value.messages : null;
  const errs = [ws, chat].filter((r) => r.status === "rejected" && messagesOffered(r.reason?.status ?? 0)).map((r) => r.reason.message);
  if (errs.length) state.error = [...new Set(errs)].join(" ");
}

// The product page: GET /products/:name, or made from the build list without that route.
// The menu keeps showing the product's latest build.
async function openProduct(name) {
  state.view = "product";
  const latest = latestBuildOf(name);
  if (latest && !(await openBuild(latest))) return;
  state.stageSel = null;
  if (state.product?.name !== name) { state.product = null; state.setupUi = { open: undefined, drafts: {}, saving: null, error: null, saved: null }; state.whenCard = null; }
  drawRail(); drawProduct();
  let p = null;
  try { p = await api(`/products/${encodeURIComponent(name)}`); state.error = ""; } catch (e) {
    if (e.needKey) return problem(e);
    if (messagesOffered(e.status ?? 0)) state.error = e.message;
  }
  state.product = p && typeof p === "object" && Array.isArray(p.builds) ? p : productFromBuilds(name, state.builds, state.build && productOf(state.build) === name ? state.build : null);
  try { await loadBoss(name); } catch (e) { if (e.needKey) return problem(e); }
  try { await loadFeatures(name); } catch (e) { if (e.needKey) return problem(e); }
  if (state.view === "product") draw();
}

// The product's features matrix (0.4.3), for the version chosen. A service without the route (404, 405
// or 501) keeps no features: the tab is shown disabled.
async function loadFeatures(name) {
  const fs0 = state.feat;
  if (fs0.name !== name) state.feat = { has: fs0.has, name, version: null, answer: null, error: "", sel: null, history: null, historyError: "" };
  const v = state.feat.version;
  try {
    state.feat.answer = await api(`/products/${encodeURIComponent(name)}/features${v ? `?version=${encodeURIComponent(v)}` : ""}`);
    state.feat.has = true; state.feat.error = "";
  } catch (e) {
    if (e.needKey) throw e;
    if (!messagesOffered(e.status ?? 0)) { state.feat.has = false; return; }
    state.feat.error = e.message;
  }
  if (state.feat.sel) await loadHistory(state.feat, name, state.feat.sel);
}

// One feature's history, into the matrix that opened it.
async function loadHistory(holder, name, id) {
  holder.history = null; holder.historyError = "";
  try { holder.history = await api(`/products/${encodeURIComponent(name)}/features/${encodeURIComponent(id)}`); } catch (e) {
    if (e.needKey) throw e;
    holder.historyError = e.message;
  }
}

// An answer to a feature proposal: Approve feature, Not now, or Ask the approvers. The chat it sits in is
// read again, so the proposal shows its answer, and so are the features.
async function answerFeature(d) {
  const go1 = featureDecision(d);
  if (!go1 || state.featPending) return;
  const onProduct = state.view === "product";
  state.featPending = `${d.featProposal} ${d.feat}`;
  onProduct ? drawProduct() : draw();
  try {
    await api(go1.path, { method: "POST", body: go1.body, own403: true });
    state.error = ""; state.boss.error = "";
    if (onProduct) { await loadBoss(state.boss.name); await loadFeatures(state.product?.name ?? state.boss.name); }
    else { await loadStage(); state.build = (await api(buildPath(state.build.id))).build; }
  } catch (e) {
    state.featPending = null;
    if (e.needKey) return problem(e);
    if (onProduct) state.boss.error = e.message; else state.error = e.message;
  }
  state.featPending = null;
  onProduct ? drawProduct() : draw();
}

// The product's boss: its conversation, and the builds its open proposals name, read for their live
// actions. A service without the route (404, 405 or 501) has no boss: the tab is shown disabled.
async function loadBoss(name) {
  const boss = state.boss;
  if (boss.name !== name) { boss.name = name; boss.messages = []; boss.builds = new Map(); boss.draft = ""; boss.error = ""; boss.confirmed = new Set(); }
  let r;
  try { r = await api(`/products/${encodeURIComponent(name)}/boss/messages`); } catch (e) {
    if (e.needKey) throw e;
    if (!messagesOffered(e.status ?? 0)) { boss.has = false; return; }
    boss.error = e.message;
    return;
  }
  boss.has = true;
  boss.messages = Array.isArray(r?.messages) ? r.messages : [];
  for (const id of bossBuildsToRead(boss.messages)) {
    try { boss.builds.set(id, (await api(buildPath(id))).build); } catch (e) { if (e.needKey) throw e; }
  }
}
const bossWaits = () => state.boss.messages.some((m) => m?.proposes && m.proposes.action !== "start_version" && (m.proposes.state ?? "open") === "open" && !state.boss.builds.get(m.proposes.build)?.actions?.some((a) => a?.name === m.proposes.action));

// A message to the boss. Its reply may say where it routed the message, carry a plan, or propose.
async function bossSay(text, extra = {}) {
  const name = state.boss.name;
  if (!name || (!text.trim() && !extra.confirms)) return;
  state.boss.sending = true; state.boss.draft = extra.confirms ? state.boss.draft : text; state.boss.error = ""; drawProduct();
  try {
    await api(`/products/${encodeURIComponent(name)}/boss/messages`, { method: "POST", body: { text, ...extra }, own403: true });
    if (!extra.confirms) state.boss.draft = "";
    await loadBoss(name);
    // A version it started is a new build: the menu and the product's versions read it.
    await refreshBuilds();
    try { const p = await api(`/products/${encodeURIComponent(name)}`); if (Array.isArray(p?.builds)) state.product = p; } catch { /* kept */ }
  } catch (e) {
    state.boss.sending = false; state.boss.pending = null;
    if (e.needKey) return problem(e);
    state.boss.error = e.message;
    return drawProduct();
  }
  state.boss.sending = false; state.boss.pending = null;
  drawProduct();
  requestAnimationFrame(() => { $("thread")?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" }); if (!extra.confirms) $("boss-say")?.focus(); });
}

// "Start version 0.2.0?": the person's yes goes to the boss, which starts the build.
function bossConfirm(pid) {
  const m = state.boss.messages.find((x) => x?.proposes?.id === pid);
  if (!m) return;
  state.boss.pending = pid;
  return bossSay(`Yes: ${String(m.proposes.words || "start it").replace(/\?$/, "")}.`, { confirms: pid });
}

// A build's own action the boss proposed: taken with the actions route, so it goes back through its gate.
async function bossAct(msgId) {
  const m = state.boss.messages.find((x) => x?.id === msgId);
  const p = m?.proposes;
  const b = p ? state.boss.builds.get(p.build) : null;
  const body = b ? confirmBody(b, p) : null;
  if (!body) return;
  state.boss.pending = p.id; drawProduct();
  try {
    const r = await api(buildPath(p.build, `/actions/${encodeURIComponent(body.name)}`), { method: "POST", body: body.needs, own403: true });
    if (state.build?.id === p.build && r?.build) state.build = r.build;
    state.boss.confirmed.add(p.id);
    await loadBoss(state.boss.name);
    await refreshBuilds();
  } catch (e) {
    if (e.needKey) { state.boss.pending = null; return problem(e); }
    state.boss.error = e.message;
  }
  state.boss.pending = null;
  drawProduct();
}
// ---------- the guided setup and the when-needed confirm cards (0.4.4) ----------

const reloadProduct = async (name) => {
  try { const p = await api(`/products/${encodeURIComponent(name)}`); if (Array.isArray(p?.builds)) state.product = p; } catch (e) { if (e.needKey) throw e; }
};
const setupItem = (stage) => (state.product?.setup ?? []).find((x) => x?.stage === stage) ?? null;

/** What a setup card's inputs hold now: { kind, name, handle, values }. */
function setupFormDraft(f) {
  const values = {};
  for (const x of f.querySelectorAll("[name^='f.']")) values[x.name.slice(2)] = x.value;
  const v = (n) => f.querySelector(`[name=${n}]`)?.value;
  return { kind: v("kind"), ...(v("name") !== undefined ? { name: v("name") } : {}), ...(v("handle") !== undefined ? { handle: v("handle") } : {}), values };
}

/** Saves one setup card with the roles route: the holder, with this stage's settings beside the role's others. */
async function saveSetup(stage, f) {
  const item = setupItem(stage);
  const ui = state.setupUi;
  if (!item || ui.saving) return;
  ui.drafts[stage] = setupFormDraft(f);
  const q = item.project ? `?project=${encodeURIComponent(item.project)}` : "";
  ui.saving = stage; ui.error = null; drawProduct();
  try {
    const roles = await api(`/roles${q}`);
    const existing = (roles?.roles ?? []).find((r) => r?.role === item.role)?.binding?.holder ?? null;
    const made = setupHolder(item, ui.drafts[stage], existing);
    if (made.error) throw new Problem(made.error, 400);
    await api(`/roles/${encodeURIComponent(item.role)}${q}`, { method: "PUT", body: { holder: made.holder }, own403: true });
    delete ui.drafts[stage];
    ui.saved = stage;
    await reloadProduct(state.product.name);
    // The next card to do opens; none, and the cards close.
    ui.open = (state.product?.setup ?? []).find((x) => x?.state === "not_chosen")?.stage ?? null;
  } catch (e) {
    if (e.needKey) { ui.saving = null; return problem(e); }
    ui.error = { stage, words: e.message };
  }
  ui.saving = null;
  drawProduct();
}

/** "Ask the boss" on a setup card: the boss's tab, with the card's question ready to send. */
function askBossAbout(stage) {
  const item = setupItem(stage);
  if (!item?.form?.ask || !state.product) return;
  state.boss.draft = item.form.ask;
  state.ptab = "boss";
  go(`${productHash(state.product.name)}/boss`);
  requestAnimationFrame(() => { const i = $("boss-say"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
}

/** Takes the action a confirm card names, with its needs, on the build it names. */
async function runWhen(stage, f) {
  const item = (state.product?.when_needed ?? []).find((x) => x?.stage === stage);
  const a = whenNeededAction(state.product?.when_needed, stage);
  const w = state.whenCard;
  if (!item || !a || !w || w.pending) return;
  const needs = {};
  for (const n of item.action?.needs ?? []) {
    const v = String(f.querySelector(`[name="${n.name}"]`)?.value ?? "").trim();
    w.draft[n.name] = v;
    if (v || !n.optional) needs[n.name] = v;
  }
  const name = state.product.name;
  w.pending = stage; w.error = ""; drawProduct();
  try {
    const r = await api(buildPath(a.build, `/actions/${encodeURIComponent(a.name)}`), { method: "POST", body: needs, own403: true });
    if (state.build?.id === a.build && r?.build) state.build = r.build;
    state.whenCard = { result: r?.result ?? { stage, ok: true, words: "Done." } };
    await refreshBuilds();
    await reloadProduct(name);
  } catch (e) {
    w.pending = null;
    if (e.needKey) return problem(e);
    w.error = e.message;
    // A refusal is kept on the record, so the activity shows it.
    await reloadProduct(name);
    return drawProduct();
  }
  drawProduct();
}

async function whenAct(stage) {
  // A service that gives a confirm card (0.4.4): the card first, and nothing runs until the person confirms.
  const item = (state.product?.when_needed ?? []).find((x) => x?.stage === stage);
  if (item?.confirm && item.can_run === true) { state.whenCard = { open: stage, draft: {}, pending: null, error: "" }; return drawProduct(); }
  const a = whenNeededAction(state.product?.when_needed, stage);
  if (!a || state.whenPending) return;
  const name = state.product.name;
  state.whenPending = stage; drawProduct();
  try {
    const r = await api(buildPath(a.build, `/actions/${encodeURIComponent(a.name)}`), { method: "POST", body: {}, own403: true });
    if (state.build?.id === a.build && r?.build) state.build = r.build;
    state.error = "";
    await refreshBuilds();
    try { const p = await api(`/products/${encodeURIComponent(name)}`); if (Array.isArray(p?.builds)) state.product = p; } catch { /* kept */ }
  } catch (e) {
    state.whenPending = null;
    if (e.needKey) return problem(e);
    state.error = e.message;
    return drawProduct();
  }
  state.whenPending = null;
  drawProduct();
}

function latestBuildOf(name) {
  const fromProducts = (state.products ?? []).find((p) => p.name === name)?.latest?.build;
  if (fromProducts) return fromProducts;
  const mine = state.builds.filter((b) => (b.product || b.name) === name);
  return (mine.find((b) => !b.archived) ?? mine[0])?.id ?? null;
}

async function loadProducts() {
  try {
    const r = await api("/products");
    state.products = Array.isArray(r?.products) ? r.products : null;
  } catch (e) { if (e.needKey) throw e; state.products = null; }
}

function pickBuild() {
  const live = state.builds.filter((x) => !x.archived);
  const b = live.find((x) => x.at?.state === "waiting_on_you") ?? live[0];
  return b?.id ?? null;
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
  else if (st?.source === "file") who = "No service · saved to a file on this computer";
  else if (st?.key_from === "saved") who = `Using your saved key · <button class="linkbtn" id="forget" type="button">Forget it</button>`;
  else if (st?.key_from === "service") who = "Started by the service, with its key";
  else if (st?.key_from === "environment") who = "Using the key from your environment";
  else if (st?.key_from === "key file") who = "Using the key from your key file";
  else if (st?.key_from === "github token") who = "Read-only · using your GitHub token";
  else if (st?.source === "github") who = "Read-only · reading without a GitHub token";
  const me = meWords(state.me);
  $("who").innerHTML = me ? `<span class="me">${esc(me)}</span>${who ? ` · ${who}` : ""}` : who;
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
  // With a build open, the menu is that build: its steps, the other builds, New build and the factory pages.
  const spine = $("spine");
  const open = Boolean(state.build) && (state.view === "build" || state.view === "product") && state.status?.source !== "file";
  spine.hidden = !open;
  $("railhome").hidden = open;
  if (open) spine.innerHTML = buildMenuHtml();
  const board = $("board");
  board.hidden = state.status?.source === "file";
  board.classList.toggle("on", state.view === "board");
  if (state.view === "board") board.setAttribute("aria-current", "page"); else board.removeAttribute("aria-current");
  const dash = $("dashboard");
  dash.hidden = state.status?.source === "file";
  dash.classList.toggle("on", state.view === "dashboard");
  if (state.view === "dashboard") dash.setAttribute("aria-current", "page"); else dash.removeAttribute("aria-current");
  // Analytics: only for a service that answers it.
  const an = $("analytics");
  an.hidden = !state.analytics || state.status?.source === "file";
  an.classList.toggle("on", state.view === "analytics");
  if (state.view === "analytics") an.setAttribute("aria-current", "page"); else an.removeAttribute("aria-current");
  const ppl = $("people");
  ppl.hidden = !state.hasPeople;
  ppl.classList.toggle("on", state.view === "people");
  if (state.view === "people") ppl.setAttribute("aria-current", "page"); else ppl.removeAttribute("aria-current");
  // A lifecycle file holds no builds: a plain line, not an error.
  if (state.status?.source === "file") {
    $("builds").innerHTML = `<p class="none">There are no builds here. The console is keeping your lifecycle in a file.</p>`;
    $("new").hidden = true;
    return drawLifecycles();
  }
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
  drawLifecycles();
}

const defs = () => state.byId;
const stepsNow = () => steps(state.build, { defs: defs(), roleDefs: state.roleDefs, when });
const buildProject = (b) => {
  const lc = b?.lifecycle;
  const p = lc && typeof lc === "object" ? lc.project : b?.project;
  return typeof p === "string" ? p : "";
};

/** The left menu while a build is open: the product and its build's stages, the other products, New build, the factory pages. */
function buildMenuHtml() {
  const b = state.build;
  const spine = stepsNow();
  const mine = productOf(b);
  const stageName = (id) => def(id).name;
  let others = "";
  let archived = 0;
  if (Array.isArray(state.products)) {
    others = state.products.filter((p) => p?.name && p.name !== mine).map((p) => {
      const l = productLine(p, { stageName });
      const id = p.latest?.build;
      return `<a class="ob" href="${esc(id ? hashFor(id) : productHash(p.name))}"><b>${esc(p.name)}</b><small class="${l.wait ? "w" : ""}">${esc(l.text)}</small></a>`;
    }).join("");
  } else {
    // No products route: each other build in the list stands for its product.
    const rest = state.builds.filter((x) => (x.product || x.name) !== mine);
    archived = rest.filter((x) => x.archived).length;
    others = rest.filter((x) => state.showArchived || !x.archived).map((x) => {
      const l = railLine(x);
      return `<a class="ob${x.archived ? " ar" : ""}" href="${hashFor(x.id)}" title="${esc(x.does)}"><b>${esc(x.name)}</b><small class="${l.wait ? "w" : ""}${l.paused ? " p" : ""}">${x.archived ? "Archived · " : ""}${esc(l.text)}</small></a>`;
    }).join("");
  }
  const page = (href, name) => `<a href="${esc(href)}">${esc(name)}</a>`;
  const pages = [
    page("#/board", "Board"), page("#/dashboard", "Dashboard"),
    state.analytics ? page("#/analytics", "Analytics") : "",
    state.status?.read_only ? "" : page(lifecycleHash(buildProject(b)), "Lifecycle"),
    state.hasPeople ? page("#/people", "People") : "",
  ].filter(Boolean).join("");
  // The boss sits at the top: the default place to talk about the product.
  const onBoss = state.view === "product" && (state.ptab ?? "boss") === "boss" && state.boss.has === true;
  const ask = state.boss.has === false ? "" : `<a class="askboss${onBoss ? " on" : ""}" href="${esc(`${productHash(mine)}/boss`)}"${onBoss ? ' aria-current="page"' : ""}>Ask the boss</a>`;
  return `${ask}${spineHtml(b, spine, { sel: state.view === "build" ? state.stageSel : null, href: (s) => hashFor(b.id, s), productHref: productHash(mine), onProduct: state.view === "product" && !onBoss })}
    ${others || archived ? `<h2>Other products</h2>${others}` : ""}
    ${archived ? `<button class="linkbtn archt" id="archt" type="button" aria-pressed="${state.showArchived}">${state.showArchived ? "Hide archived" : `Show archived (${archived})`}</button>` : ""}
    ${state.status?.read_only ? "" : `<button class="newb" id="new2" type="button">New build</button>`}
    <h2>Factory</h2><div class="pages">${pages}</div>`;
}

// The rail's Lifecycles: the organization's, then each project this page knows of.
// The service lists no projects, so these are the ones seen on a build or typed here.
function drawLifecycles() {
  const el = $("lifecycles");
  // A read-only source holds no lifecycle to choose.
  el.hidden = Boolean(state.status?.read_only);
  if (el.hidden) return;
  const on = (p) => state.view === "lifecycle" && state.project === p;
  const link = (p, n, s) => `<a class="b${on(p) ? " on" : ""}" href="${esc(lifecycleHash(p))}"${on(p) ? ' aria-current="page"' : ""}><span class="n">${esc(n)}</span>${s ? `<span class="s">${esc(s)}</span>` : ""}</a>`;
  el.innerHTML = `<h2>Lifecycles</h2>${link("", "The organization", "every build")}${knownProjects().map((p) => link(p, p, "a project")).join("")}
    <form class="projnew" id="proj-form"><label for="proj-name" class="sr">Another project</label><input type="text" id="proj-name" placeholder="Another project" autocomplete="off" spellcheck="false"></form>
    ${state.status?.lifecycle_file ? `<p class="lcfile">Saved in <code>${esc(state.status.lifecycle_file)}</code></p>` : ""}`;
}

function knownProjects() {
  const seen = new Set(store.list("projects"));
  if (typeof state.build?.project === "string" && state.build.project) seen.add(state.build.project);
  if (typeof state.build?.lifecycle?.project === "string" && state.build.lifecycle.project) seen.add(state.build.lifecycle.project);
  for (const b of state.builds) if (typeof b.project === "string" && b.project) seen.add(b.project);
  if (state.project) seen.add(state.project);
  return [...seen].sort((a, b) => a.localeCompare(b));
}
function remember(project) {
  const list = store.list("projects");
  if (!list.includes(project)) store.set("projects", JSON.stringify([...list, project].slice(-20)));
}

function layout(kind) {
  $("app").classList.toggle("solo", kind === "solo");
  $("app").classList.toggle("bare", kind === "bare");
  $("app").classList.toggle("thread", kind === "thread");
  if (kind !== "thread") $("app").classList.remove("noarts");
}

const artifactsOf = (b) => (Array.isArray(b?.artifacts) ? b.artifacts.filter((a) => a && typeof a.id === "string") : []);
const currentWs = () => stageWorkspace(state.build, state.stageSel, state.wsAnswer, { defs: defs() });

// What the stage's gate card and chat need from the page: times, names, the gate buttons, the clone check.
function stageCtx(ws) {
  const b = state.build;
  const kind = stageOf(ws.stage)?.holder?.kind;
  return {
    build: b, when, me: typeof state.me?.account?.name === "string" ? state.me.account.name : null,
    artifacts: new Map([...artifactsOf(b), ...ws.outputs, ...ws.given].map((a) => [a.id, a])), selected: state.art,
    actionsHtml, checkHtml: localCheckHtml, cloneOpen: state.cloneOpen,
    confirmed: state.confirmed, pending: state.pending, featPending: state.featPending, theirs: kind === "your_agent" || kind === "contracted",
  };
}

// The tab body scrolls on its own beside the menu; at phone width the page scrolls instead.
const phone = () => matchMedia("(max-width:760px)").matches;
const getScroll = () => (phone() ? window.scrollY : $("tabbody")?.scrollTop ?? 0);
function setScroll(top) {
  if (phone()) return window.scrollTo(0, top);
  const el = $("tabbody");
  if (el) el.scrollTop = top;
}
// Remembers where the chat was, so coming back to it lands in the same place.
function leaveTab() {
  if (state.tab === "chat" && state.view === "build" && state.build) state.chatScroll = { key: `${state.build.id}/${state.stageSel}`, top: getScroll() };
}

function draw() {
  drawTop();
  drawRail();
  if (!state.build) return;
  if (state.view === "product") return drawProduct();
  if (state.view !== "build") return;
  const b = state.build;
  const ws = currentWs();
  const ctx = stageCtx(ws);
  const s = stageOf(ws.stage) ?? { stage: ws.stage };
  const spine = stepsNow();
  const x = spine.find((y) => y.stage === ws.stage);
  const canTry = state.status?.can_try !== false && (Boolean(prStage()) || installed());
  if (state.tab === "try" && !canTry) state.tab = "chat";
  const agent = holderName(ws.holder, s, def(ws.stage), state.roleDefs);
  const who = holderHtml(ws.holder);
  const talk = state.hasChat && canTalkTo(ws.holder);
  const msgs = state.hasChat && Array.isArray(state.chat) ? state.chat : fallbackChat(b, ws.stage, { defs: defs(), roleDefs: state.roleDefs });
  const gate = gateCardHtml(ws, b, ctx);
  const st = stateOf({ state: ws.state });
  const tabs = [
    { id: "chat", label: "Chat", count: msgs.filter((m) => m?.from?.kind !== "system").length },
    { id: "artifacts", label: "Artifacts", count: artifactCount(ws) ?? undefined },
    ...(canTry ? [{ id: "try", label: "Try it" }] : []),
  ];
  let body;
  const bf = ws.stage === "requirements" && state.bfeat.build === b.id && state.bfeat.answer ? state.bfeat : null;
  const focusName = state.featFocus ? (state.bfeat.answer?.features ?? state.feat.answer?.features ?? []).find((x) => x.id === state.featFocus)?.name ?? "" : "";
  if (state.tab === "artifacts") body = artifactsTabHtml(ws, state.art, { stageName: (id) => def(id).name, when, filesHtml: (list) => filesHtml(list, false), feature: state.featFocus, featureName: focusName, featuresHtml: bf ? () => featuresMatrixHtml(bf.answer, { when, selected: bf.sel, history: bf.history, historyError: bf.historyError, stageName: (id) => def(id).name }) : null });
  else if (state.tab === "try") body = `<div class="stage trypane" id="trybody"></div>`;
  else body = `<div class="thread" id="thread">${chatHtml(msgs, { ...ctx, empty: talk ? `Nothing has been said here yet. Ask ${agent} about what it read or made.` : "Nothing has been said here yet." })}
      ${ws.evidence.length ? `<div class="evid">${evidenceHtml(ws.evidence, { when, fileHtml: (f) => filesHtml([f], false) })}</div>` : ""}</div>${timeline()}`;
  // Where the tab body was, kept across a redraw of the same stage and tab.
  const key = `${b.id}/${ws.stage}/${state.tab}`;
  const keep = key === state.drawnKey ? getScroll() : null;
  layout("thread");
  $("app").classList.add("noarts");
  $("main").innerHTML = `
    <section class="thread-wrap work">
      <div class="whead">
        <div class="hd"><div><h1>${esc(ws.name)}${x ? `<span>Step ${x.number} of ${spine.length}</span>` : ""}</h1><p class="sub"><span class="pill ${CLS[st] ?? ""}">${esc(WORD[st])}</span>${who ? ` Held by ${who}` : ""}</p></div></div>
        <div class="err" role="alert">${esc(state.error)}</div>
        ${b.paused ? `<p class="pausedwhy">Paused ${esc(when(b.paused.at))}. ${esc(b.paused.why)}</p>` : ""}
        ${gate ? `<div class="pin">${gate}</div>` : ""}
        ${tabsHtml(tabs, state.tab, { label: `${ws.name}` })}
      </div>
      <div class="wbody tab-${esc(state.tab)}" id="tabbody" role="tabpanel">${body}</div>
      ${state.tab === "chat" ? (talk ? composerHtml(agent, { draft: state.sayDraft, pending: state.sayPending, error: state.sayError }) : state.hasChat && ws.holder ? `<div class="compose quiet"><p class="hint">${esc(`${agent || "A person"} holds this stage. There is no agent here to talk to.`)}</p></div>` : "") : ""}
    </section>`;
  $("stage").innerHTML = "";
  // The bars placed through the CSSOM: the page's policy takes no style attribute.
  for (const i of document.querySelectorAll(".timeline .track i")) { i.style.left = `${i.dataset.l}%`; i.style.width = `${i.dataset.w}%`; }
  for (const det of document.querySelectorAll("#tabbody details[open][data-file]")) loadFile(det);
  if (state.tab === "try") drawTry();
  if (keep !== null) setScroll(keep);
  else if (state.tab === "chat") {
    const saved = state.chatScroll?.key === `${b.id}/${ws.stage}` ? state.chatScroll.top : null;
    // A stage's chat opens at its newest message; coming back to it lands where it was.
    if (saved !== null) setScroll(saved); else if (!phone()) setScroll(1e9);
  } else if (!phone()) setScroll(0);
  state.drawnKey = key;
  if (b.stages.some((y) => y.state === "working")) schedule();
}

// The product page: tabs for its versions, run plan and activity.
function drawProduct() {
  layout("thread");
  $("app").classList.add("noarts");
  const b = state.build;
  const same = b && state.product && productOf(b) === state.product.name;
  const bs = state.boss;
  const boss = bs.has === true && state.product && bs.name === state.product.name
    ? { offered: true, messages: bs.messages, builds: bs.builds, confirmed: bs.confirmed, pending: bs.pending, featPending: state.featPending, me: typeof state.me?.account?.name === "string" ? state.me.account.name : null, composer: { draft: bs.draft, pending: bs.sending, error: bs.error } }
    : null;
  const keep = state.drawnKey === "product/boss" ? getScroll() : null;
  $("main").innerHTML = state.product
    ? productPageHtml(state.product, {
      stageName: (id) => def(id).name, when, error: state.error, does: same ? b.does : "", extra: same ? buildLifecycleHtml(b, { day }) : "", buildHref: (id) => hashFor(id), boss,
      roleName: (id) => state.roleDefs.find((r) => r.id === id)?.name ?? id,
      chooseHref: state.status?.read_only ? null : (role, stage, project) => `${lifecycleHash(project ?? "")}${project ? "&" : "?"}edit=${encodeURIComponent(role)}&at=${encodeURIComponent(stage)}`,
      whenPending: state.whenPending,
      setup: state.setupUi,
      whenCard: state.whenCard,
      features: { offered: state.feat.has === true && state.feat.name === state.product.name, answer: state.feat.answer, error: state.feat.error, selected: state.feat.sel, history: state.feat.history, historyError: state.feat.historyError, stageName: (id) => def(id).name },
    }, state.ptab)
    : `<div class="err" role="alert">${esc(state.error)}</div><p class="does">Loading…</p>`;
  $("stage").innerHTML = "";
  const onBoss = Boolean(boss) && (state.ptab ?? "boss") === "boss";
  // The boss's conversation opens at its newest message, and stays where it was across a redraw.
  if (onBoss) { if (keep !== null) setScroll(keep); else if (!phone()) setScroll(1e9); }
  state.drawnKey = onBoss ? "product/boss" : null;
  drawRail();
  // A proposal waiting for its build to offer the action (a version that has just started) is checked again.
  if (onBoss && bossWaits()) schedule();
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
  return '<details class="timeline"' + (state.timelineOpen ? " open" : "") + '><summary>How long each step took <span>' + esc(span(whole)) + '</span></summary><p class="does">' + esc(span(whole)) + " from the first step to the last. Steps that ran at the same time overlap.</p><ol class=\"bars\">" + rows + "</ol></details>";
}

function actionsFor(stage) {
  return (state.build.actions ?? []).filter((a) => a.stage === stage);
}

function actionsHtml(stage, opts = {}) {
  const list = actionsFor(stage);
  // A gate this key may not answer: the service leaves its buttons out and says who may.
  const whoMay = whoMayHtml(stageOf(stage));
  if (whoMay) return `${whoMay}${list.length ? buttonsHtml(list, opts) : ""}`;
  if (!list.length) return "";
  return buttonsHtml(list, opts);
}

function buttonsHtml(list, { labels = {} } = {}) {
  list = list.map((a) => (labels[a.name] ? { ...a, label: labels[a.name] } : a));
  const busy = state.pending !== null;
  // Stop is never drawn as the main action, even when it is the only one.
  const main = list.findIndex((a) => a.name !== "stop");
  let h = `<div class="acts">${list.map((a, i) => `<button class="btn${i === main ? " p" : ""}" type="button" data-act="${esc(a.name)}" data-act-stage="${esc(a.stage)}"${busy ? " disabled" : ""}>${esc(state.pending === a.name ? "Sending…" : a.label)}</button>`).join("")}</div>`;
  const ask = list.find((a) => `${a.stage}\n${a.name}` === state.asking && a.needs?.length);
  if (ask) {
    h += `<form class="ask" data-ask="${esc(ask.name)}" data-ask-stage="${esc(ask.stage)}">${ask.needs.map((n) => {
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
function el(h) { const t = $("trybody"); if (t) t.innerHTML = h; }

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
      <label for="n-project">Project <span>Optional. The build follows the lifecycle chosen for this project.</span><input type="text" id="n-project" value="${esc(kept.project ?? "")}" autocomplete="off" spellcheck="false"></label>
      <div class="acts tight"><button class="btn p" type="submit"${state.pending === "new" ? " disabled" : ""}>${state.pending === "new" ? "Starting…" : "Start the build"}</button><a class="btn" href="#/">Cancel</a></div>
    </form>`;
  $("stage").innerHTML = "";
}

// The People page: who is in the organization, its teams and projects. Read-only;
// the service says where they are changed.
function drawPeople() {
  drawTop();
  layout("solo");
  $("main").innerHTML = state.people ? peoplePageHtml(state.people, { error: state.error }) : `<div class="err" role="alert">${esc(state.error)}</div><p class="does">Loading…</p>`;
  $("stage").innerHTML = "";
}

// The Board: every build by the phase it is at, read from the build list.
function drawBoard() {
  drawTop();
  layout("solo");
  $("main").innerHTML = boardHtml(state.builds, state.stages, PHASES, { mine: state.boardMine, error: state.error });
  $("stage").innerHTML = "";
  // While any build is working, it refreshes the way a build page does.
  if (state.builds.some((b) => b.at?.state === "working" && !b.archived)) schedule();
}

// The Dashboard: median time per stage, send-backs per stage, and what is
// waiting now, read from the build list and each build's record.
function drawDashboard() {
  drawTop();
  layout("solo");
  $("main").innerHTML = dashboardHtml(state.builds, [...state.full.values()].map((x) => x.build), state.stages, { error: state.error, loading: !state.fullLoaded });
  for (const i of document.querySelectorAll(".hb i[data-w]")) i.style.width = `${i.dataset.w}%`;
  $("stage").innerHTML = "";
  if (state.builds.some((b) => b.at?.state === "working" && !b.archived)) schedule();
}

// Analytics: questions over time, from the service's history (analytics.js).
function drawAnalytics() {
  drawTop();
  layout("solo");
  $("main").innerHTML = analyticsHtml(state.anData, state.anQuery, { error: state.error, service: state.status?.service ?? "" });
  for (const i of document.querySelectorAll(".hb i[data-w]")) i.style.width = `${i.dataset.w}%`;
  $("stage").innerHTML = "";
}

// Whether the service answers analytics, a route outside the lifecycle API.
// Asked once; a service that does not answer it never shows the page. A key
// the service turned down leaves it to be asked again once there is a key.
async function probeAnalytics() {
  if (state.status?.source === "file") { state.analytics = false; return; }
  try {
    state.analytics = analyticsOffered(200, await api(analyticsPath({ window: "7d" })));
  } catch (e) {
    state.analytics = e.needKey ? null : analyticsOffered(e.status ?? 0, null);
  }
}

// Reads each build in the list, again only when the list says it changed.
async function loadFull() {
  const want = state.builds.filter((b) => state.full.get(b.id)?.updated !== b.updated || !b.updated);
  const ids = new Set(state.builds.map((b) => b.id));
  for (const id of state.full.keys()) if (!ids.has(id)) state.full.delete(id);
  for (let i = 0; i < want.length; i += 6) {
    await Promise.all(want.slice(i, i + 6).map(async (b) => {
      try { state.full.set(b.id, { updated: b.updated, build: (await api(buildPath(b.id))).build }); } catch (e) { if (e.needKey) throw e; state.error = e.message; }
    }));
  }
  state.fullLoaded = true;
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
    if (state.view === "board" && !document.hidden) {
      try { await refreshBuilds(); } catch (e) { return problem(e); }
      if (state.view === "board") drawBoard();
      return;
    }
    if (state.view === "dashboard" && !document.hidden) {
      try { await refreshBuilds(); await loadFull(); } catch (e) { return problem(e); }
      if (state.view === "dashboard") drawDashboard();
      return;
    }
    // The boss's page: read again while a proposal waits for its build to offer the action.
    if (state.view === "product" && state.boss.name) {
      if (document.hidden || state.boss.sending || state.boss.pending || typing()) return schedule();
      try { await loadBoss(state.boss.name); } catch { return schedule(); }
      if (state.view === "product" && !typing()) drawProduct(); else schedule();
      return;
    }
    // Never redrawn under a person's hands: while they type a message or fill a gate's form, it waits.
    if (document.hidden || state.view !== "build" || !state.build || state.pending || state.sayPending || typing()) return schedule();
    try {
      state.build = (await api(buildPath(state.build.id))).build;
      await loadStage();
      await refreshBuilds();
      if (!typing()) draw(); else schedule();
    } catch { schedule(); }
  }, 5000);
}

function typing() {
  const a = document.activeElement;
  return Boolean(a && (a.id === "say" || a.id === "boss-say" || a.closest?.("form.ask") || a.closest?.("#clone-form")) && (a.value ?? "").length > 0) || state.asking !== null;
}

async function refreshBuilds() {
  try { state.builds = (await api("/builds?archived=1")).builds ?? []; } catch (e) { if (e.needKey) throw e; state.error = e.message; }
  await loadProducts();
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
  state.pending = name; draw();
  try {
    // A 403 with words here is the service turning down this person at this gate, not a bad key.
    const r = await api(buildPath(state.build.id, `/actions/${encodeURIComponent(name)}`), { method: "POST", body: needs, own403: true });
    if (r?.build) state.build = r.build;
    else state.build = (await api(buildPath(state.build.id))).build;
    state.asking = null; state.error = "";
    await loadStage();
    await refreshBuilds();
  } catch (e) {
    state.pending = null;
    return problem(e);
  }
  state.pending = null;
  draw();
}

// A message to the agent holding the selected stage, kept in that stage's chat for the product.
// A reply that proposes a change carries a confirm button that takes the build's own action.
async function say(text) {
  const b = state.build;
  const stage = state.stageSel;
  if (!b || !stage || !text.trim()) return;
  state.sayPending = true; state.sayDraft = text; state.sayError = ""; draw();
  try {
    const r = await api(`/products/${encodeURIComponent(productOf(b))}/stages/${encodeURIComponent(stage)}/messages`, { method: "POST", body: { text, build: b.id }, own403: true });
    if (state.build?.id !== b.id || state.stageSel !== stage) return;
    state.sayDraft = "";
    // The chat as the service now keeps it; the two new messages if it cannot be read again.
    try { await loadStage(); } catch { /* kept below */ }
    if (!(state.chat ?? []).some((m) => m.id === r?.reply?.id)) state.chat = [...(state.chat ?? []), r?.message, r?.reply].filter(Boolean);
    // A proposal is shown from the reply as it came back, even when the chat does not repeat it.
    if (r?.reply?.proposes) state.chat = state.chat.map((m) => (m.id === r.reply.id && !m.proposes ? { ...m, proposes: r.reply.proposes } : m));
  } catch (e) {
    state.sayPending = false;
    if (e.needKey) return problem(e);
    state.sayError = e.message;
    return draw();
  }
  state.sayPending = false;
  draw();
  requestAnimationFrame(() => { $("thread")?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" }); $("say")?.focus(); });
}

async function confirmProposal(msgId) {
  const m = (state.chat ?? []).find((x) => x.id === msgId);
  const body = m ? confirmBody(state.build, m.proposes) : null;
  if (!body) return;
  await act(body.name, body.needs);
  if (state.error === "") state.confirmed.add(msgId);
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
  state.checks.set(id, "running"); draw();
  try {
    const r = await call("/local/check", { method: "POST", body: { folder, agent: state.build?.name ?? "" } });
    state.checks.set(id, r.result);
  } catch (e) {
    state.checks.set(id, { error: e.message });
  }
  if (state.build?.id === id) draw();
}

// ---------- the Lifecycle page ----------

const withProject = (p) => `${p}${state.project ? `?project=${encodeURIComponent(state.project)}` : ""}`;
const stagesPath = (stage = "") => withProject(`/stages${stage ? `/${encodeURIComponent(stage)}` : ""}`);
const rolesPath = (role = "") => withProject(`/roles${role ? `/${encodeURIComponent(role)}` : ""}`);

// Both answers at once. A service without the stages operations (lifecycle API
// 0.2) answers 404 there: the page then lists stages.json's stages, with no Use switch.
async function loadLifecycle() {
  const project = state.project;
  const [st, ro] = await Promise.allSettled([api(stagesPath()), api(rolesPath())]);
  if (state.view !== "lifecycle" || state.project !== project) return;
  const errs = [];
  for (const r of [st, ro]) if (r.status === "rejected" && r.reason?.needKey) return problem(r.reason);
  state.noStages = st.status === "rejected" && st.reason?.status === 404;
  state.lcStages = st.status === "fulfilled" ? st.value : null;
  if (st.status === "rejected" && !state.noStages) errs.push(st.reason.message);
  state.lcRoles = ro.status === "fulfilled" ? ro.value : null;
  if (ro.status === "rejected") errs.push(ro.reason.message);
  state.error = [...new Set(errs)].join(" ");
  drawLifecycle();
  // Sent from the product's Setup tab to choose who holds a role: its holder form opens, and saving it uses the roles route.
  const want = state.lcWant;
  state.lcWant = null;
  if (want && lcRole(want.role) && !state.status?.read_only) {
    const r = lcRole(want.role);
    lcOpen(want.role, want.at ?? r.stages?.[0] ?? "", effectiveHolder(r)?.kind ?? "your_agent");
  }
}

function drawLifecycle() {
  drawTop();
  layout("solo");
  const role = (id) => def(id).role;
  $("main").innerHTML = lifecyclePageHtml(state.noStages ? null : state.lcStages, state.lcRoles, {
    project: state.project, error: state.error, editing: state.lcEditing, draft: state.lcDraft,
    errors: state.lcErrors, pending: state.lcPending, readOnly: Boolean(state.status?.read_only),
    formats: state.evidenceFormats, phases: PHASES, number: (id) => def(id).number, roleWords: role,
    noStages: state.noStages, fallback: state.noStages ? state.stages : [],
    local: state.status?.source === "file", canAdd: state.status?.source === "file", adding: state.lcAdding,
  });
  $("stage").innerHTML = "";
}

// ---------- stages of your own (a lifecycle file) ----------

const addedPath = (id = "") => withProject(`/local/added-stages${id ? `/${encodeURIComponent(id)}` : ""}`);

function addedValues(f) {
  const v = (n) => f.querySelector(`[name=${n}]`)?.value ?? "";
  return { ...state.lcAdding, name: v("name"), place: v("place"), role: v("role"), role_name: v("role_name"), kind: v("kind") || state.lcAdding?.kind || "person", holder_name: v("holder_name"), handle: v("handle"), given: v("given"), hands_back: v("hands_back"), done_when: v("done_when"), person_gate: Boolean(f.querySelector("[name=person_gate]")?.checked) };
}

// Add, change or remove a stage of your own. The answer carries both the stages and the roles.
async function addedChange(method, id, body) {
  state.lcPending = "added"; state.lcErrors.delete("added"); drawLifecycle();
  try {
    const answer = await call(addedPath(id), { method, body });
    state.lcStages = answer.stages; state.lcRoles = answer.roles;
    state.lcAdding = null; state.error = "";
  } catch (e) {
    if (state.lcAdding) state.lcErrors.set("added", e.message); else state.error = e.message;
  }
  state.lcPending = null;
  drawLifecycle();
}

// One change: PUT or DELETE on a stage or a role. The answer that comes back is
// drawn as it is; a refusal is shown on that row, in the service's words.
async function lcChange(key, path, method, body) {
  state.lcPending = key; state.lcErrors.delete(key); drawLifecycle();
  try {
    const answer = await api(path, { method, body, own403: true });
    if (key.startsWith("use:")) state.lcStages = answer;
    else { state.lcRoles = answer; state.lcEditing = null; state.lcDraft = null; }
    state.error = "";
  } catch (e) {
    state.lcPending = null;
    if (e.needKey) return problem(e);
    state.lcErrors.set(key, e.message);
    return drawLifecycle();
  }
  state.lcPending = null;
  drawLifecycle();
}

// Go back to the organization's stages, or the default: DELETE each stage chosen here, one at a time.
async function lcResetStages() {
  state.lcPending = "reset"; drawLifecycle();
  try {
    for (const stage of stagesToReset(state.lcStages, state.project)) state.lcStages = await api(stagesPath(stage), { method: "DELETE", own403: true });
    state.error = "";
  } catch (e) {
    if (e.needKey) { state.lcPending = null; return problem(e); }
    state.error = e.message;
  }
  state.lcPending = null;
  drawLifecycle();
}

const lcRole = (id) => state.lcRoles?.roles?.find((r) => r.role === id);

function lcOpen(role, stage, kind) {
  const r = lcRole(role);
  if (!r) return;
  state.lcEditing = { role, stage }; state.lcDraft = lifecycleDraft(r, kind); state.lcErrors.delete(`role:${role}`);
  drawLifecycle();
  $("main").querySelector("form.lcbind input[name=handle], form.lcbind input[name=name]")?.focus();
}

function formValues(f) {
  return {
    kind: f.dataset.kind ?? "",
    name: f.querySelector("[name=name]")?.value ?? "",
    handle: f.querySelector("[name=handle]")?.value ?? "",
    formats: [...f.querySelectorAll("[name=formats]:checked")].map((x) => x.value),
    where: f.querySelector("[name=where]")?.value ?? "",
  };
}

// ---------- events ----------

document.addEventListener("click", async (e) => {
  const t = e.target;
  // The stage's tabs: Chat, Artifacts, Try it. Leaving Chat remembers where it was.
  const tab = t.closest("[data-tab]");
  if (tab || t.closest("[data-tryit]")) {
    const to = tab ? tab.dataset.tab : "try";
    if (to === state.tab) return;
    leaveTab();
    state.tab = to;
    if (to === "try") await loadTries();
    return draw();
  }
  const ptab = t.closest("[data-ptab]");
  if (ptab) { state.ptab = ptab.dataset.ptab; return drawProduct(); }
  // Features (0.4.3): an answer to a proposal, a cell that opens its artifact at the feature, a row that opens its history.
  const featBtn = t.closest("[data-feat]");
  if (featBtn) return answerFeature(featBtn.dataset);
  const featCell = t.closest("[data-feat-cell]");
  if (featCell) {
    const to = cellTarget(featCell.dataset);
    if (!to) return;
    state.openAt = to;
    if (state.build?.id === to.build && state.stageSel === to.stage && state.view === "build") { state.art = to.artifact; state.featFocus = to.feature; leaveTab(); state.tab = "artifacts"; state.openAt = null; return draw(); }
    state.tab = "artifacts";
    return go(to.hash);
  }
  const featRow = t.closest("[data-feat-row]");
  if (featRow) {
    const onProduct = state.view === "product";
    const holder = onProduct ? state.feat : state.bfeat;
    const id = featRow.dataset.featRow;
    holder.sel = holder.sel === id ? null : id;
    const redraw = () => (onProduct ? drawProduct() : draw());
    redraw();
    if (holder.sel) { try { await loadHistory(holder, onProduct ? state.product.name : productOf(state.build), id); } catch (x) { return problem(x); } redraw(); }
    return;
  }
  if (t.closest("[data-feat-unfocus]")) { state.featFocus = null; return draw(); }
  // An attachment in the chat, or a row of the Given and Outputs: the Artifacts tab, with it open in the reader.
  const art = t.closest("[data-art]");
  if (art) {
    state.art = art.dataset.art;
    state.featFocus = null;
    if (state.tab !== "artifacts") { leaveTab(); state.tab = "artifacts"; }
    const top = state.drawnKey?.endsWith("/artifacts") ? getScroll() : 0;
    draw();
    if (phone()) requestAnimationFrame(() => $("reader")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    else setScroll(t.closest(".alist") ? top : 0);
    return;
  }
  const confirmBtn = t.closest("[data-confirm]");
  if (confirmBtn) return confirmProposal(confirmBtn.dataset.confirm);
  // The boss's proposals: starting a version is confirmed with the boss; a build's action with the actions route.
  const bossYes = t.closest("[data-boss-confirm]");
  if (bossYes) return bossConfirm(bossYes.dataset.bossConfirm);
  const bossAction = t.closest("[data-boss-act]");
  if (bossAction) return bossAct(bossAction.dataset.bossAct);
  const whenBtn = t.closest("[data-when-act]");
  if (whenBtn) return whenAct(whenBtn.dataset.whenAct);
  if (t.closest("[data-when-cancel]")) { state.whenCard = null; return drawProduct(); }
  // The guided setup (0.4.4): open a card, or ask the boss about it.
  const suOpen = t.closest("[data-setup-open]");
  if (suOpen) {
    const f = t.closest("form[data-setup]");
    if (f) state.setupUi.drafts[f.dataset.setup] = setupFormDraft(f);
    state.setupUi.open = suOpen.dataset.setupOpen || null; state.setupUi.error = null; state.setupUi.saved = null;
    return drawProduct();
  }
  const suAsk = t.closest("[data-setup-ask]");
  if (suAsk) return askBossAbout(suAsk.dataset.setupAsk);
  if (t.closest("#new") || t.closest("#new2")) return go("#/new");
  const edit = t.closest("[data-edit-role]");
  if (edit) {
    const r = lcRole(edit.dataset.editRole);
    return lcOpen(edit.dataset.editRole, edit.dataset.at, r ? (effectiveHolder(r)?.kind ?? "your_agent") : "your_agent");
  }
  const reset = t.closest("[data-reset-role]");
  if (reset) return lcChange(`role:${reset.dataset.resetRole}`, rolesPath(reset.dataset.resetRole), "DELETE");
  if (t.closest("[data-reset-stages]")) return lcResetStages();
  if (t.closest("[data-add-stage]")) {
    state.lcAdding = addedDraft(); state.lcErrors.delete("added"); drawLifecycle();
    return $("ad-name")?.focus();
  }
  const editAdded = t.closest("[data-edit-added]");
  if (editAdded) {
    state.lcAdding = addedDraft(state.lcStages?.stages?.find((s) => s.stage === editAdded.dataset.editAdded)); state.lcErrors.delete("added"); drawLifecycle();
    return $("ad-name")?.focus();
  }
  const removeAdded = t.closest("[data-remove-added]");
  if (removeAdded) {
    const s = state.lcStages?.stages?.find((x) => x.stage === removeAdded.dataset.removeAdded);
    if (!s || !confirm(`Remove ${s.name} from the lifecycle?`)) return;
    state.lcAdding = null;
    return addedChange("DELETE", s.stage);
  }
  if (t.closest("[data-cancel-added]")) { state.lcAdding = null; state.lcErrors.delete("added"); return drawLifecycle(); }
  if (t.closest("[data-cancel-lc]")) { if (state.lcEditing) state.lcErrors.delete(`role:${state.lcEditing.role}`); state.lcEditing = null; state.lcDraft = null; return drawLifecycle(); }
  if (t.closest("#mine")) {
    state.boardMine = !state.boardMine;
    store.set("board-mine", state.boardMine ? "1" : "");
    return drawBoard();
  }
  if (t.closest("#archt")) { state.showArchived = !state.showArchived; return drawRail(); }
  if (t.closest("#forget")) {
    try { state.status = await call("/local/forget-key", { method: "POST" }); } catch (err) { state.error = err.message; }
    state.build = null; state.builds = []; state.analytics = null; state.anData = null;
    return route();
  }
  const a = t.closest("[data-act]");
  if (a) {
    const action = actionsFor(a.dataset.actStage).find((x) => x.name === a.dataset.act);
    if (!action) return;
    if (action.needs?.length) { state.asking = `${action.stage}
${action.name}`; draw(); $("main").querySelector(".ask textarea, .ask input")?.focus(); return; }
    return act(action.name);
  }
  if (t.closest("[data-cancel]")) { const tr = state.tab === "try" && t.closest("#trybody"); state.asking = null; state.wrongFor = null; return tr ? drawTry() : draw(); }
  const keep = t.closest("[data-keep]");
  if (keep) return markTry(keep.dataset.keep, "keep", {});
  const wrong = t.closest("[data-wrong]");
  if (wrong) { state.wrongFor = wrong.dataset.wrong; drawTry(); $("why")?.focus(); }
});

document.addEventListener("toggle", (e) => {
  const det = e.target;
  if (det.matches?.("details[data-file]") && det.open) loadFile(det);
  // Kept open across redraws: the timeline and the clone check.
  if (det.matches?.("details.timeline")) state.timelineOpen = det.open;
  if (det.matches?.("details.clonecheck")) state.cloneOpen = det.open;
}, true);

document.addEventListener("input", (e) => {
  if (e.target.id === "say") state.sayDraft = e.target.value;
});

document.addEventListener("change", (e) => {
  if (e.target.id === "twhere" && state.build) store.set(`against:${state.build.id}`, e.target.value);
  // A setup card's holder kind: the card asks for a name, and a handle for your agent.
  const suKind = e.target.closest?.("[data-setup-kind]");
  if (suKind) {
    const f = suKind.closest("form[data-setup]");
    state.setupUi.drafts[f.dataset.setup] = setupFormDraft(f);
    drawProduct();
    return $(suKind.id)?.focus();
  }
  // The Features tab's version filter (0.4.3).
  if (e.target.matches?.("[data-feat-version]") && state.product) {
    state.feat.version = e.target.value; state.feat.sel = null; state.feat.history = null;
    loadFeatures(state.product.name).then(drawProduct, problem);
    return;
  }
  // Analytics: a new window or project is a new page.
  if (e.target.closest?.("#an-form")) return go(analyticsHash({ window: $("an-window").value, project: $("an-project").value }));
  // Adding a stage: a new role asks who holds it, and a holder on the mesh asks for its handle.
  if (e.target.closest?.("#added-form") && (e.target.name === "role" || e.target.name === "kind")) {
    state.lcAdding = addedValues(e.target.closest("#added-form"));
    drawLifecycle();
    return $(e.target.id)?.focus();
  }
  // The Use switch: the service says whether the stage is now used.
  const use = e.target.closest?.("[data-use]");
  if (use) return lcChange(`use:${use.dataset.use}`, stagesPath(use.dataset.use), "PUT", { used: use.checked });
  // Who holds the role: the service's own agent is bound at once; any other kind asks for its name first.
  const kind = e.target.closest?.("[data-role-kind]");
  if (kind) {
    const role = kind.dataset.roleKind;
    if (kind.value === "reference_agent") {
      const body = referenceHolder(lcRole(role));
      if (body) return lcChange(`role:${role}`, rolesPath(role), "PUT", body);
    }
    if (kind.value) return lcOpen(role, kind.dataset.at, kind.value);
    return drawLifecycle();
  }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "key-form") {
    try {
      state.status = await call("/local/key", { method: "POST", body: { key: $("key").value } });
      state.error = ""; state.analytics = null;
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
  if (f.id === "proj-form") {
    const p = $("proj-name").value.trim();
    if (!p) return go(lifecycleHash(""));
    remember(p);
    return go(lifecycleHash(p));
  }
  if (f.id === "added-form") {
    state.lcAdding = addedValues(f);
    const phaseOf = (id) => state.lcStages?.stages?.find((s) => s.stage === id)?.phase;
    return addedChange(state.lcAdding.id ? "PUT" : "POST", state.lcAdding.id ?? "", addedBody(state.lcAdding, phaseOf));
  }
  if (f.matches("form.lcbind")) {
    const values = formValues(f);
    state.lcDraft = values;
    return lcChange(`role:${f.dataset.role}`, rolesPath(f.dataset.role), "PUT", holderFrom(values));
  }
  if (f.id === "try-form") return sendTry($("tsay").value, $("twhere").value);
  if (f.id === "wrong-form") {
    const why = $("why").value.trim();
    return markTry(f.dataset.tid, "wrong", why ? { why } : {});
  }
  if (f.id === "clone-form") return runLocalCheck($("clone").value);
  if (f.id === "say-form") return say($("say").value);
  if (f.id === "boss-form") return bossSay($("boss-say").value);
  if (f.dataset.setup) return saveSetup(f.dataset.setup, f);
  if (f.dataset.whenForm) return runWhen(f.dataset.whenForm, f);
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
    state.roleDefs = Array.isArray(doc.roles) ? doc.roles : [];
    state.evidenceFormats = Array.isArray(doc.evidence_formats) ? doc.evidence_formats : [];
  } catch (e) {
    $("main").innerHTML = `<div class="err" role="alert">${esc(e.message)}</div>`;
    return;
  }
  drawTop();
  if (!state.status.signed_in) return drawKey();
  try { await refreshBuilds(); } catch (e) { return problem(e); }
  await loadMe();
  route();
}

// Who the key belongs to, and whether the service keeps people. A service that
// answers neither is drawn as before.
async function loadMe() {
  if (state.status?.source !== "service") { state.me = null; state.hasPeople = false; return; }
  try { state.me = await api("/me"); } catch { state.me = null; }
  try { state.people = await api("/people"); state.hasPeople = true; } catch { state.people = null; state.hasPeople = false; }
  drawTop();
}

start();
