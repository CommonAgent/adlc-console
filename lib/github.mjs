// A read-only source: agent repositories on GitHub, read into the same
// lifecycle answers a service gives (docs/contract.md), so the page draws
// them unchanged.
//
//   --github <org>          every agent repository in the org (or user)
//   --github <owner/repo>   one repository
//
// A repository is an agent when it has agent-repo.json (format
// "agent-repository-v1": { package, agentdoc, tests, source }). Older ones
// without it count when they hold <package>/descriptor.json or spec.json.
//
// What the repository shows becomes stages: Requirements (descriptor, plugin,
// skills, spec), Test (the tests folder), Code (the scripts), Docs
// (agentdoc.json), Publish (the repository itself), Release (releases or
// tags). Every other stage is not offered. Merged pull requests that touched
// a stage's files are its rounds. Nothing can be changed from here.
//
// The optional token is held here, in the local server, and sent only to
// api.github.com and raw.githubusercontent.com.

import { STAGE_IDS, blankStage } from "./fixture.mjs";

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const TTL = 5 * 60_000;
const FILE_LIMIT = 2 * 1024 * 1024;
const MAX_PRS = 10;
const DEFAULT_LAYOUT = { package: "package", agentdoc: "agentdoc.json", tests: "test", source: "spec.json" };

export class GitHubProblem extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function parseTarget(t) {
  const s = String(t ?? "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:\/([A-Za-z0-9._-]{1,100}))?$/.exec(s);
  if (!m) throw new Error(`"${t}" is not a GitHub org, user, or owner/repo.`);
  return { owner: m[1], repo: m[2] ?? null };
}

const clock = (epochSeconds) => new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  }));
  return out;
}

export function createGitHubSource({ target, token = null, fetchImpl = fetch, version = "0.0.0" } = {}) {
  const { owner, repo: onlyRepo } = parseTarget(target);
  const cache = new Map(); // url -> { at, etag, body }
  const label = `${onlyRepo ? `${owner}/${onlyRepo}` : owner} on GitHub`;

  function limitProblem(res) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const until = Number.isFinite(reset) && reset > 0 ? ` until ${clock(reset)}` : " for now";
    return new GitHubProblem(token
      ? `GitHub's limit for reading with your token is used up${until}. Try again then.`
      : `GitHub's limit for reading without a token is used up${until}. Start the console with a GitHub token (GITHUB_TOKEN or --github-token-file) to read more.`, 429);
  }

  // GET from the GitHub API. Returns the parsed body, or null on 404.
  async function api(path) {
    const url = `${API}${path}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL) return hit.body;
    const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": `adlc-console/${version}` };
    if (token) headers.authorization = `Bearer ${token}`;
    if (hit?.etag) headers["if-none-match"] = hit.etag;
    let res;
    try { res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) }); } catch {
      throw new GitHubProblem("GitHub did not answer.");
    }
    if (res.status === 304 && hit) { hit.at = Date.now(); return hit.body; }
    if ((res.status === 403 || res.status === 429) && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.get("retry-after"))) throw limitProblem(res);
    if (res.status === 404) { cache.set(url, { at: Date.now(), body: null }); return null; }
    if (res.status === 401) throw new GitHubProblem("GitHub turned down the token.", 502);
    if (!res.ok) throw new GitHubProblem(`GitHub answered with an error (${res.status}).`);
    const body = await res.json();
    const link = res.headers.get("link") || "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link)?.[1];
    if (Array.isArray(body) && next && next.startsWith(API)) {
      body.push(...((await api(next.slice(API.length))) ?? []));
    }
    cache.set(url, { at: Date.now(), etag: res.headers.get("etag"), body });
    return body;
  }

  // A file's bytes from raw.githubusercontent.com, or null when missing.
  // At a commit the bytes never change, so they are kept.
  async function raw(repo, ref, path) {
    const url = `${RAW}/${owner}/${repo}/${ref}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const hit = cache.get(url);
    if (hit && (/^[0-9a-f]{40}$/.test(ref) || Date.now() - hit.at < TTL)) return hit.body;
    const headers = { "user-agent": `adlc-console/${version}` };
    if (token) headers.authorization = `Bearer ${token}`;
    let res;
    try { res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) }); } catch {
      throw new GitHubProblem("GitHub did not answer.");
    }
    if (res.status === 429) throw limitProblem(res);
    if (res.status === 404) { cache.set(url, { at: Date.now(), body: null }); return null; }
    if (!res.ok) throw new GitHubProblem(`GitHub answered with an error (${res.status}).`);
    const body = Buffer.from(await res.arrayBuffer());
    cache.set(url, { at: Date.now(), body });
    return body;
  }

  async function rawJson(repo, ref, path) {
    const b = await raw(repo, ref, path);
    if (!b) return null;
    try { return JSON.parse(b.toString("utf8")); } catch { return null; }
  }

  async function repos() {
    if (onlyRepo) {
      const r = await api(`/repos/${owner}/${onlyRepo}`);
      if (!r) throw new GitHubProblem(`There is no repository ${owner}/${onlyRepo} that can be read.`, 404);
      return [r];
    }
    let list = await api(`/orgs/${owner}/repos?per_page=100&type=public`);
    if (list === null) list = await api(`/users/${owner}/repos?per_page=100`);
    if (list === null) throw new GitHubProblem(`There is no GitHub org or user named ${owner}.`, 404);
    return list;
  }

  // The repository's layout, or null when it is not an agent.
  async function layoutOf(r, ref) {
    const declared = await rawJson(r.name, ref, "agent-repo.json");
    if (declared && typeof declared === "object") {
      const pick = (k) => (typeof declared[k] === "string" && declared[k] ? declared[k].replace(/^\.\/|\/+$/g, "") : DEFAULT_LAYOUT[k]);
      return { declared: true, package: pick("package"), agentdoc: pick("agentdoc"), tests: pick("tests"), source: pick("source") };
    }
    if (await raw(r.name, ref, `${DEFAULT_LAYOUT.package}/descriptor.json`)) return { declared: false, ...DEFAULT_LAYOUT };
    if (await raw(r.name, ref, DEFAULT_LAYOUT.source)) return { declared: false, ...DEFAULT_LAYOUT };
    return null;
  }

  async function about(r, ref, layout) {
    const descriptor = await rawJson(r.name, ref, `${layout.package}/descriptor.json`);
    const plugin = descriptor ? null : await rawJson(r.name, ref, `${layout.package}/plugin.json`);
    const spec = descriptor || plugin ? null : await rawJson(r.name, ref, layout.source);
    return {
      does: descriptor?.does ?? plugin?.description ?? spec?.does ?? spec?.description ?? r.description ?? "",
      version: descriptor?.agent_version ?? descriptor?.version ?? plugin?.version ?? spec?.version ?? "",
    };
  }

  async function list() {
    const all = (await repos()).filter((r) => !r.fork || onlyRepo);
    const found = await mapLimit(all, 8, async (r) => {
      const layout = await layoutOf(r, r.default_branch);
      if (!layout) return null;
      const a = await about(r, r.default_branch, layout);
      return {
        id: r.name, name: r.name, does: a.does, version: String(a.version),
        at: { stage: "publish", state: "done" },
        updated: r.pushed_at ?? r.updated_at,
      };
    });
    return found.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async function repoNamed(id) {
    if (onlyRepo) return id === onlyRepo ? (await repos())[0] : null;
    return (await repos()).find((r) => r.name === id) ?? null;
  }

  // Everything one build page needs, read once and kept for a few minutes.
  async function read(id) {
    const r = await repoNamed(id);
    if (!r) throw new GitHubProblem("There is no agent repository with that name.", 404);
    const head = await api(`/repos/${owner}/${r.name}/commits/${encodeURIComponent(r.default_branch)}`);
    if (!head) throw new GitHubProblem("That repository has no commits yet.", 404);
    const sha = head.sha;
    const layout = await layoutOf(r, sha);
    if (!layout) throw new GitHubProblem("That repository is not an agent repository.", 404);
    const tree = await api(`/repos/${owner}/${r.name}/git/trees/${sha}?recursive=1`);
    const blobs = new Map((tree?.tree ?? []).filter((x) => x.type === "blob").map((x) => [x.path, x.size ?? 0]));
    const closed = (await api(`/repos/${owner}/${r.name}/pulls?state=closed&sort=updated&direction=desc&per_page=30`)) ?? [];
    const merged = closed.filter((p) => p.merged_at).sort((a, b) => b.merged_at.localeCompare(a.merged_at)).slice(0, MAX_PRS);
    const prs = await mapLimit(merged, 4, async (p) => {
      const files = (await api(`/repos/${owner}/${r.name}/pulls/${p.number}/files?per_page=100`)) ?? [];
      const runs = (await api(`/repos/${owner}/${r.name}/commits/${p.merge_commit_sha || p.head?.sha}/check-runs?per_page=100`))?.check_runs ?? [];
      return { p, files: files.map((f) => f.filename), runs };
    });
    let releases = ((await api(`/repos/${owner}/${r.name}/releases?per_page=20`)) ?? []).filter((x) => !x.draft)
      .map((x) => ({ tag: x.tag_name, name: x.name || x.tag_name, at: x.published_at ?? x.created_at, words: (x.body || "").split("\n")[0].trim(), url: x.html_url }));
    if (!releases.length) {
      const tags = (await api(`/repos/${owner}/${r.name}/tags?per_page=20`)) ?? [];
      releases = tags.map((t) => ({ tag: t.name, name: t.name, at: null, words: "", url: `${r.html_url}/releases/tag/${encodeURIComponent(t.name)}` }));
    }
    const descriptor = await rawJson(r.name, sha, `${layout.package}/descriptor.json`);
    const plugin = await rawJson(r.name, sha, `${layout.package}/plugin.json`);
    const agentdoc = blobs.has(layout.agentdoc) ? await rawJson(r.name, sha, layout.agentdoc) : null;
    return { r, head, sha, layout, blobs, prs, releases, descriptor, plugin, agentdoc };
  }

  function buildFrom(x) {
    const { r, head, sha, layout, blobs, prs, releases, descriptor, plugin } = x;
    const short = sha.slice(0, 7);
    const commitAt = head.commit?.committer?.date ?? head.commit?.author?.date ?? r.pushed_at;
    const author = head.commit?.author?.name || head.author?.login || "the person who committed it";
    const message = (head.commit?.message ?? "").split("\n")[0].trim();
    const paths = [...blobs.keys()];
    const fileOf = (p) => ({ path: p, size: blobs.get(p) ?? 0, link: `${r.html_url}/blob/${sha}/${p.split("/").map(encodeURIComponent).join("/")}` });
    const under = (dir) => paths.filter((p) => p.startsWith(`${dir}/`)).sort();
    const committed = { at: commitAt, said: `Committed as ${short}${message ? `: ${message}` : "."}` };
    const committer = { kind: "person", name: `${author}, who committed it` };

    // A stage's rounds: each merged pull request that touched its files.
    function rounds(touches) {
      const mine = prs.filter(({ files }) => files.some(touches));
      return mine.map(({ p, runs }, i) => {
        const done = runs.filter((c) => c.status === "completed");
        const failed = done.filter((c) => ["failure", "timed_out", "cancelled", "action_required"].includes(c.conclusion));
        const verdict = !runs.length ? "Merged, with no checks"
          : failed.length ? `Merged with ${failed.length} of ${runs.length} checks failing`
            : done.length < runs.length ? "Merged before its checks finished"
              : `Merged, all ${runs.length} checks passed`;
        return { n: mine.length - i, at: p.merged_at, label: `Pull request #${p.number}`, verdict, back: failed.length > 0, words: p.title ?? "" };
      });
    }
    function stage(id, fields, touches) {
      const rs = touches ? rounds(touches) : [];
      const log = [...rs.map((rd) => ({ at: rd.at, said: `${rd.label} was merged: ${rd.words}` })), committed];
      return { ...blankStage(id, "done"), holder: committer, runs: Math.max(1, rs.length), rounds: rs, log, ...fields };
    }

    const S = {};
    const pkg = layout.package;

    // Requirements: the descriptor, the plugin, each skill's SKILL.md, and the spec.
    const skills = paths.filter((p) => p.startsWith(`${pkg}/skills/`) && p.endsWith("/SKILL.md")).sort();
    const reqFiles = [`${pkg}/descriptor.json`, `${pkg}/plugin.json`, ...skills, layout.source].filter((p) => blobs.has(p));
    const isReq = (f) => reqFiles.includes(f) || (f.startsWith(`${pkg}/skills/`) && f.endsWith("/SKILL.md"));
    if (reqFiles.length) {
      const skillNames = skills.map((p) => p.split("/").at(-2));
      const does = descriptor?.does ?? plugin?.description;
      S.requirements = stage("requirements", {
        given: blobs.has(layout.source) ? `The spec in ${layout.source}.` : "The repository does not record what was asked.",
        handed_back: {
          words: [
            does ? `The statement of the job: ${does}` : "The statement of the job.",
            skillNames.length ? `${skillNames.length} ${skillNames.length === 1 ? "skill" : "skills"}: ${skillNames.join(", ")}.` : "No skills.",
          ],
          files: reqFiles.map(fileOf),
        },
      }, isReq);
    } else {
      S.requirements = { ...blankStage("requirements", "not_started"), log: [{ at: commitAt, said: "The repository holds no descriptor or spec." }] };
    }

    // Test: the tests folder.
    const tests = under(layout.tests);
    S.test = tests.length
      ? stage("test", {
        given: "The statement of the job in the package.",
        handed_back: { words: [`${tests.length} test ${tests.length === 1 ? "file" : "files"} in ${layout.tests}/.`], files: tests.map(fileOf) },
      }, (f) => f.startsWith(`${layout.tests}/`))
      : { ...blankStage("test", "not_started"), log: [{ at: commitAt, said: "The repository holds no tests." }] };

    // Code: the scripts.
    const isScript = (f) => /(^|\/)scripts\//.test(f) && !f.startsWith(`${layout.tests}/`);
    const scripts = paths.filter(isScript).sort();
    S.code = scripts.length
      ? stage("code", {
        given: tests.length ? "The statement of the job and the tests in the repository." : "The statement of the job in the package.",
        handed_back: { words: [`${scripts.length} ${scripts.length === 1 ? "script" : "scripts"}.`], files: scripts.map(fileOf) },
      }, isScript)
      : { ...blankStage("code", "not_started"), log: [{ at: commitAt, said: "The repository holds no scripts." }] };

    // Docs: agentdoc.json.
    S.docs = blobs.has(layout.agentdoc)
      ? stage("docs", {
        given: "The package: its descriptor, plugin and skills.",
        handed_back: { words: [`The AgentDoc for ${x.agentdoc?.package?.name ?? r.name}${x.agentdoc?.package?.version ? ` ${x.agentdoc.package.version}` : ""}.`], files: [fileOf(layout.agentdoc)] },
      }, (f) => f === layout.agentdoc)
      : { ...blankStage("docs", "not_started"), log: [{ at: commitAt, said: "The repository holds no AgentDoc." }] };

    // Publish: the repository itself.
    const theRepo = { kind: "reference_agent", name: "the repository" };
    S.publish = {
      ...blankStage("publish", "done"), holder: theRepo, runs: 1, done_when_met: true,
      given: `The package at commit ${short}.`,
      handed_back: { words: [r.html_url], files: [] },
      log: [{ at: commitAt, said: `Published at ${r.html_url}.` }],
    };

    // Release: releases, or tags when there are none.
    S.release = releases.length
      ? {
        ...blankStage("release", "done"), holder: theRepo, runs: releases.length,
        rounds: releases.filter((x) => x.at).map((x, i, all) => ({ n: all.length - i, at: x.at, label: x.tag, verdict: "Released", back: false, words: x.words || x.name })),
        given: "The package at the tagged commit.",
        handed_back: { words: releases.map((x) => `${x.name}${x.name !== x.tag ? ` (${x.tag})` : ""}`), files: [] },
        log: releases.filter((x) => x.at).map((x) => ({ at: x.at, said: `${x.name} was released.` })),
      }
      : { ...blankStage("release", "not_started"), holder: theRepo, log: [{ at: commitAt, said: "The repository has no releases or tags yet." }] };

    const stages = STAGE_IDS.map((s) => S[s] ?? blankStage(s));
    const log = stages.flatMap((s) => s.log)
      .filter((e, i, all) => all.findIndex((o) => o.at === e.at && o.said === e.said) === i)
      .sort((a, b) => b.at.localeCompare(a.at));
    return {
      id: r.name, name: r.name,
      does: descriptor?.does ?? plugin?.description ?? r.description ?? "",
      version: String(descriptor?.agent_version ?? descriptor?.version ?? plugin?.version ?? ""),
      handle: r.full_name ?? `${owner}/${r.name}`,
      stages, actions: [], log,
    };
  }

  const json = (status, body) => ({ status, type: "application/json", body });
  const nope = (status, error) => json(status, { error });

  async function handle(method, path, query) {
    const parts = path.replace(/^\/v1\/lifecycle\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== "builds") return nope(404, "Nothing here.");
    if (method !== "GET") return nope(405, `${label} is read-only: nothing can be started or changed from here.`);
    try {
      if (parts.length === 1) return json(200, { builds: await list() });
      const id = parts[1];
      const rest = parts.slice(2);
      if (rest.length === 0) return json(200, { build: buildFrom(await read(id)) });
      if (rest[0] === "tries" && rest.length === 1) return json(200, { tries: [] });
      if (rest[0] === "files" && rest.length === 1) {
        const x = await read(id);
        const p = query.get("path") ?? "";
        if (!x.blobs.has(p)) return nope(404, "There is no file at that path.");
        if (x.blobs.get(p) > FILE_LIMIT) return nope(413, "That file is too big to show here. Open it on GitHub.");
        const bytes = await raw(x.r.name, x.sha, p);
        if (!bytes) return nope(404, "There is no file at that path.");
        return { status: 200, type: "text/plain; charset=utf-8", body: bytes };
      }
      return nope(404, "Nothing here.");
    } catch (e) {
      if (e instanceof GitHubProblem) return nope(e.status, e.message);
      throw e;
    }
  }

  return { kind: "github", label, readOnly: true, canTry: false, keyFrom: token ? "github token" : null, handle };
}
