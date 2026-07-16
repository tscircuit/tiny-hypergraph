import { expect, test } from "bun:test"
import {
  createEmptyRegionIntersectionCache,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

const createSolver = (useSparseCandidateStorage: boolean) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 3,
    regionIncidentPorts: [[0], [0, 1], [1]],
    incidentPortRegion: [
      [1, 0],
      [1, 2],
    ],
    regionWidth: new Float64Array(3).fill(10),
    regionHeight: new Float64Array(3).fill(10),
    regionCenterX: new Float64Array([0, 1, 2]),
    regionCenterY: new Float64Array(3),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([1]),
    routeNet: Int32Array.from([0]),
    regionNetId: new Int32Array(3).fill(-1),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    USE_SPARSE_CANDIDATE_STORAGE: useSparseCandidateStorage,
  })

  solver.state.unroutedRoutes = []
  solver.state.portAssignment.set([0, 0])
  solver.state.regionSegments[1] = [[0, 0, 1]]
  const congestedCache = createEmptyRegionIntersectionCache()
  congestedCache.existingRegionCost = 0.5
  solver.state.regionIntersectionCaches[1] = congestedCache
  solver.solve()

  return {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    ripCount: solver.state.ripCount,
    portAssignment: Array.from(solver.state.portAssignment),
    regionSegments: solver.state.regionSegments,
    unroutedRoutes: solver.state.unroutedRoutes,
    stats: solver.stats,
  }
}

test("sparse and dense candidate storage stay equivalent across a rerip", () => {
  const denseResult = createSolver(false)
  const sparseResult = createSolver(true)

  expect(sparseResult).toEqual(denseResult)
  expect(sparseResult.solved).toBe(true)
  expect(sparseResult.failed).toBe(false)
  expect(sparseResult.ripCount).toBe(1)
  expect(sparseResult.regionSegments[1]).toEqual([[0, 0, 1]])
})
