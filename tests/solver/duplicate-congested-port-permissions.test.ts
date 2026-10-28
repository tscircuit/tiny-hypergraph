import { expect, test } from "bun:test"
import { DuplicateCongestedPortSolver } from "../../lib/DuplicateCongestedPortSolver"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createSerializedPermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("independent duplication estimates and cloned ports retain their sole owner while foreign routes use another layer", () => {
  const input = createSerializedPermissionFixture(["net-a", "net-b", "net-c"])
  input.connections![1]!.mutuallyConnectedNetworkId = "net-a"
  const duplicate = new DuplicateCongestedPortSolver(input,
    { routeSolveOptions: permissionSolveOptions })
  duplicate.solve()
  expect(duplicate.failed).toBe(false)
  expect(duplicate.solved).toBe(true)
  expect(duplicate.report.portUseCounts.restricted).toBe(2)
  expect(duplicate.report.portUseCounts.detour).toBe(1)
  expect(duplicate.report.duplicatedPorts).toContainEqual({ sourcePortId: "restricted", duplicatePortIds: ["restricted::dup1"], useCount: 2 })
  const graph = duplicate.getOutput()
  const cloned = graph.ports.find((port) => port.portId === "restricted::dup1")!
  expect(cloned.d?.allowedNetId).toBe("net-a")
  const loaded = loadSerializedHyperGraph(graph)
  const cloneIndex = graph.ports.indexOf(cloned)
  expect(loaded.problem.portNetId?.[cloneIndex]).toBe(0)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, permissionSolveOptions)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const foreignRoute = solver.getOutput().solvedRoutes?.find((route) => route.connection.mutuallyConnectedNetworkId === "net-c")!
  expect(foreignRoute.path.map((point) => point.portId)).toEqual(["start-net-c", "detour", "end-net-c"])
})
