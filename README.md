# tiny-hypergraph

Tiny hypergraph implementation.

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

### Export a solved solver back to `SerializedHyperGraph`

`solver.getOutput()` now returns a `SerializedHyperGraph` for a solved
`TinyHyperGraphSolver`.

Under the hood it uses
`lib/compat/convertToSerializedHyperGraph.ts`, which reconstructs:

- `regions`
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

### Run section optimization as a pipeline

Section optimization is intended to run as a second stage on the same
`topology` and `problem`, reusing the in-memory graph instead of converting
through `SerializedHyperGraph` between stages.

```ts
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionOptimizationPipelineSolver } from "lib/section-optimization-pipeline"

const { topology, problem } = loadSerializedHyperGraph(inputGraph)

const pipeline = new TinyHyperGraphSectionOptimizationPipelineSolver({
  topology,
  problem,
})

pipeline.solve()

const optimizedState = pipeline.getOutput()
```

If you already have an in-memory `solution`, you can still call
`TinyHyperGraphSectionSolver` directly with `{ topology, problem, solution }`.
If you want deterministic seeded route shuffling, set `problem.shuffleSeed`.
