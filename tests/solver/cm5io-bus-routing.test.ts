import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

test("CM5IO solves with fixed bus routing", async () => {
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
