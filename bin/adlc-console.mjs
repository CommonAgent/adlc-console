#!/usr/bin/env node
// npx adlc-console [--service <url> | --github <org or owner/repo> | --demo | --lifecycle <path>] [--key-file <path>] [--github-token-file <path>] [--port <n>] [--no-open]

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createConsoleServer, serviceLabel } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { createDemoService } from "../lib/demo.mjs";
import { createGitHubSource, parseTarget } from "../lib/github.mjs";
import { createLifecycleFile } from "../lib/lifecycle-file.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const DEFAULT_SERVICE = "https://api.agentmesh.ai";

const HELP = `adlc console ${pkg.version}

Shows a build's journey through the 24 stages of the agentic development
lifecycle, and lets you act at the gates that are yours.

  npx adlc-console                     start it and open the page
  npx adlc-console --demo              start it with made-up builds, no service needed
  npx adlc-console --github <org>      read the agent repositories in a GitHub org
  npx adlc-console --lifecycle <path>  define your lifecycle in a file, no service needed

  --service <url>     the lifecycle service to read (default ${DEFAULT_SERVICE})
  --key-file <path>   read the service key from this file
  --github <name>     read agent repositories on GitHub instead: an org, a user, or owner/repo
  --github-token-file <path>
                      read a GitHub token from this file (or set GITHUB_TOKEN); without
                      one, GitHub allows about 60 reads an hour
  --lifecycle <path>  keep your lifecycle in this JSON file, made if it is missing:
                      the stages you use, who holds each role, and stages of your own
  --stages <path>     read the stages from this file instead of the copy shipped here
  --port <n>          listen on this port (default: any free port)
  --no-open           print the address but do not open the browser
  --help              show this

The key can also come from the ADLC_KEY environment variable, or be pasted
into the page once; then it is kept in your config folder, readable only by you.
`;

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin" ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch { /* opening the browser is a convenience */ }
}

async function main() {
  let opts;
  try {
    opts = parseArgs({
      options: {
        service: { type: "string" },
        "key-file": { type: "string" },
        github: { type: "string" },
        "github-token-file": { type: "string" },
        stages: { type: "string" },
        lifecycle: { type: "string" },
        port: { type: "string" },
        demo: { type: "boolean", default: false },
        "no-open": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }).values;
  } catch (e) {
    console.error(`${e.message}\n\n${HELP}`);
    process.exit(2);
  }
  if (opts.help) { console.log(HELP); return; }

  const service = opts.service || process.env.ADLC_SERVICE || DEFAULT_SERVICE;
  try {
    const u = new URL(service);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))) {
      throw new Error("only https, or http on this computer");
    }
  } catch {
    console.error(`The service address ${service} is not usable: give an https address.`);
    process.exit(2);
  }

  const stagesPath = opts.stages ? opts.stages : new URL("../standards/stages.json", import.meta.url);
  const stages = JSON.parse(readFileSync(stagesPath, "utf8"));

  let keys;
  try {
    keys = createKeyStore({ service, keyFile: opts["key-file"] || null });
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  let source = null;
  if (opts.lifecycle) {
    if (opts.demo || opts.github || opts.service) { console.error("Use --lifecycle on its own: it needs no service, GitHub or demo."); process.exit(2); }
    source = createLifecycleFile({ path: opts.lifecycle, stagesDoc: stages });
    const problem = await source.check();
    if (problem) console.error(`${problem}\nThe page will say so until the file is fixed.`);
  } else if (opts.demo) source = createDemoService();
  else if (opts.github) {
    try { parseTarget(opts.github); } catch (e) { console.error(e.message); process.exit(2); }
    let token = (process.env.GITHUB_TOKEN || "").trim();
    if (opts["github-token-file"]) {
      try { token = readFileSync(opts["github-token-file"], "utf8").trim(); } catch {
        console.error(`The GitHub token file ${opts["github-token-file"]} could not be read.`);
        process.exit(2);
      }
    }
    if (token && !/^[!-~]{8,4096}$/.test(token)) { console.error("The GitHub token does not look like a token."); process.exit(2); }
    source = createGitHubSource({ target: opts.github, token: token || null, version: pkg.version });
  }

  const app = createConsoleServer({ service, keys, stages, version: pkg.version, source });
  const port = opts.port ? Number(opts.port) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("The port must be a number from 1 to 65535.");
    process.exit(2);
  }
  const url = await app.listen(port);
  console.log(`adlc console is at ${url}`);
  console.log(source?.kind === "file" ? `Keeping your lifecycle in ${source.file}.` : source ? `Reading builds from ${source.label}${source.kind === "github" ? (source.keyFrom ? ", with your token" : ", without a token") : ""}.` : `Reading builds from ${serviceLabel(service)}.`);
  console.log("Press Ctrl+C to stop it.");
  if (!opts["no-open"]) openBrowser(url);

  const stop = () => app.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
