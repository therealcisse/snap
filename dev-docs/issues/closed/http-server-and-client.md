---
title: HTTP server and client core: snap --serve snapshot server and single-GET repository operand
date: 2026-09-05
start-date: 2026-09-05
author: agent
id: http-server-and-client
stack: snap-1.0
closed: 2026-09-05
---

## Problem

Snap can move a repository between clones only by copying files. The product contract's read-only HTTP mode — serving one immutable repository snapshot and reading a repository from a URL — has no implementation, so history cannot be exchanged across machines or working copies over the network at all.

Two capabilities are missing per stack `snap-1.0`'s HTTP section. First, `snap --serve [port]` (§7.9, §9): `ts/src/cli/args.ts` already parses the invocation (default port 8765, `0` asking the OS to select one), but `ts/src/cli/main.ts` dispatches `serve` to `not implemented` and no `ts/src/http/` layer exists. The server must validate and snapshot the current repository at startup, bind `127.0.0.1` only, print and flush the plain startup URL `http://127.0.0.1:<actual-port>/repository.json`, serve `GET`/`HEAD /repository.json` with `Content-Type: application/json; charset=utf-8` from the startup snapshot, answer `404` for other paths and `405` with `Allow: GET, HEAD` for other methods, and exit 0 on SIGINT or SIGTERM. Second, the HTTP repository operand (§9): when a repository operand starts with `http://` or `https://`, Snap performs exactly one GET of that exact URL via `node:http`/`node:https`, never follows redirects, requires status 200, buffers the body into the strict reader, and validates it normally. The client gets unit tests against a local test server covering 200, non-200, and redirect refusal.

## Impact

- `tests/12-http-server.yaml` fails at its `--serve` step (`not implemented: --serve 0`): the pinned surface — startup URL bytes, GET/HEAD with the exact content type, `404` for non-exact paths including query strings, `405` with `Allow`, snapshot immutability across later commits, SIGINT/SIGTERM exit 0 with empty stderr, and exit 1 `snap: <detail>` on a corrupt repository at startup — has no enforcer.
- `tests/13-http-client.yaml` is blocked: its client checks (single GET per URL, `HTTP 302` redirect refusal, strict parse of a non-JSON body) ride on `diff --repo` and `merge <url>`, strands that do not exist yet.
- Stack `snap-1.0`'s HTTP section cannot advance: both consumer items (`snap diff <old> <new> --repo <repository>` and `snap merge <url>`) build on this core.

## Context

- Already landed: `cli/args.ts` serve grammar with port validation (digits only, ≤ 65535, `invalid port: <text>`); strict JSON reader `core/json.ts` (never `JSON.parse`) for the client's buffered body; repo decode, canonical two-space encode, §4.5 validation, and linear replay from issue `repo-model-and-validation`, so startup validation and the canonical served bytes have building blocks; `fs/locate.ts` repository loading.
- Locked by design `snap-ts-architecture` and `ts/AGENTS.md`: `src/http/` is the reserved module home; HTTP uses `node:http`/`node:https` directly, never global `fetch` (an ESLint ban); asynchronous I/O is permitted only in `--serve` and the HTTP client; all standard-stream writes go through `cli/main.ts` with `fs.writeSync` and `process.exitCode`, never `process.exit` after a write; the `--serve` startup URL always remains plain regardless of presentation mode (§7.11).
- Spec anchors: §7.9 (startup validation and snapshot, `127.0.0.1`-only bind, port default 8765 with `0` OS-assigned, plain flushed URL, serve until SIGINT/SIGTERM then exit 0); §9 (the fixed `/repository.json` resource with exact content type, `404`/`405` with `Allow`, and the operand client's one exact GET, status-200 requirement, strict parse, normal validation, read-only); §7.11 (serve URL stays plain); §10 (one-line `snap: <detail>` errors, exit codes 0/1/2).
- The client unit tests run against a local test server because the pipes-only YAML harness cannot pin the single-request/no-redirect guarantees until the consumer commands exist.

## Out of Scope

- `snap diff <old> <new> --repo <repository>` local and HTTP wiring with cross-repository dot check (§7.6) — depends on the Working tree and everyday commands strand.
- `snap merge <url>` (§7.8) — depends on the Concurrent replay and merge strand.
- `tests/13-http-client.yaml` green (it rides on those consumers).

## Plan Closeout Notes

<!-- plan-close-review: http-server-and-client -->

- Scope: no drift; all eight tasks landed as planned. One letter-level deviation recorded in the realized design: `serve.test.ts` spawns the CLI through the `ts/snap` launcher rather than `tsx src/main.ts` (the launcher's `exec` makes the shell pid the node pid, so signals reach the server; also cwd-independent).
- Documentation impact: implemented exactly as planned — SPEC.md §9 exact-target sentence, `tests/12-http-server.yaml` POST non-target → 404 regression step, `ts/AGENTS.md` Layout serve carve-out; nothing additional surfaced.
- Guidelines / conventions: serve's sanctioned impurity (async, prints its own startup URL, resolves on a signal) is recorded in `ts/AGENTS.md` Layout; no other new or extended conventions.
- Comments / docstrings: conform — new comments in `http/`, `commands/serve.ts`, and the CLI changes are why-comments citing SPEC sections; no violations flagged.
- Stack items satisfied (snap-1.0, HTTP section): item 1 `snap --serve [port]` (§7.9, §9 — tests/12) implemented and unit/subprocess-pinned; `tests/12` green pends the `snap/everyday-commands` merge (post-merge check `./verify --lang ts --filter 12-http-server` documented in the plan). Item 2 HTTP repository operand core (single GET, status 200 required, no redirects, strict parse, §9) implemented in `fetchRepository` with unit pins; `tests/13` green rides on items 3–4's strands. Items 3 (`diff --repo`) and 4 (`merge <url>`) remain for their own issues.

<!-- /plan-close-review -->
