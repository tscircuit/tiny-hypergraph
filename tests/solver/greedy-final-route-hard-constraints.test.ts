import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

const createCrossingFixture = () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 5,
    regionIncidentPorts: [[0, 1, 2, 3], [0], [1], [2], [3]],
    incidentPortRegion: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
    regionWidth: new Float64Array([2, 2, 2, 2, 2]),
    regionHeight: new Float64Array([2, 2, 2, 2, 2]),
    regionCenterX: new Float64Array([0, 0, 2, 0, -2]),
    regionCenterY: new Float64Array([0, 2, 0, -2, 0]),
    regionAvailableZMask: new Int32Array([1, 1, 1, 1, 1]),
    portAngleForRegion1: new Int32Array([9_000, 0, 27_000, 18_000]),
    portAngleForRegion2: new Int32Array([27_000, 18_000, 9_000, 0]),
    portX: new Float64Array([0, 1, 0, -1]),
    portY: new Float64Array([1, 0, -1, 0]),
    portZ: new Int32Array(4),
    regionMetadata: [
      { name: "single-layer routing region", availableZ: [0] },
      { name: "top terminal", availableZ: [0] },
      { name: "right terminal", availableZ: [0] },
      { name: "bottom terminal", availableZ: [0] },
      { name: "left terminal", availableZ: [0] },
    ],
    portMetadata: [
      { name: "top" },
      { name: "right" },
      { name: "bottom" },
      { name: "left" },
    ],
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0, 1]),
    routeEndPort: new Int32Array([2, 3]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array(5).fill(-1),
    routeMetadata: [
      { connectionId: "vertical-net" },
      { connectionId: "horizontal-net" },
    ],
  }

  const solver = new TinyHyperGraphSolver(topology, problem, {
    GREEDY_FINAL_ROUTE_ITERS: 1,
  })
  solver.state.unroutedRoutes = [1]
  solver.state.currentRouteNetId = 0
  solver.state.regionSegments[0]!.push([0, 0, 2])
  solver.state.portAssignment[0] = 0
  solver.state.portAssignment[2] = 0
  solver.appendSegmentToRegionCache(0, 0, 2)
  solver.state.currentRouteNetId = undefined

  return solver
}

test("greedy final routing preserves single-layer crossing constraints", () => {
  const solver = createCrossingFixture()

  solver.tryFinalAcceptance()

  expect(
    getSvgFromGraphicsObject(solver.visualize()),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBeUndefined()
  expect(solver.solved).toBe(false)
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 2]])
})
