import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

const createEndpointTopology = (): TinyHyperGraphTopology => ({
  portCount: 4,
  regionCount: 6,
  regionIncidentPorts: [[0], [1], [1, 2, 3], [2], [3], [0]],
  incidentPortRegion: [
    [0, 5],
    [1, 2],
    [2, 3],
    [2, 4],
  ],
  regionWidth: new Float64Array(6).fill(100),
  regionHeight: new Float64Array(6).fill(100),
  regionCenterX: new Float64Array([0, 0, 50, 100, 1, 0]),
  regionCenterY: new Float64Array([10, 0, 0, 10, 0, 10]),
  regionAvailableZMask: new Int32Array([2, 1, 3, 2, 1, 2]),
  regionMetadata: [
    { serializedRegionId: "start-z1", availableZ: [1] },
    { serializedRegionId: "start-z0", availableZ: [0] },
    { serializedRegionId: "routing", availableZ: [0, 1] },
    { serializedRegionId: "end-z1", availableZ: [1] },
    { serializedRegionId: "end-z0", availableZ: [0] },
    { serializedRegionId: "dead-z1", availableZ: [1] },
  ],
  portAngleForRegion1: new Int32Array([0, 0, 18000, 18000]),
  portAngleForRegion2: new Int32Array([18000, 18000, 0, 0]),
  portX: new Float64Array([0, 0, 100, 1]),
  portY: new Float64Array([10, 0, 10, 0]),
  portZ: new Int32Array([1, 0, 1, 0]),
  portMetadata: [
    { serializedPortId: "start-z1-port", z: 1 },
    { serializedPortId: "start-z0-port", z: 0 },
    { serializedPortId: "end-z1-port", z: 1 },
    { serializedPortId: "end-z0-port", z: 0 },
  ],
})

const createEndpointProblem = (
  includeOptions: boolean,
): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array(4).fill(1),
  routeMetadata: [
    {
      connectionId: "endpoint-choice",
      startRegionId: "start-z0",
      endRegionId: "end-z0",
    },
  ],
  routeStartPort: new Int32Array([0]),
  routeEndPort: new Int32Array([2]),
  routeStartPortOptions: includeOptions ? [[0, 1]] : undefined,
  routeEndPortOptions: includeOptions ? [[2, 3]] : undefined,
  routeNet: new Int32Array([0]),
  regionNetId: new Int32Array([0, 0, -1, 0, 0, -1]),
})

test("uses reachable endpoint options and serializes the selected zero-via layer", () => {
  const topology = createEndpointTopology()
  const canonicalOnlySolver = new TinyHyperGraphSolver(
    topology,
    createEndpointProblem(false),
  )

  canonicalOnlySolver.setup()
  expect(canonicalOnlySolver.failed).toBe(true)

  const solver = new TinyHyperGraphSolver(
    topology,
    createEndpointProblem(true),
    { RIP_THRESHOLD_RAMP_ATTEMPTS: 0 },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.state.solvedRouteStartPort[0]).toBe(1)
  expect(solver.state.solvedRouteEndPort[0]).toBe(3)
  expect(
    solver.state.regionIntersectionCaches.reduce(
      (total, regionCache) =>
        total + regionCache.existingEntryExitLayerChanges,
      0,
    ),
  ).toBe(0)

  const serialized = solver.getOutput()
  expect(serialized.solvedRoutes?.[0]?.path.map(({ portId }) => portId)).toEqual(
    ["start-z0-port", "end-z0-port"],
  )

  const reloaded = loadSerializedHyperGraph(serialized)
  expect(reloaded.solution.solvedRouteStartPort?.[0]).toBe(
    reloaded.problem.routeStartPort[0],
  )
  expect(reloaded.solution.solvedRouteEndPort?.[0]).toBe(
    reloaded.problem.routeEndPort[0],
  )
  expect(reloaded.topology.portZ[reloaded.problem.routeStartPort[0]!]).toBe(0)
  expect(reloaded.topology.portZ[reloaded.problem.routeEndPort[0]!]).toBe(0)
})
