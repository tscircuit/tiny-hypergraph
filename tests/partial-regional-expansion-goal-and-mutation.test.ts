import { expect, test } from "bun:test"
import {
  createPartialRegionalGraph,
  createRecordedRegionalSolver,
} from "./fixtures/partial-regional-graph"

test("partial search preserves goals and fails on mutation", (): void => {
  const directGraph = createPartialRegionalGraph({ seed: 1 })
  directGraph.problem.routeEndPort[0] = 1
  const direct = createRecordedRegionalSolver({
    graph: directGraph,
    partial: true,
  })
  direct.step()
  expect(direct.partialRegionalExpansionStats.preparedParents).toBe(0)
  expect(direct.state.currentRouteId).toBe(0)
  const queued = direct.state.candidateQueue.toArray()
  expect(queued.some((entry) => entry.portId === 1)).toBe(true)

  const graph = createPartialRegionalGraph({ seed: 11 })
  const solver = createRecordedRegionalSolver({ graph, partial: true })
  solver.step()
  solver.topology.regionIncidentPorts[0] = [
    ...solver.topology.regionIncidentPorts[0],
  ]
  expect(() => solver._step()).toThrow("Regional topology changed")
})
