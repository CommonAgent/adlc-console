// The demo's answers for each stage's cadence (lifecycle API 0.4.2): the
// cadence on every stage, carried on a setup stage of a later version, and a
// product's setup and when-needed lists. Like the rest of the demo it stands
// in for a service, shaped exactly like a service's answers.
//
// The demo keeps no lifecycle per build, so it reads a choice's age from the
// role's binding: a build started after the binding was made used it. A
// default binding (the reference agent) has held since the product's first
// build. A holder chosen now holds from the next version.

import { readFileSync } from "node:fs";

const DOC = JSON.parse(readFileSync(new URL("../standards/stages.json", import.meta.url), "utf8"));
const DEF = new Map(DOC.stages.map((s) => [s.id, s]));
const ROLE = new Map((DOC.roles ?? []).map((r) => [r.id, r]));
export const SETUP = DOC.stages.filter((s) => s.cadence === "setup").map((s) => s.id);
export const WHEN_NEEDED = DOC.stages.filter((s) => s.cadence === "when_needed").map((s) => s.id);
export const cadenceOf = (id) => DEF.get(id)?.cadence ?? "every_build";

/** The role whose holder holds a setup stage: Architecture is the solution architect's, the rest their first role. */
export const setupRole = (id) => (id === "architecture" ? "solution-architect" : DEF.get(id)?.role_ids?.[0] ?? null);

const startedAt = (b) => b.lifecycle?.at ?? "";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The role's binding in a roles answer: { holder, since } or null. */
function bindingOf(rolesAnswer, role) {
  const r = (rolesAnswer?.roles ?? []).find((x) => x.role === role);
  return r?.binding ? { holder: r.binding.holder, since: r.binding.since ?? null } : null;
}

/** The earliest of the product's builds (newest first) in an unbroken run that started after the binding was made. */
function earliestSince(builds, binding) {
  let since = null;
  for (const b of builds) {
    if (binding.since && startedAt(b) < binding.since) break;
    since = b;
  }
  return since;
}

const holderOnly = (h) => {
  const out = { kind: h.kind, name: h.name };
  if (h.handle) out.handle = h.handle;
  return out;
};

/** A product's setup list. builds: newest first. roles, stages: the answers for the newest build's project. */
export function setupList(builds, rolesAnswer, stagesAnswer) {
  const project = stagesAnswer?.project ?? null;
  return SETUP.map((id) => {
    const role = setupRole(id);
    const base = { stage: id, name: DEF.get(id).name, role, project };
    const used = (stagesAnswer?.stages ?? []).find((s) => s.stage === id)?.used !== false;
    if (!used) return { ...base, state: "not_used", holder: null, settings: {}, since: null, words: "Not part of this product's lifecycle" };
    const bound = bindingOf(rolesAnswer, role);
    if (!bound) return { ...base, state: "not_chosen", holder: null, settings: {}, since: null, words: `Nobody chosen: nobody holds the ${ROLE.get(role)?.name ?? role} role` };
    const since = earliestSince(builds, bound);
    const words = !since ? "Chosen: it holds from the next version" : since === builds[0] ? `Chosen at ${since.version}` : `Unchanged since ${since.version}`;
    return { ...base, state: "chosen", holder: holderOnly(bound.holder), settings: isObj(bound.holder.settings) ? bound.holder.settings : {}, since: since?.version ?? null, words };
  });
}

/** A setup stage of build b carried forward from an earlier version, or null. builds: the product's, newest first. */
export function carriedFor(b, stage, builds, rolesAnswer) {
  if (cadenceOf(stage) !== "setup") return null;
  const bound = bindingOf(rolesAnswer, setupRole(stage));
  if (!bound) return null;
  const at = builds.indexOf(b);
  if (at < 0 || (bound.since && startedAt(b) < bound.since)) return null;
  const earlier = builds.slice(at + 1).filter((x) => x.version !== b.version);
  const since = earliestSince(earlier, bound);
  return since ? { since: since.version, build: since.id, words: `Unchanged since ${since.version}` } : null;
}

/** A product's when-needed list: only an action the newest build offers can run; the rest say why. */
export function whenNeededList(builds, stagesAnswer) {
  const b = builds.find((x) => !x.archived) ?? builds[0];
  const installed = b?.stages.find((s) => s.stage === "deploy")?.state === "done";
  const retired = b?.stages.find((s) => s.stage === "decommission")?.state === "done";
  return WHEN_NEEDED.map((id) => {
    const name = DEF.get(id).name;
    const base = { stage: id, name };
    const offered = b?.actions.find((a) => a.stage === id);
    if (offered) return { ...base, can_run: true, action: { build: b.id, name: offered.name, label: offered.label } };
    const used = (stagesAnswer?.stages ?? []).find((s) => s.stage === id)?.used !== false;
    let why;
    if (!used) why = `This product's lifecycle leaves ${name} out.`;
    else if (retired) why = "It is decommissioned: nothing of it is running.";
    else if (!installed) why = `Nothing of this product is running yet, so there is nothing to ${{ impact: "check a change against", retract: "take down", reconfigure: "change the settings of", rollback: "roll back", decommission: "retire" }[id]}.`;
    else if (id === "rollback") why = "There is no earlier installed version to roll back to.";
    else if (id === "retract") why = "Nothing of this product was published, so there is nothing to take down.";
    else if (id === "impact") why = "The demo keeps no record of what depends on this product, so it cannot check a change against it.";
    else why = `Its build does not offer ${name} now.`;
    return { ...base, can_run: false, why_not: why };
  });
}
