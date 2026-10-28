import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("same-owner, clear and different-layer copper preserve the ordinary final-hop policy and steps", () => {
  for (const segment of [
    createFixedCopperSegment({netId: 0, z: 1, x1: 1.5, x2: 1.5}),
    createFixedCopperSegment({z: 1, x1: 1.5, x2: 1.5, y1: 2, y2: 3}),
    createFixedCopperSegment({z: 2, x1: 1.5, x2: 1.5}),
  ]) {
    const plain = new TinyHyperGraphSolver(createFixedCopperTopology(), createFixedCopperProblem())
    const problem = createFixedCopperProblem([])
    problem.fixedCopperSegmentsByRegion = [[], [], [segment], []]
    const fixed = new TinyHyperGraphSolver(createFixedCopperTopology(), problem)
    plain.solve()
    fixed.solve()
    expect(fixed.solved).toBe(true)
    expect(fixed.state.regionSegments).toEqual(plain.state.regionSegments)
    expect(fixed.state.regionIntersectionCaches).toEqual(plain.state.regionIntersectionCaches)
    expect(fixed.state.portAssignment).toEqual(plain.state.portAssignment)
    expect(fixed.state.ripCount).toBe(plain.state.ripCount)
    expect(fixed.iterations).toBe(plain.iterations)
    expect(fixed.stats.fixedCopperPenalizedCandidateEvaluations).toBeUndefined()
  }
})
