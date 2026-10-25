import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath } from "lib/find-distinct-owner-blocker-path"
import { inspectRelaxedBlockerReachability } from "lib/selective-rerip/inspectRelaxedBlockerReachability"
import type { RelaxedSearchHop, RelaxedSearchState } from "lib/selective-rerip/relaxedBlockerSearchTypes"
import type { PortId } from "lib/types"
import { createBlockerReachabilityFixture } from "./fixtures/createBlockerReachabilityFixture"

test("rerip traversal upgrades owned boundaries before computing the weighted owner bound", (): void => {
  const { solver, topology } = createBlockerReachabilityFixture()
  topology.regionAvailableZMask = new Int32Array(topology.regionCount).fill(1)
  const graph: RelaxedSearchHop[][] = [
    [
      { state: { portId: 1, nextRegionId: 0 }, distance: 1, owners: [0], data: { resources: [] } },
      { state: { portId: 2, nextRegionId: 0 }, distance: 10, owners: [], data: { resources: [] } },
    ],
    [{ state: { portId: 3, nextRegionId: 0 }, distance: 1, owners: [], data: { resources: [] } }],
    [{ state: { portId: 1, nextRegionId: 0 }, distance: 1, owners: [], data: { resources: [] } }],
    [],
  ]
  const visits: PortId[] = []
  const context = {
    solver,
    goalPortId: 3,
    getHops: (state: RelaxedSearchState): RelaxedSearchHop[] => {
      visits.push(state.portId)
      return graph[state.portId]!
    },
    getHopTemplates: (): RelaxedSearchHop[] => {
      throw new Error("Single-layer traversal must inspect directed hops")
    },
  }
  const start: RelaxedSearchState = { portId: 0, nextRegionId: 0 }
  const reachability = inspectRelaxedBlockerReachability(
    { start, maxExpandedStates: Infinity }, context,
  )
  expect(reachability).toEqual({ kind: "reachable", minimumOwnerCount: 0 })
  expect(visits).toEqual([0, 2, 1])
  const result = findDistinctOwnerBlockerPath({
    start,
    getStateKey: (state): PortId => state.portId,
    isGoal: (state): boolean => state.portId === 3,
    getHops: (state): RelaxedSearchHop[] => graph[state.portId]!,
    minimumOwnerCount: 0,
  })
  expect(result.found).toBe(true)
  if (!result.found) throw new Error(result.reason)
  expect(result.distance).toBe(12)
  expect(result.owners.size).toBe(0)
  graph[1]![0]!.owners = [1]
  for (let maxExpandedStates = 0; maxExpandedStates <= 4; maxExpandedStates++) {
    visits.length = 0
    const unreachable = inspectRelaxedBlockerReachability(
      { start, maxExpandedStates }, { ...context, goalPortId: 4 },
    )
    expect(new Set(visits).size).toBe(visits.length)
    expect(unreachable).toEqual(maxExpandedStates < 4
      ? { kind: "incomplete", minimumOwnerCount: maxExpandedStates < 3 ? 0 : 1 }
      : { kind: "disconnected", expandedStateCount: 4 })
  }
})
