import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("native and prepared searches choose an existing clear exit layer over a foreign fixed chord", () => {
  for (const Solver of [DistanceAwareTinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    const legacy = new Solver(createFixedCopperTopology(), createFixedCopperProblem())
    const fixed = new Solver(createFixedCopperTopology(), createFixedCopperProblem([createFixedCopperSegment()]))
    legacy.solve()
    fixed.solve()
    expect(legacy.solved).toBe(true)
    expect(fixed.solved).toBe(true)
    expect(legacy.failed).toBe(false)
    expect(fixed.failed).toBe(false)
    expect(legacy.state.regionSegments[1][0].slice(1)).toEqual([0, 1])
    expect(fixed.state.regionSegments[1][0].slice(1)).toEqual([0, 2])
    expect(fixed.stats.fixedCopperPenalizedCandidateEvaluations).toBeGreaterThan(0)
    expect(fixed.stats.fixedCopperCandidatePenaltySum).toBeGreaterThan(0)
    expect(fixed.MAX_ITERATIONS).toBe(legacy.MAX_ITERATIONS)
    expect(fixed.GREEDY_FINAL_ROUTE_ITERS).toBe(legacy.GREEDY_FINAL_ROUTE_ITERS)
  }
})
