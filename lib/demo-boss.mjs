// The demo's answers to the lifecycle API 0.4.1 boss routes (docs/contract.md):
// a product's conversation with its boss, and what the boss committed. Like the
// rest of the demo it stands in for a service with made-up content, shaped
// exactly like a service's answers. It reads the person's words with a few
// simple rules instead of a model:
//
//   "approve" / "accept" / "OK the"   refused: the boss never answers a gate
//   "price" / "pay"                   refused: past its authority
//   "test" and "should"               routed into the Test chat
//   "also" / "instead" / "change"     a plan, proposing the next version
//   "commit"                          everything it committed, in full
//   otherwise                         where the product is, from its record
//
// palindrome-judge starts with a routed directive and a plan waiting for a yes.

const DOC_NAMES = { requirements: "Requirements", test: "Test", code: "Code", review: "Review", security: "Security review", package: "Package", release: "Release", deploy: "Deploy", conformance: "Conformance", acceptance: "Acceptance" };
const now = () => new Date().toISOString();
const t = (hhmm) => `2026-10-31T${hhmm}:00Z`;
const nameOf = (id) => DOC_NAMES[id] ?? id[0].toUpperCase() + id.slice(1);
const GATES = { requirements: "You approve the spec, or ask for changes.", code: "You OK the code on its pull request, or send it back to Test.", deploy: "You approve the install.", acceptance: "You accept it." };
const OFF = new Set(["not_used", "not_offered", "not_applicable", "not_bound"]);

/** The next minor version: 0.1.0 -> 0.2.0. */
export function nextVersion(versions) {
  const top = versions.map((v) => (/^(\d+)\.(\d+)\./.exec(v) ?? [0, 0, 0]).slice(1).map(Number)).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0] ?? [0, 0];
  return `${top[0]}.${top[1] + 1}.0`;
}

export function createBossRoutes({ builds, stageRoutes, productOf, summary, start }) {
  const talk = new Map(); // product -> messages
  const kept = new Map(); // product -> commitments, with answers folded in as they come
  let seq = 0;
  const id = (p) => `${p}${++seq}`;
  const listOf = (map, name) => { if (!map.has(name)) map.set(name, []); return map.get(name); };
  const buildsOf = (name) => [...builds.values()].filter((b) => productOf(b) === name);
  const newest = (name) => { const l = buildsOf(name); return l.filter((b) => !b.archived).at(-1) ?? l.at(-1); };
  const stamp = (b) => ({ build: b.id, version: b.version });
  const boss = { kind: "agent", name: "The boss", role: "boss" };

  function planFor(b, next) {
    // The stages the change makes work for, and every stage with a gate the person meets.
    const touches = new Set(["requirements", "test", "code", ...Object.keys(GATES)]);
    const run = b.stages.filter((s) => !OFF.has(s.state) && touches.has(s.stage)).map((s) => s.stage);
    return run.map((stage) => ({
      stage,
      words: stage === "requirements" ? `The spec writer drafts ${next} from ${b.version}, then revises it with your change.` : stage === "test" ? `The test writer adds cases for the change.` : stage === "code" ? "Your coding agent changes the scripts until the suite passes, with review and security review on each push." : stage === "deploy" ? `The package for ${next} is installed once you approve.` : stage === "acceptance" ? `You try ${next} and accept it.` : `${nameOf(stage)} runs again for ${next}.`,
      ...(GATES[stage] ? { gate: `${GATES[stage]} You may answer this gate.` } : {}),
    }));
  }

  function propose(name, b, reply, p, what) {
    listOf(kept, name).push({ id: id("c"), at: reply.at, kind: "proposed", to: "you", what, build: p.build, version: b.version, reply: reply.id, proposal: p, answer: { state: "open" } });
  }

  function route(name, b, text, at = now()) {
    const posted = { id: id("bm"), at, ...stamp(b), from: { kind: "agent", name: "The boss", role: "boss", stage: "test" }, to: { role: "test-writer" }, text: `Add a test: ${text}\n\nThe person's own words: “${text}”\nFrom the boss, for you, on ${name} ${b.version}.` };
    stageRoutes.push(name, "test", posted);
    stageRoutes.push(name, "test", { id: id("bm"), at, ...stamp(b), from: { kind: "agent", name: "Test writer", role: "test-writer", stage: "test" }, text: "I can add that case. It would go in through Send back to Test from Code's gate." });
    const reply = { id: id("bm"), at, ...stamp(b), from: boss, text: "That is the test writer's. I posted it in the Test chat, to the test writer. Its answer is there.", routed: { stage: "test", message_id: posted.id, build: b.id } };
    listOf(kept, name).push({ id: id("c"), at, kind: "routed", to: "the test writer, at Test", stage: "test", what: `Add a test: ${text}`, build: b.id, version: b.version, reply: reply.id, message_id: posted.id });
    return reply;
  }

  function plan(name, b, text, at = now()) {
    const next = nextVersion(buildsOf(name).map((x) => x.version));
    const steps = planFor(b, next);
    const gates = steps.filter((s) => s.gate).map((s) => nameOf(s.stage)).join(", ");
    const p = { id: id("bp"), build: b.id, action: "start_version", needs: { version: next }, words: `Start version ${next} of ${name}, with ${b.version} as its prototype?` };
    const reply = { id: id("bm"), at, ...stamp(b), from: boss, text: `That changes what the agent does, so it needs version ${next}: a new build, with ${b.version} as its prototype. Once it starts, I will propose Ask for changes to the spec writer with your words. You will meet these gates: ${gates}. Nothing changes until you confirm.`, plan: steps, proposes: p };
    propose(name, b, reply, p, `Start ${next} of ${name} with ${b.version} as its prototype, then ask the spec writer for this change: ${text}`);
    listOf(kept, name).at(-1).then = text;
    return reply;
  }

  // palindrome-judge: a directive already routed, and a plan waiting for a yes.
  {
    const b = builds.get("b_palindrome_judge");
    if (b) {
      const name = productOf(b);
      const m = listOf(talk, name);
      const ask1 = "The tests should cover a sentence of only punctuation.";
      m.push({ id: id("bm"), at: t("15:44"), ...stamp(b), from: { kind: "person", name: "you" }, text: ask1 });
      m.push(route(name, b, ask1, t("15:44")));
      const ask2 = "It should also judge a whole paragraph, one sentence at a time.";
      m.push({ id: id("bm"), at: t("15:46"), ...stamp(b), from: { kind: "person", name: "you" }, text: ask2 });
      m.push(plan(name, b, ask2, t("15:46")));
    }
  }

  function messages(name) {
    const state = new Map(listOf(kept, name).filter((c) => c.kind === "proposed").map((c) => [c.proposal.id, c.answer.state]));
    return { messages: listOf(talk, name).map((m) => (m.proposes ? { ...m, proposes: { ...m.proposes, state: state.get(m.proposes.id) ?? "open" } } : m)) };
  }
  const commitments = (name) => ({ commitments: listOf(kept, name).map(({ then, ...c }) => c) });

  /** The person took a build's action: an open proposal of it is answered. */
  function taken(b, action) {
    for (const list of kept.values()) for (const c of list) if (c.kind === "proposed" && c.answer.state === "open" && c.proposal.build === b.id && c.proposal.action === action) c.answer = { state: "taken", by: "you", at: now() };
  }

  function post(name, body) {
    const text = String(body?.text ?? "").trim();
    if (!text) return { status: 400, body: { error: "Say something to send." } };
    const b = newest(name);
    const at = now();
    const message = { id: id("bm"), at, ...stamp(b), from: { kind: "person", name: "you" }, text };
    const said = (words, extra = {}) => ({ id: id("bm"), at, ...stamp(b), from: boss, text: words, ...extra });
    const answering = body.confirms ?? body.declines;
    let reply;
    if (answering) {
      const c = listOf(kept, name).find((x) => x.kind === "proposed" && x.proposal.id === answering);
      if (!c || c.answer.state !== "open") return { status: 400, body: { error: "That proposal is not open." } };
      if (body.declines) {
        c.answer = { state: "declined", by: "you", at };
        reply = said("All right: I have not done it. Nothing changed.");
        message.declines = answering;
      } else {
        if (c.proposal.action !== "start_version") return { status: 400, body: { error: "That proposal is the build's own action. Confirm it with its button, which takes it through the build's actions." } };
        const from = builds.get(c.proposal.build) ?? b;
        const fresh = start({ does: from.does, name }, c.proposal.needs.version);
        c.answer = { state: "taken", by: "you", at };
        message.confirms = answering;
        const p = { id: id("bp"), build: fresh.id, action: "changes", needs: { words: c.then ?? text }, words: `Ask for changes on Requirements, ${fresh.version}?`, when: `When Requirements of ${fresh.version} waits on you, after the spec writer's first draft.` };
        reply = { id: id("bm"), at, ...stamp(fresh), from: boss, text: `I started ${fresh.version} on your confirmation, with ${from.version} as its prototype. When the spec writer's first draft waits at Requirements, confirm Ask for changes below and it goes back through that gate.`, started: { build: fresh.id, version: fresh.version }, proposes: p };
        listOf(kept, name).push({ id: id("c"), at, kind: "started", to: "you", what: `Started ${fresh.version} of ${name} with ${from.version} as its prototype.`, build: fresh.id, version: fresh.version, reply: reply.id, confirmation: { message_id: message.id, by: "you", at } });
        propose(name, fresh, reply, p, `Ask for changes on Requirements of ${fresh.version}: ${c.then ?? text}`);
      }
    } else if (/\b(approve|accept)\b|\bOK the\b/i.test(text)) {
      const waiting = buildsOf(name).find((x) => x.stages.some((s) => s.state === "waiting_on_you"));
      const at2 = waiting?.stages.find((s) => s.state === "waiting_on_you");
      reply = said(`I do not answer gates, so I have not approved anything: a gate answered by whoever proposed the work is not a gate. ${waiting ? `${nameOf(at2.stage)} on ${waiting.version} waits at its gate. You may answer it there, where its buttons are.` : `No gate of ${name} waits now.`}`);
    } else if (/\b(price|pay)\b/i.test(text)) {
      reply = said("I will not do that: it is past my authority. I may post into this product's stage chats, propose, and start the next version when you confirm it. I commit no money, accept no price, start no build you have not confirmed, and message nobody outside this product's stages.");
    } else if (/\bcommit/i.test(text)) {
      const list = listOf(kept, name);
      reply = said(list.length ? `Everything I committed on your behalf, ${list.length} in all:\n${list.map((c) => `- ${c.kind === "proposed" ? `proposed to you: ${c.what} (${c.answer.state})` : c.kind === "started" ? c.what : `posted to ${c.to}: ${c.what}`}`).join("\n")}` : "I have committed nothing on your behalf yet.");
    } else if (/\btests?\b/i.test(text) && /\bshould\b/i.test(text)) {
      reply = route(name, b, text, at);
    } else if (/\b(also|instead|change)\b/i.test(text)) {
      reply = plan(name, b, text, at);
    } else {
      const s = summary(b);
      reply = said(`From the record: ${name} ${b.version} (build ${b.id}) is ${String(s.at.summary || s.at.state).replace(/^./, (c) => c.toLowerCase())}.`);
    }
    const list = listOf(talk, name);
    list.push(message, reply);
    const state = reply.proposes ? listOf(kept, name).find((c) => c.proposal?.id === reply.proposes.id)?.answer.state ?? "open" : null;
    return { status: 200, body: { message, reply: state ? { ...reply, proposes: { ...reply.proposes, state } } : reply } };
  }

  return { messages, commitments, post, taken };
}
