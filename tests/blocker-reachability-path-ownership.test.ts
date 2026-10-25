import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "lib/find-distinct-owner-blocker-path"
import type {
  RelaxedSearchHop,
  RelaxedSearchHopData,
  RelaxedSearchState,
} from "lib/selective-rerip/relaxedBlockerSearchTypes"
import type { RouteId } from "lib/types"
import { createBlockerReachabilityFixture } from "./fixtures/createBlockerReachabilityFixture"

type WeightedHop = DistinctOwnerBlockerHop<
  RelaxedSearchState,
  RouteId,
  RelaxedSearchHopData
>

test("rerip prechecks preserve weighted hop identities and independent search results", (): void => {
  const { solver, problem } = createBlockerReachabilityFixture()
  solver.state.portAssignment[1] = 1
  solver.state.portAssignment[3] = 1
  solver.state.regionSegments[0] = [[1, 1, 3]]
  const weightedHops = new Set<WeightedHop>()
  const getHops = solver["getRelaxedSearchHops"].bind(solver)
  solver["getRelaxedSearchHops"] = (input, context): RelaxedSearchHop[] => {
    const hops = getHops(input, context)
    for (const hop of hops) weightedHops.add(hop)
    return hops
  }
  const first = solver["findRelaxedBlockerPath"]()
  expect(first.found).toBe(true)
  if (!first.found) throw new Error(first.reason)
  expect(first.distance).toBe(2)
  expect(first.owners.size).toBe(0)
  expect(first.states.at(-1)?.portId).toBe(2)
  for (const hop of first.hops) expect(weightedHops.has(hop)).toBe(true)
  const snapshot = structuredClone(first)

  problem.routeEndPort[0] = 3
  const second = solver["findRelaxedBlockerPath"]()
  expect(second.found).toBe(true)
  if (!second.found) throw new Error(second.reason)
  expect(second.distance).toBe(3)
  expect([...second.owners]).toEqual([1])
  expect(second.states.at(-1)?.portId).toBe(3)
  expect(first).toEqual(snapshot)
  const forbidden = solver["findRelaxedBlockerPath"](new Set([1]))
  expect(forbidden.found).toBe(false)
  expect(first).toEqual(snapshot)
  for (const invalidLimit of [-1, 0.5, NaN, -Infinity]) {
    solver["getRelaxedSearchExpansionLimit"] = (): number => invalidLimit
    expect((): unknown =>
      solver["findRelaxedBlockerPath"](new Set([1])),
    ).toThrow("maxExpandedLabels must be a non-negative integer")
  }
})
