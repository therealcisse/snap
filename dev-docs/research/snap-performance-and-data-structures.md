---
title: "Snap performance and data structures"
date: 2026-09-04
author: agent
id: snap-performance-and-data-structures
---
# Snap performance and data structures

## Motivation

`SPEC.md` fixes Snap's observable behavior but says almost nothing about cost. A straightforward implementation validates and replays the whole history on every command (SPEC.md §4.5), computes an `O(n·m)` text diff for every concurrent text change (§5, §6.2), and reads and rewrites one unbounded `repository.json` (§4.1, §12). This document maps where CPU and memory go in such an implementation, which data structures the spec implies, which Node.js/TypeScript behaviors silently violate the spec, and how much of this matters for passing the acceptance suite versus for real use. It informs the implementation plan; it does not prescribe one.

Throughout, `P` is the number of patches, `k` the number of contributors, `F` the number of tracked files, `S` total tracked bytes, `H` the byte size of `repository.json`, and `n`, `m` token counts of the two sides of a diff.

## Scale baseline: what the acceptance suite actually exercises

The public suite is small and correctness-oriented. Measured from `tests/` on 2026-09-04:

- 28 cases, 3303 YAML lines, 89 KB in total.
- About 300 `run` steps (each a fresh `snap` process), 41 `merge` invocations, 29 `copy_tree` steps, 127 `write_file` steps.
- The largest text fixture is five lines (`tests/22-ot-matrix.yaml`, `"0\n1\n2\n3\n4\n"`). Most files are one to three lines.
- The highest revision number in any fixture is 2; the largest version has four contributors (`tests/18-three-way-convergence.yaml`, `(a@x->1,b@x->1,c@x->1,seed@x->1)`).
- Histories have at most about six patches per repository. No fixture has more than a handful of tracked paths.
- Whole-case timeout defaults to 30 s (`TEST-HARNESS.md`, "Stable YAML envelope"; `test-harness/src/runner.ts:53`); only `tests/22-ot-matrix.yaml` raises it to 60 s. Each stream is capped at 16 MiB (`TEST-HARNESS.md`, "Completed command").

The dominant cost in the suite is therefore process startup, not algorithms. The harness runs `ts/snap`, which executes `node node_modules/tsx/dist/cli.mjs src/main.ts` (`ts/snap:5`). On this machine (Node v24.9.0, V8 13.6) the stub `main.ts` takes 0.12–0.17 s per invocation, versus 0.03 s for bare `node -e 0`. The harness sets `TMPDIR` to a fresh per-case sandbox (`test-harness/src/process.ts:25`), and tsx keeps its transpile cache under `os.tmpdir()` (`ts/node_modules/tsx/dist/temporary-directory-*.mjs`), so every case starts with a cold tsx cache; with the one-line stub the difference was 0.15 s cold versus 0.12 s warm. A 31-step case (`tests/28-terminal-presentation.yaml`) spends roughly 4–5 s in startup alone, well inside 30 s, but a multi-module implementation will add cold-transpile time per process, so heavy top-level imports and large module graphs are the one "performance" item that can plausibly affect the suite.

Everything else in this document about asymptotic cost concerns real use (repositories with thousands of patches, hundreds of files, multi-thousand-line files), not the suite. That is stated per section below.

## Core data structures implied by the spec

### Version (vector clock)

§3.2 defines two canonical forms: the CLI string `(id->n,id->n)` sorted by unsigned UTF-8 bytes of the id, and the JSON form as an ordered array of `[id, revision]` pairs. §3.3 defines four comparison outcomes plus `join`; §3.4 defines the Snap total order over the sorted union of ids.

Options:

- Sorted array of `[id, rev]` pairs. Matches the JSON form directly; every §3.3 and §3.4 operation is a single merge-walk over two sorted arrays in `O(k1 + k2)`, producing all four outcomes (`=`, `<`, `>`, `||`) in one pass by tracking "some strict less" and "some strict greater" flags. Lookup of one contributor is `O(log k)` or `O(k)`. Canonical string is a trivial join.
- `Map<string, number>`. `O(1)` lookup, but iteration order is insertion order, so every output and every Snap-order comparison must sort first; equality and comparison need a union of keys anyway. No asymptotic advantage at Snap's `k`.
- Either representation plus a cached canonical string used as the identity key. This is required regardless: JavaScript `Map`/`Set` compare keys by SameValueZero, so two structurally equal arrays are different keys (ECMA-262, Map objects). Memo tables keyed by version (see §6.2 below) must key by the canonical string.

A useful observation for §6.1 replay: the set of already-integrated patches is itself a version `I` (per-contributor max integrated revision), because per-contributor revisions must integrate in order (each `(c, n)` has `(c, n-1)` in its base by §4.2). A patch is ready iff `base <= I` componentwise, an `O(k)` check.

Vector-clock semantics (absent component is zero; concurrent iff neither dominates) follow Fidge and Mattern's formulation; §3.3 is a direct restatement.

### Patch and the patch DAG

A patch is `{author, revision, base: Version, message, changes[]}` (§4.1). Its result is derived, not stored: `base` with `author -> revision` (§4.2). Structures the spec implies:

- Dot index: `Map<author, Patch[]>` where the array index is `revision - 1`. §4.5(2) requires contiguous revisions per contributor, so this is dense, dot lookup is `O(1)`, and the "sorted by author then numeric revision" check is a linear scan.
- Base closure: version `V` selects `{(c, n) : n <= V[c]}` (§4.1, §6.1). Because revisions are contiguous, the closure of a base is present iff `(c, base[c])` exists for every component, so checking closure for all patches costs `O(P·k)`, not `O(P²)`.
- Acyclicity (§4.5(4)): the spec's own replay doubles as cycle detection — "If no ready patch remains before replay is complete, the history has a cycle or missing dependency" (§4.5). That is Kahn's algorithm: repeatedly remove a node with no unintegrated predecessors; leftover nodes imply a cycle. No separate DFS is needed.
- Structural equality of patches (§3.5, §4.2, §7.6): "parsed typed values are structurally equal". `tests/26-portability-and-failure-safety.yaml` (lines 121–164) merges two repositories whose patches differ only in JSON key order and whitespace and expects success. A canonical serialization of the typed value (fixed field order, no whitespace) compared as a string is `O(patch size)` and avoids a hand-written deep-equal.

### Tree (path → bytes)

The current tree is a "path/byte map" (§2). Paths sort by unsigned UTF-8 bytes (§2). Natural representation: `Map<string, Uint8Array>` with sorting deferred to output (`status`, `diff`, `changes` ordering in §4.2), costing `O(F log F)` comparisons per sort.

Prefix-freeness (§2) is not an adjacent-pair check after sorting: `a`, `a-x`, `a/b` sort in that order because `-` (0x2D) precedes `/` (0x2F), so `a` and `a/b` are not adjacent. A correct check is: for each path, look up every proper ancestor prefix in a `Set` of paths, `O(total segments)`. The same ancestor set answers the §6.2 namespace question "does a path in `S` have a current ancestor in `C'`"; the descendant question ("current descendant") needs either an `O(F)` scan per incoming path or a maintained set of implied directory prefixes.

Trees are logically immutable per version (invariants 1.1(4)–(5)). A copy-on-write `Map` copy costs `O(F)` per integrated patch, while file contents (`Uint8Array`) can be shared by reference between versions because nothing mutates them. Persistent hash tries would make copies `O(log F)`, but `ts/AGENTS.md` restricts production code to Node built-ins, so that is a trade-off against writing one in-repo.

### Text tokens

A file is text iff its bytes are valid UTF-8 and contain no NUL; it is split immediately after every LF, LF retained (§4.4). Tokens are naturally `string[]` (they must become JSON strings in `insert` operations anyway). Two representation points:

- Bytes remain the source of truth (§2 "arbitrary bytes"); the decoded string is derived. Round-tripping valid UTF-8 through a JS string and back is lossless provided the decoder does not strip a BOM (see pitfalls).
- `O(n·m)` diffs compare tokens `O(n·m)` times. V8 compares two strings of equal length byte-by-byte unless they are the same object or internalized. Mapping each distinct token to a small integer first (`Map<string, number>`, `O(n + m)`) turns the inner loop into integer compares and preserves the §5 result exactly, because only equality is used.

### Edit scripts

`{retain: n} | {delete: n} | {insert: string[]}` with no adjacent same-kind operations and full consumption of the old sequence (§4.4). Applying a script is `O(n + m)`. A discriminated union with an exhaustive switch matches the harness's own style (`TEST-HARNESS.md`, "Implementation layout"). Coalescing (§5 step 5, §6.3) is a single pass.

### Warning set

§6.4: unique `(path, reason)` pairs sorted by path then reason; `merge` prints pairs present in the joined replay but absent from the pre-merge local replay. A `Set<string>` keyed by `path + "\0" + reason` (NUL cannot appear in a path, §2) or `Map<path, Set<reason>>` suffices; sorting happens once at the end with the byte-order comparator. The set difference implies `merge` needs the warning set of two replays: the local validation replay (§4.5(6)) and the joined replay (§7.8).

## Per-algorithm cost

### §5 canonical diff

The recurrence `D(i, j)` over suffixes is the classic edit-distance table with unit insert/delete costs (Wagner and Fischer 1974); `D(0, 0) = n + m - 2·LCS(A, B)`. Filling it is `O(n·m)` time and space. As a flat `Int32Array` of `(n+1)(m+1)` cells: 1 000×1 000 lines is 4 MB, 5 000×5 000 is 100 MB, 10 000×10 000 is 400 MB and roughly `10^8` cell updates (hundreds of milliseconds to seconds in JS). This is the only super-linear algorithm the spec mandates and the first thing that hurts on real files.

The walk (§5 steps 1–4) needs `D(i+1, j)` and `D(i, j+1)` at every visited cell, and those cells are only known as the walk proceeds, so two-row space reduction alone does not work: either keep the full table, or recompute.

What §5 permits: "Implementations MAY use Myers, Hirschberg, or another optimization only if it produces the same script, including for repeated equal lines" (§5). The constraint is the tie rule: when several minimal scripts exist (which is exactly the repeated-lines case), §5 selects one by "retain if equal, else delete when `D(i+1, j) <= D(i, j+1)`". Consequences:

- Stripping a common prefix is safe: step 1 retains whenever `A[i] == B[j]` regardless of `D`, which is exactly what a prefix strip does.
- Stripping a common suffix is not safe. Verified on `A = [b]`, `B = [a, b, b]`: the recurrence yields `insert a, retain 1, insert b`; stripping the shared trailing `b` first yields `insert a, insert b, retain 1`. Both are minimal; only the first is canonical. `tests/05-diff-goldens.yaml` exists precisely to pin such choices (`a b a -> b a a` must produce `delete 1, retain 2, insert [a]`).
- Myers (1986) finds some shortest edit script in `O((n+m)·D)`; its greedy furthest-reaching path selection has its own, different tie preference. Hirschberg (1975) reduces space to `O(n + m)` by divide-and-conquer on the middle row; any optimal split point is fine for LCS length, but reproducing the §5 walk requires choosing the split that the deletion-on-tie walk would pass through, which needs a proof, not just a port. Either could be made conformant, but conformance must be demonstrated against the recurrence on repeated-line inputs, and the suite's goldens are the only public check.
- Safe fast paths that need no proof: identical token arrays (all retain), one side empty (all insert or all delete), prefix trim, token interning, typed-array table.

### §6.1 patch selection

Each iteration finds ready patches and picks the least by (Snap order of result, author bytes, revision). Naively rescanning all unintegrated patches per iteration is `O(P² · k)`. With the `I` vector above, readiness is an `O(k)` compare, and a priority queue keyed by result version gives `O(P · log P · k)`. At suite scale (`P <= 6`) the naive rescan is indistinguishable.

Two properties reduce work further. First, for a valid history the tie-breakers 2–3 never fire: two distinct patches with equal result `R` would each contain the other's dot in their base (`base1 = R` minus own dot contains `(b, m)`, and symmetrically), which is the cycle §4.5 rejects; §6.1's "Valid histories normally decide at the first key" is a consequence. Second, for a single-contributor chain the ready set has one element at every step.

### §6.2 integration and the exact base tree `B`

§6.2 requires `B`, the tree at `P.base`, not the canonical tree so far `C`. If `materialize(V)` is implemented as "replay the closure of `V`" and each inner integration recursively materializes its own base without memoization, cost is exponential even for a linear chain: `T(P) = Σ_{i<P} T(i) + O(P)`, because integrating `a_i` re-materializes `a_{i-1}`, which re-materializes `a_{i-2}`, and so on. Memoizing by canonical version string bounds this: at most `P + 1` distinct versions (every base plus the frontier) are ever materialized, each by one replay of at most `P` patches whose inner base lookups now hit the memo, giving `O(P²)` integrations worst case and `O(P)` in the common cases below.

Two observations remove most of the work without a general memo:

- If `I == P.base` (the integrated vector equals the base), then `C == B` exactly: the integrated set is `{(c, n) : n <= I[c]}` by contiguity, which is `closure(base)`, and by invariant 1.1(5) the same patch set yields the same tree. This is every patch in a linear history and every non-concurrent patch in a merged one; §6.2 rule 1 then applies to every path.
- The top-level replay passes through a sequence of `(I, C)` states. Snapshotting `C` (an `O(F)` `Map` copy with shared byte arrays) whenever `I` is a version that some later patch names as its base seeds the memo for free. Only bases that the top-level order never passes through (genuinely concurrent interleavings) need a separate sub-replay.

Cost per integration beyond base lookup: `O(F)` for the tree copy, plus per changed path either `O(size)` byte comparison (rules 1–2) or an `O(n·m)` diff `Q = diff(B, C)` and an `O(|P| + |Q|)` transform (rule 3). The diff dominates whenever two contributors touch the same text file concurrently.

Warnings from sub-replays used only to materialize a base are a subtlety the spec does not address explicitly. §6.4 says "Replay returns the set of unique warning pairs", singular; the top-level replay integrates the same patches and produces its own warnings, so the natural reading is that sub-replay warnings are discarded, not unioned. This is listed under open questions.

### §6.3 transform

Linear: each step consumes at least one operation from `P` or `Q` after at most one split, so output length is at most `|P| + |Q|` and time is `O(|P| + |Q|)`. The cost that matters is producing `Q` (a §5 diff), and §6.3 confirms this happens once per (patch, path) against the aggregate context, not once per historical patch.

### §4.5 validation on every command

"Before using a repository, Snap validates" all six items including "deterministic replay of the declared frontier" (§4.5(6)) and "every change against its materialized exact base" (§4.5(5)). Every command that opens a repository (`status`, `log`, `commit`, `diff`, `revert`, `merge`, `--serve`) therefore pays, per invocation:

- `O(H)` to read and parse `repository.json` (see memory section for the JSON ceiling).
- `O(P · changes · k)` schema, ordering, closure and dot checks.
- One full replay: `O(P · F)` map copies plus `Σ` per-change costs, with an `O(n·m)` diff for every concurrent text change ever recorded.

History is append-only with no GC (§12) and `revert` appends rather than removes (§7.7), so this grows without bound. Order-of-magnitude: 1 000 patches over 100 files with 100-line text files and little concurrency is `~10^5` map operations and `~10^5` token operations — milliseconds. 10 000 patches over 1 000 files is `10^7` map copies — hundreds of milliseconds per command. A history with hundreds of concurrent edits to a 5 000-line file adds hundreds of 25-million-cell diffs — tens of seconds per command. Because §4.5 mandates the replay, only the constant factors (memo, `I == base` shortcut, interning, typed arrays) can be improved; caching across processes would require on-disk state the spec does not define.

`merge` performs this replay three times: local validation, remote validation (§7.8 "Loads and validates the other repository"), and the joined replay. `diff --repo` performs two validations plus up to two materializations (§7.6), and additionally compares every dot present in both repositories structurally (`O(min(P) · patch size)`).

### §7.5 commit

`commit` "Diffs the complete current tree against the complete working tree" (§7.5). Costs: the validation replay (yields the current tree — it should be reused, not recomputed); a working-tree walk reading every file fully, `O(F)` syscalls and `O(S)` bytes, since nothing like mtime or hash caching exists (§12 "no object hashes"); a sorted merge of the two path sets, `O(F)`; a §5 diff per changed text path; then `JSON.stringify` of the entire repository, `O(H)`, and an atomic rename (§10). Because the whole file is rewritten each commit, cumulative write I/O over a repository's life is quadratic in the number of commits.

### §7.6 diff, §7.7 revert, §7.8 merge

`diff` with no arguments is the read-only half of `commit`. `diff <old> <new>` materializes two known versions (memo helps when both are on the replay path). `revert` is `diff` plus authoring a patch and installing the target tree. `merge` is: two validations, a patch-set union keyed by dot with structural-equality checks on collisions (§3.5), a frontier join (`O(k)`), a third replay, the warning set difference, a working-tree delta write, and the metadata rename. Because `merge` and `revert` require a clean tree (§2, §7.7, §7.8), the working tree equals the current tree at start, so installation is a delta from the current tree to the target tree, `O(changed paths)`, not a full rewrite.

## Memory

- Materialized trees. Holding one `Map` per memoized version costs `O(F)` entries each, but byte arrays are shared, so total bytes are `O(unique content)`. Recomputing instead of caching trades the `O(P²)` replay cost above for `O(F)` memory. Restricting the memo to versions that actually appear as bases (a `Set` of canonical strings collected in one pass) bounds the cache at `P + 1` maps.
- Bytes versus strings. File contents must stay `Uint8Array`/`Buffer` (§2 arbitrary bytes; `put` may hold any bytes, §4.3). Text files additionally exist as JS strings for tokenization and JSON. V8 stores strings as one-byte (Latin-1) or two-byte (UTF-16) sequences (`v8/src/objects/string.h`); a single character above U+00FF makes the whole string two-byte, so a decoded non-Latin-1 text file costs up to 2× its UTF-8 size, and a `repository.json` containing one such character anywhere costs 2× `H` while it is a string.
- Base64. `put` content is padded RFC 4648 base64 (§4.3), a 4/3 expansion on disk and in the parsed string; decoding allocates the bytes again. Peak memory during load is roughly `H` (file text) + parsed values (including the base64 string a second time) + decoded bytes, i.e. three to four times the binary payload.
- Whole-repository JSON. `JSON.parse` is all-or-nothing and Node has no built-in streaming parser. V8's maximum string length on this Node is 536 870 888 UTF-16 units (`buffer.constants.MAX_STRING_LENGTH`), so a `repository.json` beyond roughly 512 MiB cannot be read as a string at all — a hard ceiling that §12's "no garbage collection" and "no large-file optimizations" accept by design. Text edits store only inserted tokens, so `H` grows with total inserted text plus per-patch overhead, not with snapshots.
- HTTP bodies (§9) must be fully buffered before parsing; the same ceiling applies. Redirects are out of scope and must fail (`tests/13-http-client.yaml`, 302 case).

## Filesystem materialization

- Walking (§2, §10). `fs.readdirSync(dir, { withFileTypes: true })` yields `Dirent` objects whose `isFile`/`isDirectory`/`isSymbolicLink` come from `d_type` without following links; on filesystems that report `DT_UNKNOWN`, `lstatSync` is the fallback. Any entry that is not a regular file or directory must fail the command with `snap: unsupported working tree entry: <path>` (`tests/08-unsupported-entries.yaml`, symlink and FIFO). `readdir` order is filesystem-dependent, so entries must be sorted with the byte-order comparator; sorting before checking also makes the reported entry deterministic when several are unsupported. Only the root `.snap` is excluded (§2 "no first segment equal to `.snap`"); `sub/.snap/x` is a tracked path, and `tests/25-config-version-path-boundaries.yaml` (line 90) confirms `.snap/untracked` at the root is ignored. Every file is read fully to compare (`O(S)`); comparing lengths before bytes is a free fast path.
- Installing a target tree (§6.2 last paragraph, §10). The clean-tree precondition means the delta is `current -> target`. Deletions first (sorted), then pruning of newly empty directories upward to the root, then writes (sorted) with `mkdirSync(..., { recursive: true })`. The file-blocks-directory case (`a` -> `a/b`) and its inverse are both already decided by the namespace rule (§6.2), so after deletions no blockers remain. Per-file atomicity is not required: §10 accepts a partially updated tree on failure.
- Atomic metadata replace (§10). Write `.snap/repository.json.<tmp>` in the same directory, then `renameSync` over the target: POSIX `rename()` is atomic and same-directory guarantees same filesystem. `fsync` is optional because durability under power loss is out of scope (§12). Order is fixed: working files first, metadata only after they succeed (§10).
- Sync versus async. The CLI is single-shot; synchronous `fs` calls are simpler, avoid thread-pool hops for small sequential operations, and cannot leave unhandled rejections. Only HTTP (`merge`/`diff --repo` over `http://`) and `--serve` need the event loop.
- Stdout on pipes. Node documents that pipes are asynchronous on POSIX ("A note on process I/O", Node `process` docs). The harness captures via pipes (SPEC.md §11 "captures candidate streams through pipes"), so `process.exit()` immediately after `console.log` can truncate output. Setting `process.exitCode` and returning, or writing with `fs.writeSync(1, ...)`, avoids it. §7.9's "Prints and flushes" the server URL is the same concern.

## TypeScript and Node pitfalls that affect correctness

1. String order is UTF-16 code-unit order, not UTF-8 byte order. ECMA-262's default `Array.prototype.sort` comparator and the `<` operator compare code units. The two orders diverge exactly for characters in U+E000–U+FFFF versus supplementary characters: verified `["\uFF01.txt", "\u{1F600}.txt"].sort()` puts `😀.txt` first, while UTF-8 bytes (`EF BC 81` vs `F0 9F 98 80`) put `！.txt` first. RFC 3629 states that byte-wise UTF-8 order equals code-point order, so either `Buffer.compare(Buffer.from(a), Buffer.from(b))` or a comparator that walks `codePointAt` is correct; the latter avoids allocation. This governs §2 path order (`status`, `diff`, `changes`, tree assertions) and §3.2 contributor order. Contributor ids are ASCII by §3.1, so once validation enforces that, code-unit order coincides with byte order for ids — but only after validation, and using one comparator everywhere costs nothing. The suite's non-ASCII paths (`é`, `😀` in `tests/25-config-version-path-boundaries.yaml`) happen to sort the same way in both orders, so the suite does not catch this bug; the spec still requires it.
2. Safe-integer bounds (§3.1). `JSON.parse("9007199254740993")` silently returns `9007199254740992` (verified), and `JSON.parse("1.0")` returns `1`, indistinguishable from `"1"`, while §4.1 says non-integer numbers are errors. Options: a `JSON.parse` reviver using the `context.source` argument (JSON.parse source text access; available in this Node, verified) to inspect the raw numeric text; a hand-written JSON parser; or accepting the loss for `1.0`. `Number.isSafeInteger` catches values that survive parsing but not those already rounded. CLI versions (`(a@x->9007199254740992)` must fail, `tests/25-config-version-path-boundaries.yaml:83`; `01` must fail, `tests/19-version-boundaries.yaml:40`) should be parsed digit-by-digit with a leading-zero check and compared against `"9007199254740991"` textually or via `BigInt`.
3. Duplicate JSON keys. ECMA-262 `JSON.parse` overwrites earlier duplicates; §4.1 says valid input has unique keys; §8 makes a non-unique field an error; `tests/25-config-version-path-boundaries.yaml:38` expects `snap: duplicate JSON key ...`. A reviver cannot see duplicates (it is called once per surviving property). Options: `JSON.parse` for the value plus a second scanner pass that only tracks keys (the harness does this in `test-harness/src/json.ts`, which must not be imported but can be imitated), or one recursive-descent parser that produces the value and checks duplicates, integer syntax and magnitude in a single `O(H)` pass. The latter is more code and several times slower than native `JSON.parse`, but still linear and adequate at megabyte scale.
4. UTF-8 validity and NUL (§4.4). `Buffer#toString("utf8")` never fails; it substitutes U+FFFD (verified), so it cannot be used for detection. `buffer.isUtf8(buf)` (Node ≥ 18.14) is native and exact; `new TextDecoder("utf-8", { fatal: true })` throws on invalid input but strips a leading BOM unless `ignoreBOM: true` is passed (verified: `EF BB BF 61` decodes to `"a"` by default), which would silently change file bytes on round-trip. NUL is a separate `indexOf(0)` check. All are `O(size)`.
5. Base64 leniency (§4.3). `Buffer.from(s, "base64")` accepts missing padding, the URL-safe alphabet, and non-canonical trailing bits (`"AR=="` decodes to `01`, verified). "Standard padded RFC 4648 base64" requires alphabet and length checks plus a canonical round-trip (decode then re-encode must equal the input; RFC 4648 §3.5). `Uint8Array.fromBase64` with `lastChunkHandling: "strict"` would do this natively but is not present in Node 24 (verified `undefined`).
6. Map identity. `Map`/`Set` keys are compared by SameValueZero; arrays and objects are keys by reference. Every memo or index keyed by a version or dot must use a canonical string.
7. Default `sort()` stringifies numbers (`[10, 9].sort()` is `[10, 9]`). Revisions and token counts need an explicit numeric comparator.
8. `process.exit()` versus `process.exitCode` with piped stdout (see above).
9. String building. V8 represents `a += b` as rope (cons) strings, so incremental concatenation is amortized linear, but flattening on first use of a huge rope is a large allocation. For output, collecting chunks in an array and writing once, or writing per record, is predictable. For tokenizing, an `indexOf("\n")` loop with `slice` avoids `split` plus re-append.
10. `noUncheckedIndexedAccess` is enabled in `ts/tsconfig.json`, so every indexed read is `T | undefined`. Hot loops over `Int32Array` and token arrays will need non-null assertions or small typed accessors; this affects ergonomics more than speed.
11. HTTP client (§9). Node's global `fetch` follows redirects by default; `redirect: "error"` or `"manual"` is required, and any non-200 status must produce `snap: <detail>` and exit 1 (`tests/13-http-client.yaml`). `http.get` never follows redirects, which is simpler here.

## Realistic scale versus the suite

For passing the suite: correctness of every item in the previous section matters; algorithmic complexity does not. Inputs are ≤ 5 lines, ≤ 6 patches, ≤ 4 contributors. Even an exponential base materialization would pass at `P = 6`. The only measurable performance factor is per-process startup under tsx with a cold cache.

For real use: the mandated per-command replay (§4.5) is `O(P·F)` plus a sum of `O(n·m)` diffs, the mandated whole-file `repository.json` rewrite is `O(H)` per commit, and the `O(n·m)` diff table is the first hard wall (multi-thousand-line files). None of these can be removed without leaving the spec; all can be kept at their spec-minimum constants by the cheap wins below.

## Prioritized list

Must get right (correctness; some are silently wrong in idiomatic JS):

- Byte-order comparator for paths and contributor ids everywhere ordering is observable.
- The §5 recurrence with deletion-on-tie, full table, prefix trim only; no suffix trim; no Myers/Hirschberg without a demonstrated equivalence.
- Exact base tree `B` for §6.2, keyed by canonical version string, never `C` unless `I == base`.
- Strict JSON: duplicate keys, integer syntax and safe range, unknown fields, exact schema.
- Text detection with `isUtf8`/fatal decoder and `ignoreBOM: true`; NUL check; bytes as the source of truth.
- Canonical base64 validation with round-trip check.
- Never follow symlinks; fail on any non-regular entry with the exact message.
- Working files first, then same-directory temp file and rename for `repository.json`.
- Drain stdout before exit (`process.exitCode`, not `process.exit()` after writes).
- No HTTP redirects; exact 200 requirement.

Cheap wins (small code, large constant-factor effect, no spec risk):

- Replay once per command and reuse the frontier tree and warning set for `status`/`commit`/`diff`/`merge`.
- `I == base` shortcut, and snapshotting `(I, C)` states that are known bases, before any general memo.
- Integrated vector `I` for readiness; skip the priority queue at Snap's scale.
- Token interning to integers and a flat `Int32Array` table for §5; identical/empty fast paths.
- Shared `Uint8Array` contents across tree copies; length check before `Buffer.equals`.
- Delta installation from the (clean) current tree instead of full rewrite.
- Canonical serialization for patch structural equality.
- Synchronous `fs`; a small module graph to keep cold tsx startup low.

Defer (real complexity or spec risk, no suite benefit):

- Hirschberg/Myers variants proven equivalent to §5.
- Persistent (structurally shared) tree maps.
- Streaming or incremental JSON parsing; cross-process validation caches (would need on-disk state the spec does not define, and §4.5 still requires validation per command).
- Bundling/precompiling to plain JS to cut startup; only worthwhile if suite timeouts ever become an issue.

## Open questions

- Whether warnings produced while materializing a base tree for §6.2 (a sub-replay of `closure(base)`) contribute to the replay's warning set. The singular "Replay returns the set" in §6.4 suggests only the top-level replay counts, and the top-level replay re-derives the same conflicts, but the spec does not say so explicitly.
- How `status`/`commit`/`diff` should treat working-tree files whose names are not valid tracked paths under §2 (backslash, ASCII control characters). §10 specifies failure only for symlinks and other unsupported entry kinds; the suite has no case for this.
- Whether `1.0` or `1e0` in repository JSON is a "non-integer number" (§4.1) given that "the parsed typed value—not its serialized bytes—is authoritative" (§4.1). No fixture exercises it; the answer determines whether a custom number check is required or a plain `JSON.parse` plus `Number.isSafeInteger` suffices.
- Which unsupported entry to report when the working tree contains several; sorting first gives a deterministic answer but the spec does not choose one.
- Whether the acceptance suite will ever grow inputs large enough that §5 or §6.2 cost matters; today it does not, which is why every complexity concern above is classified as real-use only.

## Conclusion

The spec forces three costs: a full validation replay per command, an `O(n·m)` canonical diff per concurrent text change, and a whole-file `repository.json` read and rewrite. Within those, the implied data structures are simple — sorted pair arrays for versions with canonical strings as keys, a dense per-author patch index, `Map<string, Uint8Array>` trees with shared contents, `string[]` tokens, a tagged-union edit script — and the main algorithmic trap is exact-base materialization, which is exponential without memoization, `O(P²)` with a memo, and near-linear with the `I == base` and snapshot shortcuts. For the public suite, none of this is measurable; process startup is. The items most likely to produce wrong bytes are not performance items at all but JavaScript defaults: UTF-16 ordering, lossy `JSON.parse`, lenient base64, BOM-stripping decoders, and asynchronous piped stdout.

## References

- `SPEC.md` §§1.1, 2, 3.1–3.5, 4.1–4.5, 5, 6.1–6.5, 7.5–7.9, 9, 10, 11, 12.
- `TEST-HARNESS.md`: "Stable YAML envelope", "Completed command", "Implementation layout"; `test-harness/src/runner.ts`, `test-harness/src/process.ts`, `test-harness/src/json.ts`.
- `tests/05-diff-goldens.yaml`, `tests/08-unsupported-entries.yaml`, `tests/13-http-client.yaml`, `tests/18-three-way-convergence.yaml`, `tests/19-version-boundaries.yaml`, `tests/22-ot-matrix.yaml`, `tests/25-config-version-path-boundaries.yaml`, `tests/26-portability-and-failure-safety.yaml`.
- `ts/AGENTS.md`, `ts/snap`, `ts/tsconfig.json`, `ts/package.json`.
- R. A. Wagner and M. J. Fischer, "The String-to-String Correction Problem", Journal of the ACM 21(1), 1974.
- E. W. Myers, "An O(ND) Difference Algorithm and Its Variations", Algorithmica 1(2), 1986.
- D. S. Hirschberg, "A linear space algorithm for computing maximal common subsequences", Communications of the ACM 18(6), 1975.
- A. B. Kahn, "Topological sorting of large networks", Communications of the ACM 5(11), 1962.
- C. J. Fidge, "Timestamps in Message-Passing Systems That Preserve the Partial Ordering", Australian Computer Science Communications 10(1), 1988; F. Mattern, "Virtual Time and Global States of Distributed Systems", Parallel and Distributed Algorithms, 1989.
- ECMA-262 (ECMAScript Language Specification): `Array.prototype.sort` and SortCompare; IsLessThan (string comparison by code units); `JSON.parse` (note on duplicate names); Map objects and SameValueZero. https://tc39.es/ecma262/
- TC39 proposal "JSON.parse source text access" (reviver `context.source`). https://github.com/tc39/proposal-json-parse-with-source
- RFC 3629, "UTF-8, a transformation format of ISO 10646", §1 (byte order equals code point order).
- RFC 4648, "The Base16, Base32, and Base64 Data Encodings", §3.5 Canonical Encoding.
- RFC 8259, "The JavaScript Object Notation (JSON) Data Interchange Format", §4 (names SHOULD be unique).
- WHATWG Encoding Standard: `TextDecoder` `fatal` and `ignoreBOM`. https://encoding.spec.whatwg.org/
- Node.js documentation: `buffer.isUtf8()`, `Buffer.compare()`, `buffer.constants.MAX_STRING_LENGTH`, `fs.readdirSync` with `withFileTypes` and `fs.Dirent`, `fs.renameSync`, `process` "A note on process I/O", `process.exitCode`. https://nodejs.org/api/
- POSIX.1-2017, `rename()` (atomic replacement within a filesystem).
- V8 source, `src/objects/string.h` (one-byte and two-byte string representations; cons strings).
- tsx documentation, cache and `TSX_DISABLE_CACHE`; `ts/node_modules/tsx/dist/temporary-directory-*.mjs` (cache directory under `os.tmpdir()`). https://tsx.is/
- Local measurements on 2026-09-04 with Node v24.9.0 / V8 13.6.233.10: tsx startup 0.12–0.17 s; `JSON.parse` precision loss; `Buffer.from(..., "base64")` leniency; `TextDecoder` BOM stripping; UTF-16 versus UTF-8 sort divergence; common-suffix stripping changing the §5 script.
