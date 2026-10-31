// The GitHub source, against recorded GitHub answers. No test calls GitHub:
// a request for anything not recorded fails the test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createGitHubSource, parseTarget } from "../lib/github.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { checkBuildList, checkBuild, checkTries } from "../lib/contract.mjs";
import { hit, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STAGES = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = STAGES.stages.map((s) => s.id);
const RECORDED = JSON.parse(await readFile(join(HERE, "fixtures", "github", "agentmesh-community.json"), "utf8")).answers;
const SHA = "706bc033e118680551a91a898e6c0e0937cd11de";

function replay(answers, seen = []) {
  return async (url, init = {}) => {
    seen.push({ url, headers: init.headers ?? {} });
    const a = answers[url];
    if (!a) throw new Error(`not recorded: ${url}`);
    return new Response(a.status === 304 ? null : a.body, { status: a.status, headers: Object.fromEntries(Object.entries(a.headers ?? {}).filter(([, v]) => v !== undefined)) });
  };
}
const q = (o = {}) => new URLSearchParams(o);
const get = (src, path, query) => src.handle("GET", `/v1/lifecycle${path}`, q(query), {});

function community(seen, change = (a) => a, token = null) {
  return createGitHubSource({ target: "AgentMesh-Community", token, fetchImpl: replay(change(structuredClone(RECORDED)), seen) });
}

test("a target is an org or user, or owner/repo", () => {
  assert.deepEqual(parseTarget("AgentMesh-Community"), { owner: "AgentMesh-Community", repo: null });
  assert.deepEqual(parseTarget("AgentMesh-Community/spec-writer"), { owner: "AgentMesh-Community", repo: "spec-writer" });
  assert.deepEqual(parseTarget("https://github.com/acme/thing/"), { owner: "acme", repo: "thing" });
  assert.throws(() => parseTarget("not a name!"));
  assert.throws(() => parseTarget("a/b/c"));
});

test("the builds are the org's agent repositories, newest first", async () => {
  const src = community();
  const r = await get(src, "/builds");
  assert.equal(r.status, 200);
  assert.deepEqual(checkBuildList(r.body), []);
  assert.deepEqual(r.body.builds.map((b) => b.name).sort(), ["spec-writer", "yt-dlp"]);
  const sw = r.body.builds.find((b) => b.name === "spec-writer");
  assert.match(sw.does, /^Turns what somebody wants an agent to do into a spec\.json/);
  assert.equal(sw.version, "0.2.3");
  assert.deepEqual(sw.at, { stage: "publish", state: "done" });
  assert.equal(sw.updated, "2026-09-26T19:04:00Z");
  assert.ok(r.body.builds[0].updated >= r.body.builds[1].updated);
});

test("an agent repository reads as a build in the contract's shape", async () => {
  const src = community();
  const r = await get(src, "/builds/spec-writer");
  assert.equal(r.status, 200);
  assert.deepEqual(checkBuild(r.body, IDS), []);
  const b = r.body.build;
  const st = (id) => b.stages.find((s) => s.stage === id);
  assert.equal(b.handle, "AgentMesh-Community/spec-writer");
  assert.deepEqual(b.actions, []);

  const req = st("requirements");
  assert.equal(req.state, "done");
  assert.equal(req.runs, 1);
  assert.deepEqual(req.rounds, []);
  const reqFiles = req.handed_back.files.map((f) => f.path);
  assert.deepEqual(reqFiles.slice(0, 2), ["package/descriptor.json", "package/plugin.json"]);
  assert.equal(reqFiles.filter((p) => p.endsWith("/SKILL.md")).length, 5);
  assert.ok(reqFiles.includes("spec.json"), "the older spec.json is shown too");
  assert.match(req.handed_back.words[1], /^5 skills: /);
  assert.ok(req.handed_back.files.every((f) => f.link.includes(`/blob/${SHA}/`)));

  assert.equal(st("test").state, "done");
  assert.equal(st("test").handed_back.files.length, 5);
  const code = st("code");
  assert.equal(code.state, "done");
  assert.ok(code.handed_back.files.length > 10);
  assert.ok(code.handed_back.files.every((f) => f.path.includes("/scripts/")));
  assert.equal(st("docs").handed_back.files[0].path, "agentdoc.json");

  const pub = st("publish");
  assert.equal(pub.state, "done");
  assert.equal(pub.holder.name, "the repository");
  assert.deepEqual(pub.handed_back.words, ["https://github.com/AgentMesh-Community/spec-writer"]);
  assert.equal(st("release").state, "not_started");
  assert.match(st("release").log[0].said, /no releases or tags/);

  const shown = new Set(["requirements", "test", "code", "docs", "publish", "release"]);
  for (const s of b.stages) if (!shown.has(s.stage)) assert.equal(s.state, "not_offered", s.stage);
  assert.ok(b.stages.every((s) => s.where === null), "nothing to try, no pull request block");
});

test("a repository with no tests says so at Test", async () => {
  const src = community([], (a) => {
    const url = `https://api.github.com/repos/AgentMesh-Community/spec-writer/git/trees/${SHA}?recursive=1`;
    const tree = JSON.parse(a[url].body);
    tree.tree = tree.tree.filter((x) => !x.path.startsWith("test"));
    a[url].body = JSON.stringify(tree);
    return a;
  });
  const b = (await get(src, "/builds/spec-writer")).body.build;
  const t = b.stages.find((s) => s.stage === "test");
  assert.equal(t.state, "not_started");
  assert.equal(t.log[0].said, "The repository holds no tests.");
  assert.deepEqual(checkBuild({ build: b }, IDS), []);
});

test("files open from GitHub at the commit shown, and only files in it", async () => {
  const seen = [];
  const src = community(seen);
  const r = await get(src, "/builds/spec-writer/files", { path: "package/skills/write-a-spec/scripts/draft.mjs" });
  assert.equal(r.status, 200);
  assert.match(r.body.toString("utf8"), /draft/);
  assert.ok(seen.some((s) => s.url === `https://raw.githubusercontent.com/AgentMesh-Community/spec-writer/${SHA}/package/skills/write-a-spec/scripts/draft.mjs`));
  for (const path of ["../../secrets", "package/nothing.json", ""]) {
    assert.equal((await get(src, "/builds/spec-writer/files", { path })).status, 404, path);
  }
});

test("nothing can be changed or tried through GitHub", async () => {
  const src = community();
  assert.equal(src.readOnly, true);
  assert.equal(src.canTry, false);
  for (const path of ["/builds", "/builds/spec-writer/actions/accept", "/builds/spec-writer/try", "/builds/spec-writer/tries/t1/keep"]) {
    const r = await src.handle("POST", `/v1/lifecycle${path}`, q(), {});
    assert.equal(r.status, 405, path);
    assert.match(r.body.error, /read-only/);
  }
  const tries = await get(src, "/builds/spec-writer/tries");
  assert.deepEqual(checkTries(tries.body), []);
  assert.deepEqual(tries.body.tries, []);
});

test("an exhausted rate limit is said plainly", async () => {
  const limited = (a) => {
    a["https://api.github.com/orgs/AgentMesh-Community/repos?per_page=100&type=public"] = {
      status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793438702", "content-type": "application/json" },
      body: JSON.stringify({ message: "API rate limit exceeded" }),
    };
    return a;
  };
  const anon = await get(community([], limited), "/builds");
  assert.equal(anon.status, 429);
  assert.match(anon.body.error, /^GitHub's limit for reading without a token is used up until .+\. Start the console with a GitHub token/);
  const withToken = await get(community([], limited, "ghp_testtoken123456"), "/builds");
  assert.match(withToken.body.error, /with your token/);
});

test("a token goes only to GitHub, and the page never sees it", async () => {
  const seen = [];
  const TOKEN = "ghp_testtoken123456";
  const src = community(seen, (a) => a, TOKEN);
  const dir = await tempDir("gh");
  const keys = createKeyStore({ service: "https://api.example", env: {}, dir });
  const app = createConsoleServer({ service: "https://api.example", keys, stages: STAGES, source: src });
  const url = await app.listen(0);
  const host = new URL(url).host;
  try {
    const st = await hit(url, { path: "/local/status", headers: { host } });
    assert.equal(st.json.service, "AgentMesh-Community on GitHub");
    assert.equal(st.json.source, "github");
    assert.equal(st.json.read_only, true);
    assert.equal(st.json.can_try, false);
    assert.equal(st.json.key_from, "github token");
    assert.ok(!st.text.includes(TOKEN));
    const list = await hit(url, { path: "/api/v1/lifecycle/builds", headers: { host } });
    assert.equal(list.status, 200);
    assert.ok(!list.text.includes(TOKEN));
    const file = await hit(url, { path: "/api/v1/lifecycle/builds/spec-writer/files?path=package%2Fplugin.json", headers: { host } });
    assert.equal(file.status, 200);
    assert.match(file.headers["content-type"], /^text\/plain/);
    assert.ok(seen.length > 0);
    for (const s of seen) {
      assert.match(s.url, /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//);
      assert.equal(s.headers.authorization, `Bearer ${TOKEN}`);
    }
    const post = await hit(url, { method: "POST", path: "/api/v1/lifecycle/builds", headers: { host }, body: { does: "x" } });
    assert.equal(post.status, 405);
  } finally { await app.close(); }
});

// A hand-made repository in GitHub's answer shapes: an older layout with no
// agent-repo.json, two merged pull requests and one closed without merging,
// and a release.
function exampleRepo() {
  const A = "https://api.github.com/repos/acme/example-agent";
  const sha = "1111111111111111111111111111111111111111";
  const raw = (p) => `https://raw.githubusercontent.com/acme/example-agent/${sha}/${p}`;
  const rawMain = (p) => `https://raw.githubusercontent.com/acme/example-agent/main/${p}`;
  const j = (body, status = 200) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = (body, status = 200) => ({ status, headers: { "content-type": "text/plain" }, body });
  const descriptor = JSON.stringify({ format: "agent-descriptor-v1", agent_version: "1.2.0", does: "Says hello back." });
  const blobs = ["package/descriptor.json", "package/plugin.json", "package/skills/greet/SKILL.md", "package/skills/greet/scripts/greet.mjs", "test/greet.test.mjs", "README.md"];
  return {
    [A]: j({ name: "example-agent", full_name: "acme/example-agent", html_url: "https://github.com/acme/example-agent", description: "hello", fork: false, default_branch: "main", pushed_at: "2026-10-20T10:00:00Z" }),
    [`${A}/commits/main`]: j({ sha, commit: { message: "Greet in French too\n\nlonger body", author: { name: "Ada", date: "2026-10-20T10:00:00Z" }, committer: { name: "Ada", date: "2026-10-20T10:00:00Z" } } }),
    [rawMain("agent-repo.json")]: t("404: Not Found", 404),
    [rawMain("package/descriptor.json")]: t(descriptor),
    [raw("agent-repo.json")]: t("404: Not Found", 404),
    [raw("package/descriptor.json")]: t(descriptor),
    [raw("package/plugin.json")]: t(JSON.stringify({ name: "example-agent", version: "1.2.0" })),
    [`${A}/git/trees/${sha}?recursive=1`]: j({ sha, truncated: false, tree: blobs.map((path) => ({ path, type: "blob", size: 100 })) }),
    [`${A}/pulls?state=closed&sort=updated&direction=desc&per_page=30`]: j([
      { number: 3, title: "Greet in French too", merged_at: "2026-10-20T10:00:00Z", merge_commit_sha: "c3" },
      { number: 2, title: "Abandoned idea", merged_at: null, merge_commit_sha: "c2" },
      { number: 1, title: "First greeting", merged_at: "2026-10-10T10:00:00Z", merge_commit_sha: "c1" },
    ]),
    [`${A}/pulls/3/files?per_page=100`]: j([{ filename: "package/skills/greet/scripts/greet.mjs" }, { filename: "test/greet.test.mjs" }]),
    [`${A}/pulls/1/files?per_page=100`]: j([{ filename: "package/skills/greet/scripts/greet.mjs" }, { filename: "package/descriptor.json" }]),
    [`${A}/commits/c3/check-runs?per_page=100`]: j({ check_runs: [{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "success" }] }),
    [`${A}/commits/c1/check-runs?per_page=100`]: j({ check_runs: [{ status: "completed", conclusion: "failure" }, { status: "completed", conclusion: "success" }] }),
    [`${A}/releases?per_page=20`]: j([{ tag_name: "v1.2.0", name: "1.2.0", draft: false, published_at: "2026-10-21T09:00:00Z", body: "French greetings.\nMore." }]),
  };
}

test("merged pull requests are a stage's rounds, newest first, with their checks", async () => {
  const src = createGitHubSource({ target: "acme/example-agent", fetchImpl: replay(exampleRepo()) });
  const list = await get(src, "/builds");
  assert.deepEqual(list.body.builds.map((b) => b.name), ["example-agent"]);
  assert.equal(list.body.builds[0].does, "Says hello back.");
  const r = await get(src, "/builds/example-agent");
  assert.equal(r.status, 200);
  assert.deepEqual(checkBuild(r.body, IDS), []);
  const st = (id) => r.body.build.stages.find((s) => s.stage === id);

  const code = st("code");
  assert.equal(code.runs, 2);
  assert.deepEqual(code.rounds.map((x) => x.label), ["Pull request #3", "Pull request #1"]);
  assert.deepEqual(code.rounds.map((x) => x.n), [2, 1]);
  assert.equal(code.rounds[0].verdict, "Merged, all 2 checks passed");
  assert.equal(code.rounds[0].back, false);
  assert.equal(code.rounds[1].verdict, "Merged with 1 of 2 checks failing");
  assert.equal(code.rounds[1].back, true);
  assert.equal(code.rounds[0].words, "Greet in French too");

  assert.deepEqual(st("test").rounds.map((x) => x.label), ["Pull request #3"]);
  assert.deepEqual(st("requirements").rounds.map((x) => x.label), ["Pull request #1"]);
  assert.equal(st("requirements").given, "The repository does not record what was asked.");
  assert.equal(st("docs").state, "not_started");

  const rel = st("release");
  assert.equal(rel.state, "done");
  assert.deepEqual(rel.handed_back.words, ["1.2.0 (v1.2.0)"]);
  assert.equal(rel.rounds[0].words, "French greetings.");
  assert.equal(r.body.build.log[0].said, "1.2.0 was released.");
});
