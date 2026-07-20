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
  traceLengthByLayer: new Float64Array(32),
  longestTraceLengthByLayer: new Float64Array(32),
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
    routeMetadata: [{ connectionId: "blocked-route" }],
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId: Int32Array.from([-1, 1, -1, -1, -1]),
  }

  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.setup()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("Static reachability precheck failed")
  expect(solver.error).toContain("blocked-route")
  expect(solver.stats.staticallyUnroutableRouteCount).toBe(1)
})

test("visualize only shows statically unroutable route hints after static reachability failure", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 6,
    regionIncidentPorts: [[0, 1], [1, 2], [2, 3], [0], [3], [4, 5]],
    incidentPortRegion: [[0, 3], [0, 1], [1, 2], [2, 4], [5], [5]],
    regionWidth: new Float64Array(6).fill(1),
    regionHeight: new Float64Array(6).fill(1),
    regionCenterX: new Float64Array(6).fill(0),
    regionCenterY: new Float64Array(6).fill(0),
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array([0, 1, 2, 3, 0, 1]),
    portY: new Float64Array([0, 0, 0, 0, 2, 2]),
    portZ: new Int32Array(6),
  }

  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(6).fill(1),
    routeMetadata: [
      { connectionId: "blocked-route" },
      { connectionId: "reachable-route" },
    ],
    routeStartPort: new Int32Array([0, 4]),
    routeEndPort: new Int32Array([3, 5]),
    routeNet: new Int32Array([0, 2]),
    regionNetId: Int32Array.from([-1, 1, -1, -1, -1, -1]),
  }

  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.setup()

  const graphicsText = JSON.stringify(solver.visualize())

  expect(graphicsText).toContain("static reachability failed: blocked-route")
  expect(graphicsText).not.toContain("reachable-route")
})

test("solver can still rerip on out-of-candidates when static precheck is disabled", () => {
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

  const solver = new TinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
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
