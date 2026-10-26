import { expect, test } from "bun:test"
import type { TinyHyperGraphRegionSegmentFeasibilityResult } from "lib/core"
import { createCapacityProbe } from "./fixtures/alternative-region-capacity.fixture"

test("malformed alternative owners and non-progressing removal branches throw instead of accepting the segment", () => {
  const { solver, candidate } = createCapacityProbe([0, 1, 2, 3], [0, 1, 2])
  const invalid: TinyHyperGraphRegionSegmentFeasibilityResult[] = [
    { feasible: false } as TinyHyperGraphRegionSegmentFeasibilityResult,
    {
      feasible: false,
      blockerRouteIds: [0],
      alternativeBlockerRouteIdSets: [[1]],
    } as unknown as TinyHyperGraphRegionSegmentFeasibilityResult,
    {
      feasible: false,
      alternativeBlockerRouteIdSets: null,
    } as unknown as TinyHyperGraphRegionSegmentFeasibilityResult,
    { feasible: false, alternativeBlockerRouteIdSets: [[]] },
    { feasible: false, alternativeBlockerRouteIdSets: [[-1]] },
    { feasible: false, alternativeBlockerRouteIdSets: [[solver.problem.routeCount]] },
    { feasible: false, alternativeBlockerRouteIdSets: [[candidate]] },
    { feasible: false, alternativeBlockerRouteIdSets: [[3]] },
    // This first removes 0, then incorrectly asks to remove it again forever.
    { feasible: false, alternativeBlockerRouteIdSets: [[0]] },
  ]
  for (const result of invalid) {
    solver.topology.regionSegmentFeasibility = () => result
    expect(() => solver.plan(candidate)).toThrow(/invalid|empty|progress/i)
  }
  solver.topology.regionSegmentFeasibility = () => ({
    feasible: false,
    alternativeBlockerRouteIdSets: [],
  })
  expect(solver.plan(candidate).found).toBe(false)
})
