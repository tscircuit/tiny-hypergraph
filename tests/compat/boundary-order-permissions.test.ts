import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createSerializedPermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("boundary-order guarantees validate and roundtrip without allocating inactive owner nets", () => {
  const graph = createSerializedPermissionFixture()
  graph.regions[0].d!.boundaryPortOrderPreserved = true
  graph.regions[0].d!.layerChangeAllowedNetIds = ["inactive-owner"]
  graph.regions[1].d!.boundaryPortOrderPreserved = false
  const before = JSON.stringify(graph)
  const loaded = loadSerializedHyperGraph(graph)
  expect([...loaded.problem.routeNet]).toEqual([0])
  expect([...loaded.problem.regionBoundaryPortOrderPreserved!]).toEqual([1, 0, 0, 0])
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, permissionSolveOptions)
  solver.solve()
  expect(solver.solved && !solver.failed).toBe(true)
  const output = solver.getOutput()
  expect(output.regions[0].d!.boundaryPortOrderPreserved).toBe(true)
  expect(output.regions[0].d!.layerChangeAllowedNetIds).toEqual(["inactive-owner"])
  expect(output.regions[1].d!.boundaryPortOrderPreserved).toBe(false)
  expect([...loadSerializedHyperGraph(output).problem.regionBoundaryPortOrderPreserved!]).toEqual([1, 0, 0, 0])
  expect(JSON.stringify(graph)).toBe(before)
  for (const invalid of [null, "true", 1, {}, []]) {
    const bad = structuredClone(graph)
    bad.regions[0].d!.boundaryPortOrderPreserved = invalid
    expect(() => loadSerializedHyperGraph(bad)).toThrow("must be a boolean")
  }
})
