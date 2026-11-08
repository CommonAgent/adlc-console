// The service key. The console's local server holds it; the browser page
// never sees it.
//
// Where it comes from, first match wins:
//   0. a key handed over in memory by the lifecycle service that started the
//      console in its own process, so no file holds it
//   1. the ADLC_KEY environment variable
//   2. --key-file <path>
//   3. a key pasted into the page once, kept in the user's config folder in
//      a file only they can read (0600), one key per service
//
// The key is never logged and never sent anywhere but the service.

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, chmod, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function configDir(env = process.env, platform = process.platform) {
  if (env.ADLC_CONSOLE_CONFIG_DIR) return env.ADLC_CONSOLE_CONFIG_DIR;
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "adlc-console");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "adlc-console");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "adlc-console");
}

const clean = (k) => (typeof k === "string" ? k.trim() : "");

// A key must be one line of visible characters; anything else is refused
// before it is stored or sent.
export function validKey(k) {
  return typeof k === "string" && k.length >= 8 && k.length <= 4096 && /^[\x21-\x7e]+$/.test(k);
}

export function createKeyStore({ service, env = process.env, keyFile = null, key = null, dir = configDir(env) } = {}) {
  const file = join(dir, "keys.json");
  const given = key === null ? "" : clean(key);
  if (key !== null && !validKey(given)) throw new Error("The key the service handed to the console does not look like a key.");
  const fromEnv = clean(env.ADLC_KEY);
  let fromFile = "";
  if (keyFile) {
    // Read once at start; a missing or unreadable file is an error the
    // person should see straight away.
    try {
      fromFile = clean(readFileSync(keyFile, "utf8"));
    } catch {
      throw new Error(`The key file ${keyFile} could not be read.`);
    }
    if (!validKey(fromFile)) throw new Error(`The key file ${keyFile} does not hold a key.`);
  }
  let saved = null; // loaded lazily

  async function readSaved() {
    if (saved !== null) return saved;
    try {
      const all = JSON.parse(await readFile(file, "utf8"));
      saved = all && typeof all === "object" ? all : {};
    } catch {
      saved = {};
    }
    return saved;
  }

  async function writeSaved(all) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
    await chmod(file, 0o600);
    saved = all;
  }

  return {
    file,
    // "service" | "environment" | "key file" | "saved" | null
    async source() {
      if (given) return "service";
      if (fromEnv) return "environment";
      if (fromFile) return "key file";
      const all = await readSaved();
      return validKey(all[service]) ? "saved" : null;
    },
    async get() {
      if (given) return given;
      if (fromEnv) return fromEnv;
      if (fromFile) return fromFile;
      const all = await readSaved();
      return validKey(all[service]) ? all[service] : null;
    },
    async save(key) {
      const k = clean(key);
      if (!validKey(k)) throw new Error("That does not look like a key.");
      const all = { ...(await readSaved()), [service]: k };
      await writeSaved(all);
    },
    async forget() {
      const all = { ...(await readSaved()) };
      if (!(service in all)) return false;
      delete all[service];
      await writeSaved(all);
      return true;
    },
  };
}
