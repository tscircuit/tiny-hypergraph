# tiny-hypergraph

Tiny hypergraph implementation. [Read more about HyperGraph Autorouting](https://blog.autorouting.com/p/hypergraph-autorouting), check out [online animated examples](https://tiny-hypergraph.vercel.app/?fixture=%7B%22path%22%3A%22pages%2Fdataset-hg07.page.tsx%22%7D)

<img width="1036" height="1540" alt="image" src="https://github.com/user-attachments/assets/69f1f1f3-40e8-486c-9402-f2b22dd885c0" />

## Usage

### Solve a serialized hypergraph

```ts
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib"

const inputGraph: SerializedHyperGraph = /* ... */

const { topology, problem } = loadSerializedHyperGraph(inputGraph)
const solver = new TinyHyperGraphSolver(topology, problem)

solver.solve()

if (!solver.solved || solver.failed) {
  throw new Error(solver.error ?? "Solver did not finish successfully")
}

const solvedGraph = solver.getOutput()
```

Existing routing can be preloaded through the standard region assignments:

```ts
const inputGraph: SerializedHyperGraph = {
  regions: [
    {
      regionId: "middle",
      pointIds: ["left-port", "right-port"],
      assignments: [
        {
          regionPort1Id: "left-port",
          regionPort2Id: "right-port",
          connectionId: "trace-1",
        },
      ],
      d: {},
    },
  ],
  ports,
  connections,
}
```

The assignments seed regular route-owned solver state. They reserve their
existing ports and contribute to region congestion immediately, but remain
eligible for the normal rip-and-reroute process. They do not create regions or
otherwise change the hypergraph topology.

### Outside-in partial reripping

`SelectiveReripTinyHyperGraphSolver` preserves the unaffected prefix and
suffix of each route that crosses a hot region. Only a bounded window around
the route's hottest affected segment is reopened. The reopened span is searched
from both retained ends, with a hard geometric travel limit on each frontier;
if the frontiers cannot meet within that limit, the span safely falls back to
the regular one-ended search.

The behavior can be tuned through `TinyHyperGraphSolverOptions`:

```ts
const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, {
  PARTIAL_RIP_ENABLED: true,
  PARTIAL_RIP_MIN_ROUTE_COUNT: 100,
  PARTIAL_RIP_MAX_ROUTE_COUNT: 350,
  PARTIAL_RIP_MAX_DISTANCE: 12,
  PARTIAL_RIP_QUALITY_MAX_DISTANCE: 24,
  PARTIAL_RIP_MAX_ATTEMPTS: 10,
  OUTSIDE_IN_ROUTING: true,
  OUTSIDE_IN_MAX_DISTANCE: 24,
})
```

Set `PARTIAL_RIP_ENABLED` or `OUTSIDE_IN_ROUTING` to `false` to use the legacy
whole-route or one-ended behavior respectively.
`PARTIAL_RIP_MIN_ROUTE_COUNT` and `PARTIAL_RIP_MAX_ROUTE_COUNT` provide an
inclusive scale window; graphs outside it use the legacy behavior. The solver
exposes aggregate
partial-rip, retained-segment, frontier-expansion, distance-prune, and fallback
counts through `solver.stats`. When the first completed solution is already
within 1.5 times the configured final rip threshold, the solver uses the
quality-recovery distance (twice the normal distance when unspecified) for the
entire partial-rip run; this gives low-cost solutions enough room to remove a
last hotspot without slowing heavily congested cases.

### Export a solved solver back to `SerializedHyperGraph`

`solver.getOutput()` now returns a `SerializedHyperGraph` for a solved
`TinyHyperGraphSolver`.

Under the hood it uses
`lib/compat/convertToSerializedHyperGraph.ts`, which reconstructs:

- `regions`
- region `assignments`
- `ports`
- `connections`
- `solvedRoutes`

The serialized region and port ids from
`loadSerializedHyperGraph(...)` are preserved, so a graph loaded through the
compat layer can be solved and then round-tripped back into the same serialized
shape.

If you want to call the converter directly:

```ts
import { convertToSerializedHyperGraph } from "lib/compat/convertToSerializedHyperGraph"

const solvedGraph = convertToSerializedHyperGraph(solver)
```

The converter expects the solver to be fully solved and not failed.

## Deterministic four-candidate race

`RacingTinyHyperGraphSolver(topology, problem, options)` supports synchronous
`.step()` / `.solve()` and `.solveAsync(runtime)` with identical routed output.
Exactly four candidates are initialized in every mode, independent of worker
count. The successful candidate with the fewest native logical steps wins;
ties use the lower index. Scheduling and elapsed time never select routing.

| Candidate | Initial order | Distance heuristic multiplier | Native step budget |
| --- | --- | --- | --- |
| 0 | Original | 1 | Original |
| 1 | Reverse | 4 | One eighth |
| 2 | Original | 4 | One eighth |
| 3 | Original | 10 | One eighth |

Speculative candidates require native completion and cannot win by accepting
a timeout result. Candidate zero retains the caller's original timeout policy.
All candidates compete from the start; no exception is swallowed. Three
bounded candidates add at most 37.5% of the original search-step budget if all
fail, excluding ceiling rounding, initialization and native finalization costs.
This is not a wall-time bound.

For preloaded copper, all four retain the original heuristic and ordering.
The three strict alternatives use budgets of one eighth, one tenth and one
twelfth, so they can only tie the original topology; lane zero wins the tie.
This preserves existing copper repair behavior while retaining four candidates.
Set `raceUseSelectiveRerip: true` to restore initial copper assignments on global
retries while preserving the existing selective-blocker policy.

Synchronous execution batches 128 native steps per lane to keep each frontier
hot and amortize pipeline bookkeeping. Every lane reaches the earliest successful
native step before the winner is selected. Wrapper iteration counts are batch
counts; `stats.raceWinningIterations` reports native steps. A partially stepped
race resumes the same synchronous schedule.

Import `tiny-hypergraph/lib/racing-tiny-hypergraph-solver` in host and worker
entrypoints to register `TinyHyperGraphRaceCandidateSolver`. Workers share an
atomic best-completion-step bound. The default library does not import Node
worker APIs. Browsers without a runtime or shared memory use the synchronous
four-candidate implementation.

The initial prototype allowed bounded timeout acceptance and obtained a 60.1%
port-point phase reduction on SRJ18, but regressed routing completion. That
prototype was rejected. Timing results for it do not validate this stricter
candidate policy; end-to-end completion and DRC remain required checks.
