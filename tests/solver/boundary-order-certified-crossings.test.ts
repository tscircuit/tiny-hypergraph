import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { isViaFreePlanarHopAllowed } from "../../lib/viaFreePlanarCrossings"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

test("same-side alternating paths need an explicit complete boundary-order guarantee", () => {
  const { topology, problem } = createSingleLayerCompletionFixture(7, false, new Set())
  topology.portX.set([-1, 1, -1, 1])
  topology.portY.set([-0.5, 0.5, 0.5, -0.5])
  const allows = () => isViaFreePlanarHopAllowed(topology, problem, [[[0, 0, 1]]], 0, 2, 3, 1)
  expect(allows()).toBe(true)
  problem.regionBoundaryPortOrderPreserved = new Uint8Array(8)
  expect(allows()).toBe(true)
  problem.regionBoundaryPortOrderPreserved[0] = 1
  expect(allows()).toBe(false)
  // Every order-preserving redistribution of these two sides stays alternating.
  for (const coordinates of [[-0.9, 0.1, 0.8, -0.2], [-0.1, 0.95, 0.1, -0.95]]) {
    topology.portY.set(coordinates)
    expect(allows()).toBe(false)
  }
  for (const owners of [new Set([0]), new Set([1])]) {
    problem.regionLayerChangeAllowedNetIds![0] = owners
    expect(allows()).toBe(true)
  }
  problem.regionLayerChangeAllowedNetIds![0] = new Set()
  topology.portY[2] = 1 // Corner stays unproven even with the order guarantee.
  expect(allows()).toBe(true)
  topology.portY[2] = 0.5
  topology.portX[2] = -0.99
  expect(allows()).toBe(true)
  for (const invalid of [new Uint8Array(1), new Uint8Array(8).fill(2), new Int8Array(8), [true]]) {
    expect(() => new TinyHyperGraphSolver(topology, { ...problem, regionBoundaryPortOrderPreserved: invalid as never })).toThrow("boolean byte")
  }
})
