import { expect, test } from "bun:test"
import {
  getMaxFlowUnroutableRoutes,
  getRouteMaxFlow,
  type TinyHyperGraphProblem,
  type TinyHyperGraphProblemSetup,
  type TinyHyperGraphTopology,
} from "lib/index"
import type { RegionIntersectionCache } from "lib/types"

const createProblemSetup = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): TinyHyperGraphProblemSetup => {
  const portEndpointNetIds = Array.from(
    { length: topology.portCount },
    () => new Set<number>(),
  )

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    portEndpointNetIds[problem.routeStartPort[routeId]]!.add(
      problem.routeNet[routeId]!,
    )
    portEndpointNetIds[problem.routeEndPort[routeId]]!.add(
      problem.routeNet[routeId]!,
    )
  }

  return {
    portEndpointNetIds,
    portHCostToEndOfRoute: new Float64Array(
      topology.portCount * problem.routeCount,
    ),
  }
}

const createLineContext = (
  regionNetId = new Int32Array([-1, -1, -1, -1, -1]),
  portAssignment = new Int32Array(4).fill(-1),
) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 5,
    regionIncidentPorts: [[0, 1], [1, 2], [2, 3], [0], [3]],
    incidentPortRegion: [
      [0, 3],
      [0, 1],
      [1, 2],
      [2, 4],
    ],
    regionWidth: new Float64Array(5).fill(1),
    regionHeight: new Float64Array(5).fill(1),
    regionCenterX: new Float64Array(5).fill(0),
    regionCenterY: new Float64Array(5).fill(0),
    portAngleForRegion1: new Int32Array(4),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([0, 1, 2, 3]),
    portY: new Float64Array(4),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(4).fill(1),
    routeMetadata: [{ connectionId: "line-route" }],
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId,
  }

  return {
    topology,
    problem,
    problemSetup: createProblemSetup(topology, problem),
    portAssignment,
    routeIds: [0],
    getStartingNextRegionId: () => 0,
    getRouteSummary: () => ({
      routeId: 0,
      connectionId: "line-route",
      startPortId: 0,
      endPortId: 3,
      pointIds: [],
    }),
  }
}

test("max-flow impossibility check reports blocked reserved-region routes", () => {
  const context = createLineContext(new Int32Array([-1, 1, -1, -1, -1]))

  const unroutableRoutes = getMaxFlowUnroutableRoutes(context)

  expect(unroutableRoutes).toHaveLength(1)
  expect(unroutableRoutes[0]!.connectionId).toBe("line-route")
  expect(unroutableRoutes[0]!.maxFlow).toBe(0)
})

test("max-flow check allows same-net assigned ports and blocks different-net assigned ports", () => {
  expect(
    getRouteMaxFlow(
      createLineContext(undefined, new Int32Array([-1, 0, 0, -1])),
      0,
    ),
  ).toBe(1)
  expect(
    getRouteMaxFlow(
      createLineContext(undefined, new Int32Array([-1, 1, -1, -1])),
      0,
    ),
  ).toBe(0)
})

test("max-flow check treats same-layer intersections in single-layer regions as hard blocks", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3]],
    incidentPortRegion: [[0], [0], [0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([1]),
    portAngleForRegion1: new Int32Array([1000, 0, 3000, 2000]),
    portX: new Float64Array([0, 1, 2, 3]),
    portY: new Float64Array(4),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 0, 1, 0]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([2]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1]),
  }
  const regionIntersectionCaches: RegionIntersectionCache[] = [
    {
      netIds: new Int32Array([1]),
      lesserAngles: new Int32Array([0]),
      greaterAngles: new Int32Array([2000]),
      layerMasks: new Int32Array([1]),
      existingCrossingLayerIntersections: 0,
      existingSameLayerIntersections: 0,
      existingEntryExitLayerChanges: 0,
      existingRegionCost: 0,
      existingSegmentCount: 1,
    },
  ]

  const maxFlow = getRouteMaxFlow(
    {
      topology,
      problem,
      problemSetup: createProblemSetup(topology, problem),
      portAssignment: new Int32Array(4).fill(-1),
      routeIds: [0],
      regionIntersectionCaches,
      getStartingNextRegionId: () => 0,
      getRouteSummary: () => ({
        routeId: 0,
        connectionId: "blocked-intersection",
        startPortId: 0,
        endPortId: 2,
        pointIds: [],
      }),
    },
    0,
  )

  expect(maxFlow).toBe(0)
})
