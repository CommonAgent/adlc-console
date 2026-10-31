# adlc console

A small page on your own computer that shows one build's journey through the
24 stages of the agentic development lifecycle (ADLC), and lets you act at the
gates that are yours: approve the spec, your OK on the code, approve the
install, and try the agent before you accept it.

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

## Point it at a service

By default it reads from `https://api.agentmesh.ai`. To read from another
service that implements the ADLC:

```
npx adlc-console --service https://api.example.com
```

For example, the AgentMesh development service is
`--service https://api.dev.agentmesh.ai`.

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

The page in your browser never holds the key. It talks only to the console's
local server, which adds the key and passes the request to the service. The
local server answers only its own page, so another web site cannot use it.

## Check your clone

When your own coding agent holds the Code stage, the stage shows the pull
request, the check's words, and a "Check my clone" box. Give it the folder
your clone of the pull request's branch is in, and it runs that branch's own
check, `node .adlc/check.mjs`, there, so you see a failure before you push.
That is the only command it ever runs, and only in a folder that holds
`.adlc/check.mjs`. The service key is not passed to it.

## Options

```
--service <url>     the lifecycle service to read (default https://api.agentmesh.ai)
--key-file <path>   read the service key from this file
--stages <path>     read the stages from this file instead of the copy shipped here
--port <n>          listen on this port (default: any free port)
--no-open           print the address but do not open the browser
--demo              made-up builds, no service needed
```

## The stages

The 24 stages come from `standards/stages.json`, shipped in this package: a
copy of the lifecycle's own `standards/stages.json` in the adlc repository
(CommonAgent/adlc). `npm run stages` refreshes the copy from there. A new or
changed stage reaches the console without a code change.

## For service authors

`docs/contract.md` lists every path the console calls and what it expects
back. `lib/contract.mjs` has those shapes as checks you can run against your
own answers.

## Working on it

```
npm test          # node:test, no dependencies
npm run demo      # the demo, on a free port
```

`design/mock.html` is the design the page follows.

## License

Apache-2.0. See LICENSE and NOTICE. Sponsored by AgentMesh.
