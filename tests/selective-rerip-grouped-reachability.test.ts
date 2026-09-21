import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"
import type { DistinctOwnerBlockerSearchResult } from "lib/find-distinct-owner-blocker-path"

type State = {portId: number; nextRegionId: number}
type Hop = {state: State; distance: number; owners: number[]; data: {resources: []}}
type Result = DistinctOwnerBlockerSearchResult<State, number, {resources: unknown[]}>
class ReachabilityProbe extends SelectiveReripTinyHyperGraphSolver {
  run(): Result {
    const result = this.findRelaxedBlockerPath()
    if (result.expandedLabelCount < 0) {
      throw new Error("Expansion count cannot be negative")
    }
    return result
  }
}

test("grouped owner-free reachability retains the first source's exit and leaves single-layer states independent", () => {
  const edges: Record<string, Array<[number, number, number, number[]]>> = {
    "0:0": [[1, 2, 1, []], [2, 2, 1, []], [5, 4, 1, []]],
    "1:2": [[2, 0, 1, []], [3, 2, .1, [7]]],
    "2:2": [[1, 0, 1, []]],
    "2:0": [[0, 1, 1, []], [1, 2, 1, []], [5, 4, 1, []]],
    "1:0": [[0, 1, 1, []], [2, 2, 1, []], [5, 4, 1, []]],
    "5:4": [],
    "0:1": [[3, 1, 1, []]],
    "3:1": [],
    "3:2": [],
  }
  const run = (singleLayerRegionZero: boolean, goal: number, limit: number, blockedGoal: boolean): {result: Result; calls: string[]} => {
    const calls: string[] = []
    const solver = Object.create(ReachabilityProbe.prototype) as ReachabilityProbe
    Object.assign(solver, {
      state: {currentRouteId: 0, currentRouteNetId: 0},
      getRouteStartPortId: (): number => 0,
      getRouteEndPortId: (): number => goal,
      getStartingNextRegionId: (): number => 0,
      getPortOwners: (): Map<number, ReadonlySet<number>> => new Map(),
      getHopId: (port: number, region: number): number => port * 10 + region,
      isKnownSingleLayerRegion: (region: number): boolean => region !== 0 && region !== 4 || singleLayerRegionZero && region === 0,
      getRelaxedSearchExpansionLimit: (): number => limit,
      getRelaxedSearchHops: (params: {state: State}): Hop[] => {
        const key = `${params.state.portId}:${params.state.nextRegionId}`
        calls.push(key)
        const entries = edges[key]
        if (!entries) throw new Error(`Unexpected state ${key}`)
        return entries.filter(([port]): boolean => !blockedGoal || port !== 3).map(([portId, nextRegionId, distance, owners]): Hop => ({state: {portId, nextRegionId}, distance, owners, data: {resources: []}}))
      },
    })
    return {result: solver.run(), calls}
  }
  // The owner-free route must return through first source 0 from a second
  // source in region 0. Otherwise the short one-owner route wins incorrectly.
  const goal = run(false, 3, Infinity, false).result
  expect(goal.found).toBe(true)
  if (!goal.found) throw new Error("Expected owner-free route")
  expect(goal.owners.size).toBe(0)
  expect(goal.distance).toBe(4)
  expect(goal.states.map((state): number => state.portId)).toEqual([0, 1, 2, 0, 3])
  const grouped = run(false, 99, 1, false)
  const singleLayer = run(true, 99, 1, false)
  expect(grouped.calls.filter((key): boolean => key.endsWith(":0"))).toEqual(["0:0", "2:0"])
  expect(singleLayer.calls.filter((key): boolean => key.endsWith(":0"))).toEqual(["0:0", "2:0", "1:0"])
  expect(grouped.calls.filter((key): boolean => key === "5:4")).toEqual(["5:4"])
  expect(grouped.result).toEqual({found: false, reason: "expansion_limit", expandedLabelCount: 1})
  expect(run(false, 3, Infinity, true).result.found).toBe(false)
  const immediate = run(false, 0, 0, false)
  expect(immediate.result.found).toBe(true)
  expect(immediate.calls).toEqual([])
})
