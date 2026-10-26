import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../lib/core"
import {
  createRegionCostProbeGraph,
  RegionCostProbe,
} from "./fixtures/region-cost-lookup"

class SeparateCountCostProbe extends RegionCostProbe {
  calls: number[][] = []

  protected override computeRegionCostForRegion(
    regionId: number,
    same: number,
    cross: number,
    entry: number,
    count: number,
  ): number {
    this.calls.push([regionId, same, cross, entry, count])
    return same ** 3 + cross ** 2 + entry * 13 + count * 17
  }
}

test("cost lookup preserves instance and global prototype custom model calls", (): void => {
  const graph = createRegionCostProbeGraph()
  const custom = new SeparateCountCostProbe(graph.topology, graph.problem, {
    USE_REGION_COST_LOOKUP: true,
  })
  custom.state.regionIntersectionCaches[0].existingSegmentCount = 4
  expect(custom.score(1, 2, 1)).toBe(103)
  expect(custom.calls).toEqual([[0, 1, 2, 1, 5]])

  const solver = new RegionCostProbe(graph.topology, graph.problem, {
    USE_REGION_COST_LOOKUP: true,
  })
  const originalValue = solver.score(0, 1, 0)
  const originalMethod =
    TinyHyperGraphSolver.prototype["computeRegionCostForRegion"]
  const calls: number[][] = []
  try {
    TinyHyperGraphSolver.prototype["computeRegionCostForRegion"] = (
      regionId,
      same,
      cross,
      entry,
      count,
    ): number => {
      calls.push([regionId, same, cross, entry, count])
      return 1000 + same * 3 + cross * 5 + entry * 7 + count * 11
    }
    expect(solver.score(0, 1, 0)).toBe(1016)
    expect(calls).toEqual([[0, 0, 1, 0, 1]])
  } finally {
    TinyHyperGraphSolver.prototype["computeRegionCostForRegion"] =
      originalMethod
  }
  expect(Object.is(solver.score(0, 1, 0), originalValue)).toBe(true)
})
