---
title: "Snap startup and scale smoke"
date: 2026-09-05
author: agent
id: snap-startup-and-scale-smoke
---
# Snap startup and scale smoke

## Motivation

`snap-performance-and-data-structures` predicted where Snap's costs go but measured only the
stub CLI (one `main.ts`) and reasoned about scale from the spec's asymptotics. This note adds
two measured baselines the hardening plan asked for: a cold-startup profile of the real,
complete CLI (`ts/src/main.ts` with the full module graph), and a scale smoke of `status`,
`log`, and `diff` on repositories two to three orders of magnitude larger than anything in the
acceptance suite. Measurements only; nothing here commits an implementation to anything.

## Machine and method

- Node v24.9.0 (V8 13.6.233.10), macOS 26.5.1, Apple M4 Max, AC power, otherwise idle.
- The CLI is `ts/snap`, i.e. `node node_modules/tsx/dist/cli.mjs src/main.ts`. tsx keeps its
  transpile cache under `os.tmpdir()`, so a fresh `TMPDIR` per invocation gives a cold cache
  and a shared, primed `TMPDIR` gives a warm one — the same mechanism the acceptance harness
  uses (`test-harness/src/process.ts`).
- Wall clock per sample via a Python timer that spawns one process and discards its output
  (`/tmp/snap-time.py` below); every number is one whole-process sample in milliseconds.
- Scale fixtures were built by a generator script (`/tmp/snap-scale-gen.mts` below) that
  constructs repositories through the real model APIs (`withPatch`, `encodeRepository`), so the
  persisted bytes are canonical by construction, and materializes the working tree to the
  frontier so `status` is clean.
- Scale fixture: 1 000 linear patches from one contributor `a@x` over 100 files. Patch 1
  creates `f000.txt`–`f099.txt` (one `put` each, content `l1\n`); patch `i > 1` appends
  `l<i>\n` to `f{(i-2) mod 100}.txt` with a one-`retain`/one-`insert` text edit. Resulting
  `repository.json`: 460 857 bytes; frontier `(a@x->1000)`; `f099.txt` ends at 10 lines because
  the 1 000-patch cap cuts its last append — the generator mirrors the patch loop exactly when
  materializing, which `snap status` confirming only the version line verifies.
- Diff fixtures: one text file `big.txt` of N lines `L0001\n`…, version 2 a single text edit
  replacing every 10th line (N/10 scattered `delete 1` + `insert` pairs, coalesced retains).
  `repository.json` 29 326 / 58 026 / 115 426 bytes for N = 1 000 / 2 000 / 4 000.

## Startup profile

`./snap --version`, cold (fresh `TMPDIR` per run), 20 samples: 1141 (a first-run outlier), then
176, 167, 163, 161, 159, 163, 167, 164, 163, 165, 157, 165, 188, 186, 171, 169, 183, 184, 180 —
median 167 ms, band 157–188 ms.

Warm (one shared, primed `TMPDIR`), 20 samples: 151, 140, 147, 208, 138, 141, 145, 148, 145,
146, 144, 142, 179, 150, 161, 162, 146, 143, 146, 149 — median 146 ms. Cold minus warm ≈ 20 ms,
matching the tsx-cache effect the prior research measured on the stub.

`./snap status` in a one-patch repository, cold, 10 samples: 177, 161, 175, 165, 160, 160, 158,
157, 160, 161 — median 161 ms, indistinguishable from `--version`: a one-patch decode,
validate, replay, working-tree scan, and tree diff cost less than the run-to-run noise of
process startup.

Module graph, by static import closure from `src/main.ts` (all `from '…'` specifiers,
transitively): 30 local modules and 4 distinct `node:` builtins (`node:buffer`, `node:fs`,
`node:http`, `node:path`). No third-party runtime imports — tsx is launch-time only.

## Scale smoke

All scale numbers are whole-process wall clock with a warm tsx cache; the warm `--version`
median of ~146 ms is inside every sample. "Work" below = median − 146 ms, i.e. everything the
command did beyond reaching `main`.

1 000-patch / 100-file repository:

- `snap status` (clean tree), 10 samples: 318, 318, 325, 329, 332, 350, 352, 381, 429, 586 —
  median 341 ms (work ≈ 195 ms). Output is exactly `version (a@x->1000)`.
- `snap log`, 10 samples: 318, 321, 327, 328, 329, 336, 344, 367, 380, 500 — median 333 ms
  (work ≈ 187 ms; 1 000 output lines). This isolates decode of 450 KB of `repository.json`
  plus validation and the full 1 000-patch replay; `status` adds a 100-file scan and tree
  diff for ~8 ms more.
- `snap diff '(a@x->1)' '(a@x->1000)'`, 10 samples: 457, 464, 516, 698, 742, 761, 781, 827,
  871, 1065 — median 752 ms (work ≈ 605 ms; 100 file blocks, 1 399 output lines). Both
  operands sit on the one replay path; the cost is decode plus materializing the two versions
  plus 100 trivial per-file diffs.

One-file N-line diff (`snap diff '(a@x->1)' '(a@x->2)'`), warm:

- N = 1 000 (5 samples): 318, 319, 321, 324, 334 — median 321 ms (work ≈ 175 ms).
- N = 2 000 (10 samples): 690, 693, 704, 716, 781, 790, 791, 872, 943, 2036 — median 786 ms
  (work ≈ 640 ms).
- N = 4 000 (5 samples): 2072, 2149, 2163, 2173, 2193 — median 2163 ms (work ≈ 2017 ms).

Doubling N multiplies the work by ≈ 3.7 then ≈ 3.2 — superlinear, consistent with the O(n·m)
§5 recurrence dominating once the file is big enough, with the linear decode/materialize share
still visible at N = 1 000.

## Comparison with snap-performance-and-data-structures

- Startup: the stub measured 0.15 s cold / 0.12 s warm on 2026-09-04; the complete CLI
  measures ≈ 167 ms cold / ≈ 146 ms warm. The finished command surface adds ~15–25 ms, and the
  import closure stayed at 30 modules + 4 builtins, so the "small module graph" cheap win is
  holding. A 31-step suite case still spends ~5 s in startup against its 30 s timeout —
  headroom unchanged from the stub-era estimate.
- Per-command validation: the prior note put the algorithmic cost of 1 000 patches over 100
  files at "~10^5 map operations and ~10^5 token operations — milliseconds" and separately
  billed `O(H)` for reading and parsing `repository.json`. Measured `log` work is ≈ 187 ms at
  H = 450 KB, i.e. tens of milliseconds per megabyte for decode-plus-validate-plus-replay
  together. A smoke cannot split decode from replay, but nothing suggests a superlinear
  surprise: the number sits between the two predicted linear costs, and `status` adding a full
  working-tree scan and tree diff for ~8 ms confirms the replay side is not exploding.
- Diff wall: the prior note called the O(n·m) §5 table "the first thing that hurts on real
  files" and estimated "hundreds of milliseconds to seconds in JS" at multi-thousand-line
  scale. Measured: 786 ms total at 2 000 lines and 2.16 s at 4 000 lines, growth ≈ 3.2–3.7×
  per doubling of work — the prediction is confirmed quantitatively at exactly the predicted
  scale, with the absolute constants inside the predicted range.
- Materialization memo: `diff` of `(a@x->1)` to `(a@x->1000)` costs ~605 ms of work versus
  `log`'s ~187 ms — materializing both end versions on top of one decode/validation pass, not
  two full replays. On a linear history the `I == base` shortcut makes exact-base
  materialization cheap, as predicted; no exponential blow-up is visible.

## Verification landscape

`./verify --lang ts` before and after this strand's only code change (the property test file
`ts/src/repo/replay.property.test.ts`): 19 passed / 13 failed both times, with byte-identical
suite title + status lists (the after run took 60.4 s). All 13 failures are the sibling
strands' not-yet-implemented surfaces (`merge`, `diff --repo`, terminal presentation); none
moved.

## Reproducing

Timing helper (`/tmp/snap-time.py`):

```python
"""Wall-clock timer for one command; prints elapsed milliseconds."""
import subprocess
import sys
import time

start = time.perf_counter()
subprocess.run([sys.argv[1]] + sys.argv[2:], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f"{(time.perf_counter() - start) * 1000:.0f}")
```

Startup loops (cold = fresh `TMPDIR` per run; warm = one primed `TMPDIR` for all runs):

```sh
SNAP=/path/to/ts/snap
for i in $(seq 20); do
  T=$(mktemp -d) TMPDIR="$T" python3 /tmp/snap-time.py "$SNAP" --version
done
for i in $(seq 20); do
  python3 /tmp/snap-time.py "$SNAP" --version   # shared, primed TMPDIR
done
```

Module-graph probe (static import closure of `src/main.ts`):

```sh
node -e 'const fs=require("fs"),path=require("path");const root="/path/to/ts/";
const seen=new Set(),builtins=new Set();const stack=["src/main.ts"];
while(stack.length){const f=stack.pop();if(seen.has(f))continue;seen.add(f);
const txt=fs.readFileSync(root+f,"utf8");
for(const m of txt.matchAll(/from '"'"'([^'"'"']+)'"'"'/g)){const spec=m[1];
if(spec.startsWith(".")){let r=spec;if(!r.endsWith(".ts"))r+=".ts";
stack.push(path.posix.join(path.posix.dirname(f),r))}else if(spec.startsWith("node:"))builtins.add(spec)}}
console.log("local modules:",seen.size,"builtins:",builtins.size)'
```

Fixture generator (`/tmp/snap-scale-gen.mts`, run with the repo's tsx:
`node /path/to/ts/node_modules/tsx/dist/cli.mjs /tmp/snap-scale-gen.mts scale <dir>` or
`… diff <dir> [lines]`; adjust the three `/Users/…/ts/src/…` import paths to the checkout
under test):

```typescript
/**
 * Scale-smoke fixture generator for the hardening-property-tests plan (task 7).
 * Builds repositories through the real model APIs so the persisted bytes are
 * canonical by construction, then materializes the working tree to the frontier.
 *
 * Usage: node <tsx> /tmp/snap-scale-gen.mts <scale|diff> <target-dir> [lines]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { encodeUtf8 } from '/Users/therealcisse/.snap/worktree/hardening/ts/src/core/bytes.ts';
import { type Version } from '/Users/therealcisse/.snap/worktree/hardening/ts/src/core/version.ts';
import { type EditOp } from '/Users/therealcisse/.snap/worktree/hardening/ts/src/text/edit.ts';
import {
  type Change,
  type Patch,
  type Repository,
  encodeRepository,
  withPatch,
} from '/Users/therealcisse/.snap/worktree/hardening/ts/src/repo/model.ts';

const EMPTY: Repository = { format: 1, frontier: [], patches: [] };
const pad3 = (n: number): string => String(n).padStart(3, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

function commit(repo: Repository, patch: Patch): Repository {
  return withPatch(repo, patch);
}

/** Fixture A: 1 000 linear patches over 100 files; working tree matches the frontier. */
function scaleRepo(dir: string): void {
  mkdirSync(join(dir, '.snap'), { recursive: true });
  const FILES = 100;
  const PATCHES = 1000;
  let repo = EMPTY;
  const create: Change[] = [];
  for (let j = 0; j < FILES; j += 1) {
    create.push({ type: 'put', path: `f${pad3(j)}.txt`, content: encodeUtf8('l1\n') });
  }
  repo = commit(repo, {
    author: 'a@x',
    revision: 1,
    base: [],
    message: 'create 100 files',
    changes: create,
  });
  const counts: number[] = new Array<number>(FILES).fill(1);
  for (let i = 2; i <= PATCHES; i += 1) {
    const j = (i - 2) % FILES;
    const base: Version = [['a@x', i - 1]];
    const edit: EditOp[] = [{ retain: counts[j] }, { insert: [`l${String(i)}\n`] }];
    counts[j] += 1;
    repo = commit(repo, {
      author: 'a@x',
      revision: i,
      base,
      message: `append ${String(i)}`,
      changes: [{ type: 'text', path: `f${pad3(j)}.txt`, edit }],
    });
  }
  writeFileSync(join(dir, '.snap', 'repository.json'), encodeRepository(repo));
  for (let j = 0; j < FILES; j += 1) {
    const lines: string[] = ['l1\n'];
    for (let i = 2; i <= PATCHES; i += 1) {
      if ((i - 2) % FILES === j) {
        lines.push(`l${String(i)}\n`);
      }
    }
    writeFileSync(join(dir, `f${pad3(j)}.txt`), lines.join(''));
  }
  console.log(`scale repo: ${String(PATCHES)} patches, ${String(FILES)} files, frontier (a@x->${String(PATCHES)})`);
}

/** Fixture B: one many-line file; version 2 replaces every 10th line (LINES/10 scattered edits). */
function diffRepo(dir: string, linesArg: number): void {
  mkdirSync(join(dir, '.snap'), { recursive: true });
  const LINES = linesArg;
  const oldLines: string[] = [];
  for (let k = 1; k <= LINES; k += 1) {
    oldLines.push(`L${pad4(k)}\n`);
  }
  let repo = EMPTY;
  repo = commit(repo, {
    author: 'a@x',
    revision: 1,
    base: [],
    message: 'create big.txt',
    changes: [{ type: 'put', path: 'big.txt', content: encodeUtf8(oldLines.join('')) }],
  });
  const edit: EditOp[] = [];
  let retain = 0;
  for (let k = 1; k <= LINES; k += 1) {
    if (k % 10 === 0) {
      if (retain > 0) {
        edit.push({ retain });
        retain = 0;
      }
      edit.push({ delete: 1 }, { insert: [`X${pad4(k)}\n`] });
    } else {
      retain += 1;
    }
  }
  if (retain > 0) {
    edit.push({ retain });
  }
  repo = commit(repo, {
    author: 'a@x',
    revision: 2,
    base: [['a@x', 1]],
    message: 'scattered edits',
    changes: [{ type: 'text', path: 'big.txt', edit }],
  });
  writeFileSync(join(dir, '.snap', 'repository.json'), encodeRepository(repo));
  const newLines = oldLines.map((line, index) =>
    (index + 1) % 10 === 0 ? `X${pad4(index + 1)}\n` : line,
  );
  writeFileSync(join(dir, 'big.txt'), newLines.join(''));
  console.log(`diff repo: big.txt ${String(LINES)} lines, v2 replaces ${String(LINES / 10)} lines`);
}

const [kind = '', target = '', linesArg] = process.argv.slice(2);
if (kind === 'scale' && target !== '') {
  scaleRepo(target);
} else if (kind === 'diff' && target !== '') {
  const lines = linesArg === undefined ? 2000 : Number(linesArg);
  if (!Number.isInteger(lines) || lines < 100 || lines % 10 !== 0) {
    throw new Error('lines must be a multiple of 10 of at least 100');
  }
  diffRepo(target, lines);
} else {
  console.error('usage: snap-scale-gen.mts <scale|diff> <target-dir> [lines]');
  process.exitCode = 1;
}
```

Scale measurements (from each fixture directory, warm `TMPDIR`):

```sh
SNAP=/path/to/ts/snap
for i in $(seq 10); do python3 /tmp/snap-time.py "$SNAP" status; done
for i in $(seq 10); do python3 /tmp/snap-time.py "$SNAP" log; done
for i in $(seq 10); do python3 /tmp/snap-time.py "$SNAP" diff '(a@x->1)' '(a@x->1000)'; done
# diff fixtures: cd <diff-dir>; then
for i in $(seq 10); do python3 /tmp/snap-time.py "$SNAP" diff '(a@x->1)' '(a@x->2)'; done
```

## References

- `dev-docs/research/snap-performance-and-data-structures.md` — stub-era startup measurements,
  per-algorithm cost predictions, prioritized list (all comparisons above are against it).
- `dev-docs/plans/approved/hardening-property-tests.md` — tasks 6–9 define this note's scope.
- `ts/snap`, `test-harness/src/process.ts` (per-case `TMPDIR`), `ts/src/repo/model.ts`
  (`withPatch`, `encodeRepository`), `ts/src/commands/{status,log,diff}.ts`.
