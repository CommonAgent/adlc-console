import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createKeyStore, validKey, configDir } from "../lib/keys.mjs";
import { tempDir } from "./helpers.mjs";

test("the environment wins over a key file, which wins over a saved key", async () => {
  const dir = await tempDir("keys");
  const file = join(dir, "key.txt");
  await writeFile(file, "  from-the-file-123\n");
  const saved = createKeyStore({ service: "https://a.example", env: {}, dir });
  await saved.save("saved-key-12345");
  assert.equal(await saved.get(), "saved-key-12345");
  assert.equal(await saved.source(), "saved");

  const withFile = createKeyStore({ service: "https://a.example", env: {}, keyFile: file, dir });
  assert.equal(await withFile.get(), "from-the-file-123");
  assert.equal(await withFile.source(), "key file");

  const withEnv = createKeyStore({ service: "https://a.example", env: { ADLC_KEY: "from-env-12345" }, keyFile: file, dir });
  assert.equal(await withEnv.get(), "from-env-12345");
  assert.equal(await withEnv.source(), "environment");
});

test("saved keys are kept per service", async () => {
  const dir = await tempDir("keys");
  const a = createKeyStore({ service: "https://a.example", env: {}, dir });
  const b = createKeyStore({ service: "https://b.example", env: {}, dir });
  await a.save("key-for-a-12345");
  assert.equal(await b.get(), null);
  await b.save("key-for-b-12345");
  const fresh = createKeyStore({ service: "https://a.example", env: {}, dir });
  assert.equal(await fresh.get(), "key-for-a-12345");
  assert.equal(await fresh.forget(), true);
  assert.equal(await fresh.get(), null);
  const all = JSON.parse(await readFile(join(dir, "keys.json"), "utf8"));
  assert.deepEqual(Object.keys(all), ["https://b.example"]);
});

test("something that is not a key is refused", async () => {
  assert.equal(validKey("short"), false);
  assert.equal(validKey("has a space in it"), false);
  assert.equal(validKey("line\nbreak-123456"), false);
  assert.equal(validKey("am_live_abcdef0123456789"), true);
  const dir = await tempDir("keys");
  const s = createKeyStore({ service: "https://a.example", env: {}, dir });
  await assert.rejects(() => s.save("no"), /does not look like a key/);
  const empty = join(dir, "empty.txt");
  await writeFile(empty, "\n");
  assert.throws(() => createKeyStore({ service: "x", env: {}, keyFile: empty, dir }), /does not hold a key/);
});

test("the config folder follows each system's custom", () => {
  assert.equal(configDir({ ADLC_CONSOLE_CONFIG_DIR: "/x" }, "linux"), "/x");
  assert.match(configDir({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32"), /adlc-console$/);
  assert.match(configDir({ XDG_CONFIG_HOME: "/home/a/.cfg" }, "linux"), /\.cfg[\\/]adlc-console$/);
});
