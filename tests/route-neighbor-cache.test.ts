import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "../lib/distance-aware-tiny-hypergraph-solver"
import type { Candidate, TinyHyperGraphProblem, TinyHyperGraphTopology } from "../lib/core"

class GoalContactSolver extends DistanceAwareTinyHyperGraphSolver {
  rejectedGoalContacts = 0

  override computeG(current: Candidate, portId: number, maximum = Infinity, distance?: number): number {
    if (current.portId === 1 && portId === 3) {
      this.rejectedGoalContacts += 1
      return Infinity
    }
    return super.computeG(current, portId, maximum, distance)
  }
}

test("route neighbor reuse preserves masked singleton goal contact and resets after reripping", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6,
    regionCount: 4,
    regionIncidentPorts: [[0, 5, 1, 2], [1, 3, 2, 4], [4, 5], [0]],
    incidentPortRegion: [[0, 3], [0, 1], [0, 1], [1], [1, 2], [0, 2]],
    regionWidth: new Float64Array(4).fill(100),
    regionHeight: new Float64Array(4).fill(100),
    regionCenterX: new Float64Array(4),
    regionCenterY: new Float64Array(4),
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: Float64Array.from([0, 1, 2, 5, 6, 30]),
    portY: new Float64Array(6),
    portZ: new Int32Array(6),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: Int8Array.from([1, 1, 1, 0, 1, 1]),
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([3]),
    routeNet: Int32Array.from([0]),
    regionNetId: new Int32Array(4).fill(-1),
  }
  const solver = new GoalContactSolver(topology, problem, { STATIC_REACHABILITY_PRECHECK: false })
  solver.setup()
  const dequeuedPorts: number[] = []
  const queue = solver.state.candidateQueue
  const dequeue = queue.dequeue.bind(queue)
  queue.dequeue = (): Candidate | undefined => {
    const current = dequeue()
    if (current) dequeuedPorts.push(current.portId)
    return current
  }
  for (let phase = 0; phase < 2; phase++) {
    if (phase === 1) {
      solver.resetRoutingStateForRerip()
      problem.portSectionMask[1] = 0
      solver.state.portAssignment[5] = 9
    }
    for (let step = 0; step < 10; step++) {
      solver.step()
      if (solver.state.currentRouteId === undefined && solver.state.unroutedRoutes.length === 0) break
    }
    expect(solver.failed).toBe(false)
    expect(solver.state.currentRouteId).toBeUndefined()
    expect(solver.state.unroutedRoutes).toEqual([])
    expect(solver.state.regionSegments[0]).toEqual([[0, 0, 2]])
    expect(solver.state.regionSegments[1]).toEqual([[0, 2, 3]])
  }
  expect(solver.rejectedGoalContacts).toBe(1)
  expect(dequeuedPorts).toEqual([0, 1, 2, 3, 0, 2, 3])
})
