import { expect, test } from "bun:test"
import { createEmptyRegionIntersectionCache, TinyHyperGraphSolver, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"

test("ordinary physical-via solvers emit the best completed path when the final round is worse", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3], []],
    incidentPortRegion: [[0, 1], [0, 1], [0, 1], [0, 1]],
    regionWidth: Float64Array.of(10, 1),
    regionHeight: Float64Array.of(10, 1),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 0),
    portAngleForRegion1: Int32Array.of(18000, 9000, 27000, 0),
    portX: Float64Array.of(-1, 0, 0, 1),
    portY: Float64Array.of(0, 1, 0, 0),
    portZ: Int32Array.of(0, 1, 0, 0),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: Int32Array.of(0),
    routeEndPort: Int32Array.of(3),
    routeNet: Int32Array.of(0),
    regionNetId: new Int32Array(2).fill(-1),
  }
  const complete = (solver: TinyHyperGraphSolver, middle: number) => {
    solver.state.regionSegments = [[], []]
    solver.state.regionIntersectionCaches = Array.from({ length: 2 }, createEmptyRegionIntersectionCache)
    solver.state.currentRouteNetId = 0
    solver.state.portAssignment.fill(-1)
    for (const [from, to] of [[0, middle], [middle, 3]]) {
      solver.state.regionSegments[0]!.push([0, from!, to!])
      solver.state.portAssignment[from!] = 0
      solver.state.portAssignment[to!] = 0
      solver.appendSegmentToRegionCache(0, from!, to!)
    }
    solver.state.currentRouteNetId = undefined
    solver.state.unroutedRoutes = []
    solver.onAllRoutesRouted()
  }
  for (const Solver of [TinyHyperGraphSolver, DistanceAwareTinyHyperGraphSolver]) {
    for (const viaCost of [0, 0.6]) {
      const solver = new Solver(topology, problem, {
        VIA_COST: viaCost,
        TRACE_DENSITY_COST_FACTOR: 1,
        RIP_THRESHOLD_START: 0,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 1,
      })
      complete(solver, 2)
      expect(solver.solved).toBe(false)
      expect(solver.state.ripCount).toBe(1)
      complete(solver, 1)
      expect(solver.solved).toBe(true)
      const expectedMiddle = viaCost > 0 ? 2 : 1
      expect(solver.state.regionSegments[0]).toEqual([[0, 0, expectedMiddle], [0, expectedMiddle, 3]])
      const path = solver.getOutput().solvedRoutes![0]!.path.map((candidate) => candidate.portId)
      expect(path).toEqual(["port-0", `port-${expectedMiddle}`, "port-3"])
      if (viaCost > 0) {
        expect(solver.state.regionIntersectionCaches[0]!.existingEntryExitLayerChanges).toBe(0)
        expect(solver.stats.maxRegionCost).toBe(solver.stats.bestMaxRegionCost)
        expect(solver.stats.totalRegionCost).toBe(solver.stats.bestTotalRegionCost)
      }
    }
  }
})
