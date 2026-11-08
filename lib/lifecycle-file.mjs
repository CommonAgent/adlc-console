// The console's lifecycle with no service: one lifecycle document, a JSON file
// at a path (standards/lifecycle-document.schema.json). It answers the same
// lifecycle routes the page calls on a service (GET/PUT/DELETE /stages and
// /roles, with ?project=) by reading and writing that file, and adds the
// organization's own stages (POST/PUT/DELETE /local/added-stages).
//
// The file is read on every request, so a change made by hand shows on the
// next reload, and written whole to a temporary file that then replaces it.
// It is a file and nothing else: no database, no git, no host.

import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const SCHEMA = JSON.parse(readFileSync(new URL("../standards/lifecycle-document.schema.json", import.meta.url), "utf8"));
const VERSION = SCHEMA.properties.version.const;
const KINDS = ["reference_agent", "your_agent", "contracted", "person", "outside_tool"];
const WITH_HANDLE = new Set(["your_agent", "contracted"]);
const FIELDS = ["given", "hands_back", "done_when"];

export const emptyDocument = () => ({ version: VERSION, organization: { used: {}, holders: {}, added_stages: [] }, projects: {} });

/** An id from words: "Legal review" -> "legal-review". */
export function idFrom(words) {
  return String(words ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "");
}

// ---------- the schema check: the small part of JSON Schema the document schema uses ----------

const typeWords = { object: "an object", array: "a list", string: "words", boolean: "true or false", null: "null" };
const isType = (t, v) => (t === "object" ? v !== null && typeof v === "object" && !Array.isArray(v) : t === "array" ? Array.isArray(v) : t === "null" ? v === null : typeof v === t);

function check(schema, v, at, out) {
  if (schema.$ref) return check(SCHEMA.$defs[schema.$ref.split("/").pop()], v, at, out);
  if (schema.anyOf) {
    const each = schema.anyOf.map((s) => { const e = []; check(s, v, at, e); return e; });
    if (!each.some((e) => !e.length)) out.push(`${at} must be ${each.map((e) => e[0].slice(at.length + 9)).join(", or ")}`);
    return;
  }
  if ("const" in schema && v !== schema.const) return out.push(`${at} must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(v)) return out.push(`${at} must be one of ${schema.enum.join(", ")}`);
  if (schema.type && !isType(schema.type, v)) return out.push(`${at} must be ${typeWords[schema.type]}`);
  if (typeof v === "string") {
    if (schema.minLength && v.length < schema.minLength) out.push(`${at} must not be empty`);
    if (schema.maxLength && v.length > schema.maxLength) out.push(`${at} must be at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) out.push(`${at} must be lowercase letters and digits joined by hyphens`);
  }
  if (Array.isArray(v) && schema.items) v.forEach((x, i) => check(schema.items, x, `${at}[${i}]`, out));
  if (isType("object", v)) {
    for (const k of schema.required ?? []) if (!(k in v)) out.push(`${at} is missing "${k}"`);
    for (const [k, x] of Object.entries(v)) {
      const where = `${at}.${k}`;
      if (schema.propertyNames) {
        const e = [];
        check(schema.propertyNames, k, `the name "${k}" in ${at}`, e);
        out.push(...e);
      }
      if (schema.properties?.[k]) check(schema.properties[k], x, where, out);
      else if (schema.additionalProperties === false) out.push(`${at} has "${k}", which the format does not have`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") check(schema.additionalProperties, x, where, out);
    }
  }
}

// ---------- the lifecycle the document describes ----------

/**
 * stagesDoc: stages.json. Returns the functions that read a document: its
 * problems, and the stages and roles in effect for the organization or a project.
 */
export function lifecycleModel(stagesDoc) {
  const REF_STAGES = stagesDoc.stages ?? [];
  const REF_ROLES = stagesDoc.roles ?? [];
  const PHASES = new Set((stagesDoc.phases ?? []).map((p) => p.id));
  const FORMATS = new Set((stagesDoc.evidence_formats ?? []).map((f) => f.id));
  const refStage = new Map(REF_STAGES.map((s) => [s.id, s]));
  const refRole = new Map(REF_ROLES.map((r) => [r.id, r]));

  /** The added stages a scope sees: the organization's, then the project's. */
  function addedIn(doc, project) {
    const org = (doc.organization?.added_stages ?? []).map((s) => ({ ...s, scope: "org" }));
    const prj = project ? (doc.projects?.[project]?.added_stages ?? []).map((s) => ({ ...s, scope: "project" })) : [];
    return [...org, ...prj];
  }

  /** Every stage in order: the reference stages, with each added stage placed after its stage. Null when one cannot be placed. */
  function place(added) {
    const list = REF_STAGES.map((s) => ({ id: s.id, phase: s.phase, def: s, added: null }));
    const byId = new Map(added.map((s) => [s.id, s]));
    // Whether an added stage hangs, through other added stages, off this anchor (a stage id, or "^phase" for the start of a phase).
    const under = (item, anchor) => {
      for (let s = item.added, seen = 0; s && seen <= added.length; s = byId.get(s.after), seen++) {
        if ((s.after ?? `^${s.phase}`) === anchor) return true;
        if (s.after === null) return false;
      }
      return false;
    };
    let left = [...added];
    while (left.length) {
      const next = [];
      for (const s of left) {
        const anchor = s.after ?? `^${s.phase}`;
        let pos = s.after === null ? list.findIndex((x) => x.phase === s.phase) : list.findIndex((x) => x.id === s.after) + 1;
        if (pos < 0 || (s.after !== null && pos === 0)) { next.push(s); continue; }
        while (pos < list.length && list[pos].added && under(list[pos], anchor)) pos++;
        list.splice(pos, 0, { id: s.id, phase: s.phase, def: null, added: s });
      }
      if (next.length === left.length) return null;
      left = next;
    }
    return list;
  }

  /** The roles a scope sees: stages.json's, then each new role an added stage names. */
  function rolesIn(added) {
    const roles = REF_ROLES.map((r) => ({ id: r.id, name: r.name, contract: r.contract, offering: r.offering, stages: [...(r.stages ?? [])], reference_agent: r.reference_agent ?? null, added: false }));
    const byId = new Map(roles.map((r) => [r.id, r]));
    for (const s of added) {
      let r = byId.get(s.role);
      if (!r) {
        r = { id: s.role, name: s.role_name ?? s.role, contract: "Named in this lifecycle document.", offering: `role-${s.role}`, stages: [], reference_agent: null, added: true };
        roles.push(r); byId.set(r.id, r);
      }
      r.stages.push(s.id);
    }
    return roles;
  }

  /** What is wrong with a document, in words. An empty list when nothing is. */
  function problems(doc) {
    const out = [];
    check(SCHEMA, doc, "the file", out);
    if (out.length) return out.map((p) => p.replace(/^the file\./, ""));
    const ids = new Set(REF_STAGES.map((s) => s.id));
    const scopes = [["organization", doc.organization, null], ...Object.entries(doc.projects ?? {}).map(([name, sc]) => [`projects.${name}`, sc, name])];
    for (const [where, sc] of scopes) {
      (sc.added_stages ?? []).forEach((s, i) => {
        const at = `${where}.added_stages[${i}]`;
        if (ids.has(s.id)) out.push(`${at}: there is already a stage "${s.id}"`);
        ids.add(s.id);
        if (!PHASES.has(s.phase)) out.push(`${at}: there is no phase "${s.phase}"`);
        if (refRole.has(s.role) && "role_name" in s) out.push(`${at}: role_name is only for a new role, and "${s.role}" is in stages.json`);
        if (!refRole.has(s.role) && !("role_name" in s)) out.push(`${at}: the new role "${s.role}" needs a role_name`);
      });
    }
    if (out.length) return out;
    for (const [where, sc, project] of scopes) {
      const added = addedIn(doc, project);
      const seen = new Map([...REF_STAGES.map((s) => [s.id, s.phase]), ...added.map((s) => [s.id, s.phase])]);
      for (const s of sc.added_stages ?? []) {
        if (s.after !== null && !seen.has(s.after)) out.push(`${where}: the stage "${s.id}" comes after "${s.after}", and there is no such stage`);
        else if (s.after !== null && seen.get(s.after) !== s.phase) out.push(`${where}: the stage "${s.id}" is in the phase "${s.phase}", but "${s.after}" is not`);
      }
      if (!out.length && !place(added)) out.push(`${where}: the added stages come after one another in a circle, so they cannot be placed`);
      for (const k of Object.keys(sc.used ?? {})) if (!seen.has(k)) out.push(`${where}.used: there is no stage "${k}"`);
      const roles = new Set(rolesIn(added).map((r) => r.id));
      for (const [k, h] of Object.entries(sc.holders ?? {})) {
        if (!roles.has(k)) out.push(`${where}.holders: there is no role "${k}"`);
        const why = holderProblem(k, h);
        if (roles.has(k) && why) out.push(`${where}.holders.${k}: ${why}`);
      }
    }
    return out;
  }

  /** Why a holder cannot hold a role, in words, or null. */
  function holderProblem(roleId, h) {
    if (!h || typeof h !== "object" || !KINDS.includes(h.kind)) return "Say who holds it: the reference agent, your own agent, a contracted supplier, a person or an outside tool.";
    if (roleId === "requester" && h.kind !== "person") return "The requester is always the person who asked, so it cannot be given to anything else.";
    if (h.kind === "reference_agent" && !refRole.get(roleId)?.reference_agent) return "There is no reference agent for this role.";
    if (!String(h.name ?? "").trim()) return "Give it a name people will know.";
    if (WITH_HANDLE.has(h.kind) && !String(h.handle ?? "").trim()) {
      return h.kind === "your_agent" ? "Give your agent's handle on the mesh, so the stage's work can be sent to it." : "Give the supplier's handle on the mesh, so the stage's work can be sent to it.";
    }
    const formats = h.evidence?.formats ?? [];
    if (!Array.isArray(formats) || formats.some((f) => !FORMATS.has(f))) return "One of those evidence formats is not in stages.json.";
    return null;
  }

  /** GET /stages: every stage in order, whether it is used, and where that comes from. */
  function stagesAnswer(doc, project) {
    const org = doc.organization ?? {};
    const prj = project ? doc.projects?.[project] ?? {} : {};
    const stages = (place(addedIn(doc, project)) ?? []).map((x) => {
      const p = prj.used?.[x.id];
      const o = org.used?.[x.id];
      const used = p ?? o ?? true;
      const from = p !== undefined ? "project" : o !== undefined ? "org" : "default";
      if (x.def) return { stage: x.id, name: x.def.name, phase: x.def.phase, roles: x.def.role_ids ?? [], used, from, can_leave_out: true };
      const s = x.added;
      const added = { scope: s.scope, after: s.after, given: s.given, hands_back: s.hands_back, done_when: s.done_when, person_gate: s.person_gate };
      if (s.role_name) added.role_name = s.role_name;
      return { stage: s.id, name: s.name, phase: s.phase, roles: [s.role], used, from, can_leave_out: true, added };
    });
    return { project: project ?? null, stages };
  }

  /** GET /roles: every role, and who holds it now. */
  function rolesAnswer(doc, project) {
    const org = doc.organization?.holders ?? {};
    const prj = project ? doc.projects?.[project]?.holders ?? {} : {};
    const roles = rolesIn(addedIn(doc, project)).map((r) => {
      const ref = r.reference_agent ? { kind: "reference_agent", name: r.reference_agent } : null;
      let binding = null; let from = "unbound";
      if (r.id === "requester") { binding = { role: r.id, holder: { kind: "person", name: "the person who asked" } }; from = "default"; }
      else if (prj[r.id]) { binding = { role: r.id, holder: prj[r.id], scope: { project } }; from = "project"; }
      else if (org[r.id]) { binding = { role: r.id, holder: org[r.id], scope: { org: true } }; from = "org"; }
      else if (ref) { binding = { role: r.id, holder: ref }; from = "default"; }
      const out = { role: r.id, name: r.name, contract: r.contract, offering: r.offering, stages: r.stages, binding, from, reference_agent: ref };
      if (r.added) out.added = true;
      return out;
    });
    return { ...(project ? { project } : {}), roles };
  }

  return { problems, holderProblem, stagesAnswer, rolesAnswer, addedIn, rolesIn, refStage, refRole, PHASES };
}

// ---------- the store ----------

class Refused extends Error { constructor(status, message) { super(message); this.status = status; } }

/**
 * path: the lifecycle file. stagesDoc: stages.json. fsImpl: the file
 * functions, replaceable in tests.
 */
export function createLifecycleFile({ path, stagesDoc, fsImpl = { readFile, writeFile, rename, mkdir, unlink } }) {
  const file = resolve(path);
  const model = lifecycleModel(stagesDoc);
  let queue = Promise.resolve();
  let seq = 0;

  async function write(doc) {
    const tmp = `${file}.${process.pid}.${Date.now()}.${++seq}.tmp`;
    await fsImpl.mkdir(dirname(file), { recursive: true });
    try {
      await fsImpl.writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      await fsImpl.rename(tmp, file);
    } catch (e) {
      await fsImpl.unlink(tmp).catch(() => {});
      throw new Refused(409, `The lifecycle file ${file} could not be saved (${e.code ?? e.message}).`);
    }
  }

  /** The document, made with the defaults when the file is missing. Refuses with the problem in words when it is not valid. */
  async function load() {
    let text;
    try { text = await fsImpl.readFile(file, "utf8"); } catch (e) {
      if (e.code !== "ENOENT") throw new Refused(409, `The lifecycle file ${file} could not be read (${e.code ?? e.message}).`);
      const doc = emptyDocument();
      await write(doc);
      return doc;
    }
    let doc;
    try { doc = JSON.parse(text.replace(/^﻿/, "")); } catch (e) {
      throw new Refused(409, `The lifecycle file ${file} is not valid JSON: ${e.message}.`);
    }
    const p = model.problems(doc);
    if (p.length) throw new Refused(409, `The lifecycle file ${file} is not a valid lifecycle document: ${p.slice(0, 5).join("; ")}${p.length > 5 ? `; and ${p.length - 5} more` : ""}.`);
    return doc;
  }

  /** One change: read the file, change it, check it, write it. One change at a time. */
  function change(fn) {
    const run = queue.then(async () => {
      const doc = await load();
      const out = fn(doc);
      const p = model.problems(doc);
      if (p.length) throw new Refused(400, p[0]);
      await write(doc);
      return out;
    });
    queue = run.catch(() => {});
    return run;
  }

  const scopeOf = (doc, project, make = true) => {
    if (!project) return doc.organization;
    doc.projects ??= {};
    if (!doc.projects[project] && make) doc.projects[project] = {};
    return doc.projects[project] ?? {};
  };
  const both = (doc, project) => ({ stages: model.stagesAnswer(doc, project), roles: model.rolesAnswer(doc, project) });

  // ---------- the lifecycle routes ----------

  async function stages(method, stage, project, body) {
    if (!stage) {
      if (method !== "GET") return { status: 405, body: { error: "Not allowed." } };
      return { status: 200, body: model.stagesAnswer(await load(), project) };
    }
    if (method === "GET") {
      const a = model.stagesAnswer(await load(), project);
      return a.stages.some((s) => s.stage === stage) ? { status: 200, body: a } : { status: 400, body: { error: "There is no stage by that name." } };
    }
    if (method !== "PUT" && method !== "DELETE") return { status: 405, body: { error: "Not allowed." } };
    if (method === "PUT" && typeof body?.used !== "boolean") return { status: 400, body: { error: "Say whether the lifecycle uses the stage." } };
    return { status: 200, body: await change((doc) => {
      if (!model.stagesAnswer(doc, project).stages.some((s) => s.stage === stage)) throw new Refused(400, "There is no stage by that name.");
      const sc = scopeOf(doc, project);
      sc.used ??= {};
      if (method === "PUT") sc.used[stage] = body.used;
      else delete sc.used[stage];
      return model.stagesAnswer(doc, project);
    }) };
  }

  async function roles(method, role, project, body) {
    if (!role) {
      if (method !== "GET") return { status: 405, body: { error: "Not allowed." } };
      return { status: 200, body: model.rolesAnswer(await load(), project) };
    }
    const known = (doc) => model.rolesAnswer(doc, project).roles.some((r) => r.role === role);
    if (method === "GET") {
      const doc = await load();
      return known(doc) ? { status: 200, body: model.rolesAnswer(doc, project) } : { status: 400, body: { error: "There is no role by that name." } };
    }
    if (method !== "PUT" && method !== "DELETE") return { status: 405, body: { error: "Not allowed." } };
    return { status: 200, body: await change((doc) => {
      if (!known(doc)) throw new Refused(400, "There is no role by that name.");
      const sc = scopeOf(doc, project);
      sc.holders ??= {};
      if (method === "DELETE") delete sc.holders[role];
      else if (role !== "requester") sc.holders[role] = cleanHolder(role, body?.holder);
      return model.rolesAnswer(doc, project);
    }) };
  }

  function cleanHolder(role, h) {
    const why = model.holderProblem(role, h);
    if (why) throw new Refused(400, why);
    const holder = { kind: h.kind, name: String(h.name).trim() };
    if (WITH_HANDLE.has(h.kind) || (h.kind === "reference_agent" && h.handle)) holder.handle = String(h.handle).trim();
    if (h.evidence && (h.evidence.formats?.length || h.evidence.where)) {
      holder.evidence = { formats: h.evidence.formats ?? [], ...(String(h.evidence.where ?? "").trim() ? { where: String(h.evidence.where).trim() } : {}) };
    }
    // The holder's settings for its role, kept as they are given (lifecycle document 0.1, Holder.settings).
    if (h.settings !== undefined) {
      if (!h.settings || typeof h.settings !== "object" || Array.isArray(h.settings)) throw new Refused(400, "A holder's settings are a JSON object, such as { \"every_minutes\": 5 }.");
      holder.settings = structuredClone(h.settings);
    }
    return holder;
  }

  // ---------- the organization's own stages ----------

  /** An added stage from the form's words. Refuses with words when something is missing. */
  function stageFrom(doc, project, body, id) {
    const name = String(body?.name ?? "").trim();
    if (!name) throw new Refused(400, "Give the stage a name.");
    const phase = String(body?.phase ?? "");
    if (!model.PHASES.has(phase)) throw new Refused(400, "Say which phase the stage goes in.");
    const after = body?.after ? String(body.after) : null;
    if (after === id) throw new Refused(400, "A stage cannot come after itself.");
    const s = { id, name, phase, after };
    const roleName = String(body?.role_name ?? "").trim();
    if (body?.role) {
      s.role = String(body.role);
      if (!model.rolesIn(model.addedIn(doc, project)).some((r) => r.id === s.role)) throw new Refused(400, "There is no role by that name.");
    } else {
      if (!roleName) throw new Refused(400, "Choose its role, or name a new one.");
      s.role = idFrom(roleName);
      if (!s.role) throw new Refused(400, "Give the new role a name with letters or digits in it.");
      if (model.refRole.has(s.role)) throw new Refused(400, `There is already a role called ${model.refRole.get(s.role).name}. Choose it from the list.`);
    }
    for (const f of FIELDS) {
      const v = String(body?.[f] ?? "").trim();
      if (!v) throw new Refused(400, { given: "Say what the stage is given.", hands_back: "Say what the stage hands back.", done_when: "Say when the stage is done." }[f]);
      s[f] = v;
    }
    s.person_gate = body?.person_gate === true;
    if (!model.refRole.has(s.role)) s.role_name = roleName || model.rolesIn(model.addedIn(doc, project)).find((r) => r.id === s.role)?.name || s.role;
    return s;
  }

  /** A new role's holder, kept at the scope the stage is added at. A new role must have one. */
  function holdNewRole(doc, project, s, body) {
    if (model.refRole.has(s.role)) return;
    const sc = scopeOf(doc, project);
    const held = sc.holders?.[s.role] ?? doc.organization.holders?.[s.role];
    if (!body?.holder && held) return;
    if (!body?.holder) throw new Refused(400, "Say who holds the new role.");
    if (body.holder.kind === "reference_agent") throw new Refused(400, "There is no reference agent for a role of your own. Choose who holds it.");
    sc.holders ??= {};
    sc.holders[s.role] = cleanHolder(s.role, body.holder);
  }

  // Keep every added stage with the same new role under one name.
  function nameRole(doc, s) {
    if (!s.role_name) return;
    for (const sc of [doc.organization, ...Object.values(doc.projects ?? {})]) for (const x of sc.added_stages ?? []) if (x.role === s.role) x.role_name = s.role_name;
  }

  // A new role no stage names any more is gone, and so is who held it.
  function dropUnusedRoles(doc) {
    const named = new Set();
    const all = [doc.organization, ...Object.values(doc.projects ?? {})];
    for (const sc of all) for (const x of sc.added_stages ?? []) named.add(x.role);
    for (const sc of all) for (const k of Object.keys(sc.holders ?? {})) if (!model.refRole.has(k) && !named.has(k)) delete sc.holders[k];
  }

  function owned(doc, project, id) {
    const list = scopeOf(doc, project, false).added_stages ?? [];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) {
      const elsewhere = model.addedIn(doc, project).some((x) => x.id === id);
      throw new Refused(400, elsewhere ? "This stage is the organization's own. Change it on the organization's lifecycle." : "There is no stage of your own by that name.");
    }
    return [list, i];
  }

  async function added(method, id, project, body) {
    if (method === "POST" && !id) {
      return { status: 201, body: await change((doc) => {
        const newId = idFrom(body?.name);
        if (!newId) throw new Refused(400, "Give the stage a name with letters or digits in it.");
        const taken = model.stagesAnswer(doc, project).stages.some((x) => x.stage === newId)
          || [doc.organization, ...Object.values(doc.projects ?? {})].some((sc) => (sc.added_stages ?? []).some((x) => x.id === newId));
        if (taken) throw new Refused(400, "There is already a stage with that name. Give it another.");
        const s = stageFrom(doc, project, body, newId);
        const sc = scopeOf(doc, project);
        (sc.added_stages ??= []).push(s);
        nameRole(doc, s);
        holdNewRole(doc, project, s, body);
        return both(doc, project);
      }) };
    }
    if (!id) return { status: 405, body: { error: "Not allowed." } };
    if (method === "PUT") {
      return { status: 200, body: await change((doc) => {
        const [list, i] = owned(doc, project, id);
        const s = stageFrom(doc, project, body, id);
        list[i] = s;
        nameRole(doc, s);
        holdNewRole(doc, project, s, body);
        dropUnusedRoles(doc);
        return both(doc, project);
      }) };
    }
    if (method === "DELETE") {
      return { status: 200, body: await change((doc) => {
        const [list, i] = owned(doc, project, id);
        const [gone] = list.splice(i, 1);
        const all = [doc.organization, ...Object.values(doc.projects ?? {})];
        // A stage that came after it now comes after the stage it came after.
        for (const sc of all) for (const x of sc.added_stages ?? []) if (x.after === gone.id) x.after = gone.after;
        for (const sc of all) if (sc.used) delete sc.used[gone.id];
        dropUnusedRoles(doc);
        return both(doc, project);
      }) };
    }
    return { status: 405, body: { error: "Not allowed." } };
  }

  const NO_BUILDS = "There are no builds here: the console is keeping your lifecycle in a file.";
  const json = (status, body) => ({ status, type: "application/json", body });
  const guard = async (fn) => {
    try { const r = await fn(); return json(r.status, r.body); } catch (e) {
      if (e instanceof Refused) return json(e.status, { error: e.message });
      throw e;
    }
  };

  return {
    kind: "file", label: basename(file), file, readOnly: false, canTry: false, keyFrom: null,
    /** Reads the file, making it when it is missing. Resolves to the problem in words, or null. */
    async check() { try { await load(); return null; } catch (e) { if (e instanceof Refused) return e.message; throw e; } },
    // The lifecycle routes, as a service answers them.
    async handle(method, path, query, body) {
      const parts = path.replace(/^\/v1\/lifecycle\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      const project = (query.get("project") ?? "").trim() || null;
      if (parts[0] === "stages" && parts.length <= 2) return guard(() => stages(method, parts[1] ?? null, project, body));
      if (parts[0] === "roles" && parts.length <= 2) return guard(() => roles(method, parts[1] ?? null, project, body));
      if (parts[0] === "builds" && parts.length === 1 && method === "GET") return json(200, { builds: [] });
      if (parts[0] === "builds") return json(parts.length === 1 ? 409 : 404, { error: NO_BUILDS });
      return json(404, { error: "Nothing here." });
    },
    // The organization's own stages: POST adds one, PUT changes one, DELETE removes one. Each answers { stages, roles }.
    async handleAdded(method, id, query, body) {
      return guard(() => added(method, id, (query.get("project") ?? "").trim() || null, body));
    },
  };
}
