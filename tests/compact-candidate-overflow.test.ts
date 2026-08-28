import { expect, test } from "bun:test"
import {
  type TinyHyperGraphProblem,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "lib/index"

const createSolver = (useSparseStorage: boolean) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 20,
    regionIncidentPorts: Array.from({ length: 20 }, () => []),
    incidentPortRegion: [[2, 7], [7]],
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
    USE_SPARSE_CANDIDATE_STORAGE: useSparseStorage,
    STATIC_REACHABILITY_PRECHECK: false,
  })
}

test("keeps manual non-incident hops in overflow storage across dense and sparse modes", () => {
  for (const useSparseStorage of [false, true]) {
    const solver = createSolver(useSparseStorage)
    const incidentHop = solver.getHopId(0, 2)
    const manualHop = solver.getHopId(0, 19)
    const secondManualHop = solver.getHopId(1, 19)

    expect(manualHop).toBeLessThan(0)
    expect(secondManualHop).toBeLessThan(0)
    expect(manualHop).not.toBe(secondManualHop)
    expect(manualHop).not.toBe(incidentHop)

    solver.setCandidateBestCost(incidentHop, 1)
    solver.setCandidateBestCost(manualHop, 2)
    solver.setCandidateBestCost(secondManualHop, 3)
    expect(solver.getCandidateBestCost(incidentHop)).toBe(1)
    expect(solver.getCandidateBestCost(manualHop)).toBe(2)
    expect(solver.getCandidateBestCost(secondManualHop)).toBe(3)

    solver.resetCandidateBestCosts()

    expect(solver.getCandidateBestCost(incidentHop)).toBe(Infinity)
    expect(solver.getCandidateBestCost(manualHop)).toBe(Infinity)
    expect(solver.getCandidateBestCost(secondManualHop)).toBe(Infinity)
  }
})
