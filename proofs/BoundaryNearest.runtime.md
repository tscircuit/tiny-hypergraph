# Algorithmic audit and cross-runtime validation

## Fresh-main audit

Explicit `git fetch origin main:refs/remotes/origin/main` found tiny-hypergraph
main `0750fa4c95e25a61d0e9e7250aa08c2046e671d8`. PR #214 remained open and the
optimization was absent. Main was safely merged into the candidate branch at
`cc9e5e5c0a73e6fd5e44c26fefedc24c407cd962`, preserving the earlier work. New main
changes concern blocker reachability; `DuplicateCongestedPortSolver` and `core`
are unchanged. The browser and warmed Bun comparisons below include separate
**current owning-main baseline and candidate** snapshots.

The consumer was checked independently: autorouter main is still
`34dc48b0bec14d802eda5936f0bd76a426a41136` and still pins tiny-hypergraph
`31459ceef75e443d3ea6efca75cde10b90d63180`. No dependency bump was made. Actual
consumer-pin baseline/boundary/lazy modes were measured separately. The capture
checkout includes the sibling lazy-option change, which the harness explicitly
overrides to false in every baseline and boundary mode. Historical measurements
retain their original revision labels in `BoundaryNearest.benchmark.*`.

## What logical work is eliminated

For P original ports and Q queried congested sources, the old algorithm traverses
Q*P entries. The candidate groups once and traverses only same-key buckets:
P + sum(bucket sizes). It removes other-boundary rejection visits and repeated
creation/sort/join of two-element region-ID arrays. It does **not** change or
skip distance calculations for retained same-boundary entries.

The invariant is that every bucket is the original list's stable boundary-key
filter. Only original ports enter the index; later duplicates cannot affect it.
The same key encoding, order, source-ID exclusion, EPSILON guard and distance
comparison remain. The index lives inside one synchronous call with immutable
serialized source data; no persistent cache-invalidation assumption is needed.

Checked Lean theorems now include the exact identity
`Q*P = retained visits + omitted visits` and the equivalence
`P + retained < Q*P iff P < omitted`. Thus the indexing overhead is accounted for;
a win is conditional on omitted work paying for it, not assumed. The semantic
proof works for an arbitrary accumulator transition, so it needs no real-number
model of JavaScript floats and preserves the original comparison outcomes and
ties. See `BoundaryNearest.md` for the explicit TypeScript mapping and limits.

Across the five actual inputs, measured visits fall from **7,586,116 to 73,963**,
including indexing: **7,512,153 fewer visits (99.03%)**. Original IDs are unique on
these measured inputs, so key constructions fall from 7,586,116 to P+Q = 71,280.
These are algorithmic counts independent of JIT, CPU timing or JS engine.

## Real Chromium and warmed Bun

The same captured Pipeline 9 prepass graphs/options were run serially on Apple
M5, macOS 27.0 arm64. Chromium is actual headless Chromium **151.0.7922.34**, V8
**15.1.206.8**, driven over CDP from shell. Bun **1.3.14** was measured separately;
Bun driving the browser does not make its in-page timings Bun measurements.

Each runtime used two warmup rounds and five measured rounds, rotating five-mode
order each round; each solve gets a fresh solver. Both variants have identical
counter instrumentation and explicit GC handling. Timings include the complete
prepass constructor/solve, excluding output hashing. All graph/report SHA256
values match across every mode, warmup and repetition within each engine.
Cross-engine hashes differ on samples 3 and 4 even for the unmodified baseline;
this change does not promise byte-identical output between JS engines. The proof
preserves each engine's original transition rather than assuming shared
floating-point transcendental results. The cause of the cross-engine differences
was not isolated in this experiment. The saved
`BoundaryNearest.runtime.json` records individual times, heap observations,
counters, exact revisions and input/output hashes.

Current owning-main comparison, medians in milliseconds:

| Sample | Chromium baseline → candidate | Reduction | Bun baseline → candidate | Reduction |
| --- | ---: | ---: | ---: | ---: |
| 1 | 286.60 → 202.40 | 29.4% | 210.60 → 92.81 | 55.9% |
| 2 | 477.30 → 340.40 | 28.7% | 367.26 → 166.40 | 54.7% |
| 3 | 272.40 → 186.00 | 31.7% | 215.77 → 96.26 | 55.4% |
| 4 | 157.40 → 106.70 | 32.2% | 118.10 → 49.98 | 57.7% |
| 5 | 243.70 → 193.90 | 20.4% | 156.83 → 88.05 | 43.9% |

The separately measured consumer-pin boundary mode improves all five Chromium
medians by 25.1–33.9%. Lazy-only mode belongs to the sibling PR and is included
for isolation; it is not combined with this change or used for its speed claim.

Memory was tracked, not assumed improved. Observed post-solve Chromium heap
deltas were larger for the candidate on four of five cases (for example sample
2: 14.0 MB → 33.9 MB, sample 4: 13.5 MB → 35.0 MB). Post-GC deltas are noisy,
including negative values from collection of unrelated prior objects. These are
sampled JS heap observations, not peak/RSS or allocation totals; no memory
improvement is claimed. The index adds O(P) references/buckets during duplication
and is released afterward. Raw observations are retained for all repetitions.

## Full browser routing check

The full Pipeline 9 bundle and the existing `evaluateRelaxedDrc` evaluator also
ran in Chromium on the bounded representative subset 1, 3, 5. Two warmup solves
(sample 1 in both modes) preceded one measured sweep. These single observations
are not sufficient for an end-to-end speedup claim:

| Sample | Baseline → boundary ms | Vias, both | Planar wire length, both | Relaxed DRC errors, both |
| --- | ---: | ---: | ---: | ---: |
| 1 | 9072.7 → 8836.8 | 174 | 2219.790072 | 0 |
| 3 | 6266.3 → 7374.9 | 90 | 890.127264 | 0 |
| 5 | 7444.5 → 7159.1 | 146 | 1993.979299 | 0 |

All six solved, and entire routed-output hashes match per case. Planar wire
length sums consecutive wire-point distances, excluding via vertical extent.
The timer excludes DRC and hashing. The full check's cooperative 60-second
step-loop cap cannot interrupt one synchronous step; the prescribed earlier
worker benchmark has a different timeout mechanism. A separate lazy-only
session also matched these outputs; its unmatched timing schedule is labeled.

The full browser results and earlier full Bun benchmark both show mixed timing.
The supported improvement remains **less logical search work and faster
preprocessing**, now demonstrated on both Chromium/V8 and Bun/JSC. No broader
routing-quality or end-to-end speedup is asserted.

## Reproduction and checks

Runnable shell-only source, capture/setup scripts, commands, GC semantics and
limitations: `scripts/benchmarking/boundary-runtime/README.md`. Normalized harness
setup/build and a short real-browser smoke run passed; those smoke timings are
excluded from performance evidence. Original full-result metadata was corrected
to describe the actual selected samples/order and two heap observation points;
no measured timing or output row was edited.

Lean: `~/.elan/bin/lean +leanprover/lean4:v4.28.0 proofs/BoundaryNearest.lean`.
No `sorry`, `admit`, or custom axioms. Final local formatting, typechecking and
focused tests are rerun on the committed, updated branch. No manual CI reruns or
snapshot regeneration are used.
