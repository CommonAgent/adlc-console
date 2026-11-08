// The product's boss on the product page (public/workspace.js), against the
// demo's lifecycle API 0.4.1 answers: routed replies link to the stage chat
// they went to, a plan is a short ordered list, and proposals are confirm
// buttons. The proxy passes the boss routes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createDemoService } from "../lib/demo.mjs";
import { createConsoleServer } from "../lib/server.mjs";
import { createKeyStore } from "../lib/keys.mjs";
import { checkBossMessages, checkBossReply, checkBossCommitments, checkMessages } from "../lib/contract.mjs";
import { productPageHtml, bossChatHtml, bossMessageHtml, bossProposalHtml, planHtml, bossBuildsToRead, stageChatHref, messagesOffered } from "../public/workspace.js";
import { hit, fakeService, tempDir } from "./helpers.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DOC = JSON.parse(await readFile(join(HERE, "..", "standards", "stages.json"), "utf8"));
const IDS = DOC.stages.map((s) => s.id);
const defs = new Map(DOC.stages.map((s) => [s.id, s]));
const stageName = (s) => defs.get(s)?.name ?? s;
const visible = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = (d, path) => d.handle("GET", path, new URLSearchParams(), {});
const post = (d, path, body = {}) => d.handle("POST", path, new URLSearchParams(), body);
const BOSS = "/v1/lifecycle/products/palindrome-judge/boss";

test("a routed reply links to the stage chat it went to, and that chat holds the boss's message", async () => {
  const d = createDemoService();
  const said = await post(d, `${BOSS}/messages`, { text: "The tests should cover a sentence with digits only." });
  assert.equal(said.status, 200);
  assert.deepEqual(checkBossReply(said.body, IDS), []);
  const r = said.body.reply;
  assert.equal(r.routed.stage, "test");
  const html = bossMessageHtml(r, { stageName, when: () => "" });
  assert.match(html, /<a href="#\/b\/b_palindrome_judge\/test\/chat">Open the Test chat<\/a>/);
  assert.equal(stageChatHref("b 1", "test"), "#/b/b%201/test/chat");
  assert.match(visible(html), /^B The boss That is the test writer's\. I posted it in the Test chat/);
  const chat = (await get(d, "/v1/lifecycle/products/palindrome-judge/stages/test/messages")).body;
  assert.deepEqual(checkMessages(chat, "test"), []);
  const posted = chat.messages.find((m) => m.id === r.routed.message_id);
  assert.deepEqual(posted.from, { kind: "agent", name: "The boss", role: "boss", stage: "test" });
  assert.match(posted.text, /The person's own words: “The tests should cover a sentence with digits only\.”/);
});

test("a plan shows as a short ordered list with its gates, and starting a version is a confirm button", async () => {
  const d = createDemoService();
  const all = (await get(d, `${BOSS}/messages`)).body;
  assert.deepEqual(checkBossMessages(all, IDS), []);
  const m = all.messages.find((x) => x.plan);
  const steps = planHtml(m.plan, { stageName });
  assert.match(steps, /^<ol class="plan"><li><b>Requirements<\/b> The spec writer drafts 0\.2\.0 from 0\.1\.0, then revises it with your change\.<small class="pgate"><span>Gate<\/span> You approve the spec, or ask for changes\. You may answer this gate\.<\/small><\/li>/);
  assert.equal((steps.match(/<li>/g) ?? []).length, m.plan.length);
  const html = bossMessageHtml(m, { stageName });
  assert.match(html, /<button class="btn p" type="button" data-boss-confirm="[^"]+">Confirm: Start version 0\.2\.0<\/button>/);
  assert.match(visible(html), /Start version 0\.2\.0 of palindrome-judge, with 0\.1\.0 as its prototype\? Confirm: Start version 0\.2\.0 Nothing starts until you confirm\.$/);
  // While it is being confirmed, every button waits.
  assert.match(bossProposalHtml(m, { pending: m.proposes.id }), /disabled>Starting…<\/button>/);

  // Confirmed: the boss starts 0.2.0, and proposes the spec writer's changes action, which waits for the build to offer it.
  const yes = await post(d, `${BOSS}/messages`, { text: "Yes.", confirms: m.proposes.id });
  assert.equal(yes.status, 200);
  assert.deepEqual(checkBossReply(yes.body, IDS), []);
  const { started, proposes } = yes.body.reply;
  assert.equal(started.version, "0.2.0");
  assert.equal(proposes.action, "changes");
  assert.deepEqual(bossBuildsToRead([yes.body.reply]), [started.build]);
  const working = (await get(d, `/v1/lifecycle/builds/${started.build}`)).body.build;
  const waits = bossMessageHtml(yes.body.reply, { stageName, builds: new Map([[started.build, working]]) });
  assert.match(waits, /<a href="#\/b\/[^"]+">Open version 0\.2\.0<\/a>/);
  assert.match(waits, /<button class="btn p" type="button" disabled>Confirm: Ask for changes<\/button><\/div><p class="hint">When Requirements of 0\.2\.0 waits on you, after the spec writer&#39;s first draft\.<\/p>/);
  // Once the build offers it, the button takes the build's own action.
  const offering = { ...working, actions: [{ stage: "requirements", name: "changes", label: "Ask for changes", needs: [{ name: "words", label: "What should change", kind: "words" }] }] };
  const ready = bossMessageHtml(yes.body.reply, { stageName, builds: new Map([[started.build, offering]]) });
  assert.match(ready, new RegExp(`data-boss-act="${yes.body.reply.id}">Confirm: Ask for changes</button>`));
  assert.match(visible(ready), /What should change It should also judge a whole paragraph, one sentence at a time\./);
  // The kept start proposal now reads as confirmed.
  const kept = (await get(d, `${BOSS}/messages`)).body.messages.find((x) => x.proposes?.id === m.proposes.id);
  assert.match(bossMessageHtml(kept, { stageName }), /<span class="btn used">Confirmed<\/span>/);
  assert.equal((await post(d, `${BOSS}/messages`, { text: "Yes.", confirms: m.proposes.id })).status, 400);
  const c = (await get(d, `${BOSS}/commitments`)).body;
  assert.deepEqual(checkBossCommitments(c, IDS), []);
  assert.deepEqual(c.commitments.map((x) => x.kind), ["routed", "proposed", "started", "proposed"]);
});

test("the Boss tab is the product page's default place to talk, with its composer", async () => {
  const d = createDemoService();
  const p = (await get(d, "/v1/lifecycle/products/palindrome-judge")).body;
  const messages = (await get(d, `${BOSS}/messages`)).body.messages;
  const ctx = { stageName, when: () => "t", buildHref: (id) => `#/b/${id}`, boss: { offered: true, messages, builds: new Map(), composer: { draft: "" } } };
  const html = productPageHtml(p, ctx);
  assert.match(html, /class="tab on" aria-selected="true" data-ptab="boss">Boss<\/button>/);
  assert.match(html, /<form class="box" id="boss-form">/);
  assert.match(html, /To <b>the boss<\/b>/);
  assert.match(html, /<ol class="plan">/);
  assert.match(html, /Open the Test chat/);
  // Another tab has no composer.
  assert.doesNotMatch(productPageHtml(p, ctx, "versions"), /boss-form/);
  // An empty conversation says what the boss is for.
  assert.match(visible(bossChatHtml([])), /^Ask the boss anything about this product/);
});

test("asked to approve, the demo boss refuses in words; asked a question, it answers from the record", async () => {
  const d = createDemoService();
  const no = await post(d, `${BOSS}/messages`, { text: "Please approve the code for me." });
  assert.match(no.body.reply.text, /^I do not answer gates, so I have not approved anything/);
  assert.equal(no.body.reply.proposes, undefined);
  const where = await post(d, `${BOSS}/messages`, { text: "Where is it now?" });
  assert.match(where.body.reply.text, /^From the record: palindrome-judge 0\.1\.0 \(build b_palindrome_judge\) is /);
  const said = (await post(d, `${BOSS}/messages`, { text: "What did you commit?" })).body.reply.text;
  assert.match(said, /^Everything I committed on your behalf, 2 in all:/);
  assert.equal((await post(d, `${BOSS}/messages`, { text: "" })).status, 400);
  assert.deepEqual(checkBossMessages((await get(d, `${BOSS}/messages`)).body, IDS), []);
});

test("the proxy passes the boss routes: its conversation read and posted to, its commitments only read", async () => {
  const svc = await fakeService((req) => ({ status: req.url.includes("nothing") ? 404 : 200, body: req.url.includes("nothing") ? { error: "Nothing here." } : { ok: true } }));
  const keys = createKeyStore({ service: svc.url, env: { ADLC_KEY: "test-key-0123456789abcdef" }, dir: await tempDir("boss") });
  const app = createConsoleServer({ service: svc.url, keys, stages: DOC, version: "test" });
  const url = await app.listen(0);
  const host = new URL(url).host;
  try {
    for (const path of ["/v1/lifecycle/products/word-counter/boss/messages", "/v1/lifecycle/products/word-counter/boss/commitments"]) {
      const r = await hit(url, { path: `/api${path}`, headers: { host } });
      assert.equal(r.status, 200, path);
      assert.equal(svc.seen.at(-1).url, path);
    }
    const p = await hit(url, { method: "POST", path: "/api/v1/lifecycle/products/word-counter/boss/messages", headers: { host }, body: { text: "Yes.", confirms: "bp_1" } });
    assert.equal(p.status, 200);
    assert.equal(svc.seen.at(-1).body, JSON.stringify({ text: "Yes.", confirms: "bp_1" }));
    assert.equal((await hit(url, { method: "POST", path: "/api/v1/lifecycle/products/word-counter/boss/commitments", headers: { host }, body: {} })).status, 405);
    assert.equal((await hit(url, { path: "/api/v1/lifecycle/products/word-counter/boss/other", headers: { host } })).status, 404);
    const none = await hit(url, { path: "/api/v1/lifecycle/products/nothing/boss/messages", headers: { host } });
    assert.equal(messagesOffered(none.status), false);
  } finally { await app.close(); await svc.close(); }
});
