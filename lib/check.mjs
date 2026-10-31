// The local check: runs the hand-off's own check, `node .adlc/check.mjs`,
// in a clone on this computer, so a person sees a failure before they push.
//
// It only ever runs that one command, in the folder the person named, and
// only when the folder holds .adlc/check.mjs. No shell is involved, and the
// service key is not passed to it.

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const LIMIT = 200_000; // characters of output kept
const TIMEOUT = 5 * 60_000;

export class CheckRefused extends Error {}

export async function folderFor(input) {
  if (typeof input !== "string" || !input.trim()) throw new CheckRefused("Say which folder your clone is in.");
  let folder = input.trim();
  if (folder.startsWith("~")) folder = join(process.env.HOME || process.env.USERPROFILE || "", folder.slice(1));
  if (!isAbsolute(folder)) throw new CheckRefused("Give the whole path to the folder, starting from the top of the drive.");
  folder = resolve(folder);
  let s;
  try { s = await stat(folder); } catch { throw new CheckRefused("There is no folder at that path."); }
  if (!s.isDirectory()) throw new CheckRefused("That path is a file, not a folder.");
  let c;
  try { c = await stat(join(folder, ".adlc", "check.mjs")); } catch { c = null; }
  if (!c || !c.isFile()) throw new CheckRefused("That folder has no .adlc/check.mjs. Point at the top of your clone of the pull request's branch.");
  return folder;
}

export async function runCheck(input, { env = process.env, timeout = TIMEOUT } = {}) {
  const folder = await folderFor(input);
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
