import { expect, test } from "bun:test"
import { RouteSnapshot } from "../lib/parallel/RouteSnapshot"
import { SharedRouteGraph } from "../lib/parallel/SharedRouteGraph"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"

test("a live worker refreshes unread regions but rejects any change to its prior read set", () => {
  const writer = createCompletionFixture()
  const observer = createCompletionFixture()
  const graph = new SharedRouteGraph(writer)
  const snapshot = new RouteSnapshot(observer, graph.context)
  expect(snapshot.refresh()).toBe(true)
  const readRegions = new Set([0])
  writer.state.portAssignment[7] = 99
  writer.state.regionCongestionCost[3] = 2
  graph.sync()
  expect(snapshot.refresh(readRegions)).toBe(true)
  expect(observer.state.portAssignment[7]).toBe(99)
  expect(observer.state.regionCongestionCost[3]).toBe(2)
  expect(snapshot.epoch).toBe(Atomics.load(graph.context.epoch, 0))
  const assignment = observer.state.portAssignment[0]
  const version = snapshot.versions[0]
  writer.state.portAssignment[0] = 123
  graph.sync()
  expect(snapshot.refresh(readRegions)).toBe(false)
  expect(observer.state.portAssignment[0]).toBe(assignment)
  expect(snapshot.versions[0]).toBe(version)
})
