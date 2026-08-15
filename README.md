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

### Optimize region costs after solving

`UnravelTinyHyperGraphSolver` accepts a completed solver and monotonically
reduces its maximum region cost. On a maximum-cost plateau, a mutation must be a
Pareto improvement across total region cost, segment concentration, and the
downstream detailed-router crossing-risk metrics. It alternates complete
boundary-port untwist descents (atomic swaps and three-port cycles) with
graph-wide route replacement until neither neighborhood can improve the solved
graph. At a one-route local optimum, it also evaluates two-route ejection
chains drawn from measured blocked-port and replacement-corridor dependencies.
This allows a route to move only after the route obstructing its better path is
removed, without enumerating every route pair.

Each route replacement uses the core A* marginal region-cost objective and an
equal-weight congestion scalarization that exposes minimax improvements hidden
by an additive path score. Every completed path is still selected by the exact
whole-graph objective. An admissible route-removal lower bound orders and
prunes the graph-wide search.
Valid paths found during a sweep are carried through later boundary swaps,
ownership-validated, and fully rescored before reuse; a final fresh A* sweep is
still required before reporting a local optimum. Replacement states use
copy-on-write region storage: only removed and newly traversed corridors rebuild
their cost and physical-risk geometry, while the exact objective is aggregated
over the whole graph. The default optimization is not route-, sample-, density-,
or mutation-count gated. Resource caps and a per-route detour ceiling remain
explicit opt-in options, and the original solution remains a safe fallback.

```ts
import {
  TinyHyperGraphSolver,
  UnravelTinyHyperGraphSolver,
} from "lib"

const solver = new TinyHyperGraphSolver(topology, problem)
solver.solve()

if (!solver.solved || solver.failed) {
  throw new Error(solver.error ?? "Solver did not finish successfully")
}

const optimizer = new UnravelTinyHyperGraphSolver(solver)
optimizer.solve()

const optimizedGraph = optimizer.getOutput()
```

The section pipeline runs this as its final `optimizeRegionCosts` stage. Useful
statistics include `initialMaxRegionCost`, `finalMaxRegionCost`,
`acceptedSwapMutationCount`, `acceptedCycleMutationCount`,
`acceptedRerouteMutationCount`, `acceptedPairRerouteMutationCount`,
`evaluatedMutationCount`, `rerouteSearchCount`,
`rerouteSearchIterationCount`, and `reusedRerouteCandidateCount`. Set
`MAX_REROUTE_SEGMENT_INCREASE` to opt into a per-route detour ceiling, or
`MAX_MUTATIONS: 0` to retain the solved input without running post-solve
mutations. Run `PROFILE_UNRAVEL=1 ./benchmark.sh` to print the complete initial
and final objective summaries plus search counters for each benchmark sample.

Boundary swaps stay on the same copper layer so a local untwist cannot
silently move a long trace onto a pad's layer.
Cross-layer boundary swaps preserve each affected route's transition count, so
they can relocate a via locally without changing a long-range layer assignment.
The optimizer's secondary risk objective groups split tiny routes by
`simpleRouteConnection.name`, uses the first two distinct physical points as
that connection's region chord, and excludes shared endpoints.

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
