// The Board: every build as a card, in the column of the phase its current
// stage belongs to, and a Done column at the end for the builds that ended.
// A version whose features are made in runs of their own (lifecycle API
// 0.4.10) has a card for each run as well, in the column of the run's own
// stage, beside the version's card.
// It is drawn from the build list (GET /builds) and stages.json alone, so the
// tests can read it without a browser or a service (test/board.test.mjs).

import { esc, stateOf, WORD } from "./roles.js";

const pad = (n) => String(n).padStart(2, "0");
const list = (v) => (Array.isArray(v) ? v : []);

/** A card for one feature run (0.4.10), not for a build. */
export const isRun = (b) => Boolean(b?.run);
/** A build that ended: its stage is done or stopped, or the person archived it. A feature run that ended, too. */
export const isDone = (b) => Boolean(b?.archived) || b?.at?.state === "done" || b?.at?.state === "stopped" || b?.run?.ended === true;
/**
 * A version making its features in runs of their own (0.4.10): while any run
 * is open, what the version waits on is its runs', and their cards say it.
 */
export const gathering = (b) => !isRun(b) && !isDone(b) && list(b?.feature_runs).some((c) => c && c.ended !== true);
/** A build waiting on the person looking at the board, or a feature run that is. */
export const waitsOnMe = (b) => b?.at?.state === "waiting_on_you" && !gathering(b) && b?.run?.ended !== true;

/**
 * The board's cards from the build list, in its order: each build, then a
 * card for each of its feature runs, in the order they started. A run's card
 * carries its version's name and version, its own at, and run: { id, feature, name, ended }.
 */
export function boardCards(builds) {
  return list(builds).flatMap((b) => [b, ...list(b?.feature_runs).filter((c) => c && typeof c.id === "string").map((c) => ({
    id: b.id, name: b.name, does: b.does, version: b.version, archived: Boolean(b.archived),
    at: c.at, run: { id: c.id, feature: c.feature, name: c.name, ended: c.ended === true },
  }))]);
}

/**
 * The board's columns, in order: one per phase, a column for stages
 * stages.json does not name (only when a build is at one), then Done.
 * stages: stages.json's stages ({ id, number, phase, name }).
 * phases: [[id, name], ...] in order. mine: only the builds waiting on me.
 */
export function boardColumns(builds, stages, phases, { mine = false } = {}) {
  const byId = new Map((stages ?? []).map((s) => [s.id, s]));
  const cols = (phases ?? []).map(([id, name]) => ({ id, name, builds: [] }));
  const other = { id: "other", name: "Other stages", builds: [] };
  const done = { id: "done", name: "Done", builds: [] };
  for (const b of boardCards(builds)) {
    if (mine && !waitsOnMe(b)) continue;
    if (isDone(b)) { done.builds.push(b); continue; }
    const phase = byId.get(b?.at?.stage)?.phase;
    (cols.find((c) => c.id === phase) ?? other).builds.push(b);
  }
  // Within a phase, the earlier stage first; the list's own order otherwise. A feature run's card
  // sits right after its version's when they share a column.
  const num = (b) => byId.get(b?.at?.stage)?.number ?? Infinity;
  for (const c of cols) {
    const version = new Map(c.builds.filter((b) => !isRun(b)).map((b) => [b.id, b]));
    const anchor = (b) => num(isRun(b) ? version.get(b.id) ?? b : b);
    c.builds = c.builds.map((b, i) => [b, i]).sort((x, y) => anchor(x[0]) - anchor(y[0]) || x[1] - y[1]).map(([b]) => b);
  }
  return [...cols, ...(other.builds.length ? [other] : []), done];
}

/** A card's words: the stage it is at, its state in words, and the service's own words when they add something. */
export function cardWords(b, stages) {
  const d = (stages ?? []).find((s) => s.id === b?.at?.stage);
  const stage = d?.name ?? String(b?.at?.stage ?? "");
  const where = d ? `${pad(d.number)} · ${stage}` : stage;
  const st = stateOf(b?.at);
  const said = typeof b?.at?.summary === "string" ? b.at.summary.trim() : "";
  if (isDone(b)) {
    const end = said
      || (b.at?.state === "stopped" ? `Stopped at ${stage}`
        : b.at?.state === "done" ? `Finished at ${stage}`
          : `Archived at ${stage}`);
    return { where, state: end, note: "", tone: b.at?.state === "stopped" ? "stop" : "done", archived: Boolean(b.archived) };
  }
  // A version gathering its features: the service's words for how many, and the run cards say who waits.
  if (gathering(b)) return { where, state: said || WORD.working, note: "", tone: "work", archived: false };
  const state = st === "waiting_on_you" ? `Waiting on you at ${stage}` : WORD[st];
  const tone = { waiting_on_you: "wait", working: "work", refused: "bad", stopped: "stop", not_bound: "unb" }[st] ?? "";
  // "Working at Code" says no more than the stage and state already do.
  const same = [state, `${WORD[st]} at ${stage}`].some((x) => x.toLowerCase() === said.toLowerCase());
  return { where, state, note: said && !same ? said : "", tone, archived: false };
}

/** Where a card opens: its build, and a feature run's card that run, at its stage. */
export const cardHref = (b) => `#/b/${encodeURIComponent(b?.id ?? "")}${isRun(b) ? `/${encodeURIComponent(b.at?.stage ?? "")}/run/${encodeURIComponent(b.run.id)}` : ""}`;

/** A feature run's name with its feature's id marked: "<F2> Count lines". */
export function runNameHtml(r) {
  const name = String(r?.name ?? r?.id ?? "");
  const id = [r?.feature, r?.id].find((x) => typeof x === "string" && x && name.startsWith(`${x} `));
  return id ? `<span class="fid">${esc(id)}</span>${esc(name.slice(id.length + 1))}` : esc(name);
}

function cardHtml(b, stages) {
  const w = cardWords(b, stages);
  const run = isRun(b);
  const version = typeof b?.version === "string" && b.version ? `<i>${esc(run ? `${b.name} ${b.version}` : b.version)}</i>` : "";
  const label = [run ? b.run.name : b?.name, run ? `${b.name} ${b.version ?? ""}`.trim() : b?.version, w.where, w.state, w.note, w.archived ? "archived" : ""].filter(Boolean).join(", ");
  return `<a class="bc${run ? " fr" : ""}${w.tone ? ` ${w.tone}` : ""}${w.archived ? " ar" : ""}" href="${cardHref(b)}" aria-label="${esc(label)}"${b?.does && !run ? ` title="${esc(b.does)}"` : ""}>`
    + `<span class="bn"><b>${run ? runNameHtml(b.run) : esc(b?.name)}</b>${version}</span>`
    + (isDone(b) ? "" : `<span class="bs">${esc(w.where)}</span>`)
    + `<span class="bw">${esc(w.state)}</span>`
    + (w.note ? `<span class="bm">${esc(w.note)}</span>` : "")
    + (w.archived ? `<span class="bm">Archived</span>` : "")
    + `</a>`;
}

/** The whole Board page. */
export function boardHtml(builds, stages, phases, { mine = false, error = "" } = {}) {
  const all = Array.isArray(builds) ? builds : [];
  const waiting = boardCards(all).filter(waitsOnMe).length;
  const cols = boardColumns(all, stages, phases, { mine });
  return `<div class="err" role="alert">${esc(error)}</div>
    <div class="head"><h1>Board</h1><button class="try${mine ? " on" : ""}" id="mine" type="button" aria-pressed="${mine}">Waiting on me (${waiting})</button></div>
    ${all.length ? "" : `<p class="does">No builds yet.</p>`}
    ${mine && !waiting ? `<p class="does">Nothing is waiting on you.</p>` : ""}
    <div class="board">${cols.map((c) => `<section class="col${c.id === "done" ? " end" : ""}" aria-label="${esc(c.name)}"><h2>${esc(c.name)} <span>${c.builds.length}</span></h2><div class="cards">${c.builds.map((b) => cardHtml(b, stages)).join("")}</div></section>`).join("")}</div>`;
}
