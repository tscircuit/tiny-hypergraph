import { expect, test } from "bun:test"
import {
  type RegionCostSummary,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "lib/outside-in-partial-rip-tiny-hypergraph-solver"

type RoundSummary = RegionCostSummary & {
  ripCount: number
  segmentCount: number
  maxRegionSegmentCount: number
  squaredRegionSegmentCount: number
}

type SelectionAccess = {
  firstSolvedStateSummary: RegionCostSummary
  firstCompletedRoundSummary: RoundSummary
  partialRipQualityBaselineSummary: RoundSummary
  bestSolvedRoundSummary: RoundSummary
  shouldReplaceBestSolvedState(summary: RoundSummary): boolean
}

test("partial rip retains its total-pressure veto when the peak limit is unbounded", (): void => {
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
    portPenalty: Float64Array.of(0, 10),
  }
  const solver = new OutsideInPartialRipTinyHyperGraphSolver(
    topology,
    problem,
    {
      VIA_COST: 0.6,
      PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
      PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 0,
      PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO: Number.POSITIVE_INFINITY,
      PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO: 0.1,
    },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  const selection = solver as unknown as SelectionAccess
  const zeroBaseline = selection.firstCompletedRoundSummary
  expect(zeroBaseline.maxRegionCost).toBe(0)
  expect(zeroBaseline.totalRegionCost).toBe(0)
  selection.partialRipQualityBaselineSummary = zeroBaseline
  expect(
    selection.shouldReplaceBestSolvedState({
      ...zeroBaseline,
      maxRegionCost: 1,
      totalRegionCost: 1,
      pathEnergy: 1,
      ripCount: 1,
    }),
  ).toBe(false)

  const positiveBaseline: RoundSummary = {
    ...zeroBaseline,
    maxRegionCost: 5,
    totalRegionCost: 10,
    pathEnergy: 20,
  }
  selection.firstSolvedStateSummary = positiveBaseline
  selection.firstCompletedRoundSummary = positiveBaseline
  selection.partialRipQualityBaselineSummary = positiveBaseline
  selection.bestSolvedRoundSummary = positiveBaseline
  const concentratedRound: RoundSummary = {
    ...positiveBaseline,
    maxRegionCost: 8,
    pathEnergy: 19,
    ripCount: 1,
  }
  expect(selection.shouldReplaceBestSolvedState(concentratedRound)).toBe(true)
  expect(
    selection.shouldReplaceBestSolvedState({
      ...concentratedRound,
      totalRegionCost: 11.1,
      pathEnergy: 18,
    }),
  ).toBe(false)
  solver.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO = 0.05
  expect(selection.shouldReplaceBestSolvedState(concentratedRound)).toBe(false)
})
