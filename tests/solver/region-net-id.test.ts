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
  pairCount: 0,
  existingCrossingLayerIntersections: 0,
  existingSameLayerIntersections: 0,
  existingEntryExitLayerChanges: 0,
  existingRegionCost,
  existingSegmentCount: 0,
})

test("solver does not traverse regions reserved for a different net", () => {
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
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId: Int32Array.from([-1, 1, -1, -1, -1]),
  }

  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.state.regionIntersectionCaches[0] = createRegionCache(0.5)

  solver.step()
  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.state.ripCount).toBe(1)
  expect(Array.from(solver.state.unroutedRoutes)).toEqual([0])
  expect(solver.state.currentRouteId).toBeUndefined()
  expect(solver.state.currentRouteNetId).toBeUndefined()
  expect(solver.state.candidateQueue.length).toBe(0)
  expect(solver.state.regionCongestionCost[0]).toBe(
    0.5 * solver.RIP_CONGESTION_REGION_COST_FACTOR,
  )
  expect(solver.stats.reripReason).toBe("out_of_candidates")
})

test("ports reserved by multiple endpoint nets stay blocked for every route", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 3,
    regionCount: 2,
    regionIncidentPorts: [[0, 1], [1, 2]],
    incidentPortRegion: [[0], [0, 1], [1]],
    regionWidth: new Float64Array(2).fill(1),
    regionHeight: new Float64Array(2).fill(1),
    regionCenterX: new Float64Array(2).fill(0),
    regionCenterY: new Float64Array(2).fill(0),
    portAngleForRegion1: new Int32Array(3),
    portAngleForRegion2: new Int32Array(3),
    portX: new Float64Array([0, 1, 2]),
    portY: new Float64Array(3),
    portZ: new Int32Array(3),
  }

  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(3).fill(1),
    routeStartPort: new Int32Array([0, 1]),
    routeEndPort: new Int32Array([1, 2]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: Int32Array.from([-1, -1]),
  }

  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.state.currentRouteNetId = 0
  expect(solver.isPortReservedForDifferentNet(1)).toBe(true)

  solver.state.currentRouteNetId = 1
  expect(solver.isPortReservedForDifferentNet(1)).toBe(true)
})
