import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib2/graph-load"
import { TinyHyperGraphSolver } from "lib/index"
import { ParseGraphError, TinyHyperGraphSolver2, solveGraph } from "lib2/index"

const getMaxRegionCost = (
  solver: TinyHyperGraphSolver | TinyHyperGraphSolver2,
) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

test("lib2 solveGraph returns a typed parse error for invalid input", () => {
  const result = solveGraph({ regions: [] })

  expect(result._tag).toBe("err")
  if (result._tag === "err") {
    expect(result.error).toBeInstanceOf(ParseGraphError)
    expect(result.error.message).toBe(
      "Invalid serialized graph: expected ports array",
    )
  }
})

test("lib2 solveGraph solves and serializes hg07 sample002", () => {
  const serializedGraph = datasetHg07.sample002 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedGraph)
  const result = solveGraph(serializedGraph)

  expect(result._tag).toBe("ok")
  if (result._tag === "ok") {
    expect(result.value.solver.solved).toBe(true)
    expect(result.value.solver.failed).toBe(false)
    expect(result.value.graph.regions).toHaveLength(topology.regionCount)
    expect(result.value.graph.ports).toHaveLength(topology.portCount)
    expect(result.value.graph.solvedRoutes).toHaveLength(problem.routeCount)
  }
})

test("lib2 solver facade matches core solver on hg07 sample002", () => {
  const serializedGraph = datasetHg07.sample002 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedGraph)
  const coreSolver = new TinyHyperGraphSolver(topology, problem)
  const lib2Solver = new TinyHyperGraphSolver2(topology, problem)

  coreSolver.solve()
  const lib2Result = lib2Solver.solveResult()

  expect(coreSolver.solved).toBe(true)
  expect(coreSolver.failed).toBe(false)
  expect(lib2Result._tag).toBe("ok")
  expect(lib2Solver.solved).toBe(true)
  expect(lib2Solver.failed).toBe(false)
  expect(getMaxRegionCost(lib2Solver)).toBeCloseTo(
    getMaxRegionCost(coreSolver),
    10,
  )
})
