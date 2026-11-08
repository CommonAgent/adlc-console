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

Added in lifecycle API 0.3 (CommonAgent/adlc#118):

```
GET    /v1/lifecycle/stages[?project=<name>]
  -> { project,                  // the project asked about, or null
       stages: [{ stage, name, phase,
                  roles: [..],     // the stage's role ids; who holds each is in the roles answer
                  used,            // true | false
                  from,            // project | org | default
                  can_leave_out,   // whether this service can run its builds without the stage
                  why_not?         // when can_leave_out is false: what needs it, in words
       }],                         // every stage of stages.json, in its order
       updated_at? }
PUT    /v1/lifecycle/stages/:stage[?project=<name>]   { used }
  -> the stages answer; 400 { error } for an unknown stage, or used: false where can_leave_out is false
DELETE /v1/lifecycle/stages/:stage[?project=<name>]   -> the stages answer
  (PUT and DELETE answer 403 for a member who is not an admin, 409 when the choice could not be saved)

stage.state adds not_used        // the build's lifecycle leaves the stage out: holder null, runs 0, no action
build adds lifecycle?: { project, at }   // whose choice of stages it started under (project or null), and when
```

Read by the console since 0.1 (CommonAgent/adlc, standards/lifecycle-api.schema.json, TimelineBar):

```
build adds timeline?: [{ phase, round, holder, kind, start, end, duration_ms, status,
                         stage? }]   // one bar per step per round, ordered by start
  // stage (optional): the stage of stages.json the step belongs to. The Dashboard
  // adds a stage's time from the bars that name it; a bar without one is not counted.
```

## How the console reads it

- A stage in stages.json that a build does not list is shown as not offered,
  and so is a stage in a state the console does not know.
- A holder is drawn with its kind in words ("our reference agent", "your
  agent", "contracted: <name>", "a person", "outside tool: <name>") and its
  handle when there is one. not_bound links to the Lifecycle page;
  not_applicable is dimmed and says the stage doesn't apply to a process.
- not_used is struck through and dimmed. Its stage page says the stage is not
  part of the build's lifecycle, and names which: the organization's, or the
  project's in `lifecycle.project`. A build with `lifecycle` says which
  lifecycle it follows under its name.
- The Lifecycle page joins the stages answer and the roles answer: one row per
  stage, with a Use switch and the holder of each of its roles. A switch is
  disabled, with the service's `why_not` words, exactly when the service says
  `can_leave_out: false`; the console never decides that itself. Stages that
  share a role show the same holder, and changing it on one row changes the
  role (PUT /roles). The requester is always the person who asked, and has no
  form.
- A refused choice shows on its row, in the service's words as they are. A 403
  on a change from the Lifecycle page is shown that way too (a member who is
  not an admin), not taken as a bad key.
- A service with no stages operations (a 404 on GET /stages) still gets the
  page: the stages come from stages.json, with no Use switch, and holders can
  be chosen as before.
- `holder` may be `null` for a stage that is not offered.
- `size` is a count of bytes. Files are shown inline, fetched from the
  `files` path when opened; a file that is not text is not shown.
- An error answer may carry `{ error: "<words>" }`; the console shows those
  words as they are. A 401 or 403 asks the person for a new key.
- The service's answers are shown as text, never run as a page.
- Each build in the list shows `at.summary` when the service gives it, and
  the stage and its state when it does not. The same words head the build.
- The Board places each build from the list alone: in the column of the
  phase stages.json gives `at.stage`, or in Done when `at.state` is `done` or
  `stopped` or the build is archived. A service reports a build that is
  between stages at the next stage, not the one it finished, so `done` means
  the build ended. Waiting on me is `at.state` `waiting_on_you`.
- The Dashboard reads the list and each build. Time per stage is the median
  across builds of the sum of a stage's timeline bars, counted once none of
  them is open. Send-backs are rounds with `back: true`. Waiting now is from
  the list: `waiting_on_you` or `refused` is on a person, `working` is an
  agent working; builds in Done are left out.
- The list is read with `?archived=1`. Archived builds are hidden, with a
  "Show archived (N)" toggle at the foot of the list. `archive`,
  `unarchive` and `resume_agent` are actions like any other: one button each.

`lib/contract.mjs` holds these shapes as checks. A service author can run
their own answers through `checkBuildList`, `checkBuild`, `checkTry`,
`checkTries`, `checkRoles` and `checkStages`; each returns a list of
problems, empty when the shape is right. `checkStages(body, { stages, project })`
takes stages.json's stages, to check the order, names, phases and role ids,
and the project asked about, which the answer must echo.

The contract is written in the plan, docs/adlc-console-plan.md in the
AgentMesh repository, section "The contract, exactly". This copy follows it.
