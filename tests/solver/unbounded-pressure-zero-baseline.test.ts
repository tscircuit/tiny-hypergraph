import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type RegionCostSummary,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"

type SelectionAccess = {
  firstSolvedStateSummary: RegionCostSummary
  compareRegionCostSummaries(
    left: RegionCostSummary,
    right: RegionCostSummary,
  ): number
}

test("unbounded peak growth keeps a zero-pressure baseline eligible and preserves total pressure after reset", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [
      [0, 1],
      [0, 1],
    ],
    incidentPortRegion: [
      [0, 1],
      [0, 1],
    ],
    regionWidth: Float64Array.of(10, 1),
    regionHeight: Float64Array.of(10, 1),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 0),
    portAngleForRegion1: Int32Array.of(0, 18000),
    portX: Float64Array.of(-1, 1),
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
    portPenalty: Float64Array.of(5, 10),
  }
  const options = {
    VIA_COST: 0.6,
    PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO: Number.POSITIVE_INFINITY,
    PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO: 0.1,
  }
  const solver = new TinyHyperGraphSolver(topology, problem, options)
  solver.solve()
  expect(solver.solved).toBe(true)
  const selection = solver as unknown as SelectionAccess
  const baseline = selection.firstSolvedStateSummary
  expect(baseline.maxRegionCost).toBe(0)
  expect(baseline.totalRegionCost).toBe(0)
  expect(baseline.pathEnergy).toBe(10)
  expect(solver.isWithinRegionCostEnvelope(baseline, baseline)).toBe(true)
  const higherTotalPressure = {
    maxRegionCost: 1,
    totalRegionCost: 1,
    pathEnergy: 1,
  }
  expect(solver.isWithinRegionCostEnvelope(higherTotalPressure, baseline)).toBe(
    false,
  )
  expect(
    selection.compareRegionCostSummaries(higherTotalPressure, baseline),
  ).toBeGreaterThan(0)

  const positiveBaseline = {
    maxRegionCost: 5,
    totalRegionCost: 10,
    pathEnergy: 20,
  }
  expect(
    solver.isWithinRegionCostEnvelope(
      { maxRegionCost: 8, totalRegionCost: 10, pathEnergy: 19 },
      positiveBaseline,
    ),
  ).toBe(true)
  solver.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO = 0.05
  expect(
    solver.isWithinRegionCostEnvelope(
      { maxRegionCost: 5.26, totalRegionCost: 10 },
      positiveBaseline,
    ),
  ).toBe(false)
  expect(
    solver.isWithinRegionCostEnvelope(
      { maxRegionCost: 5.24, totalRegionCost: 10 },
      positiveBaseline,
    ),
  ).toBe(true)

  solver.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO = Number.POSITIVE_INFINITY
  const reversedProblem = {
    ...problem,
    routeStartPort: Int32Array.of(1),
    routeEndPort: Int32Array.of(0),
  }
  solver.resetForProblem(reversedProblem)
  solver.solve()
  const fresh = new TinyHyperGraphSolver(topology, reversedProblem, options)
  fresh.solve()
  expect(solver.getOutput()).toEqual(fresh.getOutput())
  expect(selection.firstSolvedStateSummary.pathEnergy).toBe(5)
  expect(
    solver.isWithinRegionCostEnvelope(
      selection.firstSolvedStateSummary,
      selection.firstSolvedStateSummary,
    ),
  ).toBe(true)
})
