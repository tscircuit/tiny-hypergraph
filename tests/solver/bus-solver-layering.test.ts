import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "lib/index"
import { TinyHyperGraphBusSolver } from "lib/index"

const createBusLayeringTopology = (): TinyHyperGraphTopology => ({
  portCount: 9,
  regionCount: 1,
  regionIncidentPorts: [[0, 1, 2, 3, 4, 5, 6, 7, 8]],
  incidentPortRegion: Array.from({ length: 9 }, () => [0, 0]),
  regionWidth: new Float64Array([10]),
  regionHeight: new Float64Array([10]),
  regionCenterX: new Float64Array([2]),
  regionCenterY: new Float64Array([0]),
  portAngleForRegion1: new Int32Array(9),
  portAngleForRegion2: new Int32Array(9),
  portX: new Float64Array([0, 0, 0, 4, 4, 4, 1, 2, 2]),
  portY: new Float64Array([-1, 0, 1, -1, 0, 1, -1, -1, -1]),
  portZ: new Int32Array([0, 0, 0, 0, 0, 0, 0, 1, 0]),
})

const createBusLayeringProblem = (): TinyHyperGraphProblem => ({
  routeCount: 3,
  portSectionMask: new Int8Array(9).fill(1),
  routeMetadata: [
    { connectionId: "outer-low" },
    { connectionId: "center" },
    { connectionId: "outer-high" },
  ],
  routeStartPort: new Int32Array([0, 1, 2]),
  routeEndPort: new Int32Array([3, 4, 5]),
  routeNet: new Int32Array([0, 1, 2]),
  regionNetId: new Int32Array([-1]),
})

const createTestSolver = () =>
  new TinyHyperGraphBusSolver(
    createBusLayeringTopology(),
    createBusLayeringProblem(),
  )

test("outer bus traces cannot introduce layer changes when the centerline stays on one layer", () => {
  const solver = createTestSolver()
  const solverInternal = solver as any

  solverInternal.busState.centerlinePortIds = [1, 4]
  solverInternal.busState.centerlineHasLayerChanges = false

  const outerTraceIndex = solver.busTraceOrder.traces.findIndex(
    (trace) => trace.connectionId === "outer-low",
  )

  expect(
    solverInternal.isMoveBlockedByBusConstraints(outerTraceIndex, {
      nextState: {
        routeId: 0,
        portId: 7,
        nextRegionId: 0,
        atGoal: false,
        prevState: {
          routeId: 0,
          portId: 6,
          nextRegionId: 0,
          atGoal: false,
        },
      },
      segmentLength: 1,
    }),
  ).toBe(true)

  expect(
    solverInternal.isMoveBlockedByBusConstraints(outerTraceIndex, {
      nextState: {
        routeId: 0,
        portId: 8,
        nextRegionId: 0,
        atGoal: false,
        prevState: {
          routeId: 0,
          portId: 6,
          nextRegionId: 0,
          atGoal: false,
        },
      },
      segmentLength: 1,
    }),
  ).toBe(false)
})

test("bus alignment cost treats layer mismatch as a very large distance", () => {
  const solver = createTestSolver()
  const solverInternal = solver as any

  const outerTraceIndex = solver.busTraceOrder.traces.findIndex(
    (trace) => trace.connectionId === "outer-low",
  )

  const sameLayerCost = solverInternal.computeTraceAlignmentCost(
    outerTraceIndex,
    [1, 4],
    8,
  )
  const crossLayerCost = solverInternal.computeTraceAlignmentCost(
    outerTraceIndex,
    [1, 4],
    7,
  )

  expect(crossLayerCost).toBeGreaterThan(sameLayerCost + 50)
})
