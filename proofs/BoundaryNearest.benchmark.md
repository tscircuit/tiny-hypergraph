# Pipeline 9 boundary-search experiment

The candidate replaces repeated whole-graph nearest-boundary scans with one
stable boundary index. It changes no distance expression or tie comparison.
See `BoundaryNearest.md` for the checked refinement proof and its limits.
Raw per-case times, input/output hashes, work counts, and routing metrics are in
`BoundaryNearest.benchmark.json`.

## Revisions and workload

- Autorouter: `34dc48b0bec14d802eda5936f0bd76a426a41136`.
- Pinned tiny-hypergraph: `31459ceef75e443d3ea6efca75cde10b90d63180`.
- Candidate: only the `DuplicateCongestedPortSolver.ts` diff from package commit
  `6c1b9fde2ffa7f585b1e0fd063c5bf11c5318270`, applied to the pinned dependency.
  That file is identical at the pinned revision and package PR base
  `ae00a96acef719af5c44b35109b95a2157966bfc` before the patch.
- SRJ18 samples 1–5, effort 1, existing fixed dataset/sample order and default
  deterministic solver seeds. No custom random inputs or seed changes.
- Apple M5, Darwin arm64/macOS 27.0, Bun 1.3.14; serial local runs with other
  coordinated timing work paused. Frozen autorouter dependency lock.
- Eager heuristic enabled in both modes. The sibling lazy-heuristic change is
  **excluded** from this comparison.

The actual Pipeline 9 constructor CPU profile located the bottleneck:
`getBoundaryKey` plus `findNearestPortOnSameBoundary` accounted for approximately
657 ms of 3431 ms sampled (19.2%). These costs occur inside a constructor and are
not fully represented by ordinary stage timing.

## Measured prepass benefit

The measured region is the complete `DuplicateCongestedPortSolver.solve()` call,
including independent route solves and duplication, excluding upstream stages,
main pathing, and output hashing. Identical counter instrumentation wraps both
variants. Three fresh-process runs per variant, followed by a baseline drift
check; baseline runs originally alternated with a separate lazy experiment,
then boundary runs were sequential. They were not randomized/interleaved pairs.

| SRJ18 sample | Baseline median ms | Candidate median ms | Reduction | Final baseline ms | Full-scan visits | Index + bucket visits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 293.70 | 145.31 | 50.5% | 278.07 | 1,562,113 | 13,932 |
| 2 | 417.21 | 225.46 | 46.0% | 404.79 | 2,574,969 | 20,964 |
| 3 | 227.37 | 102.09 | 55.1% | 222.26 | 1,581,736 | 15,737 |
| 4 | 133.35 | 57.49 | 56.9% | 130.68 | 891,770 | 8,549 |
| 5 | 173.85 | 101.73 | 41.5% | 168.16 | 975,528 | 14,781 |

Every prepass graph/report hash matched exactly. A separate differential check
on actual constructor inputs also compared full outputs and counted the
original array's iteration visits using a Proxy. Candidate counts include the
single grouping pass plus matching bucket lengths: 98.5–99.2% fewer entries.
The index uses additional O(P) references and bucket storage; peak memory was
not measured and no memory improvement is claimed. Low-query/dense-boundary
inputs can have smaller benefits or overhead; zero-query inputs never build it.

The reproducible prepass harness is committed in autorouter commit
`d1f01c5dc63796cecd35533a8ccb806edf5e9f4f`:

```sh
bun scripts/benchmark/measure-pipeline9-prepass-heuristic.ts
```

Run with the pinned package, then with only the candidate source patch. The
command explicitly forces eager heuristics, including when run from that
harness commit, and reports SHA256 of the entire output graph plus report.
Initial runs used the same logic in a scratch script; the typed committed
harness was verified with the final baseline check.

## Full-pipeline check and limits

The existing prescribed benchmark was run once per variant:

```sh
./benchmark.sh --pipeline 9 --dataset srj18 --sample-numbers 1,2,3,4,5 --effort 1 --sample-timeout 60s --concurrency 1
```

Both completed 4/5 cases with 4/5 relaxed DRC passes. Completed-case via counts
were identical: 174, 90, 136, 146 for samples 1, 3, 4, 5; all had zero DRC errors.
Sample 2 timed out in both runs (baseline at power-trace expansion, candidate
later at joint DRC repair). This is not a claim of output equality for interrupted
full pipelines.

Full-pipeline times in seconds, baseline → candidate: sample 1 7.695 → 7.584;
sample 2 60 → 60; sample 3 6.248 → 7.557; sample 4 32.825 → 37.614;
sample 5 5.803 → 5.950. P50 7.695 → 7.584, P95 54.565 → 55.523.
These mixed single-run results **do not establish an end-to-end runtime win**.
The supported claim is less nearest-neighbor search work and faster constructor
preprocessing on the five measured cases, with identical preprocessing outputs.

Existing GitHub run `36263365509`, attempt 1, was also inspected using `gh` and
its shared downloaded artifact. It used the same autorouter SHA, SRJ19 samples
1–200, effort 1, 32 ARM workers, and a 360-second cap: 181 completed, 19 timed out,
144 passed relaxed DRC. This historical context was reused rather than rerun;
it is not a controlled timing comparator for this local SRJ18 experiment.

## Local verification

```sh
bun test tests/solver/duplicate-congested-port-solver.test.ts tests/solver/duplicate-congested-port-boundary-index.test.ts
bun run typecheck
bun run format:check
~/.elan/bin/lean +leanprover/lean4:v4.28.0 proofs/BoundaryNearest.lean
```

Seven focused tests pass. Format checking reports only the two existing
oversized fixture warnings. No snapshots were updated, CI manually triggered,
or CI runs retried.
