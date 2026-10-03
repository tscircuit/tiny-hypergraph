import { expect, test } from "bun:test"
import {
  DistanceAwareTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

const topology: TinyHyperGraphTopology = {
  portCount: 4,
  regionCount: 3,
  regionIncidentPorts: [
    [0, 1, 2],
    [1, 3],
    [2, 3],
  ],
  incidentPortRegion: [[0], [0, 1], [0, 2], [1, 2]],
  regionWidth: new Float64Array([4, 4, 4]),
  regionHeight: new Float64Array([4, 4, 4]),
  regionCenterX: new Float64Array([0, 1, 1]),
  regionCenterY: new Float64Array([0, 0, 1]),
  portAngleForRegion1: new Int32Array(4),
  portAngleForRegion2: new Int32Array(4),
  portX: new Float64Array([0, 1, 0, 2]),
  portY: new Float64Array([0, 0, 2, 0]),
  portZ: new Int32Array(4),
}

const createProblem = (): TinyHyperGraphProblem => ({
  routeCount: 1,
  portSectionMask: new Int8Array([1, 1, 1, 1]),
  routeStartPort: new Int32Array([0]),
  routeEndPort: new Int32Array([3]),
  routeNet: new Int32Array([0]),
  regionNetId: new Int32Array([-1, -1, -1]),
  // The geometrically shorter branch enters port 1, but it is more expensive.
  // Reverse search must charge this penalty to the destination of the edge.
  portPenalty: new Float64Array([0, 100, 0, 0]),
})

const routeOnce = (useExactBidirectionalSearch: boolean) => {
  const solver = new DistanceAwareTinyHyperGraphSolver(
    topology,
    createProblem(),
    {
      DISTANCE_TO_COST: 1,
      STATIC_REACHABILITY_PRECHECK: false,
      EXACT_BIDIRECTIONAL_FALLBACK_EXPANSION_THRESHOLD:
        useExactBidirectionalSearch ? 0 : Number.POSITIVE_INFINITY,
    },
  )

  while (
    solver.state.unroutedRoutes.length > 0 ||
    solver.state.currentRouteId !== undefined
  ) {
    solver.step()
  }

  return solver
}

test("exact bidirectional fallback preserves directed edge costs", () => {
  const oneEndedSolver = routeOnce(false)
  const bidirectionalSolver = routeOnce(true)

  expect(bidirectionalSolver.state.regionSegments).toEqual(
    oneEndedSolver.state.regionSegments,
  )
  expect(bidirectionalSolver.state.regionSegments).toEqual([
    [[0, 0, 2]],
    [],
    [[0, 2, 3]],
  ])
  expect(
    bidirectionalSolver.stats.exactBidirectionalForwardExpansionCount,
  ).toBeGreaterThan(0)
  expect(
    bidirectionalSolver.stats.exactBidirectionalReverseExpansionCount,
  ).toBeGreaterThan(0)
})
