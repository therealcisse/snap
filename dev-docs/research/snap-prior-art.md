---
title: "Snap prior art: vector clocks, patch theory, OT, CRDTs, diff, and deterministic replay"
date: 2026-09-04
author: agent
id: snap-prior-art
---

# Snap prior art: vector clocks, patch theory, OT, CRDTs, diff, and deterministic replay

## Motivation

Snap (`SPEC.md`) combines several well-studied ideas — vector-clock versions, a causally ordered patch set, replay in a canonical total order, a canonical minimal line diff, and a one-shot operational transform — into a small local VCS. None of these ideas is new; each has decades of literature and at least one production system behind it, and each has well-known failure modes. This document maps every design pillar in `SPEC.md` to the original sources and to existing systems so that the implementer knows (a) the concept and its standard algorithms, (b) the known pitfalls, and (c) where Snap deliberately deviates from the mainstream and why that deviation is safe. It informs; it does not prescribe an implementation.

The acceptance suite under `tests/` is tiny (28 YAML files, ~89 KB total; text fixtures of one to six short lines). Complexity remarks below should be read with that in mind: correctness and determinism dominate, not asymptotics.

## 1. Vector clocks and version vectors (SPEC.md §3, §4.2)

### Concept and origin

A vector clock assigns each process an integer component; an event's timestamp is the vector of components known at that event. Fidge (1988) and Mattern (1989) independently introduced them to characterise the causal ("happened-before") relation exactly: `V ≤ W` (componentwise) iff the event stamped `V` causally precedes the event stamped `W`, and two stamps that are incomparable denote concurrent events [Fidge 1988; Mattern 1989]. Mattern notes that vector timestamps under componentwise `max`/`min` form a lattice, so the least upper bound (join) of two stamps is their componentwise maximum [Mattern 1989, §7].

Version vectors predate vector clocks: Parker et al. (1983) used a per-replica counter vector on each file in LOCUS to detect whether two replicas of a file were in a dominance relation (one is an ancestor of the other) or in conflict (neither dominates) [Parker et al. 1983]. The difference is what is being stamped: vector clocks stamp events in a process, version vectors stamp versions of a data item. Snap's usage is the version-vector one: a version is a stamp on a *tree*, not on an actor's local history.

### Mapping to Snap

- `SPEC.md §3.3` defines exactly the four outcomes of Parker's comparison — equal, `<`, `>`, concurrent (`||`) — and defines join as componentwise max, which is Mattern's lattice join. Missing components are treated as 0, matching the usual convention.
- `SPEC.md §4.2` defines a dot as `(author, revision)` with `revision = B[author] + 1`, and a patch's result version as `join(B, {author: revision})`. The pair `(actor, counter)` identifying one specific write is what Preguiça, Baquero et al. call a *dot*; a *dotted version vector* is a version vector paired with the dot of the write it describes, so that a single write can be identified independently of the whole causal context [Preguiça et al. 2010]. Snap's patch (base version `B` plus dot) is structurally a dotted version vector: the dot identifies the patch, `B` is its causal context.
- `SPEC.md §1.1` states that two patches with the same dot but different content is corruption. This is the standard uniqueness invariant of dots: a dot must name at most one event.

### The serial-contributor rule (§3.5) and actor identity in real systems

Because Snap's frontier component `V[a]` is the count of `a`'s patches and each new revision is `B[a] + 1`, all patches by one contributor form a chain: revision `n` must have revision `n−1` in its base. Two concurrent patches by the same contributor would both compute the same revision and thus collide on the dot with different content — undetectable as "concurrent", only as corruption (`SPEC.md §3.5`; the `tests/16-dot-collision.yaml` case). This is not a Snap quirk; it is the fundamental actor invariant of any version-vector system. Riak's engineers state it plainly: an actor ID must be unique, and each actor must issue events serially with strictly increasing counters; violating this leads to silent data loss [Riak, "Vector Clocks Revisited"; basho/riak_kv PR #1027].

How production systems keep the invariant:

- Dynamo uses the *coordinator node* that handled a write as the actor, so many clients writing through one node are serialised by it; concurrent writes through different coordinators produce siblings that the application reconciles. Dynamo also truncates old entries from long vectors [DeCandia et al. 2007, §4.4].
- Riak originally used *client-supplied* actor IDs, which required clients to be well behaved; Riak 1.0 moved the actor to the *vnode* (server) because misbehaving or shared client IDs corrupted causality [Riak, "Vector Clocks Revisited"]. Using the server as actor in turn caused sibling explosion and false concurrency, which dotted version vectors were introduced to fix [Riak, "Vector Clocks Revisited Part 2"; Preguiça et al. 2010; Riak, "Why Vector Clocks Are Hard"].

Snap's choice (`SPEC.md §3.1`, §3.5) is the client-ID model with the burden on the human: the contributor ID is an email-shaped string, and one ID must not author concurrently. This is the simplest possible model and is adequate for a local, single-user-per-ID tool. The known failure mode — two clones configured with the same contributor ID, each committing — produces a dot collision that Snap detects at import but cannot repair. Options the spec leaves open for the implementer to be aware of (not to add now, given scope discipline): a per-clone actor suffix (Riak's vnode approach), or failing `import` with a clear message identifying the colliding dot (which is what the spec requires).

### Snap order (§3.4) as a linear extension

`SPEC.md §3.4` orders versions lexicographically over the sorted union of contributor IDs (absent = 0). Lexicographic order on vectors is a linear extension of the componentwise (product) order: if `V ≤ W` componentwise then `V` sorts lexicographically no later than `W`. So Snap order agrees with causality wherever causality speaks, and breaks ties between concurrent versions arbitrarily but deterministically. This is exactly the role of the total order in Lamport's 1978 construction (see §6 below): any total order consistent with the causal partial order gives a deterministic replicated computation [Lamport 1978]. The specific tie-break (byte order of contributor IDs) is arbitrary; what matters is that it is a function of the data alone.

## 2. Patch-based VCS and patch theory (SPEC.md §1, §4, §6.1)

### Darcs

Darcs (Roundy, 2002–) treats a repository as a set of patches, and its "patch theory" is built on *commutation*: two adjacent patches `A;B` can be reordered to `B';A'` if a commute function exists for that pair, and merging two branches consists of commuting patches past each other. When two patches cannot be commuted (they touch overlapping regions), Darcs records a *conflictor* / *merger* patch and the working tree shows conflict markers for the user to resolve [Darcs Theory wiki]. Patch commutation is the source of both Darcs's elegance and its notorious exponential-time merge cases, and the formalisation was hard enough to spawn academic work: Mimram and Di Giusto model patches as morphisms and merges as pushouts in a category of files [Mimram & Di Giusto 2013], and Angiuli et al. give a homotopy-type-theoretic account [Angiuli et al. 2014].

### Pijul

Pijul (Meyer, Rincón) reworks the idea: a file is a graph of lines whose edges are labelled by the change that introduced them; changes carry explicit dependencies; and *conflicts are first-class* — a graph with two unordered live vertices at the same position is a legitimate state that is shown to the user and later resolved by another change. Pijul describes this as a CRDT: applying changes in any order consistent with the dependencies gives the same graph [Pijul manual, "Theory"]. Pijul models names as vertices too and enumerates file-level conflicts (same-name, name/directory, cyclic directories, zombie files) as first-class states [Pijul manual, "Theory"].

### Mapping to Snap

Snap shares the *storage model* of Darcs/Pijul — the repository is a causally ordered set of patches, versions are frontiers, import is set union (`SPEC.md §1, §1.1`) — but deliberately takes the opposite stance on merging:

- No patch commutation. Snap never reorders patches relative to each other; it replays every selected patch exactly once in a canonical total order derived from the data (`SPEC.md §6.1`). Because the order is fixed and identical on every machine, "does `A;B` equal `B;A`?" never has to be asked. Commutation in Darcs exists precisely so that the same patch can be applied in different contexts on different machines; Snap has one context per patch (the state of the replay when that patch becomes ready) and one integration rule for that context (`SPEC.md §6.2`). This removes the whole commutation theory (and its exponential cases) at the cost of making the result depend on the canonical order, which the spec accepts explicitly (`SPEC.md §6.5`).
- Conflicts are resolved, not stored. Where Pijul stores an unordered pair and Darcs stores a conflictor, Snap always produces a single tree and emits sorted warnings (`SPEC.md §6.4`; `§12` forbids unresolved-conflict machinery). This means Snap can never present a "conflict" to fix later; the trade-off is that the deterministic rule may not match what either author intended, which `§6.5` disclaims.
- No rename identity. Darcs has a `move` patch and Pijul tracks inodes; Snap treats paths as plain keys (`SPEC.md §12`). This avoids the rename-detection heuristics of git and the move/edit interaction of Darcs, at the cost of a rename plus concurrent edit becoming an add + delete + lost edit under the `§6.4` rules.

## 3. Operational transformation (SPEC.md §6.2–§6.3)

### The literature

- Ellis and Gibbs introduced OT (dOPT) for real-time group editors: each site applies local operations immediately and transforms incoming remote operations against concurrent local ones; ties between two inserts at the same position are broken by a site *priority* [Ellis & Gibbs 1989].
- Ressel et al. (adOPTed) formalised the two convergence conditions later named TP1 and TP2 and gave a multi-dimensional interaction model with undo [Ressel et al. 1996].
- Sun et al. (GOT/GOTO) added intention preservation as an explicit goal alongside convergence and causality preservation, and introduced inclusion/exclusion transformations to handle operations that are not in a directly transformable context [Sun et al. 1998].
- Jupiter (Nichols et al.) is the *client–server* model: a central server imposes a total order; every client transforms only against the server's stream and vice versa, so only pairwise (2D) transformation is ever needed and TP2 never arises [Nichols et al. 1995]. This is the design Google Wave and most production OT systems later adopted.

TP1 says that for two concurrent ops `a`, `b`: `a ; T(b,a) ≡ b ; T(a,b)`. TP2 says that transforming an op against two concurrent ops in either order gives the same result: `T(T(c,a),T(b,a)) = T(T(c,b),T(a,b))`. TP2 is only needed when a site may receive concurrent ops in different orders — i.e., in peer-to-peer OT without a total order. It is also where the field's famous negative results live: Imine et al. mechanically checked published transformation functions and found that essentially all of them (dOPT, adOPTed, GOTO, SOCT2, …) violate TP2 on strings with insert/delete, giving concrete counterexamples [Imine et al. 2003; Imine et al. 2006]. Oster et al. state that none of the published proposals satisfy both TP1 and TP2 and propose tombstone-based transformation functions (TTF) to fix it [Oster et al. 2006 (TTF)], and separately propose WOOT, a CRDT that avoids transformation altogether [Oster et al. 2006 (WOOT)].

### Mapping to Snap: canonical-log OT, one transform per patch

Snap's design (`SPEC.md §6.2–§6.3`) avoids the TP2 problem by construction, for the same reason Jupiter does:

1. There is a single canonical order in which patches are integrated (`SPEC.md §6.1`), so every replica sees the same "server log". No patch is ever transformed against two concurrent patches in different orders. TP2 is therefore not a requirement.
2. Snap does not even need TP1. TP1 is about two sites applying the same pair of ops in opposite orders and converging; Snap has one order everywhere, so convergence follows from determinism, not from an algebraic property of the transform.
3. Snap transforms *once*, against the aggregate `Q = diff(B, C)` where `B` is the patch's base text and `C` is the text currently in the replay tree (`SPEC.md §6.2`). It does not compose or chain transforms through the history of intervening patches. This is a deliberate departure from all the systems above, which transform against the actual concurrent *operations*. Consequences worth knowing:
   - `Q` is a canonical minimal script (per `§5`), not the operations the other authors performed. If an intervening patch deleted a line and re-inserted an identical line elsewhere, `diff(B, C)` may align the two occurrences differently from what happened, and `P`'s edits may land at a different place than an operation-based OT would put them. `SPEC.md §6.5` explicitly disclaims intention preservation, so this is allowed, but the implementer should expect it in tests with repeated lines.
   - The transform table in `SPEC.md §6.3` is an *inclusion transformation* of `P` against `Q` over the same base sequence, i.e., `IT(P, Q)` in Sun et al.'s terminology. It is total (every pair of op kinds has a row) and it never needs an exclusion transformation, because both scripts are always expressed against the same `B`.
4. Tie rule: the row "Q insert → emit `retain(len)`; Q only; has priority" means that when both scripts insert at the same cursor, the text already in `C` stays first and `P`'s insertion goes after it. In dOPT/Jupiter terms, the already-integrated side has the higher priority; since the integrated side is always the earlier patch in canonical order, concurrent inserts at the same position appear in canonical integration order. This is deterministic and symmetric across replicas, which is all Snap needs.
5. Snap adds a shortcut classical OT lacks: if `C` already equals the patch's target `T`, the patch is a no-op (`SPEC.md §6.2`). Naive OT would insert the same lines twice when two authors make the identical concurrent edit; Snap collapses them.
6. `delete/delete → nothing` and `retain/delete → nothing` are the usual "delete of already-deleted text vanishes" rule; `delete/retain → delete(min)` splits `P`'s delete around `Q`'s edits. There are no tombstones, so unlike TTF Snap cannot recover an original position after a concurrent delete; again `§6.5` covers this.

Known failure modes that survive: (a) positional drift with repeated lines (above); (b) a patch whose `P` moves a line (delete + insert) concurrently with an edit to that line yields the deleted original and an un-edited copy; (c) any script must consume exactly `len(B)` or the transform is undefined — the `§4.4` edit-script well-formedness rules exist so the transform never has to handle a malformed `P`.

## 4. CRDTs (SPEC.md §1.1, §6.1)

Shapiro, Preguiça, Baquero, and Zawirski define two families of Conflict-free Replicated Data Types: *state-based* (CvRDT), where states form a join-semilattice and replicas merge by taking the join, and *operation-based* (CmRDT), where concurrent operations must commute and delivery must respect causality. Both converge without coordination; they prove the two are equivalent in expressive power and catalogue many designs, including the grow-only set (G-Set) and sequence types such as Treedoc [Shapiro et al. 2011 (RR-7506); Shapiro et al. 2011 (SSS)].

### Mapping to Snap

- The Snap repository state — a set of patches keyed by dot, plus a frontier — is a G-Set of patches paired with a version vector. `import` is set union (`SPEC.md §1.1`), which is idempotent, commutative, and associative; the frontier of the union is the join of the frontiers. This is a state-based CRDT whose join is union/join; replicas that have exchanged patch sets are identical. The dot-collision rule (`§1.1`, `§3.5`) is the one place where union is not total: two "elements" with equal key and different payload are rejected as corruption rather than merged.
- The *tree* is not a CRDT at all; it is a deterministic function (`replay`, `SPEC.md §6.1`) of the CRDT state. Snap therefore does not need per-line identifiers, tombstones, or commutative operations: any total order consistent with causality applied to the same set gives the same tree. This is the "replicated state machine over a causally consistent, totally ordered log" pattern (see §6 below), not an op-based CRDT — commutativity is replaced by a fixed order.
- Sequence CRDTs — WOOT [Oster et al. 2006 (WOOT)], Logoot [Weiss, Urso, Molli 2009], RGA [Roh et al. 2011], Treedoc [Shapiro et al. 2011] — instead give every character or line a globally unique, totally ordered identifier so that concurrent inserts commute without transformation. Snap deliberately does not do this for text (`SPEC.md §4.4` stores plain edit scripts over positional tokens). Trade-offs: sequence CRDTs give strong intention preservation and no transform code, but they require identifier metadata that grows with history, tombstones for deleted elements, and a non-human-readable patch format; Snap's positional scripts are small, printable, and reconstructable from a text diff, but lose intention preservation (`§6.5`) and require the whole-history replay of `§6.1` to compute any tree.

## 5. Diff algorithms (SPEC.md §5, §4.4, §7.6)

### The literature

- Wagner and Fischer gave the `O(n·m)` dynamic-programming recurrence for edit distance and the traceback that yields an edit script [Wagner & Fischer 1974]. With insert/delete costs of 1 and no substitution this is the LCS problem: edit distance `= n + m − 2·LCS`.
- Hunt and McIlroy's algorithm is the original Unix `diff`: hash lines, find candidate matches, and compute an LCS over the match candidates in `O((r + n) log n)` where `r` is the number of matching pairs [Hunt & McIlroy 1976].
- Myers's `O(ND)` algorithm walks the edit graph greedily by number of edits `D`, tracking the furthest-reaching path on each diagonal; it is optimal when `D` is small and is the default in git's xdiff [Myers 1986]. Myers observes that several paths (and therefore several scripts) can correspond to the same trace and that his algorithm finds *a* shortest path, chosen by its tie rule (`k == −D || (k != D && V[k−1] < V[k+1])` → take the vertical/insertion step from `V[k+1]`, otherwise the horizontal/deletion step from `V[k−1]`), followed by the longest available snake [Myers 1986, §3]. His linear-space refinement finds a middle snake by running the greedy search from both ends and recurses on the two halves [Myers 1986, §4b].
- Hirschberg gave the linear-space divide-and-conquer LCS in `O(n·m)` time [Hirschberg 1975]; Ukkonen independently gave `O(n·D)`-style diagonal-band algorithms [Ukkonen 1985].
- Patience diff (Bram Cohen, for Bazaar) matches lines that are unique on both sides first, computes an LCS over those anchors via patience sorting, then recurses/falls back between anchors; it explicitly does *not* minimise edits and treats non-unique lines (braces, blanks) as unreliable anchors [Cohen 2010; Cohen via Schindelin 2009]. Histogram diff (JGit, ported to git) is a faster variant of the same idea; git documents that neither patience nor histogram produces a minimal diff [git mailing list, diff-algorithms doc thread; git `xdiff/xdiffi.c`].

### Mapping to Snap: §5 specifies a script, not just a minimum

`SPEC.md §5` is stricter than "compute a minimal diff". It fixes:

1. The cost model: LCS-style, insert and delete cost 1, no substitution (`D(i,j)` recurrence over *suffixes* `old[i..]`, `new[j..]`).
2. The traceback: walk forward from `(0,0)`; if tokens are equal, `retain 1` (always take the diagonal); otherwise `delete 1` if `D(i+1,j) <= D(i,j+1)`, else `insert`; then coalesce adjacent same-kind ops.
3. The output is unique: for every input pair there is exactly one script, so the golden in `tests/05-diff-goldens.yaml` (`a\nb\na\n` → `b\na\na` must give `delete 1, retain 2, insert ["a"]`) is a contract, not an example.

Observations for the implementer:

- "Always retain on equal" is safe for minimality under this cost model (matching equal tokens never increases LCS distance), so the walk is guaranteed minimal; the only free choice is the delete/insert tie, which the spec pins to *delete first at the earliest position*. Note that the `§5` golden itself has a unique minimal script (the only common subsequence of length 2 is `b\n, a\n`, since `a` ≠ `a\n`), so it does not exercise the tie. A case that does: old `a\nb\n` → new `b\na\n` has two minimal scripts, `delete a, retain b, insert a` and `insert b, retain a, delete b`; at `(0,0)` both `D(1,0)` and `D(0,1)` equal 1, so the spec's `<=` picks the first. Implementers should add such tie cases to unit tests.
- Because the DP is over suffixes and the walk is forward, the table must be filled from the end (or the prefix table computed on reversed inputs, being careful that reversing also flips which alternative script the tie rule picks). A textbook prefix table with a backward traceback from `(n,m)` preferring deletion is *not* the same rule — it prefers deletion at the *latest* position — and will produce different scripts on some repeated-line inputs.
- Myers `O(ND)`: it finds a minimal script and prefers the diagonal (snake) as early as possible, which matches "retain on equal". Its tie rule prefers the deletion (horizontal) step when the two neighbouring diagonals reach equally far. On the `a b` → `b a` tie case above a hand trace gives the spec's script (`delete a, retain b, insert a`), but "furthest-reaching on adjacent diagonals" is a different criterion from "`D(i+1,j) <= D(i,j+1)` on the suffix table", and the two have not been shown equivalent here. Using Myers would require either a proof that the greedy path equals the `§5` path for all inputs or exhaustive/property testing against the DP oracle over small alphabets with many repeated tokens. The spec's own wording — "only if it produces the same script, including for repeated equal lines" — anticipates exactly this risk.
- Linear-space variants (Hirschberg; Myers §4b middle snake) choose a split point and solve halves independently. Each half is minimal, but the concatenation is only guaranteed to be *a* minimal script; the split-point selection would need the same canonical tie criterion to reproduce `§5`. Given fixture sizes of a few lines, linear space buys nothing.
- Patience and histogram are excluded by construction: they are not minimal and their anchoring on unique lines means two inputs differing only in the multiplicity of a repeated line can get structurally different scripts [Cohen 2010; git diff-algorithms thread]. Cohen himself notes that `12121` vs `212` is "highly ambiguous" and that patience deliberately declines to pick an LCS alignment there [Cohen via Schindelin 2009]; `§5` requires a specific answer.
- Practical option space: (a) the direct `O(n·m)` suffix DP with the spec's walk, trivially correct for the fixture scale and easy to audit against the recurrence; (b) Myers or a banded Ukkonen variant *plus* an equivalence test-suite against (a); (c) a hybrid that strips common prefix/suffix first — safe only if the stripped prefix/suffix would also be retained by the `§5` walk, which holds for common prefixes (equal ⇒ retain) but must be checked for common suffixes, since the forward walk may consume a suffix token earlier as part of a different alignment when lines repeat.

### Tokenisation and the "no newline" case

`SPEC.md §4.4` splits after every LF with the LF retained in the token, so a file that lacks a final LF has a distinct last token (`"a\nb"` → `"a\n"`, `"b"`), and `"a\nb\n"` vs `"a\nb"` differ by one token. GNU diff and git express the same distinction by emitting `\ No newline at end of file` after the affected line [GNU diffutils manual, "Incomplete Lines"]; `SPEC.md §7.6` reuses that marker in `snap diff` output. Treating the trailing partial line as a normal token, rather than as a flag on the file, keeps the diff and OT layers oblivious to the special case and makes `"b"` vs `"b\n"` a delete+insert rather than a metadata change.

## 6. Deterministic replay and total-order broadcast (SPEC.md §6.1)

Lamport (1978) showed that a total order `⇒` extending the causal partial order `→` — obtained from logical clocks with an arbitrary deterministic tie-break on process identity — lets every process apply the same commands in the same order and therefore reach the same state: the replicated state machine [Lamport 1978, §3]. Any deterministic total order consistent with causality works; the tie-break need only be a function of the events.

`SPEC.md §6.1` is a direct instance: select the patches whose dots are covered by the target version (`n <= V[c]`), then repeatedly pick the *least ready* patch, where "ready" means its base version is satisfied by what has already been replayed (causal delivery) and "least" is by `(Snap order of result version, author bytes, revision)`. Snap order is a linear extension of the causal order (§1 above), and the author/revision tie-break makes the key unique, so this is Lamport's `⇒` with the readiness check acting as the causal-delivery guard. Two properties follow and should be tested:

- Determinism: same patch set ⇒ same replay order ⇒ same tree, on every machine, regardless of import order.
- Prefix stability: replaying to an ancestor version `V' <= V` replays a *subset* of the patches in an order that is a subsequence of the order for `V`, so `snap log`-style queries over history are consistent with the head. (This holds because readiness and the key depend only on the patches themselves, not on the target.)

Cost: `O(|patches|)` per replay with a priority queue on the key; every `status`, `diff`, and merge reconstructs from empty (`§6.1`). For the fixture scale this is irrelevant; if it ever matters, memoising the tree at each frontier is a pure optimisation that must reproduce the same result.

## 7. Prefix-free trees and namespace conflicts (SPEC.md §2, §6.2, §6.4)

`SPEC.md §2` makes the tree prefix-free by path segment: no path may be both a file and a proper prefix of another path. Paths are compared by unsigned UTF-8 byte order, without normalisation, and `.snap/` is excluded.

How other systems handle the resulting conflicts:

- Git detects *directory/file* ("D/F") conflicts and *add/add* conflicts during merge and leaves the index in a conflicted state with multiple stages; for add/add on a text file it writes conflict markers; for D/F it leaves the file under a different name (`path~branch`) and expects the user to resolve [git-merge documentation, "How conflicts are presented"]. Git's paths are byte strings compared as such, and it does no Unicode normalisation by default (`core.precomposeunicode` exists for macOS) — consistent with Snap's byte-order rule.
- Pijul treats a name as a vertex in the graph and enumerates file-level conflicts as first-class states: same-name conflicts, name/directory conflicts, cyclic directories, and zombie files [Pijul manual, "Theory"].
- Darcs records conflicting `addfile`/`adddir` patches as conflictors and marks them for resolution [Darcs Theory wiki].

Snap's rule (`SPEC.md §6.2`, `§6.4`) is again "resolve deterministically and warn": the namespace check runs first — a patch that would create a file at an ancestor or descendant of an existing path loses with `namespace-wins` — and only then are per-path rules applied (`delete-wins`, `later-create-wins`, `later-put-wins`, `put-wins`). Because the namespace check precedes per-path integration, an add/add of a file versus a directory at the same segment can never reach the OT/text path. Warnings are sorted by path then reason so output is byte-deterministic. The trade-off versus git/Pijul is that the losing content is silently dropped from the tree (though recoverable from the patch), which `§6.5` accepts.

## 8. Line-ending handling (SPEC.md §4.4, §7.6)

Git normalises line endings in the *index* according to `text`/`eol` attributes and `core.autocrlf`: with normalisation on, CRLF in the working tree is stored as LF and converted back on checkout, so diffs are computed over LF-normalised content [git gitattributes documentation]. This means two authors on different platforms see no diff from line endings alone, at the cost of a stateful conversion layer that has caused its own class of bugs (mixed endings, `warning: LF will be replaced by CRLF`).

Snap does none of this: `SPEC.md §4.4` splits after LF only, keeps CR inside the token (`"a\r\nb"` → `"a\r\n"`, `"b"`), and performs no normalisation anywhere. Consequences: (a) a CRLF-vs-LF change to a line is an ordinary delete+insert of that token, visible in `snap diff` and subject to OT like any edit; (b) a repository shared across platforms with differing editor settings will see whole-file diffs, exactly as `git` does with `autocrlf=false`; (c) text validity is UTF-8 without NUL (`§4.4`), and anything else is treated as binary and reported as `Binary files … differ` (`§7.6`), mirroring GNU diff's behaviour for non-text input [GNU diffutils manual, "Binary"]. The implementer should confirm that the tokeniser is byte-exact (no `String.split("\n")` that drops the terminator, no platform-dependent line-reading) since `§5` and `§6.3` operate on these tokens.

## Conclusion

Snap is a conservative recombination of well-understood pieces:

- Versions are version vectors (Parker 1983; Fidge/Mattern 1988–89); a patch's `(base, dot)` is a dotted version vector; join is lattice max. The serial-contributor rule is the standard actor invariant that Riak and Dynamo enforce structurally and Snap enforces by convention, detecting violations as unrepairable dot collisions.
- The repository is a state-based CRDT (G-Set of patches ∪ frontier join); the tree is a deterministic function of it via Lamport-style replay in a total order that extends causality. This removes the need for both Darcs-style commutation and CRDT-style commutative operations.
- Text merging is Jupiter-style canonical-log OT: one inclusion transform of the patch's script against the aggregate `diff(base, current)`, with "already-integrated wins" as the tie rule. TP2 is not required because there is one order; TP1 is not required because determinism, not algebra, gives convergence. The price is no intention preservation, which the spec disclaims.
- The diff is not "a minimal diff" but *the* script of a specific forward walk over the suffix DP with delete-on-tie. This uniquely determines output; Myers/Hirschberg/Ukkonen may be used only if shown to reproduce the same path, and patience/histogram cannot. Given fixture sizes, the direct DP is the low-risk option, with faster algorithms as an optional, oracle-tested optimisation.

Open questions not resolved here: whether Myers's greedy tie rule (furthest-reaching, delete-preferred) is provably identical to `§5`'s suffix-table tie rule for all inputs (no proof or counterexample found; it agrees on the published golden, which has a unique minimal script, and on the small `a b` → `b a` tie case); whether the spec intends common-suffix stripping to be permitted (it is safe only if shown to coincide with the forward walk on repeated lines).

## References

- Angiuli, C., Morehouse, E., Licata, D. R., Harper, R. "Homotopical Patch Theory." ICFP 2014. https://doi.org/10.1145/2628136.2628158
- Cohen, B. "Patience Diff Advantages." 2010. https://bramcohen.livejournal.com/73318.html
- Cohen, B. (forwarded by J. Schindelin). "Bram Cohen speaks up about patience diff." git mailing list, 2009. https://public-inbox.org/git/alpine.DEB.1.00.0902052113590.7491@intel-tinevez-2-302/T/
- Darcs project. "Theory" (patch theory, commutation, conflictors). https://darcs.net/Theory
- DeCandia, G., et al. "Dynamo: Amazon's Highly Available Key-value Store." SOSP 2007. https://doi.org/10.1145/1294261.1294281
- Ellis, C. A., Gibbs, S. J. "Concurrency control in groupware systems." SIGMOD 1989. https://doi.org/10.1145/66926.66963
- Fidge, C. J. "Timestamps in Message-Passing Systems That Preserve the Partial Ordering." Proc. 11th Australian Computer Science Conference, 1988, pp. 56–66. http://sky.scitech.qut.edu.au/~fidgec/Publications/fidge88a.pdf
- git project. "gitattributes" (text, eol, core.autocrlf). https://git-scm.com/docs/gitattributes
- git project. "git-merge — How conflicts are presented." https://git-scm.com/docs/git-merge
- git project. "Documentation/diff-algorithms" discussion (myers/minimal/patience/histogram). http://public-inbox.org/git/CAGZ79kap9TovN2ia4pEgz33dh=9y89cVYZWnB_1e6iHpR=kDOQ@mail.gmail.com/ ; source `xdiff/xdiffi.c` in https://github.com/git/git
- GNU Project. "GNU Diffutils manual" (Incomplete Lines; Binary). https://www.gnu.org/software/diffutils/manual/
- Hirschberg, D. S. "A linear space algorithm for computing maximal common subsequences." CACM 18(6), 1975. https://doi.org/10.1145/360825.360861
- Hunt, J. W., McIlroy, M. D. "An Algorithm for Differential File Comparison." Bell Labs Computing Science Technical Report 41, 1976. https://www.cs.dartmouth.edu/~doug/diff.pdf
- Imine, A., Molli, P., Oster, G., Rusinowitch, M. "Proving Correctness of Transformation Functions in Real-Time Groupware." ECSCW 2003. https://doi.org/10.1007/978-94-010-0068-0_15 ; PDF https://dl.eusset.eu/bitstreams/f68f7b26-0dd0-4931-821c-328ced4bb096/download
- Imine, A., Rusinowitch, M., Oster, G., Molli, P. "Formal design and verification of operational transformation algorithms for copies convergence." Theoretical Computer Science 351(2), 2006. https://doi.org/10.1016/j.tcs.2005.09.066
- Lamport, L. "Time, Clocks, and the Ordering of Events in a Distributed System." CACM 21(7), 1978. https://doi.org/10.1145/359545.359563
- Mattern, F. "Virtual Time and Global States of Distributed Systems." In Cosnard et al. (eds.), Parallel and Distributed Algorithms, North-Holland, 1989, pp. 215–226. https://www.vs.inf.ethz.ch/publ/papers/VirtTimeGlobStates.pdf
- Mimram, S., Di Giusto, C. "A Categorical Theory of Patches." Electronic Notes in Theoretical Computer Science 298, 2013. https://doi.org/10.1016/j.entcs.2013.09.018
- Myers, E. W. "An O(ND) Difference Algorithm and Its Variations." Algorithmica 1(2), 1986, pp. 251–266. https://doi.org/10.1007/BF01840446 ; PDF https://publications.mpi-cbg.de/Myers_1986_6330.pdf
- Nichols, D. A., Curtis, P., Dixon, M., Lamping, J. "High-latency, low-bandwidth windowing in the Jupiter collaboration system." UIST 1995. https://doi.org/10.1145/215585.215706
- Oster, G., Urso, P., Molli, P., Imine, A. "Data Consistency for P2P Collaborative Editing" (WOOT). CSCW 2006. https://doi.org/10.1145/1180875.1180916
- Oster, G., Urso, P., Molli, P., Imine, A. "Tombstone Transformation Functions for Ensuring Consistency in Collaborative Editing Systems." CollaborateCom 2006. https://doi.org/10.1109/COLCOM.2006.361867
- Parker, D. S., Popek, G. J., Rudisin, G., Stoughton, A., Walker, B. J., Walton, E., Chow, J. M., Edwards, D., Kiser, S., Kline, C. "Detection of Mutual Inconsistency in Distributed Systems." IEEE Transactions on Software Engineering SE-9(3), 1983. https://doi.org/10.1109/TSE.1983.236733
- Pijul project. "The Pijul manual — Theory." https://pijul.org/manual/theory.html
- Preguiça, N., Baquero, C., Almeida, P. S., Fonte, V., Gonçalves, R. "Dotted Version Vectors: Logical Clocks for Optimistic Replication." arXiv:1011.5808, 2010. https://arxiv.org/abs/1011.5808
- Ressel, M., Nitsche-Ruhland, D., Gunzenhäuser, R. "An integrating, transformation-oriented approach to concurrency control and undo in group editors." CSCW 1996. https://doi.org/10.1145/240080.240305
- Riak (Basho). "Causal Context." https://docs.riak.com/riak/kv/latest/learn/concepts/causal-context/index.html
- Riak (Basho). "Vector Clocks Revisited." https://riak.com/posts/technical/vector-clocks-revisited/ ; "Vector Clocks Revisited Part 2: Dotted Version Vectors." https://riak.com/posts/technical/vector-clocks-revisited-part-2-dotted-version-vectors/ ; "Why Vector Clocks Are Hard." https://riak.com/posts/technical/why-vector-clocks-are-hard/ ; basho/riak_kv PR #1027 (duplicate vnode IDs cause data loss). https://github.com/basho/riak_kv/pull/1027
- Roh, H.-G., Jeon, M., Kim, J.-S., Lee, J. "Replicated abstract data types: Building blocks for collaborative applications" (RGA). JPDC 71(3), 2011. https://doi.org/10.1016/j.jpdc.2010.12.006
- Shapiro, M., Preguiça, N., Baquero, C., Zawirski, M. "A comprehensive study of Convergent and Commutative Replicated Data Types." INRIA Research Report RR-7506, 2011. https://hal.inria.fr/inria-00555588
- Shapiro, M., Preguiça, N., Baquero, C., Zawirski, M. "Conflict-free Replicated Data Types." SSS 2011. https://doi.org/10.1007/978-3-642-24550-3_29
- Sun, C., Jia, X., Zhang, Y., Yang, Y., Chen, D. "Achieving convergence, causality preservation, and intention preservation in real-time cooperative editing systems." ACM TOCHI 5(1), 1998. https://doi.org/10.1145/274444.274447
- Ukkonen, E. "Algorithms for approximate string matching." Information and Control 64(1–3), 1985. https://doi.org/10.1016/S0019-9958(85)80046-2
- Wagner, R. A., Fischer, M. J. "The String-to-String Correction Problem." JACM 21(1), 1974. https://doi.org/10.1145/321796.321811
- Weiss, S., Urso, P., Molli, P. "Logoot: A Scalable Optimistic Replication Algorithm for Collaborative Editing on P2P Networks." ICDCS 2009. https://doi.org/10.1109/ICDCS.2009.75
- Snap. `SPEC.md` (§1, §1.1, §2, §3.1, §3.3–§3.5, §4.2–§4.4, §5, §6.1–§6.5, §7.6, §12); `tests/05-diff-goldens.yaml`; `tests/16-dot-collision.yaml`; `tests/22-ot-matrix.yaml`.
