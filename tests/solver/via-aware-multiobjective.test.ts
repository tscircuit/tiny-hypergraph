import { expect, test } from "bun:test"
import {
  computeEstimatedViaCount,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

const createBranchingTopology = (): TinyHyperGraphTopology => ({
  portCount: 6,
  regionCount: 6,
  regionIncidentPorts: [[0], [0, 1, 3], [1, 2], [3, 4], [2, 4, 5], [5]],
  incidentPortRegion: [
    [0, 1],
    [1, 2],
    [2, 4],
    [1, 3],
    [3, 4],
    [4, 5],
  ],
  regionWidth: new Float64Array(6).fill(100),
  regionHeight: new Float64Array(6).fill(100),
  regionCenterX: new Float64Array(6),
  regionCenterY: new Float64Array(6),
  regionAvailableZMask: new Int32Array([1, 3, 2, 1, 3, 1]),
  portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000, 9000, 18000]),
  portAngleForRegion2: new Int32Array([18000, 27000, 0, 9000, 27000, 0]),
  portX: new Float64Array([0, 1, 2, 1, 2, 3]),
  portY: new Float64Array([0, 0, 0, 0, 0.1, 0]),
  portZ: new Int32Array([0, 1, 1, 0, 0, 0]),
})

test("prefers a modestly longer route when it requires fewer estimated vias", () => {
  const topology = createBranchingTopology()
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(topology.portCount).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([5]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([0, -1, -1, -1, -1, 0]),
    portPenalty: new Float64Array(topology.portCount),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedPortIds = solver.state.regionSegments
    .flat()
    .flatMap(([, fromPortId, toPortId]) => [fromPortId, toPortId])
  expect(routedPortIds).toContain(3)
  expect(routedPortIds).toContain(4)
  expect(routedPortIds).not.toContain(1)
  expect(routedPortIds).not.toContain(2)

  const estimatedViaCount = solver.state.regionIntersectionCaches.reduce(
    (total, regionCache) =>
      total +
      computeEstimatedViaCount(
        regionCache.existingSameLayerIntersections,
        regionCache.existingCrossingLayerIntersections,
        regionCache.existingEntryExitLayerChanges,
      ),
    0,
  )
  expect(estimatedViaCount).toBe(0)
})
