import { expect, test } from "bun:test"
import {
  createPartialRegionalGraph,
  createRecordedRegionalSolver,
  getIndependentRegionalCost,
} from "./fixtures/partial-regional-graph"

test("partial successors match independent shortest costs", (): void => {
  for (let seed = 1; seed <= 32; seed++) {
    const graph = createPartialRegionalGraph({ seed })
    const expected = getIndependentRegionalCost(graph)
    for (const partial of [false, true]) {
      const solver = createRecordedRegionalSolver({ graph, partial })
      solver.solve()
      expect(solver.failed).toBe(false)
      expect(solver.solved).toBe(true)
      expect(solver.completedCosts).toHaveLength(1)
      expect(solver.completedCosts[0]).toBeCloseTo(expected, 9)
      if (partial) {
        expect(
          solver.partialRegionalExpansionStats.preparedParents,
        ).toBeGreaterThan(0)
        expect(solver.partialRegionalExpansionStats.resumes).toBeGreaterThan(0)
        expect(solver["regionalExpansionQueue"].length).toBe(0)
      }
    }
  }
})
