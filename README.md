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
