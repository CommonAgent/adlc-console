# The lifecycle API the console reads

The console works against any service that implements the agentic
development lifecycle (ADLC) and answers these paths. It holds no lifecycle
logic of its own: it draws what the service says, and draws a button for each
action the service offers, and nothing else.

All JSON. Times are ISO 8601. Auth is `Authorization: Bearer <key>`, where the
key is one the person makes for their own account (the service says how). The
console never sees a password.

```
GET  /v1/lifecycle/builds[?archived=1]   // archived builds only when asked for
  -> { builds: [{ id, name, does, version, at: { stage, state, summary? }, archived?, updated }] }

POST /v1/lifecycle/builds   { does, refuses?, more?, name?, prototype? }
  -> { build }

GET  /v1/lifecycle/builds/:id
  -> { build: {
       id, name, does, version, handle,
       stages: [{
         stage,                 // id from stages.json, e.g. "code"
         state,                 // not_started | working | waiting_on_you | done | refused | stopped | not_offered
         holder: { kind, name },// kind: reference_agent | your_agent | person
         runs,                  // how many times it has run
         rounds: [{ n, at, label, verdict, back, words }],   // newest first; back: true when it sent the work back
         given,                 // words
         handed_back: { words: [..], files: [{ path, size, link }] },
         done_when_met,         // true | false | null
         log: [{ at, said }],
         where: { kind: "pull_request", url, check: { title, words, items: [..] } } | null
       }],
       actions: [{ stage, name, label, needs: [{ name, label, kind, optional? }] }],   // optional: true when it may be left empty, and is then not sent
       log: [{ at, said }],
       summary?,              // where it ended or is, in words: "Installed · conforms", "Stopped at Requirements"
       paused?,               // { at, why } while the installed agent is paused, else null
       archived?              // true once the person archived it
     } }

GET  /v1/lifecycle/builds/:id/files?path=<path>   -> the file's bytes

POST /v1/lifecycle/builds/:id/actions/:name   { ...needs }
  -> { build }

POST /v1/lifecycle/builds/:id/try   { say, against: "pull_request" | "installed" }
  -> { try: { id, say, against, answer, ms, at } }
GET  /v1/lifecycle/builds/:id/tries
  -> { tries: [{ id, say, against, answer, at, kept: bool, sent_back: bool }] }
POST /v1/lifecycle/builds/:id/tries/:tid/keep      -> adds it to the suite as a new test file
POST /v1/lifecycle/builds/:id/tries/:tid/wrong   { why? }  -> a comment on the pull request
```

Added in lifecycle API 0.2 (CommonAgent/adlc, standards/lifecycle-api.schema.json):

```
GET    /v1/lifecycle/roles[?project=<name>]
  -> { roles: [{ role, name, contract, offering, stages: [..],
                 binding,          // { role, holder, scope?, since?, by? }; null exactly when from is unbound
                 from,             // project | org | default | unbound
                 reference_agent   // { kind: "reference_agent", name, handle } | null
       }] }
PUT    /v1/lifecycle/roles/:role[?project=<name>]   { holder: { kind, name, handle?, evidence?: { formats: [..], where? } } }
  -> the roles answer; 400 { error } when the binding is refused
DELETE /v1/lifecycle/roles/:role[?project=<name>]   -> the roles answer

POST /v1/lifecycle/builds   adds project?       build adds project?
stage.state adds not_bound | not_applicable     holder.kind adds contracted | outside_tool; holder adds handle?
stage adds evidence?: [{ format, name, at, summary, file? }]
```

## How the console reads it

- A stage in stages.json that a build does not list is shown as not offered,
  and so is a stage in a state the console does not know.
- A holder is drawn with its kind in words ("our reference agent", "your
  agent", "contracted: <name>", "a person", "outside tool: <name>") and its
  handle when there is one. not_bound links to the Roles page; not_applicable
  is dimmed and says the stage doesn't apply to a process.
- The Roles page shows the service's 400 words for a refused binding as they
  are. The requester is always the person who asked, and has no form.
- `holder` may be `null` for a stage that is not offered.
- `size` is a count of bytes. Files are shown inline, fetched from the
  `files` path when opened; a file that is not text is not shown.
- An error answer may carry `{ error: "<words>" }`; the console shows those
  words as they are. A 401 or 403 asks the person for a new key.
- The service's answers are shown as text, never run as a page.
- Each build in the list shows `at.summary` when the service gives it, and
  the stage and its state when it does not. The same words head the build.
- The list is read with `?archived=1`. Archived builds are hidden, with a
  "Show archived (N)" toggle at the foot of the list. `archive`,
  `unarchive` and `resume_agent` are actions like any other: one button each.

`lib/contract.mjs` holds these shapes as checks. A service author can run
their own answers through `checkBuildList`, `checkBuild`, `checkTry` and
`checkTries`; each returns a list of problems, empty when the shape is right.

The contract is written in the plan, docs/adlc-console-plan.md in the
AgentMesh repository, section "The contract, exactly". This copy follows it.
