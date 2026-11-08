// The Board: every build as a card, in the column of the phase its current
// stage belongs to, and a Done column at the end for the builds that ended.
// It is drawn from the build list (GET /builds) and stages.json alone, so the
// tests can read it without a browser or a service (test/board.test.mjs).

import { esc, stateOf, WORD } from "./roles.js";

const pad = (n) => String(n).padStart(2, "0");

/** A build that ended: its stage is done or stopped, or the person archived it. */
export const isDone = (b) => Boolean(b?.archived) || b?.at?.state === "done" || b?.at?.state === "stopped";
/** A build waiting on the person looking at the board. */
export const waitsOnMe = (b) => b?.at?.state === "waiting_on_you";

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
  for (const b of Array.isArray(builds) ? builds : []) {
    if (mine && !waitsOnMe(b)) continue;
    if (isDone(b)) { done.builds.push(b); continue; }
    const phase = byId.get(b?.at?.stage)?.phase;
    (cols.find((c) => c.id === phase) ?? other).builds.push(b);
  }
  // Within a phase, the earlier stage first; the list's own order otherwise.
  const num = (b) => byId.get(b?.at?.stage)?.number ?? Infinity;
  for (const c of cols) c.builds = c.builds.map((b, i) => [b, i]).sort((x, y) => num(x[0]) - num(y[0]) || x[1] - y[1]).map(([b]) => b);
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
  const state = st === "waiting_on_you" ? `Waiting on you at ${stage}` : WORD[st];
  const tone = { waiting_on_you: "wait", working: "work", refused: "bad", stopped: "stop", not_bound: "unb" }[st] ?? "";
  // "Working at Code" says no more than the stage and state already do.
  const same = [state, `${WORD[st]} at ${stage}`].some((x) => x.toLowerCase() === said.toLowerCase());
  return { where, state, note: said && !same ? said : "", tone, archived: false };
}

function cardHtml(b, stages) {
  const w = cardWords(b, stages);
  const version = typeof b?.version === "string" && b.version ? `<i>${esc(b.version)}</i>` : "";
  const label = [b?.name, b?.version, w.where, w.state, w.note, w.archived ? "archived" : ""].filter(Boolean).join(", ");
  return `<a class="bc${w.tone ? ` ${w.tone}` : ""}${w.archived ? " ar" : ""}" href="#/b/${encodeURIComponent(b?.id ?? "")}" aria-label="${esc(label)}"${b?.does ? ` title="${esc(b.does)}"` : ""}>`
    + `<span class="bn"><b>${esc(b?.name)}</b>${version}</span>`
    + (isDone(b) ? "" : `<span class="bs">${esc(w.where)}</span>`)
    + `<span class="bw">${esc(w.state)}</span>`
    + (w.note ? `<span class="bm">${esc(w.note)}</span>` : "")
    + (w.archived ? `<span class="bm">Archived</span>` : "")
    + `</a>`;
}

/** The whole Board page. */
export function boardHtml(builds, stages, phases, { mine = false, error = "" } = {}) {
  const list = Array.isArray(builds) ? builds : [];
  const waiting = list.filter(waitsOnMe).length;
  const cols = boardColumns(list, stages, phases, { mine });
  return `<div class="err" role="alert">${esc(error)}</div>
    <div class="head"><h1>Board</h1><button class="try${mine ? " on" : ""}" id="mine" type="button" aria-pressed="${mine}">Waiting on me (${waiting})</button></div>
    ${list.length ? "" : `<p class="does">No builds yet.</p>`}
    ${mine && !waiting ? `<p class="does">Nothing is waiting on you.</p>` : ""}
    <div class="board">${cols.map((c) => `<section class="col${c.id === "done" ? " end" : ""}" aria-label="${esc(c.name)}"><h2>${esc(c.name)} <span>${c.builds.length}</span></h2><div class="cards">${c.builds.map((b) => cardHtml(b, stages)).join("")}</div></section>`).join("")}</div>`;
}
