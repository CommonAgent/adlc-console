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

Proposed for lifecycle API 0.4 (all additive): products, each stage as a workspace, and
each product's chat with the agent holding a stage.

```
build adds artifacts?: [{ id, stage, name, by,       // by: the holder, in words
                          state,                     // made | next | later | not_made | not_run
                          kind,                      // statement | architecture | suite | programs | findings | security |
                                                     // package | build_record | run_plan | attestation | agentdoc | other
                          version?, digest?, at?, files?: [File],
                          summary? }]                // readable, per kind (below); in stage order, only stages the build uses
  summary per kind:
    statement { agent, offerings: [{ name, does }], refuses: [..], records: [..], price?, open: [questions] }
    suite     { count, tests: [names] }
    programs  { scripts: [{ path, lines, does? }], commit?, pr?: { number, url } }
    findings  { open: [{ place, claim, consequence }], verdict, outside?: [{ place, claim }] }
    security  { reach: [..], spend, never: [..], verdict }
    package   { file, digest, validated }
    run_plan  { stages: [{ stage, name?, holder | null, settings, reads }] }   // reads: chosen, not chosen or not used
    any other { words }

GET  /v1/lifecycle/products
  -> { products: [{ name, latest: { build, version, state, at: { stage, state, summary? } }, versions: [..] }] }
     // state: working | waiting_on_you | refused | stopped | done; versions newest first
GET  /v1/lifecycle/products/:name
  -> { name, builds: [{ id, version, state, at, created? }],          // newest first
       run_plan?: { build, version, at, summary, files? },            // the newest build's run plan
       activity: [{ at, build, version?, stage, words }] }             // newest first, one line per stage event
GET  /v1/lifecycle/builds/:id/stages/:stage
  -> { stage, name?, state, holder,
       given: [artifact id],                 // what it read: earlier stages' outputs, only those made
       outputs: [Artifact],                  // what it made
       gate?: { actions: [name], state: "open" | "answered", answered?: { by, at, action },
                closed?, who_may },          // closed: why it closed with no answer; who_may: words
       done_when }                           // words
GET  /v1/lifecycle/products/:name/stages/:stage/messages
  -> { messages: [{ id, at, from: { kind: person | agent | system, name, role?, stage }, to?: { role },
                    text, attachments?: [artifact id], build, version, proposes? }] }   // oldest first; no gate messages
POST /v1/lifecycle/products/:name/stages/:stage/messages   { text, build? }
  -> { message, reply }                      // reply.proposes?: { action, needs } names one of the build's live
                                             // actions for that stage; nothing changes until the person takes it
                                             // through the actions route. 400 { error } when a person, an outside
                                             // tool or nobody holds the stage.
```

How the console reads these:

- Opening a build opens the stage it is at now (`#/b/<id>/<stage>` opens any stage it uses).
  The left menu is the product: its name and the build's version, "Step N of M" and what it
  waits on, then the stages the build uses (not `not_used`, `not_offered` or `not_applicable`),
  each done, now or next. Then the other products, from GET /products (each with what its
  latest build waits on), New build, and the factory pages.
- The rest of the page is the selected stage. Its header stays put while the tab below it
  scrolls: the stage's name, its gate when there is one (the build's live actions for the
  stage; an answered gate in a done style, with who answered and when; a gate that closed with
  no answer, with `closed`), and its tabs.
- Chat: the stage's messages, each marked with its version, then the composer addressed to
  the stage's agent. A reply's `proposes` shows a confirm button that posts the build's own
  action with the needs filled. A service's refusal (400 for a stage a person, an outside tool
  or a harness holds) is shown in its own words.
- Artifacts: the stage's Given and Outputs, with the chosen one open in a reader per kind. The
  reader reads only the summary fields above, as words; it never shows raw JSON. An attachment
  in the chat opens this tab at that artifact; going back to Chat lands where it was.
- Try it, when the build has a pull request or an installed agent.
- `#/b/<id>/<stage>/<tab>` opens a stage at a tab (`chat`, `artifacts` or `try`).
- The product page (`#/p/<name>[/<tab>]`, the product's name in the menu) has tabs for the
  boss, its versions, the run plan (`run_plan.summary`) and the activity feed. It opens at the
  boss when the service has one (below), else at its versions.
- A service without these routes (a 404, 405 or 501) still gets the page: each stage is drawn
  from the build answer (its state, holder, rounds, log, live actions and handed-back words and
  files), its chat is made from its rounds and log and cannot be written to, the Artifacts tab
  shows the build's `artifacts` for the stage or what it handed back, and the product page is
  made from the build list. Other products are the other builds in the list.

Proposed for lifecycle API 0.4.1 (additive): the product's boss (Agent Roles §39, role-boss).

```
GET  /v1/lifecycle/products/:name/boss/messages
  -> { messages: [{ id, at, build, version, from: { kind: person | agent | system, name, role? },
                    text, confirms?, declines?,
                    routed?: { stage, message_id, build },          // the stage chat it posted into
                    plan?: [{ stage, words, gate? }],               // in the lifecycle's order; gate: words
                    proposes?: { id, build, action, needs, words?, when?, state? },
                    started?: { build, version },                   // only on the person's confirmation
                    dropped?: [{ stage, message_id, build }] }] }   // oldest first
POST /v1/lifecycle/products/:name/boss/messages   { text, confirms?, declines? }
  -> { message, reply }      // proposes.action is a build's own action (taken with the actions route,
                             // once the build offers it; when says when it will), or start_version,
                             // which is confirmed here with confirms: the boss then starts the version
GET  /v1/lifecycle/products/:name/boss/commitments
  -> { commitments: [{ id, at, kind: routed | proposed | started | dropped, to, stage?, what, build,
                       version, reply, message_id?, proposal?, answer?: { state, by?, at? },
                       confirmation?: { message_id, by, at }, withdraws? }] }   // in full, oldest first
```

How the console reads these:

- "Ask the boss" sits at the top of the left menu and opens the product page's Boss tab, the
  default place to talk about the product. A service that answers the boss routes 404, 405 or
  501 has no boss: the link is hidden and the tab is disabled.
- The Boss tab is a chat like a stage's, with its composer addressed to the boss. A routed reply
  links to the stage chat it went to (`#/b/<build>/<stage>/chat`). A plan is a short ordered
  list, each stage with the gate the person meets there. A started version links to its build.
- A proposal is a confirm button. "Start version 0.2.0?" (`start_version`) posts `confirms` to
  the boss. A build's own action posts to that build's actions route with the needs filled, so
  it goes back through its gate; until the build offers it, the button is disabled with the
  proposal's `when`, and the page reads the build again until it does. A taken, declined or
  closed proposal is shown done.

Read by the console since lifecycle API 0.4.2 (additive; stages.json 1.3.0): each stage's cadence.

```
stage (in a build, and a stage workspace) adds
  cadence?: every_build | setup | when_needed            // stages.json's cadence for the stage
  carried?: { since, build?, words }                    // a setup stage whose holder and settings are the
                                                        // same as an earlier version's: "Unchanged since 0.1.0"
GET /v1/lifecycle/products/:name adds
  setup?: [{ stage, name?, role, project?, state: chosen | not_chosen | not_used,
             holder: Holder | null, settings: {}, since: <version> | null, words? }]
             // every setup stage of stages.json, in order; since null: it holds from the next version
  when_needed?: [{ stage, name?, can_run, why_not?, action?: { build, name, label } }]
             // every when_needed stage, in order; why_not exactly when it cannot run,
             // action (a build's own, taken with the actions route) exactly when it can
```

How the console reads these:

- The spine is the build's steps: only its every-build stages, in the states the build gives
  them, so Review and Security review show as done when they ran inside Code's gate. A setup or
  when-needed stage is never drawn as a build step, whatever state it is in. A stage without a
  cadence takes stages.json's; with neither, it is a step, as before.
- The product page's Setup tab is a checklist of the setup stages: each with its role, its
  holder and settings in words, and since when it has held. Nobody chosen is marked to do,
  with a link to the Lifecycle page that opens that role's holder form, which saves through
  `PUT /roles/:role` (for the product's project when it has one). The tab's count is how many
  are to do. A service without `setup` has the tab disabled.
- The when-needed actions are buttons under the product's name. A button is enabled only when
  `can_run` is true and it names the action; it then posts that build's action. Every other is
  disabled, with `why_not` as its title and listed under "Why they are off".

Read by the console since lifecycle API 0.4.3 (additive): features.

```
statement summary adds features?: [{ id, name, does, offering, state: approved | proposed }]
message (a stage's chat, and the boss's) adds
  features?: [{ proposal, feature, name, does, offering, change: new | changed, was?,
                state: open | asked | approved | not_now | replaced,
                you_may_approve, approvers: [<words>], answered?: { decision, by, at },
                asked?: { by, at, to: [<words>] } }]
POST /v1/lifecycle/builds/:id/features/:feature/approve | not_now | ask   { proposal, message? }
  -> { feature, proposal, statement?, told? }   // approve: 403 in words for someone who may not
                                                // answer Requirements; they ask instead
round adds by_feature?: [{ feature, passed, total }]     // a test names its feature: "[F3] ..."
stage gate (at Requirements) adds open?: [<words>], features?: { approved, to_approve, backlog }
GET /v1/lifecycle/builds/:id/features
GET /v1/lifecycle/products/:name/features[?version=]
  -> { product, build, version, versions: [{ version, build }], columns, words?,
       features: [{ id, name, does, offering, state, backlog, badge: new | changed | unchanged,
                    cells: { spec, tests, code, review, docs:
                             { state: done | stale | missing | failing, words, tests?, link? } } }] }
GET /v1/lifecycle/products/:name/features/:feature
  -> { feature, history: [{ at, kind, words, by?, build, version, link?: { kind: message | artifact, ... } }] }
```

How the console reads these:

- A reply that proposes a feature shows it with **Approve feature** and **Not now**. Someone
  who may not approve sees **Ask <approver> to approve** instead; once asked, the approver sees
  the same proposal with Approve feature. An answered proposal says who answered and how. The
  buttons post to the build's feature route, and the chat is read again.
- At Requirements, a gate that carries `features` shows only what is still open and the
  features it starts building with; its approve button reads "Start building with these
  features". Features approved in a chat are marked approved, not asked again.
- The product page's **Features** tab is the matrix for the version chosen in its filter.
  A cell opens its artifact at that feature (the statement marks it, the suite shows the tests
  naming it); a row opens the feature's history, each entry linking to its message or artifact.
  From 0.4.5 the build's features are the Requirements stage's own Features tab instead (below).
  A service without the routes has the tab disabled.

Read by the console since lifecycle API 0.4.4 (additive): the guided setup and the when-needed actions.

```
GET /v1/lifecycle/products/:name adds
  setup[].form?: { ask?, reference_agent?: <agent> | null, shares?,
                   fields: [{ name, label, kind: number | text | choice, default?, unit?, options?, min?, max? }] }
  when_needed[].action.needs?: [Need]                   // a choice need has options and a default
  when_needed[].confirm?: { title, will, done_when?, steps?, who_may, you_may, from_version?, to_version?,
                            cannot_undo: [words], changes?: [{ stage, name?, from, to }] }   // only when can_run
  when_needed[].last?: { at, by?, ok, words, version?, build?, files? }
  running?: { build, version, words? } | null
  retired?: { at, by?, version, why?, words? }
POST /v1/lifecycle/builds/:id/actions/<when_needed stage>   (needs as words) answers { build, result?:
  { stage, ok, words, cannot_undo?, files?, report? } }; 403, 400 and 409 with the words
```

How the console reads these:

- With forms, the Setup tab is a guided flow: one card per setup stage, numbered, the first one
  to do open. An open card is a small form: who holds it (the reference agent only when the form
  names one, your agent with its handle, a person, an outside tool) and its fields, filled from
  the saved settings, then the defaults. Save reads `GET /roles` for the role's holder now and
  sends `PUT /roles/:role` (for the item's project) with the holder chosen, whose settings keep
  this stage's values under the stage's id beside the others. "Ask the boss" opens the Boss tab
  with the form's `ask` in the composer. Read only, the cards are not opened. Without forms, the
  tab is the 0.4.2 checklist.
- A when-needed button with a `confirm` card opens the card under the buttons: the title, what
  will happen and the steps, what changes, what can't be undone, the needs, who may act and
  when it is done. Confirm posts the action with the needs; it is disabled with `who_may` when
  `you_may` is false. The answer's `result` replaces the card (Impact's report shown in full); a
  refusal stays on the card in the service's words. Without a card, the button posts at once,
  as in 0.4.2.
- `running` and `retired` are a line under the product's name.

Read by the console since lifecycle API 0.4.5 (additive): features at every stage, and features
listed after the build.

```
build stage adds features?: { covered, total, words }        // "4 of 5 features", every-build stages
GET /v1/lifecycle/builds/:id/stages/:stage adds
  features?: { stage, covered, total, words,
               items: [{ id, name, state: done | to_do | failing | stale | findings, words,
                         tests?, passed?, of?, findings?: [{ place, claim, open }] }],
               untied?: { words, items: [<words>] } }
GET /v1/lifecycle/builds/:id/features adds
  features[].pending?: FeatureProposal, features[].from?: { build, message, stage? }, features[].tests?,
  unmapped?: [<test name>], backfill?: { offered, words }
POST /v1/lifecycle/builds/:id/features/backfill   {}  -> { message, reply }   // reply.features: proposals,
                                                        // each with tests?; 409 in words when not offered
POST /v1/lifecycle/builds/:id/features/approve_all   { proposals: [<id>], message? }
  -> { approved: [FeatureProposal], features: [FeatureEntry], statement? }   // 403 / 400 in words
```

How the console reads these:

- The Requirements stage's first tab is **Features**, before Chat and Artifacts, and the stage
  opens on it. It lists every feature with its state (approved, proposed, changed in this
  version, not now), what it does, a link to the message it came from, how many tests check it,
  and **Approve feature** and **Not now** (or **Ask <approver>**) inline while it waits. With
  more than one waiting, **Approve all** answers them together. The tests that check no feature
  are listed under it as not tied to a feature. With no features and `backfill` offered, it shows
  **List this product's features**, which posts the backfill and reads the stage again.
- Every other stage with `features` shows them at the foot of its Artifacts tab, one short line
  per feature (tests, passing, findings, documented), and what is not tied to a feature.
- The spine shows each stage's count beside its name.
- The product page's Features tab stays the matrix, the overview. The matrix no longer sits under
  the Requirements stage's Artifacts tab.

Read by the console since lifecycle API 0.4.10 (additive; CommonAgent/adlc#148): each feature of a
version in a run of its own.

```
GET /v1/lifecycle/builds
builds[] adds feature_runs?: [{ id, feature, name, started, at: { stage, state, summary? }, ended }]

GET /v1/lifecycle/builds/{id}
build adds feature_runs?: [{ id, feature, name, started, by, ended, at,
                             stages: [Stage],              // the run's own Test and Code
                             actions: [Action],            // each naming the run as run; empty once it ended
                             pull_request: PullRequest | null, log, timeline }]
Action adds run?: <feature_runs[].id>
TimelineBar adds run?: <feature_runs[].id>                  // on the build's timeline, a bar of that run

POST /v1/lifecycle/builds/{id}/actions/{name}
body adds run?: <feature_runs[].id>                         // sent whenever the action named one
```

How the console reads these:

- The **left menu** is the version's work: its steps before the runs' stages (Requirements, and
  whatever else it runs before Test), then **Features**, a line per feature run where the runs'
  stages were, then its steps after (Package and on). Each feature shows where it is, in the
  service's words, and opens its run at that stage; the open one shows its own Test and Code under
  it. The Features heading opens every run at once, the version's own page at those stages (below).
  The runs' stages are the features' steps, not the version's: the version's steps count on
  without them, and while any run is open the product's line is the version's `summary`.
- The **Board** gives each feature run a card of its own beside its version's, in the column of
  the run's own stage: the feature's name, the version, where it is and who it waits on. A run
  that ended goes to Done. While any of its runs is open, the version's card shows the service's
  words for how many features it is making, and **Waiting on me** counts the runs that wait on
  you, never the version that waits on them. A run's card opens that run at its stage.
- At **Test** and **Code** (the stages the runs hold), a row per run takes the gate card's place:
  the feature, its stage and state, its pull request, and its actions, drawn the way every action
  is, labeled without the run's own id since the row names it. The version's own actions at the
  stage, such as Stop, follow the rows. Every action of a run is posted with its `run`.
- Opening a row shows that run at the stage, as a build of its own made from the build answer: its
  stage's state and holder, its pull request's check, its rounds and log as the chat (read only:
  the stage's chat with its agent is the version's), what it handed back under Artifacts, each
  file asked for at `runs/<run id>/<path>`, and its own timeline. Closing the row goes back to
  the version's own view, where the timeline names each run's bars.
- A service with no `feature_runs` is drawn exactly as before.

Read by the console since lifecycle API 0.4.9 (additive): the skills of a stage's holder.

```
GET /v1/lifecycle/builds/{id}/stages/{stage}
holder adds skills?: [{ name, description?, text }]     // text: the SKILL.md as written, in full
         or skills_note?: <one sentence>                 // when the service cannot see them
```

How the console reads these:

- A stage page has a **Skills** tab, after Artifacts, when its holder lists skills or the
  service says why it cannot. Each skill is listed by name with its one-line description, and
  the chosen one, the first at the start, opens its SKILL.md in full in the reader beside them.
- A holder with `skills_note` shows that sentence on the tab, such as "Its skills are whatever
  your coding harness has installed".
- A holder that lists none (`skills: []`), a person, an outside tool and a service from before
  0.4.9 show no Skills tab. The build's stages may leave skills out; the console reads them
  from the stage workspace.

The Artifacts reader, in the same change: below the summary, the artifact's files sit under a
**Full text** heading that says how many there are, each as written, and an artifact's only file
is open. A suite's summary names every test it gives; "and N more" is said only for tests the
service counts but does not name.

Read by the console since lifecycle API 0.4.8 (additive): the spec (stages.json 1.6.0,
spec-v1). What Requirements hands back is the spec, the analysis of the product's functional
requirements and capabilities; the agent's own files (the statement artifact) are made at Design.

```
artifact kind spec, summary (SpecSummary):
  { product, purpose?,
    features: [{ id, name, does, offering?, as_built?,
                 requirements: [{ id, shall, kind?, exact?: [<words>] }],   // F1.R1
                 acceptance: [{ id, gherkin }] }],                         // F1.A1, Gherkin text
    interfaces?: [{ id, kind?, name, keep, about? }],                      // I1; keep: must stay exactly
    constraints?: [<words>], open: [<words>],
    systems?: [<words>], settings?: [<words>], price? }                    // drawn when a service gives them
```

How the console reads these:

- The Requirements stage has a **Spec** tab, after Features, when the stage hands back a spec:
  the product and its purpose, each feature with its requirements (the shall line, its kind, and
  the exact words in code style) and its Gherkin scenarios, then the interfaces with the ones to
  keep marked, the constraints, the systems, the settings and what is still open.
- The Features tab shows, under each feature the spec holds, its requirements and scenarios,
  folded, with their count.
- The Artifacts reader draws an artifact of kind `spec` the same way. The asset is named Spec;
  the agent's own files read as the `statement` kind always did.

Read by the console since lifecycle API 0.4.7 (additive): starting from an as-built record of
code kept elsewhere (stages.json 1.5.0), and the action back_to_requirements.

```
POST /v1/lifecycle/builds   { does, name, starting_point: "as-built-record",
                              source: { folder } | { repository, commit?, path? }, project? }
build source adds record?: { folder } | { repository, commit?, path? }
as_built summary adds brought?: { from, words }
action back_to_requirements at code, needs [{ name, label, kind: "words" }]
```

How the console reads these:

- New build offers a third choice, **Start from an as-built record**. It asks what the product is
  called and the record's folder on the service's computer, or a repository with an optional
  commit and path, and posts the start request above with `does` written for the person.
- The `as_built` reader's source line says where a brought record came from, in place of
  "On adoption". The build's `source.words` show on Reverse engineering, after "Started from
  existing code" or "Started from an as-built record".
- `back_to_requirements` draws through the generic action buttons, as every action does: its
  words need opens a paragraph box, and a chat reply that proposes it confirms with its words.
  An answered gate reads "Sent back to Requirements".

Read by the console since lifecycle API 0.4.6 (additive): starting from existing code
(stages.json 1.4.0, Reverse engineering, stage 0).

```
POST /v1/lifecycle/builds   { does, name, starting_point: "existing-code",
                              source: { repository, commit? } | { folder, commit? }, project? }
build adds source?: { starting_point?, trigger?, repository, commit, at?, words? }
artifact kind as_built, summary:
  { source: { repository, commit, ran, words? }, trigger: adoption | drift, since?,
    parts: [{ part: behaviors | architecture | interfaces | dependencies | tests_and_gaps,
              name, count, words, items: [<words>], file? }] }          // five, in that order
FeatureProposal and a matrix row add as_built?: { behavior, evidence: [<words>], commit?, change? },
  fix?: { id, feature, behavior, name, does, words?, state: proposed, by, at, build? };
  a row adds dropped?: { by, at }; a proposal's state adds bug | dropped
POST /v1/lifecycle/builds/:id/features/:feature/bug    { proposal, message?, words? }  -> { feature, proposal, fix }
POST /v1/lifecycle/builds/:id/features/:feature/drop   { proposal, message? }          -> { feature, proposal }
GET /v1/lifecycle/builds/:id/features adds fixes?: [FixItem]
GET /v1/lifecycle/products/:name adds source?: { repository, commit, build, version, current, drift, words }
```

How the console reads these:

- Reverse engineering reads "00" wherever a stage's number is shown. It is a step of a build that
  ran it, before Requirements, so the spine shows it as step 00; otherwise it is the product's
  when-needed action, like Impact or Rollback.
- New build offers **Start from an idea** and **Start from existing code**. The second asks what
  the product is called and a repository (with an optional commit) or a folder on the service's
  computer, and posts the start request above with `does` written for the person.
- The `as_built` reader shows the source line (repository, short commit, read or also run,
  adoption or drift and what it is described against), then each of the five parts with its
  count, words and items; a gap reads as one.
- A proposal or a Features tab row marked as built shows "As built" with its evidence and three
  answers: **Approve feature**, **This is a bug** (with an optional "What is wrong", sent as
  `words`) and **Drop**. One answered bug says a fix item was kept and never approved; one dropped
  says it is not kept. The matrix's `fixes` are listed under the Features tab and the matrix.
- The product's `source.words` stand beside the when-needed buttons, so a person sees why the
  Reverse engineering action is on (drift) or off.

Read by the console since 0.1 (CommonAgent/adlc, standards/lifecycle-api.schema.json, TimelineBar):

```
build adds timeline?: [{ phase, round, holder, kind, start, end, duration_ms, status,
                         stage? }]   // one bar per step per round, ordered by start
  // stage (optional): the stage of stages.json the step belongs to. The Dashboard
  // adds a stage's time from the bars that name it; a bar without one is not counted.
```

An addition a service may make, outside the lifecycle API standard (Product
Factory answers it from its history of builds; other services need not):

```
GET  /v1/lifecycle/analytics?window=7d|30d|all&project=<name>
  -> { window, project, from, to,
       weeks: ["YYYY-MM-DD", ...],           // the Mondays the window covers, oldest first
       projects?: [names],                   // for the page's project filter
       builds: [{ week, started, finished, stopped? }],
       stage_times: [{ stage, name?, weeks: [{ week, median_ms, builds }] }],
       send_backs: [{ stage, name?, rounds, back, rate, builds? }],   // over the window
       waiting: [{ week, person_ms, agent_ms }] }
```

Read by the console when a service keeps people (Product Factory's own, not yet in the lifecycle API):

```
GET /v1/lifecycle/me adds role?: member | approver | admin, teams?: [<team name>]
stage adds gate?: { you_may_answer, who: [<words>], words }   // on a stage waiting on a person:
  // whether this key may answer its gate, who may, and the service's sentence for it.
  // A gate this key may not answer has no actions offered for it.
GET /v1/lifecycle/people
  -> { organization, people: [{ name, email, role, teams }], teams: [{ name, members }],
       projects: [{ name, teams }], problems: [<words>], change: <words> }   // read only
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
- A stage whose `gate.you_may_answer` is false shows `gate.words` in place of
  the gate's buttons. A 403 with words on an action is shown as words too.
- The top bar shows `account.name` and `role` from GET /me. People shows in
  the rail only when GET /people answers; it draws the answer and offers no
  change.
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
- Analytics is shown in the rail only when the service answers
  GET /v1/lifecycle/analytics with weeks; a 404, or any other answer, keeps it
  hidden. The page passes on only `window` and `project`, and draws the
  service's answer as it is: it works nothing out itself.
- The list is read with `?archived=1`. Archived builds are hidden, with a
  "Show archived (N)" toggle at the foot of the list. `archive`,
  `unarchive` and `resume_agent` are actions like any other: one button each.

`lib/contract.mjs` holds these shapes as checks. A service author can run
their own answers through `checkBuildList`, `checkBuild`, `checkTry`,
`checkTries`, `checkRoles`, `checkStages`, `checkAnalytics`, and for 0.4 `checkArtifact`,
`checkProducts`, `checkProduct`, `checkStageWorkspace(body, { build })`, `checkMessages`
and `checkMessageReply(body, { build, stage })`; each returns a list of
problems, empty when the shape is right. `checkStages(body, { stages, project })`
takes stages.json's stages, to check the order, names, phases and role ids,
and the project asked about, which the answer must echo.

The contract is written in the plan, docs/adlc-console-plan.md in the
AgentMesh repository, section "The contract, exactly". This copy follows it.
