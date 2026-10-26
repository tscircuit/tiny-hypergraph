import { expect, test } from "bun:test"
import { type Candidate, DistanceAwareTinyHyperGraphSolver } from "../lib/index"
import {
  createPartialRegionalGraph,
  createRecordedRegionalSolver,
  getIndependentRegionalCost,
} from "./fixtures/partial-regional-graph"

class CustomRegionalCostSolver extends DistanceAwareTinyHyperGraphSolver {
  override computeG(candidate: Candidate, portId: number): number {
    return super.computeG(candidate, portId) + 0.125
  }
}

test("partial search respects cost contracts and finite ties", (): void => {
  for (const partial of [false, true]) {
    const graph = createPartialRegionalGraph({ seed: 31 })
    const solver = new CustomRegionalCostSolver(graph.topology, graph.problem, {
      PARTIAL_REGIONAL_EXPANSION: partial,
      OWNED_REGIONAL_HOP_FRONTIER: true,
      STATIC_REACHABILITY_PRECHECK: false,
    })
    solver.step()
    expect(solver.partialRegionalExpansionStats.preparedParents).toBe(0)
    expect(solver.state.candidateQueue.length).toBeGreaterThan(0)
  }
  const tied = createPartialRegionalGraph({ seed: 41 })
  tied.topology.portX.fill(0)
  tied.topology.portY.fill(0)
  tied.problem.portPenalty!.fill(0)
  const tiedSolver = createRecordedRegionalSolver({ graph: tied, partial: true })
  tiedSolver.solve()
  expect(tiedSolver.completedCosts[0]).toBe(getIndependentRegionalCost(tied))
  expect(tiedSolver.solved).toBe(true)

  const capped = createRecordedRegionalSolver({
    graph: createPartialRegionalGraph({ seed: 59 }),
    partial: true,
  })
  capped.MAX_ITERATIONS = 2
  capped.solve()
  expect(capped.failed).toBe(true)
  expect(capped.partialRegionalExpansionStats.resumes).toBeLessThanOrEqual(1)
  expect(capped.iterations).toBeLessThanOrEqual(3)
})
