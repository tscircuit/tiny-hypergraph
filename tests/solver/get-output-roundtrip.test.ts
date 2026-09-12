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

  for (const regionSegments of solver.state.regionSegments) {
    for (const [routeId, port1Id, port2Id] of regionSegments) {
      routeSegmentKeys[routeId]!.push(
        [port1Id, port2Id].sort((a, b) => a - b).join(":"),
      )
    }
  }

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

test("solver getOutput serializes a route whose endpoints share one port", () => {
  const topology = {
    portCount: 1,
    regionCount: 2,
    regionIncidentPorts: [[0], [0]],
    incidentPortRegion: [[0, 1]],
    regionWidth: new Float64Array([1, 1]),
    regionHeight: new Float64Array([1, 1]),
    regionCenterX: new Float64Array([0, 1]),
    regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([1, 1]),
    regionMetadata: [
      { serializedRegionId: "region-start-end" },
      { serializedRegionId: "region-other" },
    ],
    portAngleForRegion1: new Int32Array([0]),
    portAngleForRegion2: new Int32Array([18000]),
    portX: new Float64Array([0.5]),
    portY: new Float64Array([0]),
    portZ: new Int32Array([0]),
    portMetadata: [{ serializedPortId: "shared-port" }],
  }
  const connection = {
    connectionId: "preloaded-section",
    startRegionId: "region-start-end",
    endRegionId: "region-start-end",
    mutuallyConnectedNetworkId: "net-0",
  }
  const problem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1]),
    routeMetadata: [connection],
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([0]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput().solvedRoutes).toEqual([
    {
      connection,
      path: [
        {
          portId: "shared-port",
          g: 0,
          h: 0,
          f: 0,
          hops: 0,
          ripRequired: false,
          nextRegionId: "region-start-end",
        },
      ],
      requiredRip: false,
    },
  ])
})

test("solver getOutput preserves a closed assigned route through section replay", () => {
  const topology = {
    portCount: 3,
    regionCount: 4,
    regionIncidentPorts: [[0, 1, 2], [0], [1], [2]],
    incidentPortRegion: [
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    regionWidth: new Float64Array([2, 1, 1, 1]),
    regionHeight: new Float64Array([2, 1, 1, 1]),
    regionCenterX: new Float64Array([0, -1, 1, 0]),
    regionCenterY: new Float64Array([0, 0, 0, 1]),
    regionAvailableZMask: new Int32Array([1, 1, 1, 1]),
    regionMetadata: [
      { serializedRegionId: "route-region" },
      { serializedRegionId: "endpoint-region" },
      { serializedRegionId: "outside-1" },
      { serializedRegionId: "outside-2" },
    ],
    portAngleForRegion1: new Int32Array([0, 12000, 24000]),
    portAngleForRegion2: new Int32Array([18000, 30000, 6000]),
    portX: new Float64Array([-1, 1, 0]),
    portY: new Float64Array([0, 0, 1]),
    portZ: new Int32Array([0, 0, 0]),
    portMetadata: [
      { serializedPortId: "shared-endpoint" },
      { serializedPortId: "cycle-1" },
      { serializedPortId: "cycle-2" },
    ],
  }
  const connection = {
    connectionId: "preloaded-closed-section",
    startRegionId: "endpoint-region",
    endRegionId: "endpoint-region",
    mutuallyConnectedNetworkId: "net-0",
  }
  const problem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1, 1]),
    routeMetadata: [connection],
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([0]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1, -1, -1]),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 0, regionId: 0, fromPortId: 1, toPortId: 2 },
      { routeId: 0, regionId: 0, fromPortId: 2, toPortId: 0 },
    ],
  }
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutput()
  expect(output.solvedRoutes?.[0]?.path.map(({ portId }) => portId)).toEqual([
    "shared-endpoint",
    "cycle-1",
    "cycle-2",
    "shared-endpoint",
  ])

  const replay = loadSerializedHyperGraph(output)
  const sectionSolver = new TinyHyperGraphSectionSolver(
    replay.topology,
    replay.problem,
    replay.solution,
  )

  expect(
    getRouteSegmentKeysFromSolver(sectionSolver.baselineSolver)[0],
  ).toEqual(["0:1", "0:2", "1:2"])
})
