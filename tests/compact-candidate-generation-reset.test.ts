import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

const createSolver = () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 20,
    regionIncidentPorts: Array.from({ length: 20 }, () => []),
    incidentPortRegion: [[2, 7, 11], [7]],
    regionWidth: new Float64Array(20).fill(1),
    regionHeight: new Float64Array(20).fill(1),
    regionCenterX: new Float64Array(20),
    regionCenterY: new Float64Array(20),
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array(2),
    portY: new Float64Array(2),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 0,
    portSectionMask: new Int8Array(2),
    routeStartPort: new Int32Array(0),
    routeEndPort: new Int32Array(0),
    routeNet: new Int32Array(0),
    regionNetId: new Int32Array(20).fill(-1),
  }

  return new TinyHyperGraphSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
  })
}

test("uses distinct incident slots and generation reset for dense hop costs", () => {
  const solver = createSolver()
  const firstHop = solver.getHopId(0, 2)
  const secondHop = solver.getHopId(0, 7)
  const thirdHop = solver.getHopId(0, 11)

  expect(new Set([firstHop, secondHop, thirdHop]).size).toBe(3)
  expect(solver.state.candidateBestCostByHopId).toHaveLength(6)
  expect(solver.state.candidateBestCostGenerationByHopId).toHaveLength(6)

  solver.setCandidateBestCost(firstHop, 1)
  solver.setCandidateBestCost(secondHop, 2)
  solver.setCandidateBestCost(thirdHop, 3)
  expect(solver.getCandidateBestCost(firstHop)).toBe(1)
  expect(solver.getCandidateBestCost(secondHop)).toBe(2)
  expect(solver.getCandidateBestCost(thirdHop)).toBe(3)

  solver.resetCandidateBestCosts()

  expect(solver.getCandidateBestCost(firstHop)).toBe(Infinity)
  expect(solver.getCandidateBestCost(secondHop)).toBe(Infinity)
  expect(solver.getCandidateBestCost(thirdHop)).toBe(Infinity)
})
