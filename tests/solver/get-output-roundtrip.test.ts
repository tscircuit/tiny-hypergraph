import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

const getRouteSegmentKeysFromSolver = (solver: TinyHyperGraphSolver) => {
  const routeSegmentKeys = Array.from(
    { length: solver.problem.routeCount },
    () => [] as string[],
  )

  solver.state.regionSegments.forEach((regionSegments) => {
    for (const [routeId, port1Id, port2Id] of regionSegments) {
      routeSegmentKeys[routeId]!.push(
        [port1Id, port2Id].sort((a, b) => a - b).join(":"),
      )
    }
  })

  return routeSegmentKeys.map((segmentKeys) => segmentKeys.sort())
}

const getRouteSegmentKeysFromSolution = (
  solution: ReturnType<typeof loadSerializedHyperGraph>["solution"],
) =>
  solution.solvedRoutePathSegments.map((segments) =>
    segments
      .map(([port1Id, port2Id]) =>
        [port1Id, port2Id].sort((a, b) => a - b).join(":"),
      )
      .sort(),
  )

const getRouteRegionIdsFromSolution = (
  solution: ReturnType<typeof loadSerializedHyperGraph>["solution"],
) => solution.solvedRouteRegionIds

test("solver getOutput serializes a solved graph that round-trips through compat loading", () => {
  const serializedHyperGraph = datasetHg07.sample002 as SerializedHyperGraph
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutput()
  const roundTripped = loadSerializedHyperGraph(output)

  expect(output.regions).toHaveLength(topology.regionCount)
  expect(output.ports).toHaveLength(topology.portCount)
  expect(output.connections).toEqual(problem.routeMetadata)
  expect(output.solvedRoutes).toHaveLength(problem.routeCount)

  expect(Array.from(roundTripped.problem.routeStartPort)).toEqual(
    Array.from(problem.routeStartPort),
  )
  expect(Array.from(roundTripped.problem.routeEndPort)).toEqual(
    Array.from(problem.routeEndPort),
  )
  expect(Array.from(roundTripped.problem.routeNet)).toEqual(
    Array.from(problem.routeNet),
  )
  expect(getRouteSegmentKeysFromSolution(roundTripped.solution)).toEqual(
    getRouteSegmentKeysFromSolver(solver),
  )
  expect(getRouteRegionIdsFromSolution(roundTripped.solution)).toEqual(
    solver.getSolution().solvedRouteRegionIds,
  )
})
