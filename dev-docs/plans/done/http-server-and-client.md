---
title: HTTP server and client core: serve startup snapshot and single-GET repository operand
date: 2026-09-05
author: agent
id: http-server-and-client
issue: http-server-and-client
research: []
designs:
- snap-ts-architecture
completed: 2026-09-05
closeout_notes: true
---

## Context

Issue `http-server-and-client` (stack `snap-1.0`, HTTP section, items 1–2) captures the missing HTTP layer: the `snap --serve [port]` snapshot server (§7.9, §9) and the HTTP repository operand client (§9). Everything the server and client need already exists — strict reader, repository codec, §4.5 validation, repository loading, the flushed single write point — so this plan wires them into `ts/src/http/` plus the `serve` command body. One cross-strand dependency shapes acceptance: tests/12's setup steps require `commit`, which belongs to the `snap/everyday-commands` strand (verified: tests/12 fails at step 4, `commit one`, before any `--serve` step on this branch). Per the interview decision, this plan pins the full server and client behavior in unit and subprocess tests now, and the suite's greenness is verified after that strand merges.

## Current State

- `ts/src/cli/args.ts:46` parses `--serve [port]` (default 8765, digits ≤ 65535, `invalid port: <text>`); `ts/src/cli/main.ts:93` dispatches `serve` to `notImplemented`. No `ts/src/http/` directory exists; design `snap-ts-architecture` reserves `http/server.ts`, `http/client.ts`, and `commands/serve.ts`.
- Building blocks landed: `decodeUtf8`/`encodeUtf8` (`core/bytes.ts:52`), `parseJson` + `JsonCursor` (`core/json.ts`), `decodeRepository`/`encodeRepository` (canonical two-space + trailing LF, `repo/model.ts`), `validateRepository` running §4.5 steps 2–6 (`repo/validate.ts:24`), `loadRepository` (`fs/locate.ts:65`), `SnapError`/`describeFailure` (`core/errors.ts`), and `run`/`Context`/`fdOutput` with sync `writeSync` sinks (`cli/main.ts`, `src/main.ts`).
- `run` is synchronous and every command is pure (arguments in, `CommandOutput` out); serve cannot be — it is long-running, async, and prints mid-flight (design decisions 9–10 sanction exactly this).
- The harness already supports `start`/`stop` with signals, `http_request`, and `start_http` with request counting (`test-harness/src/runner.ts`, `types.ts`), so both suites are runnable once consumers land.
- Landscape on this branch (45596ea): unit baseline 322 tests / 58 suites green (`cd ts && npm run check`); `./verify --lang ts` has 01/02/14/24 green, tests/12 failing at step 4 (`commit one`, exit 1) and tests/13 at its `commit remote` step — both before any HTTP step.

## Developer Feedback

Interview: one question (acceptance framing for the `commit` dependency). User chose: pin behavior in unit + subprocess tests now; verify suite green after the everyday-commands strand merges. Plan-author calls:

1. **Exact-target-first request classification.** The served target is exactly `/repository.json` (no query): `GET`/`HEAD` → 200; other methods on that exact target → 405 + `Allow: GET, HEAD`; every other target — different path or any query string — → 404 regardless of method. Rejected: method-first classification (405 for a `POST /other`) — it contradicts §9's sentence order and HTTP convention that 404 applies before a method is considered; neither is suite-pinned, so the plan adds the regression case (call 6).
2. **`run` becomes async; serve flows through the same failure boundary.** A serve arm inside `run`'s try/catch awaits the command so startup failures (outside a repository, corrupt `repository.json` — pinned by tests/12's last case) still funnel through `describeFailure` and `resolveModes`. Rejected: a special-case serve entry in `src/main.ts` (dodges the boundary and the exit-code mapping); rejected: fire-and-forget server inside sync `run` (untestable, unhandled-rejection risk).
3. **Signal shutdown closes connections hard.** On SIGINT/SIGTERM: `server.close()` + `closeIdleConnections()` + `closeAllConnections()`, once-guarded, then exit 0 via `process.exitCode`. Rejected: `close()` callback alone — keep-alive sockets from clients (the harness uses them) never drain and the process hangs.
4. **Snapshot bytes are computed once at startup** — `encodeUtf8(encodeRepository(repository))` after validation; `GET` serves those bytes with `Content-Length`; `HEAD` sends the same status and headers with no body. Rejected: per-request encode or disk re-read (§7.9 "serves the startup snapshot"; tests/12 pins post-commit immutability).
5. **The client is the full trust boundary**, returning a validated `Repository`: scheme guard, exactly one `get` via `node:http`/`node:https` (a redirect is just a non-200; nothing follows it), non-200 → `SnapError` `HTTP <status>` (pins tests/13's `HTTP 302`), transport error → `HTTP request failed: <code>` (an unreachable server is an expected failure, exit 1, not internal 2), body buffered to `Uint8Array`, non-text body → `invalid JSON: body is not valid UTF-8 text`, else `decodeUtf8` → `parseJson(text, 'repository')` → `decodeRepository` → `validateRepository`. Rejected: a bytes-returning client (both future consumers — `diff --repo`, `merge <url>` — would duplicate decode + validation).
6. **§9 gets one clarifying sentence plus a regression step** fixing exact-target semantics (any query or other path → 404 regardless of method; other methods on the exact target → 405), with `POST <origin>/nope` → 404 added to tests/12 — per root `AGENTS.md`'s rule that implementation-revealed ambiguities are corrected in the spec, not silently implemented.
7. **`commands/serve.ts` purity exception is recorded in `ts/AGENTS.md`** (Layout clause): serve is async and owns its writes until exit, per design decisions 9–10. Rejected: leaving the "pure: arguments in, output record out" clause contradicting the new file.
8. **Listen failures are expected failures**: `SnapError` `cannot listen on port <port>: <code>` (e.g. `EADDRINUSE`), exit 1. Unpinned by the suite; recorded so the plan author's choice survives.

## Approach

1. **Spec first**: add the §9 sentence and the tests/12 regression step (`POST` on a non-target path → 404) before the server exists.
2. **`ts/src/http/server.ts`** — `createSnapshotServer(body: Uint8Array): http.Server`. Stateless handler over the captured bytes implementing call 1's classification; headers `Content-Type: application/json; charset=utf-8` and `Content-Length` on 200.
3. **`ts/src/http/client.ts`** — `fetchRepository(url: string): Promise<Repository>` per call 5.
4. **`ts/src/commands/serve.ts`** — `serve(port: number, cwd: string, print: (line: string) => void): Promise<number>`: `loadRepository(cwd)` → `validateRepository` → snapshot bytes → `createSnapshotServer` → `listen('127.0.0.1', port)`; on listening, print `http://127.0.0.1:<actual-port>/repository.json` + LF; then install the once-guarded signal handlers (call 3); `error` event → the call 8 `SnapError`. `print` is `ctx.out.stdout` — the single flushed write point; the URL is plain.
5. **`ts/src/cli/main.ts` + `ts/src/main.ts`** — `run(argv, ctx): Promise<number>`; inside the existing try/catch: `if (command.kind === 'serve') return serve(command.port, ctx.cwd, ctx.out.stdout);` then `execute` narrows to `Exclude<Command, { kind: 'serve' }>` so its switch stays exhaustive over the nine pure commands. `src/main.ts` becomes `process.exitCode = await run(...)`; `main.test.ts` awaits `run`.
6. **Tests** (three new files, in Tasks).

## Tasks

- [ ] `SPEC.md` §9: exact-target clarification sentence; `tests/12-http-server.yaml`: add `POST` non-target step expecting 404.
- [ ] `ts/src/http/server.ts` + `server.test.ts`: in-process request matrix — GET 200 with exact `Content-Type`, `Content-Length`, and body bytes; HEAD 200 with empty body; POST on exact target → 405 + `Allow: GET, HEAD`; `/other` → 404; `/repository.json?x=1` → 404; `PUT /other` → 404 (precedence pin).
- [ ] `ts/src/http/client.ts` + `client.test.ts` against a local `node:http` test server: 200 with canonical repository JSON → returns the validated `Repository`; 500 → `HTTP 500`; 302 with `Location` → `HTTP 302` and exactly one request with zero hits on the redirect target; `not-json` body → `invalid JSON`; closed port → `HTTP request failed`.
- [ ] `ts/src/commands/serve.ts` + `serve.test.ts` subprocess tests spawning the CLI (`tsx src/main.ts`) in a temp repo with a hand-written canonical `repository.json` (no `commit` needed): ready on the stdout URL line; GET serves the snapshot; rewriting `repository.json` on disk leaves GET unchanged; SIGTERM → exit 0, stdout exactly the URL line, stderr empty; SIGINT → exit 0; corrupt repository (unknown field `bad`) → exit 1, stderr `snap: repository has unknown field: bad`, stdout empty.
- [ ] `ts/src/cli/main.ts` async serve arm + `ts/src/main.ts` await; update `main.test.ts`.
- [ ] `ts/AGENTS.md` Layout: carve the serve exception out of the `commands/` purity clause.
- [ ] `cd ts && npm run format && npm run check` green (suite grows from 322 tests / 58 suites).
- [ ] `./verify --lang ts`: 01/02/14/24 still green; tests/12 and tests/13 unchanged (still failing at their `commit` setup steps on this branch); `--list` = 32; record the post-merge check `./verify --lang ts --filter 12-http-server` green once everyday-commands lands.

## Documentation Impact

- `SPEC.md` §9: one clarifying sentence (call 6). `tests/12-http-server.yaml`: one regression step.
- `ts/AGENTS.md`: Layout clause update for the serve exception (call 7; per `agents-policy.md` this is a durable convention edit, not status).
- None for root `AGENTS.md`, `TEST-HARNESS.md` (harness already supports the steps), or `README.md` (surface list already shows `snap --serve [port]`).

## Acceptance Tests

- `cd ts && npm run check` green; unit pins: the full server matrix above, the client's single-request/no-redirect guarantee (request count asserted), `HTTP <status>` / `HTTP request failed` / `invalid JSON` fragments, and the subprocess pins for URL bytes, snapshot immutability, SIGTERM/SIGINT exit 0 with empty stderr, and the corrupt-repository startup failure.
- `./verify --lang ts` on this branch: landscape unchanged except the new tests/12 step (suite still stops at `commit one`).
- Post-merge verification (documented, run after everyday-commands lands): `./verify --lang ts --filter 12-http-server` green.
