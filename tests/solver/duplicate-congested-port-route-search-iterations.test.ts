import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { DuplicateCongestedPortSolver } from "lib/index"

test("duplicate congested port solver reports each connection's solo search iterations", async () => {
  const input = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const graph = convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const solver = new DuplicateCongestedPortSolver(graph)
  solver.solve()
  expect(solver.solved).toBe(true)

  const iterations = solver.report.routeSearchIterations
  expect(Object.keys(iterations).sort()).toEqual(
    graph.connections!.map((c) => c.connectionId).sort(),
  )
  expect(Object.values(iterations).every((n) => n >= 1)).toBe(true)
})
