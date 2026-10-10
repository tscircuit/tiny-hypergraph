import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type RegionCostSummary, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "lib/outside-in-partial-rip-tiny-hypergraph-solver"
import { TinyHyperGraphSectionSolver } from "lib/section-solver"

type RoundSummary = RegionCostSummary & {
  ripCount: number
  segmentCount: number
  maxRegionSegmentCount: number
  squaredRegionSegmentCount: number
}

type SelectionAccess = {
  firstCompletedRoundSummary: RoundSummary
  partialRipQualityBaselineSummary: RoundSummary
  bestSolvedRoundSummary: RoundSummary
  shouldReplaceBestSolvedState(summary: RoundSummary): boolean
}

test("physical path energy telescopes and selects completed rounds within the pressure envelope", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3], []],
    incidentPortRegion: [[0, 1], [0, 1], [0, 1], [0, 1]],
    regionWidth: Float64Array.of(3, 1),
    regionHeight: Float64Array.of(3, 1),
    regionCenterX: new Float64Array(2),
    regionCenterY: new Float64Array(2),
    regionAvailableZMask: Int32Array.of(3, 0),
    portAngleForRegion1: Int32Array.of(0, 9000, 18000, 27000),
    portX: Float64Array.of(1, 0, -1, 0),
    portY: Float64Array.of(0, 1, 0, -1),
    portZ: Int32Array.of(0, 1, 0, 0),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array(4).fill(1),
    routeStartPort: Int32Array.of(0, 1),
    routeEndPort: Int32Array.of(2, 3),
    routeNet: Int32Array.of(0, 1),
    regionNetId: new Int32Array(2).fill(-1),
    portPenalty: Float64Array.of(0.1, 0.2, 0.3, 0.4),
  }
  const options = {
    VIA_COST: 0.6,
    CROSS_LAYER_INTERSECTION_COST_FACTOR: 0,
    PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 100,
    PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO: 0.05,
    PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO: 0.1,
  }
  const build = (reverse: boolean) => {
    const solver = new OutsideInPartialRipTinyHyperGraphSolver(topology, problem, options)
    let pathCost = 0
    const segments: Array<[number, number, number]> = [[0, 0, 2], [1, 1, 3]]
    for (const [routeId, fromPortId, toPortId] of reverse ? segments.reverse() : segments) {
      solver.state.currentRouteNetId = routeId
      pathCost += solver.computeG({ nextRegionId: 0, portId: fromPortId, f: 0, g: 0, h: 0 }, toPortId)
      solver.state.regionSegments[0]!.push([routeId, fromPortId, toPortId])
      solver.appendSegmentToRegionCache(0, fromPortId, toPortId)
    }
    const pressure = solver.state.regionIntersectionCaches[0]!.existingRegionCost
    const summary = solver.withPathEnergy({ maxRegionCost: pressure, totalRegionCost: pressure })
    expect(summary.pathEnergy).toBeCloseTo(pathCost)
    return { solver, summary }
  }
  const forward = build(false)
  expect(build(true).summary.pathEnergy).toBeCloseTo(forward.summary.pathEnergy!)
  const greedy = new TinyHyperGraphSolver(topology, problem, options)
  greedy.state = forward.solver.state
  const parentSummary = (forward.solver as unknown as { summarizeSolvedState(solver: TinyHyperGraphSolver): RegionCostSummary }).summarizeSolvedState(greedy)
  expect(parentSummary.pathEnergy).toBeCloseTo(forward.summary.pathEnergy!)
  const round = (pathEnergy: number, segmentCount: number, maxRegionCost = 1, totalRegionCost = 10): RoundSummary => ({
    pathEnergy, segmentCount, maxRegionCost, totalRegionCost,
    ripCount: 1, maxRegionSegmentCount: segmentCount, squaredRegionSegmentCount: segmentCount * segmentCount,
  })
  const selection = forward.solver as unknown as SelectionAccess
  selection.firstCompletedRoundSummary = round(10, 20)
  selection.partialRipQualityBaselineSummary = selection.firstCompletedRoundSummary
  selection.bestSolvedRoundSummary = selection.firstCompletedRoundSummary
  expect(selection.shouldReplaceBestSolvedState(round(20, 10, 0.99))).toBe(false)
  expect(selection.shouldReplaceBestSolvedState(round(8, 25, 1.04, 10.5))).toBe(true)
  expect(selection.shouldReplaceBestSolvedState(round(1, 5, 1.051))).toBe(false)
  expect(forward.solver.isWithinRegionCostEnvelope(round(8, 25, 1.04, 10.5), round(10, 20))).toBe(true)
  expect(forward.solver.isWithinRegionCostEnvelope(round(1, 5, 1.051), round(10, 20))).toBe(false)

  const legacy = new OutsideInPartialRipTinyHyperGraphSolver(topology, problem, { ...options, VIA_COST: 0 })
  const legacySelection = legacy as unknown as SelectionAccess
  legacySelection.firstCompletedRoundSummary = round(10, 20)
  legacySelection.partialRipQualityBaselineSummary = legacySelection.firstCompletedRoundSummary
  legacySelection.bestSolvedRoundSummary = legacySelection.firstCompletedRoundSummary
  expect(legacySelection.shouldReplaceBestSolvedState(round(20, 10, 0.99))).toBe(true)
  expect(legacy.withPathEnergy({ maxRegionCost: 1, totalRegionCost: 10 }).pathEnergy).toBeUndefined()

  const section = new TinyHyperGraphSectionSolver(topology, problem, {
    solvedRoutePathSegments: [[[0, 2]], [[1, 3]]],
    solvedRoutePathRegionIds: [[0], [0]],
  }, options)
  expect(section.baselineSummary.pathEnergy).toBeCloseTo(forward.summary.pathEnergy! - 4 * forward.solver.DISTANCE_TO_COST)
  expect(section.sectionBaselineSummary.pathEnergy! + section.outsideSectionBaselineSummary.pathEnergy!).toBeCloseTo(section.baselineSummary.pathEnergy!)
})
