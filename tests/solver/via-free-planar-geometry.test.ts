import { expect, test } from "bun:test"
import { isViaFreePlanarHopAllowed, assertViaFreePlanarRouting } from "../../lib/viaFreePlanarCrossings"
import { createSingleLayerCompletionFixture } from "../fixtures/singleLayerCompletion.fixture"

test("physical crossing certificates require two via-free owners and four distinct open rectangle sides", () => {
  const fixture = () => createSingleLayerCompletionFixture(7, false, new Set())
  const allowed = (f: ReturnType<typeof fixture>) => isViaFreePlanarHopAllowed(f.topology, f.problem, [[[0, 0, 1]]], 0, 2, 3, 1)
  expect(allowed(fixture())).toBe(false)
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { delete f.problem.regionLayerChangeAllowedNetIds },
    (f: ReturnType<typeof fixture>) => { f.problem.regionLayerChangeAllowedNetIds![0] = new Set([0]) },
    (f: ReturnType<typeof fixture>) => { f.problem.regionLayerChangeAllowedNetIds![0] = new Set([1]) },
    (f: ReturnType<typeof fixture>) => { f.problem.routeNet[0] = 1 },
    (f: ReturnType<typeof fixture>) => { f.topology.portZ[0] = 1; f.topology.portZ[1] = 1 },
    (f: ReturnType<typeof fixture>) => { f.topology.portZ[0] = 1 },
    (f: ReturnType<typeof fixture>) => { f.topology.portZ[2] = -1; f.topology.portZ[3] = -1 },
    (f: ReturnType<typeof fixture>) => { f.topology.portY[2] = 0.99 },
    (f: ReturnType<typeof fixture>) => { f.topology.portY[2] = 1.012584 },
    (f: ReturnType<typeof fixture>) => { f.topology.portX[2] = 1 }, // Corner.
    (f: ReturnType<typeof fixture>) => { f.topology.portX[2] = NaN },
    (f: ReturnType<typeof fixture>) => { f.topology.regionWidth[0] = 0 },
  ]) {
    const f = fixture()
    mutate(f)
    expect(allowed(f)).toBe(true)
  }
  // These strict crossings have two endpoints on the same side. The caller may
  // redistribute edge ports, so their apparent alternating order is unproven.
  const sameSide = fixture()
  sameSide.topology.portX.set([-1, 1, -1, 0])
  sameSide.topology.portY.set([-0.5, 0, 0.5, -1])
  expect(allowed(sameSide)).toBe(true)
  const uncertain = fixture()
  uncertain.topology.regionCenterX[0] = 1e15
  uncertain.topology.regionCenterY[0] = 1e15
  uncertain.topology.regionWidth[0] = 100
  uncertain.topology.regionHeight[0] = 100
  uncertain.topology.portX.set([1e15 - 45, 1e15 + 45, 1e15, 1e15])
  uncertain.topology.portY.set([1e15, 1e15, 1e15 + 45, 1e15 - 45])
  expect(allowed(uncertain)).toBe(true)
  const tangent = fixture()
  tangent.topology.portX[2] = -1
  tangent.topology.portY[2] = 0
  expect(allowed(tangent)).toBe(true)
  const crossed = fixture()
  expect(() => assertViaFreePlanarRouting(crossed.topology, crossed.problem, [[[0, 0, 1], [1, 2, 3]]])).toThrow("cannot change layers")
})
