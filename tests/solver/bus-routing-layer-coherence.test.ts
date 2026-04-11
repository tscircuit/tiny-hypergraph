import { expect, test } from "bun:test"
import { computeTinyHyperGraphFixedBusRouteSegments } from "lib/bus-routing"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"

const createBusLayerSwitchTopology = (): TinyHyperGraphTopology => ({
  portCount: 12,
  regionCount: 7,
  regionIncidentPorts: [
    [0],
    [1],
    [0, 1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6, 7, 8, 9],
    [6, 7, 8, 9, 10, 11],
    [10],
    [11],
  ],
  incidentPortRegion: [
    [0, 2],
    [1, 2],
    [2, 3],
    [2, 3],
    [2, 3],
    [2, 3],
    [3, 4],
    [3, 4],
    [3, 4],
    [3, 4],
    [4, 5],
    [4, 6],
  ],
  regionWidth: new Float64Array(7).fill(10),
  regionHeight: new Float64Array(7).fill(10),
  regionCenterX: new Float64Array([0, 1, 2, 3, 4, 5, 6]),
  regionCenterY: new Float64Array(7).fill(0),
  portAngleForRegion1: new Int32Array(12),
  portAngleForRegion2: new Int32Array(12),
  portX: new Float64Array([0, 1, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1]),
  portY: new Float64Array([0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3]),
  portZ: new Int32Array([0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 0]),
  regionMetadata: [
    { serializedRegionId: "s0" },
    { serializedRegionId: "s1" },
    { serializedRegionId: "a" },
    { serializedRegionId: "b" },
    { serializedRegionId: "c" },
    { serializedRegionId: "t0" },
    { serializedRegionId: "t1" },
  ],
})

const createBusLayerSwitchProblem = (): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(12).fill(1),
  routeMetadata: [
    {
      connectionId: "route-0",
      startRegionId: "s0",
      endRegionId: "t0",
      _bus: {
        id: "bus-0",
        order: 0,
        orderingVector: { x: 1, y: 0 },
      },
    },
    {
      connectionId: "route-1",
      startRegionId: "s1",
      endRegionId: "t1",
      _bus: {
        id: "bus-0",
        order: 1,
        orderingVector: { x: 1, y: 0 },
      },
    },
  ],
  routeStartPort: new Int32Array([0, 1]),
  routeEndPort: new Int32Array([10, 11]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array(7).fill(-1),
})

const getUsedBoundaryPortIds = (
  topology: TinyHyperGraphTopology,
  routeSegmentsByRegion: Array<[number, number, number][]>,
  region1Id: number,
  region2Id: number,
) => {
  const boundaryPortIds = new Set<number>()

  for (const [routeId, fromPortId, toPortId] of routeSegmentsByRegion[
    region1Id
  ] ?? []) {
    void routeId

    for (const portId of [fromPortId, toPortId]) {
      const incidentRegions = topology.incidentPortRegion[portId] ?? []
      if (
        incidentRegions.includes(region1Id) &&
        incidentRegions.includes(region2Id)
      ) {
        boundaryPortIds.add(portId)
      }
    }
  }

  for (const [routeId, fromPortId, toPortId] of routeSegmentsByRegion[
    region2Id
  ] ?? []) {
    void routeId

    for (const portId of [fromPortId, toPortId]) {
      const incidentRegions = topology.incidentPortRegion[portId] ?? []
      if (
        incidentRegions.includes(region1Id) &&
        incidentRegions.includes(region2Id)
      ) {
        boundaryPortIds.add(portId)
      }
    }
  }

  return [...boundaryPortIds].sort(
    (leftPortId, rightPortId) => leftPortId - rightPortId,
  )
}

const getAppliedRegionSegmentCount = (solver: TinyHyperGraphSolver) =>
  solver.state.regionSegments.reduce(
    (segmentCount, regionSegments) => segmentCount + regionSegments.length,
    0,
  )

test("fixed bus routing keeps traces on one layer per boundary and switches the whole bus together", () => {
  const topology = createBusLayerSwitchTopology()
  const problem = createBusLayerSwitchProblem()
  const fixedBusRouteSegments = computeTinyHyperGraphFixedBusRouteSegments(
    topology,
    problem,
  )

  expect(fixedBusRouteSegments).toBeDefined()

  const routeSegmentsByRegion = fixedBusRouteSegments!.routeSegmentsByRegion
  const firstBoundaryPortIds = getUsedBoundaryPortIds(
    topology,
    routeSegmentsByRegion,
    2,
    3,
  )
  const secondBoundaryPortIds = getUsedBoundaryPortIds(
    topology,
    routeSegmentsByRegion,
    3,
    4,
  )

  expect(firstBoundaryPortIds).toHaveLength(2)
  expect(secondBoundaryPortIds).toHaveLength(2)
  expect([
    ...new Set(firstBoundaryPortIds.map((portId) => topology.portZ[portId])),
  ]).toEqual([0])
  expect([
    ...new Set(secondBoundaryPortIds.map((portId) => topology.portZ[portId])),
  ]).toEqual([1])
})

test("fixed bus routing applies one segment operation per solver iteration", () => {
  const topology = createBusLayerSwitchTopology()
  const problem = createBusLayerSwitchProblem()
  const fixedBusRouteSegments = computeTinyHyperGraphFixedBusRouteSegments(
    topology,
    problem,
  )

  expect(fixedBusRouteSegments).toBeDefined()

  const totalOperationCount =
    fixedBusRouteSegments!.orderedRouteSegmentOperations.length
  expect(totalOperationCount).toBeGreaterThan(0)

  const solver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: totalOperationCount + 5,
  })
  solver.setup()

  expect(getAppliedRegionSegmentCount(solver)).toBe(0)
  expect(solver.getPendingFixedBusOperationCount()).toBe(totalOperationCount)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)

  for (
    let appliedOperationCount = 1;
    appliedOperationCount <= totalOperationCount;
    appliedOperationCount++
  ) {
    solver.step()

    expect(getAppliedRegionSegmentCount(solver)).toBe(appliedOperationCount)
    expect(solver.getPendingFixedBusOperationCount()).toBe(
      totalOperationCount - appliedOperationCount,
    )
    expect(solver.state.currentRouteId).toBeUndefined()
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(false)
  }

  solver.step()

  expect(getAppliedRegionSegmentCount(solver)).toBe(totalOperationCount)
  expect(solver.getPendingFixedBusOperationCount()).toBe(0)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
