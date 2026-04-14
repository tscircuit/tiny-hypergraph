import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "lib/index"

const createNonCenterTestSolver = (
  options?: ConstructorParameters<typeof TinyHyperGraphSolver>[2],
) => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 2,
    regionIncidentPorts: [
      [0, 1, 2, 3],
      [0, 1, 2, 3],
    ],
    incidentPortRegion: [
      [0, 1],
      [0, 1],
      [0, 1],
      [1, 0],
    ],
    regionWidth: new Float64Array([6, 6]),
    regionHeight: new Float64Array([10, 10]),
    regionCenterX: new Float64Array([0, 0]),
    regionCenterY: new Float64Array([0, 0]),
    portAngleForRegion1: new Int32Array([4500, 0, 13500, 0]),
    portAngleForRegion2: new Int32Array([4500, 0, 13500, 18000]),
    portX: new Float64Array(4),
    portY: new Float64Array(4),
    portZ: new Int32Array(4),
  }

  topology.portAngleForRegion1[3] = 4500

  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1, 1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(2).fill(-1),
  }

  return new TinyHyperGraphSolver(topology, problem, options)
}

test("non-center penalty is based on distance from the middle of the touched side", () => {
  const solver = createNonCenterTestSolver({
    NON_CENTER_COST_PER_MM: 0.2,
  })

  expect(solver.computePortNonCenterPenalty(0, 0)).toBeCloseTo(0, 6)
  expect(solver.computePortNonCenterPenalty(0, 1)).toBeCloseTo(1, 6)
  expect(solver.computePortNonCenterPenalty(0, 2)).toBeCloseTo(0, 6)
  expect(solver.computePortNonCenterPenalty(0, 3)).toBeCloseTo(0.6, 6)
  expect(solver.computeBestPortNonCenterPenalty(3)).toBeCloseTo(0, 6)
})

test("computeG uses the lower non-center penalty across both incident regions", () => {
  const solver = createNonCenterTestSolver({
    NON_CENTER_COST_PER_MM: 0.2,
  })

  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0

  const currentCandidate = {
    portId: 0,
    nextRegionId: 0,
    g: 0,
    h: 0,
    f: 0,
  }

  expect(solver.computeG(currentCandidate, 2)).toBeCloseTo(0, 6)
  expect(solver.computeG(currentCandidate, 1)).toBeCloseTo(1, 6)
  expect(solver.computeG(currentCandidate, 3)).toBeCloseTo(0, 6)
})
