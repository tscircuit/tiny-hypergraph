import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import type { RegionIntersectionCache } from "lib/types"

const createRegionCache = (
  existingRegionCost: number,
): RegionIntersectionCache => ({
  netIds: new Int32Array(0),
  lesserAngles: new Int32Array(0),
  greaterAngles: new Int32Array(0),
  layerMasks: new Int32Array(0),
  existingCrossingLayerIntersections: 0,
  existingSameLayerIntersections: 0,
  existingEntryExitLayerChanges: 0,
  existingRegionCost,
  existingSegmentCount: 0,
})

test("a failed optional rerip restores the valid completed route", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.state.unroutedRoutes = []
  solver.state.portAssignment.set([0, 0])
  solver.state.regionSegments[0] = [[0, 0, 1]]
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.5)
  solver.onAllRoutesRouted()

  expect(solver.solved).toBe(false)
  expect(solver.state.ripCount).toBe(1)

  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.unroutedRoutes = []
  solver.onOutOfCandidates()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.acceptedBestSolutionAfterReripFailure).toBe(true)
  expect(solver.state.ripCount).toBe(0)
  expect(solver.state.unroutedRoutes).toEqual([])
  expect(Array.from(solver.state.portAssignment)).toEqual([0, 0])
  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  expect(solver.state.regionIntersectionCaches[0].existingRegionCost).toBe(0.5)
})
