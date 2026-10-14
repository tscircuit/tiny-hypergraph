import { expect, test } from "bun:test"
import {
  OutsideInPartialRipTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

class InspectableOutsideInSolver extends OutsideInPartialRipTinyHyperGraphSolver {
  outOfCandidatesIteration?: number

  override onOutOfCandidates(): void {
    this.outOfCandidatesIteration = this.iterations
    this.solved = true
  }
}

test("whole-route outside-in search stops when either frontier is exhausted", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0], [1]],
    incidentPortRegion: [[0], [1]],
    regionWidth: new Float64Array(2).fill(1),
    regionHeight: new Float64Array(2).fill(1),
    regionCenterX: Float64Array.of(0, 10),
    regionCenterY: new Float64Array(2),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: Float64Array.of(0, 10),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: Int32Array.of(0),
    routeEndPort: Int32Array.of(1),
    routeNet: Int32Array.of(0),
    regionNetId: new Int32Array(2).fill(-1),
  }
  const solver = new InspectableOutsideInSolver(topology, problem, {
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    WHOLE_ROUTE_OUTSIDE_IN_ROUTING: true,
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.solve()

  expect(solver.outOfCandidatesIteration).toBe(1)
  expect(solver.stats.outsideInForwardExpansionCount).toBe(1)
  expect(solver.stats.outsideInReverseExpansionCount).toBe(0)
})
