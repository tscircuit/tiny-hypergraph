import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import * as datasetHg07 from "dataset-hg07"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver, TinyHyperGraphSolver } from "lib/index"
import { ambiguousRouteOutputFixture } from "tests/fixtures/ambiguous-route-output.fixture"

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

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

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

  const replayedSolver = new TinyHyperGraphSectionSolver(
    roundTripped.topology,
    roundTripped.problem,
    roundTripped.solution,
  )

  expect(getMaxRegionCost(replayedSolver.baselineSolver)).toBeCloseTo(
    getMaxRegionCost(solver),
    10,
  )
})

test("serialized solved route replay preserves explicit traversed region ids", () => {
  const { topology, problem, solution } = loadSerializedHyperGraph(
    ambiguousRouteOutputFixture,
  )
  const replayedSolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  expect(solution.solvedRoutePathRegionIds?.[0]).toEqual([1, 2, 2])
  expect(
    replayedSolver.baselineSolver.state.regionSegments[1]?.map(
      ([routeId, fromPortId, toPortId]) => [routeId, fromPortId, toPortId],
    ),
  ).toEqual([[0, 0, 1]])
  expect(
    replayedSolver.baselineSolver.state.regionSegments[2]?.map(
      ([routeId, fromPortId, toPortId]) => [routeId, fromPortId, toPortId],
    ),
  ).toEqual([
    [0, 1, 2],
    [0, 2, 3],
  ])
})
