---
title: HTTP server and client core: serve startup snapshot and single-GET repository operand — realized
date: 2026-09-05
author: agent
id: http-server-and-client
issue: http-server-and-client
plan: http-server-and-client
---

## Summary

Snap now has its HTTP layer: `http/server.ts` serves one immutable snapshot of the repository over the fixed `/repository.json` resource with exact-target request classification; `http/client.ts` fetches a repository operand with a single exact GET and returns a fully validated `Repository`; and `commands/serve.ts` plus an async serve arm in the CLI boundary turn `snap --serve [port]` (§7.9) into a running server that validates and snapshots at startup, prints the plain flushed URL, and exits 0 on SIGINT/SIGTERM. SPEC §9 gained the exact-target clarification sentence with a tests/12 regression step, and `ts/AGENTS.md` records serve's sanctioned impurity. The consumer commands (`diff --repo`, `merge <url>`) remain on their own strands.

## Plan Realized

### http-server-and-client

All eight tasks of `dev-docs/plans/approved/http-server-and-client.md` landed. Deviations from the plan's approach:

- `serve.test.ts` spawns the CLI through the `ts/snap` launcher (`sh <ts-root>/snap --serve 0`) rather than `tsx src/main.ts` as the task specified: the launcher `exec`s node, so the shell pid becomes the node pid — signals reach the server directly — and the test is cwd-independent. Same coverage.
- `server.ts` classifies methods with an `if`, not the sketched `switch`: `request.method` is `string | undefined` on the wire, and the repo's exhaustive-switch lint rule (plus the need to answer `undefined` sanely) forced the flattening.
- `client.ts`'s `transport` helper accepts `unknown` rather than `Error` — the rejects-as-Error lint discipline applies at the promise boundary too.

## Implementation

- `ts/src/http/server.ts` — `createSnapshotServer(body: Uint8Array): Server`. The handler is stateless over the captured bytes: any target other than exactly `/repository.json` (other path, or the fixed path with a query string) is `404` regardless of method; `GET`/`HEAD` on the exact target get `200` with `Content-Type: application/json; charset=utf-8` and `Content-Length: body.byteLength` (GET ends with the bytes, HEAD without); every other method on the exact target gets `405` + `Allow: GET, HEAD`. `request.method ?? ''` folds a malformed request line into the 405 path.
- `ts/src/http/client.ts` — `fetchRepository(url): Promise<Repository>`. Scheme chosen by `url.startsWith('https://')` (https vs http `get`); `node:http`/`node:https` never follow redirects, so a 302 is simply a non-200. Non-200: `resume()` to drain and release the socket, reject `HTTP <status>`. Request/response-stream errors reject `HTTP request failed: <code ?? message>` via `transport`. A 200 body is buffered and run through `toRepository`: `isText` (else `invalid JSON: body is not valid UTF-8 text`), `decodeUtf8` → `decodeRepository` (the strict reader lives inside) → `validateRepository` called for its §4.5 throw, returning the `Repository` itself.
- `ts/src/commands/serve.ts` — `serve(port, cwd, print): Promise<number>`. Startup order: `loadRepository` → `validateRepository` → snapshot bytes `encodeUtf8(encodeRepository(repository))` computed once → `createSnapshotServer` → `listen(port, '127.0.0.1')`. Listen errors reject `cannot listen on port <port>: <code>`; on listening, `print` receives `http://127.0.0.1:<actual-port>/repository.json\n` (the CLI's flushed stdout sink — the URL stays plain regardless of presentation mode), then `stopOnSignal` installs once-guarded SIGINT/SIGTERM handlers that call `close()` + `closeIdleConnections()` + `closeAllConnections()` and resolve `0`.
- `ts/src/cli/main.ts` — `run(argv, ctx): Promise<number>`. After `parseArgs`, a serve arm inside the existing try/catch awaits `serve(command.port, ctx.cwd, ctx.out.stdout)`; `execute` narrows to `ImmediateCommand = Exclude<Command, { kind: 'serve' }>` and drops its serve case, so its switch stays exhaustive over the nine immediate commands. `ts/src/main.ts` becomes `process.exitCode = await run(...)` (top-level await, ESM).
- Spec/docs/tests: SPEC.md §9 exact-target sentence; `tests/12-http-server.yaml` gained `POST <origin>/nope` → 404; `ts/AGENTS.md` Layout now names `http/` (snapshot server, repository client) and carves the serve exception out of the `commands/` purity clause.

## Behavior

- `snap --serve [port]` (default 8765, `0` OS-assigned): everything before `listen` is synchronous — locate, decode, §4.5 validate, encode — so a corrupt repository fails before the process becomes a server (`snap: repository has unknown field: bad`, exit 1, nothing printed to stdout). Once listening, the served bytes are the startup snapshot: later writes to `repository.json` on disk are invisible. SIGINT or SIGTERM tears the server down and exits 0, stdout exactly the URL line, stderr empty. Startup failures outside a repository, decode/validation failures, and listen failures (`EADDRINUSE`) all funnel through the one failure boundary as `snap: <detail>`, exit 1.
- Classification is target-first: 404 answers before any method is considered; 405 exists only on the exact target. The client performs exactly one request per call, never follows a redirect, and resolves only validated repositories — it is the trust boundary, so future consumers can use the value without re-validating.

## Tests

`cd ts && npm run check`: 338 tests / 61 suites green (from 322/58). New: `server.test.ts` (6) — the full wire matrix including `PUT /other` → 404 pinning target-before-method; `client.test.ts` (6) — canned routes with per-target hit counts: 200 → validated repository, 500 → `HTTP 500`, 302 → `HTTP 302` with zero hits on the redirect target and exactly one on the bait, invalid JSON, non-UTF-8, refused connection; `serve.test.ts` (3) — subprocess pins through the real CLI: snapshot immutability across a disk rewrite + SIGTERM exit 0, SIGINT exit 0, corrupt-repository startup failure; `main.test.ts` (11) — all `run` calls awaited plus a serve-arm test proving serve failures land in `run`'s single catch. Acceptance landscape: `--list` = 32; 01/02/14/24 green (27 green, pre-existing); tests/12 and tests/13 unchanged, still failing at their step-4 `commit` setup (the `snap/everyday-commands` dependency) — tests/12's new POST step sits after those steps and is unobservable until that strand merges.

## Decisions

- Subprocess tests spawn through the `snap` launcher rather than tsx directly — `exec` collapses shell pid into node pid, so a signal to the child is a signal to the server; without it SIGTERM tests would race a shell that never forwards.
- Teardown closes hard: `close()` + `closeIdleConnections()` + `closeAllConnections()`, then resolve — `close()` alone waits out keep-alive sockets (the harness's client pools them) and the process would hang. Resolving instead of awaiting the close callback lets the emptied event loop end the process 0.
- One-shot `{ agent: false }` requests in the in-process http tests — nothing pools sockets, so `after` never hangs.
- `serve` bypasses the pure `execute`/`emit` pipeline but stays inside `run`'s try/catch — one error path, one exit-code mapping for the whole CLI, async or not.
- The client returns the `Repository`, not `validateRepository`'s `ReplayResult` — the caller's contract is a trusted value; the replay result is each consumer's to derive.
- `transport(failure: unknown)` renders `code ?? message` — an unreachable server is an expected failure (`snap: HTTP request failed: ECONNREFUSED`, exit 1), never an internal error.
- `request.method ?? ''` folds the undefined-method corner into 405: a malformed request line is still "a method we don't serve on the exact target," which keeps the classifier total without a special case.

## Follow-Up

- `snap diff <old> <new> --repo <repository>` and `snap merge <url>` consume `fetchRepository` (Working tree / Concurrent replay strands); tests/13 goes green with them.
- After `snap/everyday-commands` merges: run `./verify --lang ts --filter 12-http-server` (the plan's documented post-merge check) — tests/12's new POST-non-target step becomes observable then.
