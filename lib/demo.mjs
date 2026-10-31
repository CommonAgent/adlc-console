// A stand-in lifecycle service for --demo. It answers the same paths, with
// the same shapes, as a real service (docs/contract.md), from memory, so the
// page can be shown and worked on with no service and no key.
//
// It is not a lifecycle: it moves the demo builds along just enough to show
// what each button does.

import { palindromeJudge, palindromeTries, tallyWords, wordTally, blankStage, judge, STAGE_IDS, FIXTURE_FILES } from "./fixture.mjs";

const now = () => new Date().toISOString();

function summary(b) {
  const waiting = b.stages.find((s) => s.state === "waiting_on_you");
  const live = waiting
    ?? b.stages.find((s) => s.state === "working" || s.state === "stopped" || s.state === "refused")
    ?? [...b.stages].reverse().find((s) => s.state === "done")
    ?? b.stages[0];
  const updated = b.log[0]?.at ?? now();
  return { id: b.id, name: b.name, does: b.does, version: b.version, at: { stage: live.stage, state: live.state }, updated };
}

function slug(words) {
  return String(words).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).join("-") || "new-agent";
}

export function createDemoService() {
  const builds = new Map();
  const tries = new Map();
  for (const b of [palindromeJudge(), tallyWords(), wordTally()]) builds.set(b.id, b);
  tries.set("b_palindrome_judge", palindromeTries());
  tries.set("b_tally_words", []);
  tries.set("b_word_tally", []);
  let seq = 0;

  const json = (status, body) => ({ status, type: "application/json", body });
  const nope = (status, error) => json(status, { error });
  const stageOf = (b, id) => b.stages.find((s) => s.stage === id);
  const say = (b, s, said) => {
    const e = { at: now(), said };
    if (s) s.log.unshift(e);
    b.log.unshift(e);
  };

  function act(b, name, body) {
    const offered = b.actions.find((a) => a.name === name);
    if (!offered) return nope(409, "This build does not offer that now.");
    for (const n of offered.needs) {
      if (!String(body?.[n.name] ?? "").trim()) return nope(400, `${n.label} is needed.`);
    }
    const code = stageOf(b, "code");
    if (name === "accept") {
      code.state = "done";
      say(b, code, "You accepted the pull request.");
      for (const id of ["package", "release"]) {
        const s = stageOf(b, id);
        s.state = "done"; s.runs = 1; s.done_when_met = true;
        say(b, s, `${s.holder.name} finished ${id === "package" ? "the package" : "the signed build record"}.`);
      }
      const d = stageOf(b, "deploy");
      d.state = "waiting_on_you";
      say(b, d, "The install is waiting for your approval.");
      b.actions = [{ stage: "deploy", name: "approve", label: "Approve the install", needs: [] }, { stage: "deploy", name: "stop", label: "Stop", needs: [] }];
    } else if (name === "approve") {
      const d = stageOf(b, "deploy");
      d.state = "done"; d.runs = 1; d.done_when_met = true;
      say(b, d, `The agent is installed and answering as ${b.handle}.`);
      const c = stageOf(b, "conformance");
      c.state = "done"; c.runs = 1; c.done_when_met = true;
      say(b, c, "It conforms: it does what it declared and nothing it refused.");
      const a = stageOf(b, "acceptance");
      a.state = "waiting_on_you";
      b.actions = [];
    } else if (name === "stop") {
      const s = b.stages.find((x) => x.state === "waiting_on_you" || x.state === "working");
      if (s) { s.state = "stopped"; say(b, s, `You stopped the build at ${s.stage[0].toUpperCase() + s.stage.slice(1)}.`); }
      b.actions = [{ stage: s?.stage ?? "code", name: "resume", label: "Resume", needs: [] }];
    } else if (name === "resume") {
      const s = b.stages.find((x) => x.state === "stopped");
      if (s) { s.state = "waiting_on_you"; say(b, s, "You resumed the build."); }
      b.actions = s?.stage === "code" && s.where
        ? [{ stage: "code", name: "accept", label: "Accept the pull request", needs: [] }, { stage: "code", name: "stop", label: "Stop", needs: [] }]
        : [{ stage: s?.stage ?? "code", name: "stop", label: "Stop", needs: [] }];
    } else if (name === "changes") {
      const s = stageOf(b, offered.stage);
      s.state = "working";
      say(b, s, `You asked for changes: “${String(body.words).trim()}”`);
    }
    return json(200, { build: b });
  }

  function create(body) {
    const does = String(body?.does ?? "").trim();
    if (!does) return nope(400, "Say what the agent should do.");
    const id = `b_new_${++seq}`;
    const name = String(body?.name ?? "").trim() || slug(does);
    const offered = new Set(["requirements", "architecture", "test", "code", "review", "security", "package", "release", "deploy", "conformance", "acceptance"]);
    const stages = STAGE_IDS.map((s) => (offered.has(s) ? blankStage(s, "not_started") : blankStage(s)));
    stages[0].state = "working";
    stages[0].holder = { kind: "reference_agent", name: "spec-writer" };
    stages[0].given = [does, body.refuses, body.more].filter((x) => x && String(x).trim()).join(" ");
    const b = { id, name, does, version: "0.1.0", handle: `${name}.example`, stages, actions: [{ stage: "requirements", name: "stop", label: "Stop", needs: [] }], log: [] };
    say(b, stages[0], "The spec writer was asked.");
    builds.set(id, b);
    tries.set(id, []);
    return json(201, { build: b });
  }

  function tryIt(b, body) {
    const text = String(body?.say ?? "");
    if (!text.trim()) return nope(400, "Say what to send it.");
    const against = body?.against;
    if (against !== "pull_request" && against !== "installed") return nope(400, "Say whether to try the pull request or the installed agent.");
    if (against === "pull_request" && !b.stages.some((s) => s.where?.kind === "pull_request")) return nope(409, "There is no pull request to try.");
    if (against === "installed" && stageOf(b, "deploy")?.state !== "done") return nope(409, "The agent is not installed yet.");
    const t = { id: `t${Date.now().toString(36)}`, say: text, against, answer: judge(text), ms: 380 + (text.length % 60), at: now() };
    tries.get(b.id).unshift({ id: t.id, say: t.say, against, answer: t.answer, at: t.at, kept: false, sent_back: false });
    return json(200, { try: t });
  }

  return {
    // method: "GET" | "POST"; path: the service path, e.g. /v1/lifecycle/builds/x
    async handle(method, path, query, body) {
      const parts = path.replace(/^\/v1\/lifecycle\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== "builds") return nope(404, "Nothing here.");
      if (parts.length === 1) {
        if (method === "GET") return json(200, { builds: [...builds.values()].map(summary) });
        if (method === "POST") return create(body);
        return nope(405, "Not allowed.");
      }
      const b = builds.get(parts[1]);
      if (!b) return nope(404, "There is no build with that id.");
      const rest = parts.slice(2);
      if (rest.length === 0 && method === "GET") return json(200, { build: b });
      if (rest[0] === "files" && method === "GET") {
        const p = query.get("path");
        const known = b.stages.some((s) => s.handed_back.files.some((f) => f.path === p));
        if (!known || !(p in FIXTURE_FILES)) return nope(404, "There is no file at that path.");
        return { status: 200, type: "text/plain; charset=utf-8", body: FIXTURE_FILES[p] };
      }
      if (rest[0] === "actions" && rest[1] && method === "POST") return act(b, rest[1], body);
      if (rest[0] === "try" && method === "POST") return tryIt(b, body);
      if (rest[0] === "tries" && rest.length === 1 && method === "GET") return json(200, { tries: tries.get(b.id) });
      if (rest[0] === "tries" && rest[1] && method === "POST" && (rest[2] === "keep" || rest[2] === "wrong")) {
        const t = tries.get(b.id).find((x) => x.id === rest[1]);
        if (!t) return nope(404, "There is no try with that id.");
        if (rest[2] === "keep") {
          t.kept = true;
          say(b, stageOf(b, "test"), `“${t.say}” was kept as a test.`);
        } else {
          t.sent_back = true;
          const why = String(body?.why ?? "").trim();
          say(b, stageOf(b, "code"), `“${t.say}” went back to your coding agent${why ? `: ${why}` : ""}.`);
        }
        return json(200, { try: t });
      }
      return nope(404, "Nothing here.");
    },
  };
}
