import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { createFixedCopperProblem, createFixedCopperSegment, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

class FinalAttemptProbe extends TinyHyperGraphSolver {
  createFinalAttempt(): TinyHyperGraphSolver {
    return this.createGreedyFinalRouteSolver({ MAX_ITERATIONS: 50000 }, 0)
  }
}

test("ordinary and existing greedy final attempts price the final chord instead of accepting a blind goal shortcut", () => {
  for (const greedy of [false, true]) {
    const topology = createFixedCopperTopology()
    topology.portZ[3] = 0
    topology.regionWidth[2] = topology.regionHeight[2] = 2
    const problem = createFixedCopperProblem([])
    problem.fixedCopperSegmentsByRegion = [[], [], [createFixedCopperSegment({x1: 1.5, x2: 1.5})], []]
    const parent = new FinalAttemptProbe(topology, problem)
    const solver = greedy ? parent.createFinalAttempt() : new TinyHyperGraphSolver(topology, problem)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.state.regionSegments[1][0].slice(1)).toEqual([0, 2])
    expect(solver.stats.fixedCopperPenalizedCandidateEvaluations).toBeGreaterThan(0)
    expect(solver.MAX_ITERATIONS).toBe(greedy ? 50000 : 1000000)
  }
})
