// The local check: runs the hand-off's own check, `node .adlc/check.mjs`,
// in a clone on this computer, so a person sees a failure before they push.
//
// It only ever runs that one command, in the build folder it finds, and only
// when that folder holds .adlc/check.mjs. No shell is involved, and the
// service key is not passed to it.
//
// A hand-off goes to a folder of its own in its repository, agents/<name>/
// (AgentMesh technical debt 653), and a repository may hold several, an
// earlier one at its root among them. So given the build's name, the folder
// the person names may be the top of the clone, where agents/<name>/ is
// looked for first, or the build folder itself; and a check whose folder
// says it belongs to another agent (its plugin.json) is refused, never run.

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const LIMIT = 200_000; // characters of output kept
const TIMEOUT = 5 * 60_000;
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export class CheckRefused extends Error {}

const hasCheck = async (folder) => {
  try { return (await stat(join(folder, ".adlc", "check.mjs"))).isFile(); } catch { return false; }
};

/** The agent a build folder says it is for, from its plugin.json; "" when it does not say. */
const whose = async (folder) => {
  try { return String(JSON.parse(await readFile(join(folder, "plugin.json"), "utf8"))?.name ?? "").trim(); } catch { return ""; }
};

export async function folderFor(input, agent = "") {
  if (typeof input !== "string" || !input.trim()) throw new CheckRefused("Say which folder your clone is in.");
  let folder = input.trim();
  if (folder.startsWith("~")) folder = join(process.env.HOME || process.env.USERPROFILE || "", folder.slice(1));
  if (!isAbsolute(folder)) throw new CheckRefused("Give the whole path to the folder, starting from the top of the drive.");
  folder = resolve(folder);
  let s;
  try { s = await stat(folder); } catch { throw new CheckRefused("There is no folder at that path."); }
  if (!s.isDirectory()) throw new CheckRefused("That path is a file, not a folder.");
  const name = typeof agent === "string" && NAME.test(agent.trim()) ? agent.trim() : "";
  if (name && await hasCheck(join(folder, "agents", name))) return join(folder, "agents", name);
  if (!(await hasCheck(folder))) {
    throw new CheckRefused(name
      ? `That folder has no agents/${name}/.adlc/check.mjs and no .adlc/check.mjs. Point at the top of your clone of the pull request's branch.`
      : "That folder has no .adlc/check.mjs. Point at the top of your clone of the pull request's branch.");
  }
  const said = name ? await whose(folder) : "";
  if (said && said !== name) throw new CheckRefused(`That folder's check is for ${said}, not ${name}. Point at the top of your clone of ${name}'s pull request branch; its build folder is agents/${name}/.`);
  return folder;
}

export async function runCheck(input, { env = process.env, timeout = TIMEOUT, agent = "" } = {}) {
  const folder = await folderFor(input, agent);
  const childEnv = { ...env };
  delete childEnv.ADLC_KEY;
  const started = Date.now();
  return await new Promise((done) => {
    execFile(process.execPath, [join(".adlc", "check.mjs")], {
      cwd: folder, env: childEnv, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => {
      const out = `${stdout ?? ""}${stderr ? (stdout ? "\n" : "") + stderr : ""}`;
      done({
        folder,
        command: "node .adlc/check.mjs",
        passed: !err,
        exit: err ? (typeof err.code === "number" ? err.code : null) : 0,
        timed_out: Boolean(err && err.killed),
        ms: Date.now() - started,
        output: out.length > LIMIT ? out.slice(0, LIMIT) + "\n[cut short]" : out,
      });
    });
  });
}
