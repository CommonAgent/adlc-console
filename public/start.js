// New build: what a person brings (stages.json 1.4.0 starting_points). From an
// idea, they say what the agent should do; from existing code (lifecycle API
// 0.4.6), they name the codebase (a repository and commit, or a local folder
// for a service on this computer) and what the product is called, and the
// build enters at Reverse engineering; from an as-built record (lifecycle API
// 0.4.7), they name the record of code kept elsewhere (a folder of its files,
// or a repository, commit and path) and what the product is called, and the
// build enters at Requirements and writes the code fresh, taking nothing on.

import { esc } from "./roles.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");

/** The starting points the form offers, in order. */
export const STARTS = [
  { id: "idea", label: "Start from an idea" },
  { id: "existing-code", label: "Start from existing code" },
  { id: "as-built-record", label: "Start from an as-built record" },
];

/** The New build form. kept: what the person wrote so far. from: idea, existing-code or as-built-record. pending: a start is being sent. */
export function newBuildHtml(kept = {}, { from = "idea", pending = false, error = "" } = {}) {
  const k = (n) => esc(kept[n] ?? "");
  const tabs = `<div class="tabs startfrom" role="tablist" aria-label="What you bring">${STARTS.map((s) => `<button type="button" role="tab" class="tab${s.id === from ? " on" : ""}" aria-selected="${s.id === from}" data-start-from="${esc(s.id)}">${esc(s.label)}</button>`).join("")}</div>`;
  const project = `<label for="n-project">Project <span>Optional. The build follows the lifecycle chosen for this project.</span><input type="text" id="n-project" value="${k("project")}" autocomplete="off" spellcheck="false"></label>`;
  const submit = `<div class="acts tight"><button class="btn p" type="submit"${pending ? " disabled" : ""}>${pending ? "Starting…" : "Start the build"}</button><a class="btn" href="#/">Cancel</a></div>`;
  if (from === "as-built-record") {
    return `<div class="err" role="alert">${esc(error)}</div>
    <h1>New build</h1><p class="does">Bring the as-built record of code kept elsewhere, to build it again without taking that code on: a rewrite, a port, or a clean-room rebuild. The build starts at Requirements, where you decide what in the record to keep, and the code is written fresh.</p>
    ${tabs}
    <form class="form" id="new-form" data-from="as-built-record">
      <label for="n-name">What the product is called <span>Lowercase words joined by hyphens, such as word-counter.</span><input type="text" id="n-name" value="${k("name")}" required autocomplete="off" spellcheck="false"></label>
      <label for="n-folder">The record's folder on the service's computer <span>The folder that holds record.json and its five parts, for a service that runs on this computer.</span><input type="text" id="n-folder" value="${k("folder")}" autocomplete="off" spellcheck="false"></label>
      <label for="n-repo">Or a repository <span>A git URL, or owner/name on GitHub, that holds the record.</span><input type="text" id="n-repo" value="${k("repository")}" autocomplete="off" spellcheck="false" placeholder="https://github.com/acme/records"></label>
      <label for="n-commit">Commit <span>Optional. Without one, the service reads the newest commit.</span><input type="text" id="n-commit" value="${k("commit")}" autocomplete="off" spellcheck="false"></label>
      <label for="n-path">Path in the repository <span>Optional. The folder in the repository that holds the record, such as as-built.</span><input type="text" id="n-path" value="${k("path")}" autocomplete="off" spellcheck="false"></label>
      ${project}
      ${submit}
    </form>`;
  }
  if (from === "existing-code") {
    return `<div class="err" role="alert">${esc(error)}</div>
    <h1>New build</h1><p class="does">Name the code that already exists. The build starts at Reverse engineering, which writes down what the code does today, and you decide at Requirements what to keep.</p>
    ${tabs}
    <form class="form" id="new-form" data-from="existing-code">
      <label for="n-name">What the product is called <span>Lowercase words joined by hyphens, such as word-counter.</span><input type="text" id="n-name" value="${k("name")}" required autocomplete="off" spellcheck="false"></label>
      <label for="n-repo">Repository <span>A git URL, or owner/name on GitHub.</span><input type="text" id="n-repo" value="${k("repository")}" autocomplete="off" spellcheck="false" placeholder="https://github.com/acme/word-counter"></label>
      <label for="n-commit">Commit <span>Optional. Without one, the service reads the newest commit and records it.</span><input type="text" id="n-commit" value="${k("commit")}" autocomplete="off" spellcheck="false"></label>
      <label for="n-folder">Or a folder on the service's computer <span>For a service that runs on this computer, in place of a repository.</span><input type="text" id="n-folder" value="${k("folder")}" autocomplete="off" spellcheck="false"></label>
      ${project}
      ${submit}
    </form>`;
  }
  return `<div class="err" role="alert">${esc(error)}</div>
    <h1>New build</h1><p class="does">Say what the agent should do, in your own words. The service takes it from there, and comes back to you at the gates that are yours.</p>
    ${tabs}
    <form class="form" id="new-form" data-from="idea">
      <label for="n-does">What should it do?<textarea id="n-does" required placeholder="Say whether a sentence is a palindrome, ignoring spaces, punctuation and letter case.">${k("does")}</textarea></label>
      <label for="n-refuses">What should it refuse to do? <span>Optional</span><textarea id="n-refuses">${k("refuses")}</textarea></label>
      <label for="n-more">Anything else it should know <span>Optional</span><textarea id="n-more">${k("more")}</textarea></label>
      <label for="n-name">Its name <span>Optional. Lowercase words joined by hyphens, such as palindrome-judge.</span><input type="text" id="n-name" value="${k("name")}" autocomplete="off" spellcheck="false"></label>
      ${project}
      ${submit}
    </form>`;
}

/**
 * The start request (POST /builds) from what the form holds: { body } or { error } in words.
 * v: { does, refuses, more, name, project, repository, commit, folder, path }.
 */
export function newBuildBody(v = {}, from = "idea") {
  const project = str(v.project);
  if (from === "as-built-record") {
    const name = str(v.name);
    const repository = str(v.repository);
    const folder = str(v.folder);
    const commit = str(v.commit);
    const path = str(v.path);
    if (!name) return { error: "Say what the product is called." };
    if (!repository && !folder) return { error: "Name the record's folder on the service's computer, or a repository that holds it." };
    if (repository && folder) return { error: "Name a folder or a repository, not both." };
    if (folder && (commit || path)) return { error: "A commit and a path go with a repository, not a folder." };
    const source = repository ? { repository, ...(commit ? { commit } : {}), ...(path ? { path } : {}) } : { folder };
    return { body: { does: `Rebuild ${name} from its as-built record`, name, starting_point: "as-built-record", source, ...(project ? { project } : {}) } };
  }
  if (from === "existing-code") {
    const name = str(v.name);
    const repository = str(v.repository);
    const folder = str(v.folder);
    const commit = str(v.commit);
    if (!name) return { error: "Say what the product is called." };
    if (!repository && !folder) return { error: "Name a repository, or a folder on the service's computer." };
    if (repository && folder) return { error: "Name a repository or a folder, not both." };
    const source = repository ? { repository, ...(commit ? { commit } : {}) } : { folder, ...(commit ? { commit } : {}) };
    return { body: { does: `Adopt the existing code of ${name}`, name, starting_point: "existing-code", source, ...(project ? { project } : {}) } };
  }
  const does = str(v.does);
  if (!does) return { error: "Say what the agent should do." };
  const body = { does };
  for (const k of ["refuses", "more", "name"]) if (str(v[k])) body[k] = str(v[k]);
  if (project) body.project = project;
  return { body };
}
