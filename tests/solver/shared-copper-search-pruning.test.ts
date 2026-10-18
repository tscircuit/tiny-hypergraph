import { expect, test } from "bun:test"
import {
  type Candidate,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
} from "../../lib/core"
import { IndexedCandidateHeap } from "../../lib/indexed-candidate-heap"

test("both search loops retain cheaper reuse before scoring a shared hop", (): void => {
  const results: Array<{ owned: boolean; entry: number; copper: number }> = []
  for (const owned of [false, true]) {
    // S -> {A,D} -> B -> C. A-B is committed same-net copper. D reaches
    // B first at cost 20; A must replace it at cost 1, not be pruned at 21.
    const topology: TinyHyperGraphTopology = {
      portCount: 5,
      regionCount: 5,
      regionIncidentPorts: [[0], [0, 1, 2], [1, 2, 3], [3, 4], [4]],
      incidentPortRegion: [[0, 1], [1, 2], [1, 2], [2, 3], [3, 4]],
      regionWidth: Float64Array.from([0.01, 2, 2, 2, 0.01]),
      regionHeight: Float64Array.from([0.01, 4, 4, 4, 0.01]),
      regionCenterX: Float64Array.from([-4, -2, 0, 2, 4]),
      regionCenterY: new Float64Array(5),
      regionAvailableZMask: new Int32Array(5).fill(1),
      portAngleForRegion1: Int32Array.from([0, 7000, 1000, 0, 0]),
      portAngleForRegion2: Int32Array.from([4000, 5000, 3000, 4000, 4000]),
      portX: Float64Array.from([-3, -1, -1, 1, 3]),
      portY: Float64Array.from([0, -1, 1, 0, 0]),
      portZ: new Int32Array(5),
    }
    const problem: TinyHyperGraphProblem = {
      routeCount: 2,
      portSectionMask: new Int8Array(5).fill(1),
      routeStartPort: Int32Array.from([1, 0]),
      routeEndPort: Int32Array.from([3, 4]),
      routeNet: new Int32Array(2),
      regionNetId: Int32Array.from([0, -1, -1, -1, 0]),
      portPenalty: Float64Array.from([0, 1, 0, 13, 0]),
      shareSameNetCopper: true,
      regionLayerMasksAreBinding: false,
    }
    const solver = new TinyHyperGraphSolver(topology, problem, {
      OWNED_REGIONAL_HOP_FRONTIER: owned,
      STATIC_REACHABILITY_PRECHECK: false,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      MAX_ITERATIONS: 1_000,
    })
    const start: Candidate = {
      portId: 1,
      nextRegionId: 2,
      g: 0,
      h: 0,
      f: 0,
    }
    solver.state.currentRouteId = 0
    solver.state.currentRouteNetId = 0
    solver.state.goalPortId = 3
    solver.onPathFound({
      portId: 3,
      nextRegionId: 3,
      prevRegionId: 2,
      prevCandidate: start,
      g: 0,
      h: 0,
      f: 0,
    })
    solver.state.unroutedRoutes = [1]
    solver.state.regionCongestionCost[2] = 7
    solver.state.candidateQueue = new IndexedCandidateHeap(topology.regionCount)
    solver.solve()
    expect(solver.failed, solver.error ?? "").toBe(false)
    expect(solver.solved).toBe(true)
    const segment = solver.state.regionSegments[2]!.find(([route]) => route === 1)!
    results.push({
      owned,
      entry: segment[1],
      copper: solver.state.regionIntersectionCaches[2]!.existingSegmentCount,
    })
  }
  expect(results).toEqual([
    { owned: false, entry: 1, copper: 1 },
    { owned: true, entry: 1, copper: 1 },
  ])
})
