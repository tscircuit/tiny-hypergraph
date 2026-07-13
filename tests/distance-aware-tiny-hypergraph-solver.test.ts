import { expect, test } from "bun:test"
import {
  DistanceAwareTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"

test("queues a costed goal candidate before committing the path", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0, 1], []],
    incidentPortRegion: [
      [0, 1],
      [0, 1],
    ],
    regionWidth: new Float64Array([100, 100]),
    regionHeight: new Float64Array([100, 100]),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 10]),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1]),
  }
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, problem, {
    DISTANCE_TO_COST: 2,
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.step()

  expect(solver.state.candidateQueue).toBeInstanceOf(IndexedCandidateHeap)
  const queuedGoal = solver.state.candidateQueue.toArray()[0]
  expect(queuedGoal?.portId).toBe(1)
  expect(queuedGoal?.g).toBeGreaterThanOrEqual(20)
  expect(solver.state.currentRouteId).toBe(0)

  solver.step()

  expect(solver.state.regionSegments[0]).toEqual([[0, 0, 1]])
  expect(solver.state.currentRouteId).toBeUndefined()
})
