// The Dashboard: three things read from the build records, never estimated.
//   1. How long each stage takes: the median across builds, from build.timeline.
//   2. How often each stage's work is sent back: rounds with back: true.
//   3. What is waiting now: on a person, or an agent working, from the list.
// It is drawn from GET /builds and GET /builds/:id alone, so the tests can read
// it without a browser or a service (test/dashboard.test.mjs).

import { esc } from "./roles.js";
import { isDone } from "./board.js";

/** "4 min", "35 s", "2 h 5 min": a duration as a person says it. */
export function span(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** The middle value; the mean of the two middle values for an even count; null for none. */
export function median(values) {
  const v = (values ?? []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Stages in stages.json's order; a stage it does not name comes after, by id.
function order(stages) {
  const byId = new Map((stages ?? []).map((s) => [s.id, s]));
  const name = (id) => byId.get(id)?.name ?? id;
  const num = (id) => byId.get(id)?.number ?? Infinity;
  const sort = (rows) => rows.sort((a, b) => num(a.stage) - num(b.stage) || String(a.stage).localeCompare(String(b.stage)));
  return { name, sort };
}

/**
 * Time per stage. A build's time at a stage is the sum of its timeline bars
 * for that stage (every round, the agent's work and any wait on a person). A
 * stage with a bar still open is left out for that build until it closes. A
 * bar names its stage in `stage`; a bar with none is not counted.
 * builds: full builds (GET /builds/:id). Returns { rows, timed, untimed }:
 * rows [{ stage, name, builds, median_ms }] in stages.json's order.
 */
export function stageTimes(builds, stages) {
  const { name, sort } = order(stages);
  const per = new Map();
  let timed = 0;
  let untimed = 0;
  for (const b of Array.isArray(builds) ? builds : []) {
    const bars = (Array.isArray(b?.timeline) ? b.timeline : []).filter((x) => typeof x?.stage === "string" && x.stage);
    if (!bars.length) { untimed++; continue; }
    timed++;
    const sums = new Map();
    for (const x of bars) {
      const open = x.end === null || x.end === undefined || !Number.isFinite(x.duration_ms);
      const cur = sums.get(x.stage) ?? { ms: 0, open: false };
      if (open) cur.open = true; else cur.ms += x.duration_ms;
      sums.set(x.stage, cur);
    }
    for (const [stage, s] of sums) {
      if (s.open) continue;
      (per.get(stage) ?? per.set(stage, []).get(stage)).push(s.ms);
    }
  }
  const rows = sort([...per].map(([stage, ms]) => ({ stage, name: name(stage), builds: ms.length, median_ms: median(ms) })));
  return { rows, timed, untimed };
}

/**
 * Send-backs per stage, counted from each stage's rounds: rounds is every
 * round across the builds, back the rounds with back: true, and builds how
 * many builds had at least one round there. Stages with no rounds are left out.
 */
export function sendBacks(builds, stages) {
  const { name, sort } = order(stages);
  const per = new Map();
  for (const b of Array.isArray(builds) ? builds : []) {
    for (const s of Array.isArray(b?.stages) ? b.stages : []) {
      const rounds = Array.isArray(s?.rounds) ? s.rounds : [];
      if (!rounds.length) continue;
      const row = per.get(s.stage) ?? per.set(s.stage, { stage: s.stage, name: name(s.stage), rounds: 0, back: 0, builds: 0 }).get(s.stage);
      row.rounds += rounds.length;
      row.back += rounds.filter((r) => r?.back === true).length;
      row.builds++;
    }
  }
  return sort([...per.values()]);
}

/**
 * What is waiting now, from the build list: a build waiting on you, or one a
 * stage refused (it waits for a person to say what next), is on a person; a
 * build at a working stage is an agent working. Builds that ended are left out.
 * Returns { rows: [{ stage, name, person: [names], agent: [names] }], person, agent }.
 */
export function waitingNow(list, stages) {
  const { name, sort } = order(stages);
  const per = new Map();
  let person = 0;
  let agent = 0;
  for (const b of Array.isArray(list) ? list : []) {
    if (isDone(b)) continue;
    const st = b?.at?.state;
    const who = st === "waiting_on_you" || st === "refused" ? "person" : st === "working" ? "agent" : null;
    if (!who) continue;
    const stage = b.at.stage;
    const row = per.get(stage) ?? per.set(stage, { stage, name: name(stage), person: [], agent: [] }).get(stage);
    row[who].push(String(b.name ?? b.id ?? ""));
    if (who === "person") person++; else agent++;
  }
  return { rows: sort([...per.values()]), person, agent };
}

// A bar drawn in CSS: its width is set from data-w after the page is drawn
// (the page's style rules allow no inline styles).
const bar = (value, max, tone = "") => `<span class="hb${tone ? ` ${tone}` : ""}" aria-hidden="true"><i data-w="${max > 0 && value > 0 ? Math.max(1, (value / max) * 100).toFixed(1) : 0}"></i></span>`;
const howMany = (n) => (n === 1 ? "1 build" : `${n} builds`);
const reading = `<p class="does">Reading the builds…</p>`;

function timesHtml(t) {
  if (!t.rows.length) {
    return `<p class="does">No stage has finished with a timeline yet.${t.untimed ? ` ${howMany(t.untimed)} carry no timeline with stages.` : ""}</p>`;
  }
  const max = Math.max(...t.rows.map((r) => r.median_ms));
  return `<table class="dt"><thead><tr><th scope="col">Stage</th><th scope="col">Median</th><th scope="col" class="w">Builds</th></tr></thead><tbody>${t.rows.map((r) =>
    `<tr><th scope="row">${esc(r.name)}${bar(r.median_ms, max)}</th><td>${esc(span(r.median_ms))}</td><td class="w">${r.builds}</td></tr>`).join("")}</tbody></table>`
    + `<p class="note">From ${howMany(t.timed)} with a timeline. A stage counts once it has finished: every round, the agent's work and any wait on a person.${t.untimed ? ` ${howMany(t.untimed)} carry no timeline with stages and are not counted.` : ""}</p>`;
}

function backsHtml(rows) {
  if (!rows.length) return `<p class="does">No stage has run a round yet.</p>`;
  const max = Math.max(1, ...rows.map((r) => r.back));
  return `<table class="dt"><thead><tr><th scope="col">Stage</th><th scope="col">Sent back</th><th scope="col" class="w">Rounds</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><th scope="row">${esc(r.name)}${bar(r.back, max, "back")}</th><td>${r.back}</td><td class="w">${r.rounds} in ${howMany(r.builds)}</td></tr>`).join("")}</tbody></table>`
    + `<p class="note">A round counts as sent back when its record says the work went back for another go.</p>`;
}

function waitingHtml(w) {
  if (!w.rows.length) return `<p class="does">Nothing is waiting or working now.</p>`;
  const max = Math.max(1, ...w.rows.map((r) => r.person.length + r.agent.length));
  const who = (names) => (names.length ? `<span class="nm">${names.map(esc).join(", ")}</span>` : "");
  return `<p class="does">${w.person} on a person · ${w.agent} with an agent working</p>`
    + `<table class="dt now"><thead><tr><th scope="col">Stage</th><th scope="col">On a person</th><th scope="col">Agent working</th></tr></thead><tbody>${w.rows.map((r) =>
      `<tr><th scope="row">${esc(r.name)}<span class="hb two" aria-hidden="true"><i class="p" data-w="${((r.person.length / max) * 100).toFixed(1)}"></i><i class="a" data-w="${((r.agent.length / max) * 100).toFixed(1)}"></i></span></th><td>${r.person.length}${who(r.person)}</td><td>${r.agent.length}${who(r.agent)}</td></tr>`).join("")}</tbody></table>`
    + `<p class="note">A stage that refused waits on a person to say what next.</p>`;
}

/** The whole Dashboard page. list: GET /builds; builds: the full builds read so far. */
export function dashboardHtml(list, builds, stages, { error = "", loading = false } = {}) {
  const all = Array.isArray(list) ? list : [];
  return `<div class="err" role="alert">${esc(error)}</div>
    <div class="head"><h1>Dashboard</h1></div>
    ${all.length ? "" : `<p class="does">No builds yet.</p>`}
    <div class="dashg">
    <section class="dash"><h2>How long each stage takes</h2>${loading ? reading : timesHtml(stageTimes(builds, stages))}</section>
    <section class="dash"><h2>How often work is sent back</h2>${loading ? reading : backsHtml(sendBacks(builds, stages))}</section>
    <section class="dash"><h2>What is waiting now</h2>${waitingHtml(waitingNow(all, stages))}</section>
    </div>`;
}
