import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("fixed copper survives serialization and fresh replay while independent problem reset clears old geometry", () => {
  const topology = createFixedCopperTopology()
  const first = new TinyHyperGraphSolver(topology, createFixedCopperProblem([createFixedCopperSegment({netId: 0}), createFixedCopperSegment({netId: -1})]))
  first.solve()
  const output = first.getOutput()
  const loaded = loadSerializedHyperGraph(output)
  expect(loaded.problem.fixedCopperSegmentsByRegion?.[1].map(s => s.netId)).toEqual([0, -1])
  expect(loaded.problem.fixedCopperSegmentsByRegion?.[1].map(s => s.width)).toEqual([0.1, 0.1])
  expect(loaded.problem.fixedCopperTraceWidthByRegion?.[1]).toBe(0.1)
  const replay = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  expect(replay.computeFixedCopperTransitionCost(1, 0, 1, 0)).toBeGreaterThan(0)
  replay.solve()
  expect(replay.solved).toBe(true)
  first.resetForProblem(createFixedCopperProblem())
  expect(first.computeFixedCopperTransitionCost(1, 0, 1, 0)).toBe(0)
  first.solve()
  expect(first.getOutput().regions.every(region => region.d?.fixedCopperSegments === undefined)).toBe(true)
  const fresh = new TinyHyperGraphSolver(topology, createFixedCopperProblem())
  fresh.solve()
  expect(first.getOutput()).toEqual(fresh.getOutput())
  expect(first.iterations).toBe(fresh.iterations)
  expect(first.stats).toEqual(fresh.stats)
})
