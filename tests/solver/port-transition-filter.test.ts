import { expect, test } from "bun:test"
import {
  type Candidate,
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"
import type { PortId } from "lib/types"

class TransitionFilteringSolver extends TinyHyperGraphSolver {
  costedPortIds: PortId[] = []

  protected override isPortTransitionAllowed(
    _firstPortId: PortId,
    secondPortId: PortId,
  ): boolean {
    return secondPortId !== 1
  }

  override computeG(
    currentCandidate: Candidate,
    neighborPortId: PortId,
  ): number {
    this.costedPortIds.push(neighborPortId)
    return super.computeG(currentCandidate, neighborPortId)
  }
}

test("rejects disallowed transitions before costing or queueing candidates", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 3,
    regionIncidentPorts: [
      [0, 1, 2],
      [1, 3],
      [2, 3],
    ],
    incidentPortRegion: [[0], [0, 1], [0, 2], [1, 2]],
    regionWidth: new Float64Array(3).fill(10),
    regionHeight: new Float64Array(3).fill(10),
    regionCenterX: new Float64Array(3),
    regionCenterY: new Float64Array(3),
    portAngleForRegion1: new Int32Array(4),
    portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([0, 1, 1, 2]),
    portY: new Float64Array([0, 1, -1, 0]),
    portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(3).fill(-1),
  }
  const solver = new TransitionFilteringSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })

  solver.step()

  expect(solver.costedPortIds).toEqual([2])
  expect(
    solver.state.candidateQueue.toArray().map(({ portId }) => portId),
  ).toEqual([2])
})
