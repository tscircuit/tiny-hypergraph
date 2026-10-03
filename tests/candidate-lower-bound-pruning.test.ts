import { expect, test } from "bun:test"
import {
  type Candidate,
  DistanceAwareTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

class CountingDistanceAwareSolver extends DistanceAwareTinyHyperGraphSolver {
  computeGCallCount = 0

  override computeG(
    currentCandidate: Candidate,
    neighborPortId: number,
    maximumCost?: number,
    knownSegmentDistance?: number,
  ): number {
    this.computeGCallCount += 1
    return super.computeG(
      currentCandidate,
      neighborPortId,
      maximumCost,
      knownSegmentDistance,
    )
  }
}

test("skips candidate scoring when its lower bound cannot improve the hop", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 3,
    regionCount: 3,
    regionIncidentPorts: [[0, 1], [1], [0, 2]],
    incidentPortRegion: [
      [0, 2],
      [0, 1],
      [2],
    ],
    regionWidth: new Float64Array([10, 10, 10]),
    regionHeight: new Float64Array([10, 10, 10]),
    regionCenterX: new Float64Array(3),
    regionCenterY: new Float64Array(3),
    portAngleForRegion1: new Int32Array(3),
    portAngleForRegion2: new Int32Array(3),
    portX: new Float64Array([0, 10, 20]),
    portY: new Float64Array(3),
    portZ: new Int32Array(3),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([2]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1, -1]),
  }
  const solver = new CountingDistanceAwareSolver(topology, problem, {
    DISTANCE_TO_COST: 1,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  solver._setup()
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0
  solver.state.goalPortId = 2

  const currentHopId = solver.getHopId(0, 0)
  const neighborHopId = solver.getHopId(1, 1)
  solver.setCandidateBestCost(currentHopId, 5)
  solver.setCandidateBestCost(neighborHopId, 15)
  solver.state.candidateQueue.queue({
    hopId: currentHopId,
    portId: 0,
    nextRegionId: 0,
    f: 5,
    g: 5,
    h: 0,
  })

  solver._step()

  expect(solver.computeGCallCount).toBe(0)
  expect(solver.state.candidateQueue.length).toBe(0)
})
