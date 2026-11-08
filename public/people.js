// Who you are, who may answer a gate, and the People page. Everything here
// builds HTML from what the service answered and nothing else, so the tests
// read it without a browser (test/people.test.mjs).
//
// A service that keeps people answers GET /me with role and teams, puts a
// gate on a stage that waits on a person ({ you_may_answer, who, words }),
// and answers GET /people. A service that does none of this shows none of it.

import { esc } from "./roles.js";

const ROLE_WORDS = { member: "member", approver: "approver", admin: "admin" };

/** The top bar's words for who you are: "Ana Lee · approver", or "" when the service did not say. */
export function meWords(me) {
  const name = typeof me?.account?.name === "string" ? me.account.name.trim() : "";
  if (!name) return "";
  const role = ROLE_WORDS[me.role];
  return role ? `${name} · ${role}` : name;
}

/** In place of a gate's buttons, when you may not answer it: who may, in the service's words. */
export function whoMayHtml(stage) {
  const g = stage?.gate;
  if (!g || g.you_may_answer !== false) return "";
  const words = typeof g.words === "string" && g.words.trim() ? g.words : "Someone else answers this gate.";
  return `<p class="whomay" role="note">${esc(words)}</p>`;
}

const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : "");

/** The People page: people, teams and projects, read-only, with any problem the service found. */
export function peoplePageHtml(answer, { error = "" } = {}) {
  const org = str(answer?.organization);
  const people = list(answer?.people);
  const teams = list(answer?.teams);
  const projects = list(answer?.projects);
  const problems = list(answer?.problems).filter((p) => typeof p === "string");
  let h = `<div class="err" role="alert">${esc(error)}</div><div class="head"><h1>People</h1></div>`;
  h += `<p class="does">${org ? `${esc(org)}: ` : ""}${people.length === 1 ? "1 person" : `${people.length} people`}, ${teams.length === 1 ? "1 team" : `${teams.length} teams`} and ${projects.length === 1 ? "1 project" : `${projects.length} projects`}. Read-only here.</p>`;
  if (problems.length) h += `<div class="check people-problems"><div class="t back">The service found ${problems.length === 1 ? "a problem" : `${problems.length} problems`}</div><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>`;
  h += `<section class="ppl"><h2>People</h2>`;
  h += people.length
    ? `<table class="ptable"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Teams</th></tr></thead><tbody>${people.map((p) => `<tr><td>${esc(str(p.name) || str(p.email))}</td><td><code>${esc(str(p.email))}</code></td><td><span class="role r-${esc(ROLE_WORDS[p.role] ?? "other")}">${esc(ROLE_WORDS[p.role] ?? str(p.role))}</span></td><td>${esc(list(p.teams).filter((t) => typeof t === "string").join(", ")) || '<span class="dim">none</span>'}</td></tr>`).join("")}</tbody></table>`
    : `<p class="none">No people yet. Until there are, only the service's own key is used.</p>`;
  h += `</section><section class="ppl"><h2>Teams</h2>`;
  h += teams.length
    ? `<ul class="plist">${teams.map((t) => `<li><b>${esc(str(t.name))}</b><span>${esc(list(t.members).filter((m) => typeof m === "string").join(", ")) || "no members"}</span></li>`).join("")}</ul>`
    : `<p class="none">No teams yet.</p>`;
  h += `</section><section class="ppl"><h2>Projects</h2>`;
  h += projects.length
    ? `<ul class="plist">${projects.map((p) => `<li><b>${esc(str(p.name))}</b><span>${esc(list(p.teams).filter((t) => typeof t === "string").join(", ")) || "no teams"}</span></li>`).join("")}</ul>`
    : `<p class="none">No projects yet.</p>`;
  h += `</section>`;
  const change = str(answer?.change);
  h += `<p class="pchange">${esc(change || "People are changed at the service, not here.")}</p>`;
  return h;
}
