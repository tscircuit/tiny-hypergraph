import { expect, test } from "bun:test"
import { IndexedCandidateHeap } from "../lib/indexed-candidate-heap"
import {
  createPartialRegionalGraph,
  createRecordedRegionalSolver,
} from "./fixtures/partial-regional-graph"

test("tickets preserve closure, epochs and charged steps", (): void => {
  const graph = createPartialRegionalGraph({ seed: 7 })
  const solver = createRecordedRegionalSolver({ graph, partial: true })
  solver.step()
  const queue = solver.state.candidateQueue
  expect(queue).toBeInstanceOf(IndexedCandidateHeap)
  expect(solver.iterations).toBe(1)
  expect(solver["regionalExpansionQueue"].length).toBe(1)
  expect(queue.length).toBe(0)
  expect(queue.isClosedHopId?.(solver.getHopId(0, 0))).toBe(true)
  solver.step()
  expect(solver.iterations).toBe(2)
  expect(solver.partialRegionalExpansionStats.resumes).toBe(1)
  expect(queue.length).toBeGreaterThan(0)
  const previousParents = solver["regionalExpansionQueue"].toArray()
  queue.clear()
  solver.state.currentRouteId = undefined
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = [0]
  solver.state.candidateBestCostGeneration = 0xffffffff
  solver.step()
  expect(solver.state.candidateBestCostGeneration).toBe(1)
  expect(solver.partialRegionalExpansionStats.cancelledParents).toBeGreaterThan(
    0,
  )
  for (const ticket of solver["regionalExpansionQueue"].toArray()) {
    expect(previousParents).not.toContain(ticket)
  }
})
