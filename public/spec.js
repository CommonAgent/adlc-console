// The spec (lifecycle API 0.4.8, stages.json 1.6.0) on the page: what
// Requirements hands back, the analysis of the product's functional
// requirements and capabilities, drawn from an artifact of kind spec and its
// SpecSummary. Each feature with its requirements (the shall line, its kind,
// and the exact words, patterns and numbers it fixes, in code style) and its
// acceptance scenarios as Gherkin; the interfaces, with the ones that must be
// kept marked; the constraints; the systems it reaches or names; its
// settings; and the open questions.
//
// SpecSummary names product, purpose, features, interfaces, constraints and
// open. A service may also give systems, settings and price as words; they
// are drawn when given, and nothing is drawn for a field that is missing.
//
// Everything here builds HTML from what the service answered and nothing else,
// so the tests read it without a browser (test/spec.test.mjs).

import { esc } from "./roles.js";

const list = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const words = (v) => list(v).map(str).filter(Boolean);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The spec artifact among a build's or a stage's artifacts: the newest one made, or null. */
export function specOf(artifacts) {
  return list(artifacts).filter((a) => isObj(a) && a.kind === "spec" && a.state === "made" && isObj(a.summary)).at(-1) ?? null;
}

/** One feature of a spec summary by its id, or null. */
export function specFeature(summary, id) {
  return list(summary?.features).find((f) => isObj(f) && str(f.id) === id) ?? null;
}

/** "3 requirements · 2 scenarios", for a feature of the spec. */
export function featureCounts(f) {
  const r = list(f?.requirements).filter(isObj).length;
  const a = list(f?.acceptance).filter(isObj).length;
  return `${plural(r, "requirement")} · ${plural(a, "scenario")}`;
}

/** One requirement: its id, the shall line, its kind, and the exact words it fixes in code style. */
export function requirementHtml(r) {
  if (!isObj(r) || !str(r.shall)) return "";
  const exact = words(r.exact);
  return `<li class="sreq"><span class="sid">${esc(str(r.id))}</span><span class="shall">${esc(str(r.shall))}</span>${str(r.kind) ? ` <span class="sk">${esc(str(r.kind))}</span>` : ""}${exact.length ? `<span class="sx">${exact.map((x) => `<code>${esc(x)}</code>`).join(" ")}</span>` : ""}</li>`;
}

/** One acceptance scenario: its id, then the Gherkin as it is written. */
export function scenarioHtml(a) {
  if (!isObj(a) || !str(a.gherkin)) return "";
  return `<li class="sacc"><span class="sid">${esc(str(a.id))}</span><pre class="gherkin">${esc(str(a.gherkin).replace(/\s+$/, ""))}</pre></li>`;
}

/** A feature's requirements, then its scenarios. */
export function featureSpecHtml(f) {
  if (!isObj(f)) return "";
  const reqs = list(f.requirements).map(requirementHtml).filter(Boolean);
  const accs = list(f.acceptance).map(scenarioHtml).filter(Boolean);
  return `${reqs.length ? `<p class="sgl">Requirements</p><ul class="sreqs">${reqs.join("")}</ul>` : ""}${accs.length ? `<p class="sgl">Acceptance</p><ul class="saccs">${accs.join("")}</ul>` : ""}`;
}

/** One feature of the spec, with what it does, its requirements and its scenarios. at: the feature the reader is opened at. */
function featureHtml(f, at) {
  const ab = str(f.as_built) ? ` <small>as built, ${esc(str(f.as_built))}</small>` : "";
  return `<section class="sfe${str(f.id) === at ? " at" : ""}" data-spec-feature="${esc(str(f.id))}"><h4><span class="fid">${esc(str(f.id))}</span> ${esc(str(f.name))}${str(f.offering) ? ` <small>in ${esc(str(f.offering))}</small>` : ""}${ab}</h4>${str(f.does) ? `<p class="fdoes">${esc(str(f.does))}</p>` : ""}${featureSpecHtml(f)}</section>`;
}

/** The interfaces, each with whether it must be kept exactly. */
export function interfacesHtml(list0) {
  const xs = list(list0).filter((x) => isObj(x) && str(x.name));
  if (!xs.length) return "";
  const li = (x) => `<li class="sif${x.keep === true ? " keep" : ""}"><span class="sid">${esc(str(x.id))}</span>${str(x.kind) ? `<span class="sk">${esc(str(x.kind))}</span> ` : ""}<code>${esc(str(x.name))}</code>${x.keep === true ? ` <span class="fb s-keep">Keep exactly</span>` : x.keep === false ? ` <span class="fb">May change</span>` : ""}${str(x.about) ? `<small>${esc(str(x.about))}</small>` : ""}</li>`;
  return `<section class="sgrp"><h4>Interfaces <span class="ct">${xs.length}</span></h4><ul class="sifs">${xs.map(li).join("")}</ul></section>`;
}

/** A group of lines, such as the constraints: a heading with its count, then one line each. */
function linesHtml(title, xs, cls = "") {
  return xs.length ? `<section class="sgrp${cls ? ` ${cls}` : ""}"><h4>${esc(title)} <span class="ct">${xs.length}</span></h4><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : "";
}

/**
 * The whole spec: the product and its purpose, each feature with its
 * requirements and scenarios, then the interfaces, the constraints, the
 * systems, the settings and the open questions. feature: the feature the
 * reader is opened at, marked.
 */
export function specHtml(s, { feature = null } = {}) {
  if (!isObj(s)) return "";
  const feats = list(s.features).filter((f) => isObj(f) && str(f.id));
  const open = words(s.open);
  const head = `<p class="sprod"><b>${esc(str(s.product))}</b>${str(s.price) ? ` <small>${esc(str(s.price))}</small>` : ""}</p>${str(s.purpose) ? `<p class="spurp">${esc(str(s.purpose))}</p>` : ""}`;
  const fs = feats.length ? `<div class="sfes">${feats.map((f) => featureHtml(f, feature)).join("")}</div>` : `<p class="gw">No features in the spec.</p>`;
  return `<div class="spec">${head}${fs}${interfacesHtml(s.interfaces)}${linesHtml("Constraints", words(s.constraints))}${linesHtml("Systems", words(s.systems))}${linesHtml("Settings", words(s.settings))}${open.length ? `<section class="sgrp open"><h4>Still open <span class="ct">${open.length}</span></h4><ul class="open">${open.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></section>` : `<p class="sgl">Nothing is still open.</p>`}</div>`;
}

/** The Requirements stage's Spec tab: the spec, with its version and who made it, or why there is none yet. */
export function specTabHtml(a, { when = null } = {}) {
  if (!isObj(a)) return `<p class="gw">No spec yet. The spec writer hands it back at Requirements.</p>`;
  const meta = [str(a.by), str(a.version), a.at && when ? when(a.at) : ""].filter(Boolean).join(" · ");
  return `<div class="spectab"><div class="vm">${esc(meta)}</div>${specHtml(a.summary)}</div>`;
}
