import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("single-layer fixed contact remains a finite search preference even in degenerate or tiny mesh cells", () => {
  for (const side of [2, 0.01, 0]) {
    const topology = createFixedCopperTopology()
    topology.regionAvailableZMask!.fill(1)
    topology.portZ.fill(0)
    topology.regionWidth[1] = topology.regionHeight[1] = side
    // A finite short segment can be detoured physically; the chord cost is
    // deliberately not a statement that this single-layer pair is impossible.
    const problem = createFixedCopperProblem([createFixedCopperSegment({y1: -0.1, y2: 0.1})])
    const solver = new TinyHyperGraphSolver(topology, problem)
    const penalty = solver.computeFixedCopperTransitionCost(1, 0, 1, 0)
    expect(penalty).toBeGreaterThan(0)
    expect(Number.isFinite(penalty)).toBe(true)
    if (side > 0) {
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
    }
  }
})
