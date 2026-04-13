import { expect, test } from "bun:test"
import {
  BusCorridorHypergraphSolver,
  filterPortPointPathingSolverInputByConnectionPatches,
  type ConnectionPatchSelection,
} from "lib/index"
import {
  convertPortPointPathingSolverInputToSerializedHyperGraph,
  type SerializedHyperGraphPortPointPathingSolverInput,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/index"

const createOrderingTopology = (): TinyHyperGraphTopology => ({
  portCount: 10,
  regionCount: 2,
  regionIncidentPorts: [
    Array.from({ length: 10 }, (_, index) => index),
    Array.from({ length: 10 }, (_, index) => index),
  ],
  incidentPortRegion: Array.from({ length: 10 }, () => [0, 1]),
  regionWidth: new Float64Array([10, 10]),
  regionHeight: new Float64Array([10, 10]),
  regionCenterX: new Float64Array([0, 10]),
  regionCenterY: new Float64Array([0, 0]),
  portAngleForRegion1: new Int32Array(10),
  portAngleForRegion2: new Int32Array(10),
  portX: new Float64Array(10),
  portY: new Float64Array(10),
  portZ: new Int32Array(10),
})

const createOrderingProblem = (): TinyHyperGraphProblem => ({
  routeCount: 5,
  portSectionMask: new Int8Array(10).fill(1),
  routeMetadata: [
    {
      connectionId: "route-0",
      simpleRouteConnection: {
        pointsToConnect: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
        ],
      },
    },
    {
      connectionId: "route-1",
      simpleRouteConnection: {
        pointsToConnect: [
          { x: 1, y: 0 },
          { x: 30, y: 0 },
        ],
      },
    },
    {
      connectionId: "route-2",
      simpleRouteConnection: {
        pointsToConnect: [
          { x: 2, y: 0 },
          { x: 20, y: 0 },
        ],
      },
    },
    {
      connectionId: "route-3",
      simpleRouteConnection: {
        pointsToConnect: [
          { x: 3, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    },
    {
      connectionId: "route-4",
      simpleRouteConnection: {
        pointsToConnect: [
          { x: 4, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    },
  ],
  routeStartPort: new Int32Array([0, 1, 2, 3, 4]),
  routeEndPort: new Int32Array([5, 6, 7, 8, 9]),
  routeNet: new Int32Array([0, 1, 2, 3, 4]),
  regionNetId: new Int32Array(2).fill(-1),
})

const createSharedStartTopology = (): TinyHyperGraphTopology => ({
  portCount: 3,
  regionCount: 2,
  regionIncidentPorts: [
    [0, 1, 2],
    [0, 1, 2],
  ],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [0, 1],
  ],
  regionWidth: new Float64Array([4, 4]),
  regionHeight: new Float64Array([4, 4]),
  regionCenterX: new Float64Array([0, 4]),
  regionCenterY: new Float64Array([0, 0]),
  portAngleForRegion1: new Int32Array(3),
  portAngleForRegion2: new Int32Array(3),
  portX: new Float64Array([0, 1, 2]),
  portY: new Float64Array([0, 0, 0]),
  portZ: new Int32Array(3),
})

const createSharedStartProblem = (): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(3).fill(1),
  routeMetadata: [
    {
      connectionId: "route-0",
      _bus: { order: 0 },
    },
    {
      connectionId: "route-1",
      _bus: { order: 1 },
    },
  ],
  routeStartPort: new Int32Array([0, 0]),
  routeEndPort: new Int32Array([1, 2]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array(2).fill(-1),
})

const createSharedPortPointAcrossLayersTopology = (): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 2,
  regionIncidentPorts: [
    [0, 1, 2, 3],
    [0, 1, 2, 3],
  ],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [0, 1],
    [0, 1],
  ],
  regionWidth: new Float64Array([4, 4]),
  regionHeight: new Float64Array([4, 4]),
  regionCenterX: new Float64Array([0, 4]),
  regionCenterY: new Float64Array([0, 0]),
  portAngleForRegion1: new Int32Array(4),
  portAngleForRegion2: new Int32Array(4),
  portX: new Float64Array([0, 0, 1, 2]),
  portY: new Float64Array([0, 0, 0, 0]),
  portZ: new Int32Array([0, 1, 0, 0]),
})

const createSharedPortPointAcrossLayersProblem = (): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(4).fill(1),
  routeMetadata: [
    {
      connectionId: "route-0",
      _bus: { order: 0 },
    },
    {
      connectionId: "route-1",
      _bus: { order: 1 },
    },
  ],
  routeStartPort: new Int32Array([0, 1]),
  routeEndPort: new Int32Array([2, 3]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array(2).fill(-1),
})

const createLayerPenaltyTopology = (): TinyHyperGraphTopology => ({
  portCount: 3,
  regionCount: 2,
  regionIncidentPorts: [
    [0, 1, 2],
    [0, 1, 2],
  ],
  incidentPortRegion: [
    [0, 1],
    [0, 1],
    [0, 1],
  ],
  regionWidth: new Float64Array([4, 4]),
  regionHeight: new Float64Array([4, 4]),
  regionCenterX: new Float64Array([0, 4]),
  regionCenterY: new Float64Array([0, 0]),
  portAngleForRegion1: new Int32Array(3),
  portAngleForRegion2: new Int32Array(3),
  portX: new Float64Array([0, 1, 1]),
  portY: new Float64Array([0, 0, 0]),
  portZ: new Int32Array([0, 0, 1]),
})

const createLayerPenaltyProblem = (): TinyHyperGraphProblem => ({
  routeCount: 2,
  portSectionMask: new Int8Array(3).fill(1),
  routeMetadata: [
    {
      connectionId: "centerline",
      _bus: { order: 0 },
    },
    {
      connectionId: "outer",
      _bus: { order: 1 },
    },
  ],
  routeStartPort: new Int32Array([0, 0]),
  routeEndPort: new Int32Array([1, 2]),
  routeNet: new Int32Array([0, 1]),
  regionNetId: new Int32Array(2).fill(-1),
})

const hasCandidatePathThroughAssignedPortPoint = (
  solver: BusCorridorHypergraphSolver,
) => {
  const assignedPointKeys = new Set(
    Array.from({ length: solver.topology.portCount }, (_, portId) => portId)
      .filter((portId) => solver.state.portAssignment[portId] !== -1)
      .map((portId) => solver.portPointKeyByPortId[portId]),
  )

  return solver.state.candidateQueue.toArray().some((candidate) => {
    let cursor: typeof candidate | undefined = candidate

    while (cursor) {
      if (assignedPointKeys.has(solver.portPointKeyByPortId[cursor.portId])) {
        return true
      }

      cursor = cursor.prevCandidate
    }

    return false
  })
}

const createCm5ioBus1SerializedHyperGraph = async () => {
  const fullInput = (await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()) as SerializedHyperGraphPortPointPathingSolverInput
  const busSelection = (await Bun.file(
    new URL("../fixtures/CM5IO_bus1.json", import.meta.url),
  ).json()) as ConnectionPatchSelection

  return convertPortPointPathingSolverInputToSerializedHyperGraph(
    filterPortPointPathingSolverInputByConnectionPatches(
      fullInput,
      busSelection,
    ),
  )
}

test("BusCorridorHypergraphSolver infers mirrored bus order and solves center-out", () => {
  const solver = new BusCorridorHypergraphSolver(
    createOrderingTopology(),
    createOrderingProblem(),
  )

  expect(solver.routeIdsInBusOrder).toEqual([0, 1, 2, 3, 4])
  expect(solver.routeIdsInSolveOrder).toEqual([2, 1, 3, 0, 4])
  expect(Array.from(solver.routeDistanceFromCenterByRouteId)).toEqual([
    2,
    1,
    0,
    1,
    2,
  ])
})

test("BusCorridorHypergraphSolver rejects routes that reuse an assigned start port", () => {
  const solver = new BusCorridorHypergraphSolver(
    createSharedStartTopology(),
    createSharedStartProblem(),
  )

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("cannot reuse assigned start port")
  expect(Array.from(solver.state.portAssignment)).toEqual([0, 0, -1])
})

test("BusCorridorHypergraphSolver rejects routes that reuse an assigned port point across layers", () => {
  const solver = new BusCorridorHypergraphSolver(
    createSharedPortPointAcrossLayersTopology(),
    createSharedPortPointAcrossLayersProblem(),
  )

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("cannot reuse assigned start port point")
  expect(solver.error).toContain("occupied by")
  expect(Array.from(solver.state.portAssignment)).toEqual([0, -1, 0, -1])
})

test("BusCorridorHypergraphSolver heavily penalizes moving off the centerline layer", () => {
  const solver = new BusCorridorHypergraphSolver(
    createLayerPenaltyTopology(),
    createLayerPenaltyProblem(),
    {
      CENTERLINE_LAYER_DIFFERENCE_COST: 7,
    },
  )

  solver.centerlineLayer = 0

  expect(solver.getCenterlineLayerPenalty(1, 1)).toBe(0)
  expect(solver.getCenterlineLayerPenalty(1, 2)).toBe(7)
  expect(solver.getCenterlineLayerPenalty(0, 2)).toBe(0)
})

test("BusCorridorHypergraphSolver does not explore candidate paths through assigned CM5IO port points", async () => {
  const serializedHyperGraph = await createCm5ioBus1SerializedHyperGraph()
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new BusCorridorHypergraphSolver(topology, problem, {
    MAX_ITERATIONS: 2_000_000,
  })

  solver._setup()

  for (let iteration = 0; iteration < 5_000; iteration++) {
    solver._step()
    solver.iterations += 1

    const hasAssignedPort = Array.from(solver.state.portAssignment).some(
      (assignment) => assignment !== -1,
    )
    const isRoutingNonCenterlineRoute =
      solver.state.currentRouteId !== undefined &&
      solver.state.currentRouteId !== solver.centerRouteId
    const hasCandidates = solver.state.candidateQueue.toArray().length > 0

    if (hasAssignedPort && isRoutingNonCenterlineRoute && hasCandidates) {
      break
    }

    if (solver.solved || solver.failed) {
      break
    }
  }

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.centerlineLayer).toBeDefined()
  expect(solver.state.currentRouteId).not.toBeUndefined()
  expect(solver.state.currentRouteId).not.toBe(solver.centerRouteId)
  expect(hasCandidatePathThroughAssignedPortPoint(solver)).toBe(false)
})

test("BusCorridorHypergraphSolver keeps the iteration-11 best candidate close to the CM5IO centerline", async () => {
  const serializedHyperGraph = await createCm5ioBus1SerializedHyperGraph()
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new BusCorridorHypergraphSolver(topology, problem, {
    MAX_ITERATIONS: 2_000_000,
  })

  solver._setup()

  for (let iteration = 0; iteration < 11; iteration++) {
    solver._step()
    solver.iterations += 1
  }

  const bestCandidate = solver.state.candidateQueue
    .toArray()
    .sort((left, right) => left.f - right.f)[0]

  expect(solver.state.currentRouteId).not.toBeUndefined()
  expect(solver.state.currentRouteId).not.toBe(solver.centerRouteId)
  expect(solver.centerlineSegments.length).toBeGreaterThan(0)
  expect(bestCandidate).toBeDefined()
  expect(
    solver.getDistanceFromCenterline(bestCandidate!.portId),
  ).toBeLessThan(1)
})

test("BusCorridorHypergraphSolver solves the CM5IO bus1 subset", async () => {
  const serializedHyperGraph = await createCm5ioBus1SerializedHyperGraph()
  const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
  const solver = new BusCorridorHypergraphSolver(topology, problem, {
    MAX_ITERATIONS: 2_000_000,
  })

  solver.solve()

  expect(solver.routeIdsInSolveOrder.map((routeId) => routeId)).toEqual([
    4,
    3,
    5,
    2,
    6,
    1,
    7,
    0,
    8,
  ])
  expect(
    solver.routeIdsInSolveOrder.map(
      (routeId) => problem.routeMetadata?.[routeId]?.connectionId,
    ),
  ).toEqual([
    "source_trace_108",
    "source_trace_109",
    "source_trace_107",
    "source_trace_110",
    "source_trace_106",
    "source_trace_111",
    "source_trace_105",
    "source_trace_114",
    "source_trace_104",
  ])
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
