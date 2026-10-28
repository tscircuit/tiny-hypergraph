import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("malformed fixed copper inputs fail with named errors and unknown serialized owners never become free", () => {
  for (const override of [{width: -1}, {clearance: NaN}, {x1: Infinity}, {z: 0.5}, {netId: -2}]) {
    expect(() => new TinyHyperGraphSolver(createFixedCopperTopology(), createFixedCopperProblem([createFixedCopperSegment(override)]))).toThrow("Fixed copper")
  }
  const noWidths = createFixedCopperProblem([createFixedCopperSegment()])
  delete noWidths.fixedCopperTraceWidthByRegion
  expect(() => new TinyHyperGraphSolver(createFixedCopperTopology(), noWidths)).toThrow("must match regionCount")
  const solved = new TinyHyperGraphSolver(createFixedCopperTopology(), createFixedCopperProblem([createFixedCopperSegment()]))
  solved.solve()
  const output = solved.getOutput()
  const d = output.regions[1].d as Record<string, any>
  d.fixedCopperSegments[0].netId = "unrouted-owner"
  const loaded = loadSerializedHyperGraph(output)
  expect(loaded.problem.fixedCopperSegmentsByRegion?.[1][0].netId).toBe(-1)
  const unknown = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  expect(unknown.computeFixedCopperTransitionCost(1, 0, 1, 0)).toBeGreaterThan(0)
  d.fixedCopperSegments[0].netId = 0
  expect(() => loadSerializedHyperGraph(output)).toThrow("canonical string or null")
})
