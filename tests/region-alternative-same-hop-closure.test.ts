import { expect, test } from "bun:test"
import { createCapacityProbe } from "./fixtures/alternative-region-capacity.fixture"

test("same-hop alternative closure combines independent violated faces before choosing the cheapest owner union", () => {
  const { solver, candidate } = createCapacityProbe([0, 1, 2])
  const ignoredCalls: number[][] = []
  solver.topology.regionSegmentFeasibility = ({ ignoredRouteIds }) => {
    ignoredCalls.push([...(ignoredRouteIds ?? [])].sort((a, b) => a - b))
    // Report only the first violated face. Rechecking the selected removal
    // set must discover the second face before this hop becomes traversable.
    if (!ignoredRouteIds?.has(0) && !ignoredRouteIds?.has(1)) {
      return { feasible: false, alternativeBlockerRouteIdSets: [[0], [1]] }
    }
    if (!ignoredRouteIds?.has(1) && !ignoredRouteIds?.has(2)) {
      return { feasible: false, alternativeBlockerRouteIdSets: [[1], [2]] }
    }
    return { feasible: true }
  }
  const before = structuredClone(solver.state.regionSegments)
  const shared = solver.plan(candidate)
  expect(shared.found).toBe(true)
  if (!shared.found) throw new Error("Expected the owner shared by both faces")
  expect([...shared.owners]).toEqual([1])
  expect(ignoredCalls).toContainEqual([1])

  const alternate = solver.plan(candidate, new Set([1]))
  expect(alternate.found).toBe(true)
  if (!alternate.found) throw new Error("Expected both independent face owners")
  expect([...alternate.owners].sort()).toEqual([0, 2])
  expect(alternate.hops.at(-1)!.data!.resources).toContainEqual({
    kind: "region_segment_feasibility",
    regionId: 0,
    fromPortId: candidate * 2,
    toPortId: candidate * 2 + 1,
    owners: [0, 2],
  })
  expect(ignoredCalls).toContainEqual([0, 2])
  expect(solver.state.regionSegments).toEqual(before)
})
