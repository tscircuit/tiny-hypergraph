import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"

const topology: TinyHyperGraphTopology = {
  portCount: 1,
  regionCount: 1,
  regionIncidentPorts: [[]],
  incidentPortRegion: [[]],
  regionWidth: new Float64Array([1]),
  regionHeight: new Float64Array([1]),
  regionCenterX: new Float64Array([0]),
  regionCenterY: new Float64Array([0]),
  portAngleForRegion1: new Int32Array([0]),
  portX: new Float64Array([0]),
  portY: new Float64Array([0]),
  portZ: new Int32Array([0]),
}

const problem: TinyHyperGraphProblem = {
  routeCount: 0,
  portSectionMask: new Int8Array([1]),
  routeStartPort: new Int32Array(),
  routeEndPort: new Int32Array(),
  routeNet: new Int32Array(),
  regionNetId: new Int32Array([-1]),
}

const candidate = (
  estimatedViaCount: number,
  regionRiskCost: number,
  routeLengthCost: number,
): Candidate => ({
  portId: 0,
  nextRegionId: 0,
  estimatedViaCount,
  regionRiskCost,
  routeLengthCost,
  g: regionRiskCost,
  h: 0,
  f: regionRiskCost,
})

test("keeps Pareto alternatives without requeueing equal-risk labels", () => {
  const solver = new TinyHyperGraphSolver(topology, problem)
  const originalSearchLabel = candidate(1, 1, 1)
  const betterViaAtEqualRisk = candidate(0, 1, 0.5)
  const lowerRiskAlternative = candidate(2, 0.5, 2)

  expect(solver.retainCandidateQuality(0, originalSearchLabel)).toBe(true)
  expect(
    solver.queueCandidateIfSearchCostImproves(0, originalSearchLabel),
  ).toBe(true)

  expect(solver.retainCandidateQuality(0, betterViaAtEqualRisk)).toBe(true)
  expect(
    solver.queueCandidateIfSearchCostImproves(0, betterViaAtEqualRisk),
  ).toBe(false)

  expect(solver.retainCandidateQuality(0, lowerRiskAlternative)).toBe(true)
  expect(
    solver.queueCandidateIfSearchCostImproves(0, lowerRiskAlternative),
  ).toBe(true)

  expect(solver.state.candidateParetoFrontierByHopId.get(0)).toEqual([
    betterViaAtEqualRisk,
    lowerRiskAlternative,
  ])
  expect(solver.state.candidateQueue.dequeue()).toBe(lowerRiskAlternative)
  expect(solver.state.candidateQueue.dequeue()).toBe(originalSearchLabel)
  expect(solver.state.candidateQueue.dequeue()).toBeUndefined()
})
