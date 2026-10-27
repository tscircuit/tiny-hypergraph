import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { ParallelRegionCosts } from "../../lib/parallel/ParallelRegionCosts"
import { createEmptyRegionIntersectionCache } from "../../lib/core"
import type { RegionIntersectionCache } from "../../lib/types"
import { createParallelFixture } from "./fixture"

const waitForTable = async (costs: ParallelRegionCosts, cache: RegionIntersectionCache, net: number): Promise<void> => {
  const deadline = performance.now() + 10_000
  do {
    costs.prepare(0, net, cache)
    if (costs.entries[0]?.cache === cache && costs.entries[0]?.ready && costs.entries[0]?.activeNetId === net) return
    if (performance.now() > deadline) throw new Error("Test worker did not publish a table")
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  } while (true)
}

test("tables reject stale caches and only reuse the same-net exclusion when equivalent", async (): Promise<void> => {
  const solver = createParallelFixture()
  const costs = new ParallelRegionCosts(solver.topology, 0.3, 0)
  const runtime = new SolverRuntime({ workerCount: 3, workerUrl: new URL("./worker.ts", import.meta.url), requireWorker: true })
  const cache = {
    ...createEmptyRegionIntersectionCache(), netIds: Int32Array.from([7]),
    lesserAngles: Int32Array.from([5000]), greaterAngles: Int32Array.from([25000]),
    layerMasks: Int32Array.from([1]), existingSegmentCount: 1,
  }
  try {
    await costs.start(runtime)
    await waitForTable(costs, cache, 1)
    const version = costs.entries[0]!.version
    costs.prepare(0, 2, cache)
    expect(costs.entries[0]!.version).toBe(version)
    expect(costs.getReadyRow(0, 0, cache, 2)).toBeGreaterThanOrEqual(0)
    expect(costs.getReadyRow(0, 0, cache, 1)).toBe(-1)
    costs.prepare(0, 7, cache)
    expect(costs.entries[0]!.version).toBeGreaterThan(version)
    expect(costs.getReadyRow(0, 0, cache, 7)).toBe(-1)
    const replaced = { ...cache, existingSameLayerIntersections: 2 }
    expect(costs.getReadyRow(0, 0, replaced, 7)).toBe(-1)
    await waitForTable(costs, replaced, 7)
    expect(costs.getReadyRow(0, 0, replaced, 7)).toBeGreaterThanOrEqual(0)
    expect(costs.getReadyRow(0, 0, cache, 7)).toBe(-1)
  } finally {
    await costs.close()
    await runtime.dispose()
  }
})
