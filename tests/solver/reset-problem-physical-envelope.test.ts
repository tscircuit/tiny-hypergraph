import { expect, test } from "bun:test"
import {
  createEmptyRegionIntersectionCache,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"

test("a reused physical-via workspace selects paths within its new problem's pressure envelope", (): void => {
  const topology: TinyHyperGraphTopology = {
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
    regionWidth: Float64Array.of(10, 1),
    regionHeight: Float64Array.of(10, 1),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 3),
    portAngleForRegion1: Int32Array.of(18000, 9000, 27000, 0),
    portAngleForRegion2: Int32Array.of(18000, 9000, 27000, 0),
    portX: Float64Array.of(-0.5, 0, 0, 0.5),
    portY: Float64Array.of(0, 0.5, -0.5, 0),
    portZ: Int32Array.of(0, 1, 0, 0),
  }
  const firstProblem: TinyHyperGraphProblem = {
    routeCount: 0,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array(0),
    routeEndPort: new Int32Array(0),
    routeNet: new Int32Array(0),
    regionNetId: new Int32Array(2).fill(-1),
  }
  const nextProblem: TinyHyperGraphProblem = {
    ...firstProblem,
    routeCount: 1,
    routeStartPort: Int32Array.of(0),
    routeEndPort: Int32Array.of(3),
    routeNet: Int32Array.of(0),
  }
  const options = {
    VIA_COST: 0.6,
    TRACE_DENSITY_COST_FACTOR: 1,
    RIP_THRESHOLD_START: 0,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 1,
  }
  const reused = new TinyHyperGraphSolver(topology, firstProblem, options)
  reused.solve()
  expect(reused.solved).toBe(true)
  reused.resetForProblem(nextProblem)
  const fresh = new TinyHyperGraphSolver(topology, nextProblem, options)
  const completeRound = (
    solver: TinyHyperGraphSolver,
    regionId: number,
    middlePortId: number,
  ): void => {
    solver.state.regionSegments = [[], []]
    solver.state.regionIntersectionCaches = Array.from(
      { length: 2 },
      createEmptyRegionIntersectionCache,
    )
    solver.state.currentRouteNetId = 0
    solver.state.portAssignment.fill(-1)
    for (const [fromPortId, toPortId] of [
      [0, middlePortId],
      [middlePortId, 3],
    ]) {
      solver.state.regionSegments[regionId].push([0, fromPortId, toPortId])
      solver.state.portAssignment[fromPortId] = 0
      solver.state.portAssignment[toPortId] = 0
      solver.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
    solver.state.currentRouteNetId = undefined
    solver.state.unroutedRoutes = []
    solver.onAllRoutesRouted()
  }
  for (const solver of [fresh, reused]) {
    // Establish a new pressure baseline with two transitions in a large region.
    completeRound(solver, 0, 1)
    expect(solver.solved).toBe(false)
    // Removing the transitions in a tiny region saves energy but exceeds this
    // problem's pressure envelope, so its earlier path must remain selected.
    completeRound(solver, 1, 2)
    expect(solver.solved).toBe(true)
    expect(solver.state.regionSegments).toEqual([
      [
        [0, 0, 1],
        [0, 1, 3],
      ],
      [],
    ])
  }
  expect(reused.getOutput()).toEqual(fresh.getOutput())
  expect(reused.stats.maxRegionCost).toBe(fresh.stats.maxRegionCost)
})
