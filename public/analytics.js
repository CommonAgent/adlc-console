// The Analytics page: questions over time, from a service that keeps a
// history of its builds and answers GET /v1/lifecycle/analytics. That route
// is not part of the lifecycle API standard; Product Factory answers it. The
// rail shows Analytics only when the service does (analyticsOffered).
//   1. Builds started and finished, per week.
//   2. The median time per stage, per week.
//   3. How often each stage's work is sent back, over the window.
//   4. Time waiting on people against time with an agent working, per week.
// Drawn from that one answer, so the tests can read it without a browser or a
// service (test/analytics.test.mjs).

import { esc } from "./roles.js";
import { span } from "./dashboard.js";

export const WINDOWS = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["all", "All time"]];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whether the rail shows Analytics: only when the service answered the route with weeks. */
export function analyticsOffered(status, body) {
  return status === 200 && body !== null && typeof body === "object" && Array.isArray(body.weeks);
}

/** The page's choices from the hash's query: a known window (30 days when not given) and a project. */
export function analyticsQuery(raw) {
  const q = new URLSearchParams(String(raw ?? "").split("?")[1] ?? "");
  const w = q.get("window");
  return { window: WINDOWS.some(([id]) => id === w) ? w : "30d", project: (q.get("project") ?? "").trim() };
}

export function analyticsHash({ window = "30d", project = "" } = {}) {
  const q = new URLSearchParams();
  if (window && window !== "30d") q.set("window", window);
  if (project) q.set("project", project);
  const s = q.toString();
  return `#/analytics${s ? `?${s}` : ""}`;
}

/** The service path for the page's choices. */
export function analyticsPath({ window = "30d", project = "" } = {}) {
  const q = new URLSearchParams({ window });
  if (project) q.set("project", project);
  return `/analytics?${q}`;
}

/** "Nov 2": the Monday a week starts on. */
export function weekLabel(week) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(week));
  return m ? `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}` : String(week);
}

const pct = (r) => `${Math.round(r * 100)}%`;
const bar = (value, max, tone = "") => `<span class="hb${tone ? ` ${tone}` : ""}" aria-hidden="true"><i data-w="${max > 0 && value > 0 ? Math.max(1, (value / max) * 100).toFixed(1) : 0}"></i></span>`;
const newestFirst = (rows) => [...rows].reverse();

function filtersHtml(q, projects) {
  const names = [...new Set([...(projects ?? []), ...(q.project ? [q.project] : [])])];
  const opt = (value, label, on) => `<option value="${esc(value)}"${on ? " selected" : ""}>${esc(label)}</option>`;
  return `<form class="anf" id="an-form">
    <label>Window <select id="an-window" name="window">${WINDOWS.map(([id, label]) => opt(id, label, id === q.window)).join("")}</select></label>
    <label>Project <select id="an-project" name="project">${opt("", "Every project", !q.project)}${names.map((p) => opt(p, p, p === q.project)).join("")}</select></label>
  </form>`;
}

function buildsHtml(rows) {
  if (!rows.some((r) => r.started || r.finished || r.stopped)) return `<p class="does">No build started or finished in this window.</p>`;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.started, r.finished)));
  const stopped = rows.reduce((n, r) => n + (r.stopped ?? 0), 0);
  return `<table class="dt"><thead><tr><th scope="col">Week of</th><th scope="col">Started</th><th scope="col">Finished</th></tr></thead><tbody>${newestFirst(rows).map((r) =>
    `<tr><th scope="row">${esc(weekLabel(r.week))}${bar(r.started, max)}${bar(r.finished, max, "fin")}</th><td>${r.started}</td><td>${r.finished}</td></tr>`).join("")}</tbody></table>`
    + `<p class="note">${stopped ? `${stopped} stopped in this window, not counted as finished. ` : ""}Finished means the build ran to its end.</p>`;
}

function timesHtml(stageTimes, weeks) {
  if (!stageTimes.length) return `<p class="does">No stage finished in this window.</p>`;
  const max = Math.max(1, ...stageTimes.flatMap((s) => s.weeks.map((x) => x.median_ms)));
  const cell = (s, week) => {
    const x = s.weeks.find((y) => y.week === week);
    return x ? `<td title="${x.builds === 1 ? "1 build" : `${x.builds} builds`}">${esc(span(x.median_ms))}${bar(x.median_ms, max)}</td>` : `<td class="w">·</td>`;
  };
  return `<div class="dtx"><table class="dt wk"><thead><tr><th scope="col">Stage</th>${weeks.map((w) => `<th scope="col">${esc(weekLabel(w))}</th>`).join("")}</tr></thead><tbody>${stageTimes.map((s) =>
    `<tr><th scope="row">${esc(s.name ?? s.stage)}</th>${weeks.map((w) => cell(s, w)).join("")}</tr>`).join("")}</tbody></table></div>`
    + `<p class="note">Each week, the median across the stages that finished that week: every round, the agent's work and any wait on a person.</p>`;
}

function backsHtml(rows) {
  if (!rows.length) return `<p class="does">No stage ran a round in this window.</p>`;
  return `<table class="dt"><thead><tr><th scope="col">Stage</th><th scope="col">Sent back</th><th scope="col" class="w">Rounds</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><th scope="row">${esc(r.name ?? r.stage)}${bar(r.rate, 1, "back")}</th><td>${pct(r.rate)}</td><td class="w">${r.back} of ${r.rounds}</td></tr>`).join("")}</tbody></table>`
    + `<p class="note">A round counts as sent back when its record says the work went back for another go.</p>`;
}

function waitingHtml(rows) {
  if (!rows.some((r) => r.person_ms || r.agent_ms)) return `<p class="does">No step finished in this window.</p>`;
  const max = Math.max(1, ...rows.map((r) => r.person_ms + r.agent_ms));
  const person = rows.reduce((n, r) => n + r.person_ms, 0);
  const agent = rows.reduce((n, r) => n + r.agent_ms, 0);
  return `<p class="does">${esc(span(person) || "0 s")} waiting on people · ${esc(span(agent) || "0 s")} with agents working</p>`
    + `<table class="dt"><thead><tr><th scope="col">Week of</th><th scope="col">On people</th><th scope="col">Agents working</th></tr></thead><tbody>${newestFirst(rows).map((r) =>
      `<tr><th scope="row">${esc(weekLabel(r.week))}<span class="hb two" aria-hidden="true"><i class="p" data-w="${((r.person_ms / max) * 100).toFixed(1)}"></i><i class="a" data-w="${((r.agent_ms / max) * 100).toFixed(1)}"></i></span></th><td>${esc(span(r.person_ms) || "0 s")}</td><td>${esc(span(r.agent_ms) || "0 s")}</td></tr>`).join("")}</tbody></table>`;
}

/** The whole Analytics page. data: the analytics answer, or null while it loads. */
export function analyticsHtml(data, q, { error = "", service = "" } = {}) {
  const head = `<div class="err" role="alert">${esc(error)}</div>
    <div class="head"><h1>Analytics</h1></div>
    ${filtersHtml(q, data?.projects)}`;
  if (!data) return `${head}<p class="does">${error ? "" : "Reading the history…"}</p>`;
  return `${head}
    <div class="dashg">
    <section class="dash"><h2>Builds started and finished</h2>${buildsHtml(data.builds ?? [])}</section>
    <section class="dash"><h2>How often work is sent back</h2>${backsHtml(data.send_backs ?? [])}</section>
    <section class="dash"><h2>Time waiting on people and agents</h2>${waitingHtml(data.waiting ?? [])}</section>
    <section class="dash wide"><h2>Median time per stage</h2>${timesHtml(data.stage_times ?? [], data.weeks ?? [])}</section>
    </div>
    <p class="note">Weeks start on Monday (UTC). From ${esc(service || "the service")}'s history of its builds, never estimated.</p>`;
}
