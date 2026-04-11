import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

// Kept as a copied regression case from `buses`; it requires the bus-routing
// implementation that has intentionally not been ported onto this branch.
test.skip("CM5IO solves with fixed bus routing", async () => {
  const input = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const serializedHyperGraph =
    convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 50_000,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
