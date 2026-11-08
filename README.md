# adlc console

A small page on your own computer that shows one build's journey through the
24 stages of the agentic development lifecycle (ADLC), and lets you act at the
gates that are yours: approve the spec, your OK on the code, approve the
install, and try the agent before you accept it.

A build opens at the stage it is at. The menu on the left is the product and its
build's stages; the page is that stage, with its gate on top when it waits on
you, and two tabs: Chat, to talk to the agent holding the stage, and Artifacts,
what the stage read and made. A product page lists its versions, run plan and
activity.

It holds no lifecycle logic. It reads the stage definitions, reads your builds
from a service that implements the ADLC, and shows the actions that service
offers. Every judgment stays with the service and its agents. It has no
accounts of its own.

## Start it

```
npx adlc-console
```

It starts on `127.0.0.1` on a free port, prints the address, and opens your
browser. Press Ctrl+C to stop it. It needs Node 22 or later and nothing else.

To look around without a service or a key:

```
npx adlc-console --demo
```

The demo shows made-up builds, including one waiting on you at Code with a
pull request, so every part of the page can be seen and clicked.

## The Board

Board, at the top of the rail, shows every build as a card in the column of
the phase its current stage belongs to (Define, Make, Ship, Prove, Use, Run,
Change), with a Done column at the end for the builds that finished, stopped
or were archived. A card gives the build's name and version, its stage, its
state in words, and who it waits on ("Waiting on you at Code"); clicking it
opens the build. Waiting on me shows only the builds waiting on you. The board
reads the same build list as the rail, and refreshes while any build is
working.

## The Dashboard

Dashboard, below Board in the rail, shows three things read from the build
records, never estimated:

- How long each stage takes: the median across builds, from each build's
  timeline. A stage counts for a build once it has finished, adding up every
  round, the agent's work and any wait on a person. Builds with no timeline
  are named as not counted.
- How often work is sent back at each stage: the rounds whose record says
  `back: true`, out of every round there.
- What is waiting now, stage by stage: builds waiting on a person (waiting
  on you, or refused and waiting for someone to say what next) and builds
  with an agent working.

Each is a plain table with a bar drawn in CSS. The page reads GET /builds and
GET /builds/:id, and refreshes while any build is working.

## Analytics

Analytics, below Dashboard in the rail, asks questions over time of a service
that keeps a history of its builds. It is shown only when the service answers
GET /v1/lifecycle/analytics, a route outside the lifecycle API standard that
Product Factory adds; for any other service it stays hidden. Choose the window
(the last 7 or 30 days, or all time) and a project. It shows, week by week:

- builds started and finished;
- the median time per stage;
- how often each stage's work is sent back, over the window;
- time waiting on people against time with an agent working.

Each is a plain table with bars drawn in CSS, from the service's answer as it
is. The demo answers the route with made-up weeks.

## People

When the service keeps people (it answers GET /people), each person opens
the console with their own key, and:

- the top bar says who they are and their role (GET /me);
- a gate they may not answer shows who may, in the service's words, instead
  of its buttons; a 403 on an action is shown as the service's words, not
  taken as a bad key;
- People, in the rail, lists the organization's people, teams, roles and
  projects. It is read-only; the service says where they are changed.

A service that answers neither route is drawn as before.

## Define your ADLC with no service

```
npx adlc-console --lifecycle ./lifecycle.json
```

This opens the Lifecycle page with no service, no key and no account, and
keeps everything you choose in one JSON file at that path, made if it is
missing: which of the 24 stages you use, who holds each role, and stages of
your own (Add a stage: say where it goes, its role, what it is given, what it
hands back, when it is done, whether a person must say yes, and who holds it),
for the organization and for each project. The file follows
`standards/lifecycle-document.schema.json`, is checked against it each time it
is read, and is written whole, so you can keep it wherever you like, edit it
by hand, or put it in a repository; the console only reads and writes the
file. There are no builds in this mode.

## Point it at a service

By default it reads from `https://api.agentmesh.ai`. To read from another
service that implements the ADLC:

```
npx adlc-console --service https://api.example.com
```

For example, the AgentMesh development service is
`--service https://api.dev.agentmesh.ai`.

## Point it at a GitHub org or repository

The console can also read agent repositories straight from GitHub, with no
lifecycle service:

```
npx adlc-console --github AgentMesh-Community            every agent repository in an org (or a user's)
npx adlc-console --github AgentMesh-Community/spec-writer one repository
```

A repository counts as an agent when it has `agent-repo.json` (format
`agent-repository-v1`, naming its `package`, `agentdoc`, `tests` and `source`).
Older repositories without it count when they hold `package/descriptor.json`
or `spec.json`.

What the repository holds is shown as stages:

- Requirements: the descriptor, the plugin, each skill's SKILL.md, and the spec if there is one.
- Test: the tests folder, or a line saying the repository holds no tests.
- Code: the scripts.
- Docs: agentdoc.json.
- Publish: the repository itself, with its address.
- Release: its releases, or its tags when there are no releases.

Every other stage shows as not offered. Each merged pull request that touched
a stage's files is one of that stage's rounds, with what its checks
concluded. Files open in the page, read from GitHub at the commit shown.
This view is read-only: there are no buttons, and Try it is hidden.

It works without a token, within GitHub's limit of about 60 reads an hour
for readers without one; the page says plainly when that limit is used up.
To read more, or to read private repositories, give it a GitHub token in
`GITHUB_TOKEN` or with `--github-token-file <path>`. Like the service key,
the token stays in the console's local server, is never shown in the page,
and is sent only to GitHub.

`lib/github.mjs` also exports `createGitHubClient`, a small client for a
lifecycle service that writes to GitHub (a branch, a pull request, a comment,
a commit status), so a service built on the console does not need a second
GitHub client. It caches nothing, answers every status as `{ status, body }`,
and sends its token only to its API address (api.github.com, or a GitHub
Enterprise Server's). The page itself never writes.

## Give it a key

The service decides how you make a key for your own account. Give it to the
console in one of three ways; the first one found is used:

1. The `ADLC_KEY` environment variable.
2. `--key-file <path>`, a file holding only the key.
3. Paste it into the page once. It is kept in your config folder
   (`%APPDATA%\adlc-console\keys.json` on Windows,
   `~/Library/Application Support/adlc-console/keys.json` on macOS,
   `~/.config/adlc-console/keys.json` elsewhere), readable only by you, one
   key per service. "Forget it" at the top of the page removes it.

A lifecycle service can also start the console in its own process and hand
it the key in memory, so you give it nothing and no file holds the key.
That key comes before the three above:

```js
import { createConsoleServer } from "adlc-console/lib/server.mjs";
import { createKeyStore } from "adlc-console/lib/keys.mjs";
import { openBrowser } from "adlc-console/lib/open.mjs";

const keys = createKeyStore({ service, key });       // the key, held in memory
const app = createConsoleServer({ service, keys });  // the shipped stages by default
openBrowser(await app.listen(0));
```

The page in your browser never holds the key. It talks only to the console's
local server, which adds the key and passes the request to the service. The
local server answers only its own page, so another web site cannot use it.

## Check your clone

When your own coding agent holds the Code stage, the stage shows the pull
request, the check's words, and a "Check my clone" box. Give it the folder
your clone of the pull request's branch is in, and it runs that branch's own
check, `node .adlc/check.mjs`, there, so you see a failure before you push.
The build folder is a folder of its own in the repository, `agents/<name>/`,
so the console looks there first; you may also point straight at it. A
repository can hold several hand-offs, an earlier one at its root among
them, and a check whose folder says it is another agent's is refused rather
than run. That is the only command it ever runs, and only in a folder that
holds `.adlc/check.mjs`. The service key is not passed to it.

## Options

```
--service <url>     the lifecycle service to read (default https://api.agentmesh.ai)
--key-file <path>   read the service key from this file
--lifecycle <path>  keep your lifecycle in this JSON file, no service needed
--stages <path>     read the stages from this file instead of the copy shipped here
--port <n>          listen on this port (default: any free port)
--github <name>     read agent repositories on GitHub: an org, a user, or owner/repo
--github-token-file <path>  read a GitHub token from this file (or set GITHUB_TOKEN)
--no-open           print the address but do not open the browser
--demo              made-up builds, no service needed
```

## The stages

The 24 stages come from `standards/stages.json`, shipped in this package: a
copy of the lifecycle's own `standards/stages.json` in the adlc repository
(CommonAgent/adlc). `npm run stages` refreshes the copy from there. A new or
changed stage reaches the console without a code change.

## Lifecycle

The Lifecycle page defines your lifecycle on one screen. It lists the 24
stages by phase. For each stage you choose whether your lifecycle uses it, and
who holds its role: the service's own agent, your own agent, a contracted
supplier, a person, or an outside tool, with the evidence it hands in. Stages
that share a role, such as Deploy and Rollback, share its holder. A line at the
top counts the stages used and who holds them.

Some stages the service cannot build without. Their switch cannot be turned off, and
the service says why. You can choose for the whole organization or for one
project, and go back to the organization's choices or the default. A build
keeps the lifecycle it started with: a stage it leaves out is struck through,
and its page says which lifecycle the build follows. A stage held outside the
service shows the evidence its holder handed in, such as security findings or
a bill of materials.

## For service authors

`docs/contract.md` lists every path the console calls and what it expects
back. `lib/contract.mjs` has those shapes as checks you can run against your
own answers.

## Working on it

```
npm test          # node:test, no dependencies
npm run demo      # the demo, on a free port
```

`design/lifecycle.html` is the design of the Lifecycle page. The build page follows the approved build-thread design: one stage at a time, with Chat and Artifacts tabs. `design/mock.html` is the earlier stage-chips design.

## License

Apache-2.0. See LICENSE and NOTICE. Sponsored by AgentMesh.
