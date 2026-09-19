# Full-connection reroute performance

Based on `origin/main` (`ae00a96`), with the implementation and regressions from
PR #203 applied directly (without its stacked snapshot-only prerequisite).

## Local measurement

Bun 1.3.14, macOS arm64; sequential hg07 runs. Both versions receive the same
104 serialized section-stage outputs. Times include construction and rerouting,
but exclude input loading, the initial/section solve, and final independent
validation. These are single-run measurements, not end-to-end autorouter timings.

| Metric | Original PR #203 | Optimized |
| --- | ---: | ---: |
| Total reroute stage time | 8.576 s | 2.572 s |
| Average final maximum region cost | 0.132145 | 0.131615 |
| Successful cases | 104 | 104 |

Speedup: **3.33×**, or **70.0% less reroute time**.
103 outputs are identical; sample062 improves maximum cost from 0.300929 to
0.245854. No case regresses against either the original PR or its section-stage
incumbent. All outputs retain every connection. The existing sample014
`source_trace_69` endpoint-mapping error occurs before rerouting and is excluded.

## Implementation

- Copy validated fixed segment lists and share immutable intersection caches;
  recompute only the regions losing a segment. Preserve shared-net occupancy.
- Calculate route distance heuristics lazily rather than allocating the
  ports-by-connections matrix for each single-route search.
- Screen candidates in replay insertion order before serializing the entire
  graph. Coincident port angles make raw search-state scores order-dependent.
  Every accepted candidate still passes full serialization and caller-provided
  loader replay. Screening is a search heuristic; the measured output equivalence
  above is specific to this dataset, not a guarantee for every graph or loader.
- Skip shared-port scans and endpoint fallback searches when a serialized solved
  path already supplies that information.
- Expose `fullConnectionRerouteOptions.maxTotalIterations` on pipeline input.
  Budget exhaustion returns the latest complete incumbent, including accepted
  reroutes when the outer pipeline stops before the stage completes.
- `pipeline.getSolvedSolver()` exposes that same final incumbent to downstream
  consumers. Custom loader metadata restoration remains supported.

## Reproduce

```sh
bun scripts/benchmarking/full-connection-reroute.ts prepare /tmp/reroute-inputs.json
bun scripts/benchmarking/full-connection-reroute.ts run /tmp/reroute-inputs.json /tmp/reroute-results.json
bun test --timeout 9999999
bun run typecheck
```

For before/after measurements, run the same harness and prepared input file with
PR #203's original reroute implementation and with the optimized implementation.
The JSON report includes per-case timings, replayed scores, counters, and outputs.
Do not run the timed measurement concurrently with tests.

## Autorouter integration

The companion local change in `tscircuit-autorouter` makes
`TinyHyperGraphSectionPipelineWithTerminalNetIds.getSolvedTinySolver()` use
`getSolvedSolver()` and updates current-solver selection to include rerouting.
Previously downstream scoring and port-point output ignored the new final stage.

Five focused autorouter tests pass with a temporary TypeScript path override to
this checkout: final-stage selection, terminal PCB port identities, error
propagation, candidate portfolio, and pipeline input immutability. The autorouter's
existing package pin is unchanged: adopting this upstream requires publishing or
pinning the resulting tiny-hypergraph revision together with the companion change.
