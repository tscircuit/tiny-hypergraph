# Progress

## Baseline Stats

Environment: local Bun run in `/home/ohmx/Documents/tiny-hypergraph`.

- Repo stats before edits: 94 files under `lib/tests/scripts`; 38 TypeScript
  files in `lib`; 39 TypeScript test files; 13,332 total lines in `lib/*.ts`.
- `bun test`: 90 pass, 0 fail, 11.23s.
- `bun run typecheck`: passed.
- `./benchmark.sh --limit 10 --concurrency 6`: 10/10 success, avg duration
  0.090s, p50 0.052s, p95 0.347s, avg final max region cost 0.170.
- `./benchmark-srj13.sh --limit 5`: 40.0% success, avg duration 8.459s,
  avg iterations 1,000,000.0, avg solved max region cost 519.897.
- `./benchmark2.sh`: solved CM5IO in 49.892s, routeCount 158, regionCount
  2538, portCount 17816, ripCount 9, avgMaxRegionBeforeRip 3.633.

## Work System

1. Capture stats before changing behavior.
2. Keep vocabulary changes in `dictionary.md`.
3. Build `lib2` as a measurable compatibility slice first.
4. Add tests through public seams.
5. Run typecheck, tests, and representative benchmarks.
6. Only move performance-sensitive internals after a benchmark comparison exists.

## Current Checklist

- [x] Load TypeScript standards.
- [x] Capture original tests and benchmarks.
- [x] Use sub-agent architecture review.
- [x] Start Claude CLI architecture review without killing early.
- [x] Add `lib2` API and docs.
- [x] Add benchmark flags for `lib2`.
- [x] Verify and compare.

## Lib2 Verification

- `bun run typecheck`: passed.
- `bun test`: 93 pass, 0 fail, 11.92s.
- `./benchmark.sh --limit 10 --concurrency 6 --solver lib2`: 10/10 success,
  avg duration 0.043s, p50 0.025s, p95 0.150s, avg final max region cost
  0.170.
- `./benchmark-srj13.sh --limit 5 --solver lib2`: 40.0% success, avg
  duration 7.693s, avg iterations 1,000,000.0, avg solved max region cost
  519.897.
- `./benchmark2.sh --solver lib2`: solved CM5IO in 47.531s, routeCount 158,
  regionCount 2538, portCount 17816, ripCount 9, avgMaxRegionBeforeRip 3.633.

## Owned Lib2 Rewrite

- `TinyHyperGraphSolver2` now extends `BaseSolver` directly instead of
  `TinyHyperGraphSolver`.
- `TinyHyperGraphSectionPipelineSolver2` now extends `BasePipelineSolver`
  directly instead of `TinyHyperGraphSectionPipelineSolver`.
- `TinyHyperGraphSolver2` owns its solver state, route search lifecycle, rerip
  policy, final acceptance, output, and visualization hooks.
- Lib2 uses `MutableRegionCache` and `readSegmentGeometry` for route cost and
  committed segment cache updates.
- `convertToSerializedHyperGraph`, `visualizeTinyGraph`, and static
  reachability visualization now depend on a structural
  `TinyHyperGraphSolverView` instead of the nominal legacy solver class.

Verification after ownership rewrite:

- `bun run typecheck`: passed.
- `bun test`: 97 pass, 0 fail, 13.63s.
- `./benchmark-srj13.sh --limit 5 --solver lib2`: 40.0% success, avg duration
  7.935s, avg iterations 1,000,000.0, avg solved max region cost 519.897.
- `./benchmark.sh --limit 10 --concurrency 6 --solver lib2`: 10/10 success,
  avg duration 0.053s, p50 0.028s, p95 0.180s, avg final max region cost
  0.170.
- `./benchmark2.sh --solver lib2`: solved CM5IO in 47.168s, routeCount 158,
  regionCount 2538, portCount 17816, ripCount 9, avgMaxRegionBeforeRip 3.633.

## Owned Lib2 Section Optimization

- `TinyHyperGraphSectionSolver2` now lives in `lib2/section-solver.ts` and uses
  `TinyHyperGraphSolver2` for baseline replay, section search, candidate
  scoring, visualization, and output.
- `TinyHyperGraphSectionPipelineSolver2` now instantiates
  `TinyHyperGraphSectionSolver2`; it no longer imports or creates the legacy
  section solver.
- Section candidate-family helpers now live under `lib2` and use lib2 topology
  types.
- Fixed a lib2 section-search timeout bug: incomplete fixed-only section state
  is rejected and the public section solver falls back to the baseline solution
  instead of treating missing active routes as an optimized candidate.
- This bug appears to be inherited from legacy `lib/section-solver/index.ts`.
  The current fix is only in `lib2/section-solver.ts`; legacy `lib` still
  needs the same fallback behavior if it remains supported.

Verification after section ownership:

- `bun run typecheck`: passed.
- `bun test tests/lib2`: 10 pass, 0 fail.
- `bun test`: 100 pass, 0 fail, 11.16s.
- `./benchmark.sh --limit 10 --concurrency 6 --solver lib2`: 10/10
  success, avg duration 0.053s, p50 0.025s, p95 0.171s, avg final max
  region cost 0.170.
- `./benchmark-srj13.sh --limit 5 --solver lib2`: 40.0% success, avg
  duration 8.091s, avg iterations 1,000,000.0, avg solved max region cost
  519.897.
- `./benchmark2.sh --solver lib2`: solved CM5IO in 47.470s, routeCount 158,
  regionCount 2538, portCount 17816, ripCount 9, avgMaxRegionBeforeRip 3.633.

## Lib2 Independence Cut

- Moved lib2-owned domain types into `lib2/domain.ts` and primitive graph/cache
  types into `lib2/types.ts`.
- Moved `computeRegionCost`, `MinHeap`, `shuffle`, and `range` into lib2-owned
  modules.
- Moved serialized graph load/output adapters into `lib2/graph-load.ts` and
  `lib2/graph-output.ts`.
- Removed lib2 runtime and test imports from `lib/core`, `lib/types`,
  `lib/computeRegionCost`, `lib/MinHeap`, `lib/shuffle`, `lib/utils`,
  `lib/compat/loadSerializedHyperGraph`, and
  `lib/compat/convertToSerializedHyperGraph`.
- Updated lib2-capable benchmarks so `--solver lib2` uses the lib2 graph loader
  while legacy/core branches still use legacy adapters.
- Made `lib/solver-view.ts` structural around the fields visualizers and
  serializers actually read, avoiding nominal coupling through private heap
  fields.

Verification after independence cut:

- `bun run typecheck`: passed.
- `bun test tests/lib2`: 12 pass, 0 fail.
- `bun test`: 102 pass, 0 fail, 13.31s.
- `./benchmark.sh --limit 10 --concurrency 6 --solver lib2`: 10/10 success,
  avg duration 0.054s, p50 0.028s, p95 0.174s, avg final max region cost
  0.170.
- `./benchmark-srj13.sh --limit 5 --solver lib2`: 40.0% success, avg
  duration 8.302s, avg iterations 1,000,000.0, avg solved max region cost
  519.897.
- `./benchmark2.sh --solver lib2`: solved CM5IO in 47.780s, routeCount 158,
  regionCount 2538, portCount 17816, ripCount 9, avgMaxRegionBeforeRip 3.633.
