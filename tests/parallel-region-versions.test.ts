import { expect, test } from "bun:test"
import { SharedRouteGraph } from "../lib/parallel/SharedRouteGraph"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"

test("snapshot versions cover assignments and congestion as well as segment caches", () => {
  const solver = createCompletionFixture(),
    graph = new SharedRouteGraph(solver)
  const versions = (): number[] =>
    Array.from(
      { length: solver.topology.regionCount },
      (_, r) => graph.context.headers[r * 8],
    )
  const initial = versions()
  graph.sync()
  expect(versions()).toEqual(initial)
  solver.state.portAssignment[4] = 1
  graph.sync()
  const assigned = versions()
  expect(assigned[0]).toBeGreaterThan(initial[0])
  expect(assigned[1]).toBeGreaterThan(initial[1])
  expect(assigned[2]).toBe(initial[2])
  solver.state.regionCongestionCost[2] += 1
  graph.sync()
  expect(versions()[2]).toBeGreaterThan(assigned[2])
  expect(graph.context.congestion[2]).toBe(solver.state.regionCongestionCost[2])
  expect(Atomics.load(graph.context.epoch, 0) % 2).toBe(0)
})
