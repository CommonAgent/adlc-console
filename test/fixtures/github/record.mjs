// Records the GitHub answers the tests replay. Maintainers run it by hand;
// the tests never call GitHub.
//
//   node test/fixtures/github/record.mjs
//
// It reads AgentMesh-Community without a token (about 8 API reads), then
// keeps only the answers about the repositories named in KEEP.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createGitHubSource } from "../../../lib/github.mjs";

const ORG = "AgentMesh-Community";
const KEEP = ["spec-writer", "yt-dlp", "agentmesh-typescript"];
const OUT = fileURLToPath(new URL("./agentmesh-community.json", import.meta.url));
const HEADERS = ["content-type", "etag", "link", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];

const seen = {};
async function recording(url, init) {
  const res = await fetch(url, init);
  const body = await res.clone().text();
  const headers = {};
  for (const h of HEADERS) if (res.headers.get(h)) headers[h] = res.headers.get(h);
  seen[url] = { status: res.status, headers, body };
  return res;
}

const gh = createGitHubSource({ target: ORG, fetchImpl: recording, version: "fixtures" });
const list = await gh.handle("GET", "/v1/lifecycle/builds", new URLSearchParams());
if (list.status !== 200) throw new Error(JSON.stringify(list.body));
const build = await gh.handle("GET", "/v1/lifecycle/builds/spec-writer", new URLSearchParams());
if (build.status !== 200) throw new Error(JSON.stringify(build.body));
for (const path of ["package/descriptor.json", "package/skills/write-a-spec/SKILL.md", "package/skills/write-a-spec/scripts/draft.mjs"]) {
  await gh.handle("GET", "/v1/lifecycle/builds/spec-writer/files", new URLSearchParams({ path }));
}

const kept = {};
for (const [url, rec] of Object.entries(seen)) {
  const repo = /(?:repos|raw\.githubusercontent\.com)\/[^/]+\/([^/]+)/.exec(url)?.[1];
  if (url.includes(`/orgs/${ORG}/repos`)) {
    const repos = JSON.parse(rec.body).filter((r) => KEEP.includes(r.name))
      .map(({ name, full_name, html_url, description, fork, archived, private: p, default_branch, pushed_at, updated_at }) =>
        ({ name, full_name, html_url, description, fork, archived, private: p, default_branch, pushed_at, updated_at }));
    kept[url] = { ...rec, headers: { ...rec.headers, link: undefined }, body: JSON.stringify(repos) };
  } else if (//commits/[^/?]+$/.test(url) && rec.status === 200) {
    // A commit answer carries every file's diff; keep what the source reads.
    const c = JSON.parse(rec.body);
    kept[url] = { ...rec, body: JSON.stringify({ sha: c.sha, html_url: c.html_url, author: c.author && { login: c.author.login }, commit: { message: c.commit.message, author: c.commit.author, committer: c.commit.committer } }) };
  } else if (KEEP.includes(repo)) kept[url] = rec;
}
await writeFile(OUT, JSON.stringify({ recorded: new Date().toISOString(), org: ORG, answers: kept }, null, 1) + "\n");
console.log(`kept ${Object.keys(kept).length} of ${Object.keys(seen).length} answers in ${OUT}`);
