import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createSerializedPermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("canonical region layer-change permissions preserve inactive owners and do not renumber routing nets", () => {
  const graph = createSerializedPermissionFixture(["net-a"])
  delete graph.ports[0]!.d!.allowedNetId
  graph.ports[0]!.d!.z = 1
  graph.ports[1]!.d!.z = 0
  graph.ports[3]!.d!.z = 1
  graph.regions.find((region) => region.regionId === "left")!.d!.layerChangeAllowedNetIds = ["inactive-owner"]
  const before = JSON.stringify(graph)
  const loaded = loadSerializedHyperGraph(graph)
  expect([...loaded.problem.routeNet]).toEqual([0])
  expect(loaded.problem.regionLayerChangeAllowedNetIds?.[0]?.size).toBe(0)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, permissionSolveOptions)
  solver.solve()
  expect(solver.solved && !solver.failed).toBe(true)
  const output = solver.getOutput()
  expect(output.solvedRoutes![0]!.path.map((point) => point.portId)).toEqual(["start-net-a", "detour", "end-net-a"])
  expect(output.regions.find((region) => region.regionId === "left")!.d!.layerChangeAllowedNetIds).toEqual(["inactive-owner"])
  expect(loadSerializedHyperGraph(output).problem.regionLayerChangeAllowedNetIds?.[0]?.size).toBe(0)
  expect(JSON.stringify(graph)).toBe(before)
  const owner = structuredClone(graph)
  owner.regions[0]!.d!.layerChangeAllowedNetIds = ["net-a"]
  const allowed = loadSerializedHyperGraph(owner)
  expect([...allowed.problem.regionLayerChangeAllowedNetIds![0]!]).toEqual([0])
  const ownerSolver = new TinyHyperGraphSolver(allowed.topology, allowed.problem, permissionSolveOptions)
  ownerSolver.solve()
  expect(ownerSolver.getOutput().solvedRoutes![0]!.path.map((point) => point.portId)).toEqual(["start-net-a", "restricted", "end-net-a"])
  allowed.problem.regionLayerChangeAllowedNetIds![0] = new Set()
  expect(() => ownerSolver.getOutput()).toThrow("disagree")
  for (const invalid of [null, 0, false, "net-a", [null], [""], [0]]) {
    const bad = structuredClone(graph)
    bad.regions[0]!.d!.layerChangeAllowedNetIds = invalid
    expect(() => loadSerializedHyperGraph(bad)).toThrow()
  }
})
