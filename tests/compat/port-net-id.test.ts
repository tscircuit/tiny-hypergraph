import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "../../lib/core"
import { createNativePermissionFixture, createSerializedPermissionFixture, permissionSolveOptions } from "../fixtures/portPermissions.fixture"

test("singular canonical permissions retain inactive owners without allocating or renumbering native route nets", () => {
  const knownGraph = createSerializedPermissionFixture(["net-a", "net-b", "net-c"])
  knownGraph.ports[1]!.d!.allowedNetId = "net-b"
  const known = loadSerializedHyperGraph(knownGraph)
  expect([...known.problem.routeNet]).toEqual([0, 1, 2])
  expect(known.problem.portNetId?.[0]).toBe(0)
  expect(known.problem.portNetId?.[1]).toBe(1)
  expect(loadSerializedHyperGraph(createSerializedPermissionFixture()).problem.portNetId?.[1]).toBe(-1)

  const ownerOnly = createSerializedPermissionFixture(["net-c"])
  const loaded = loadSerializedHyperGraph(ownerOnly)
  expect([...loaded.problem.routeNet]).toEqual([0])
  expect(loaded.problem.portNetId?.[0]).toBe(-2)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, permissionSolveOptions)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  expect(output.solvedRoutes?.[0]?.path.map((point) => point.portId)).toEqual(["start-net-c", "detour", "end-net-c"])
  expect(output.ports.find((port) => port.portId === "restricted")?.d?.allowedNetId).toBe("net-a")
  expect(loadSerializedHyperGraph(output).problem.portNetId?.[0]).toBe(-2)
  const ownerBecomesRoutable = structuredClone(output)
  ownerBecomesRoutable.connections!.push({
    connectionId: "new-owner-route", mutuallyConnectedNetworkId: "net-a",
    startRegionId: "start-region-net-c", endRegionId: "end-region-net-c",
  })
  const expandedOwners = loadSerializedHyperGraph(ownerBecomesRoutable)
  expect([...expandedOwners.problem.routeNet]).toEqual([0, 1])
  expect(expandedOwners.problem.portNetId?.[0]).toBe(1)
  loaded.problem.portNetId![0] = 99
  expect(() => solver.getOutput()).toThrow()

  const filteredOwner = createSerializedPermissionFixture(["net-c"])
  filteredOwner.connections!.unshift({
    connectionId: "unroutable-owner-connection",
    mutuallyConnectedNetworkId: "net-a",
    startRegionId: "left",
    endRegionId: "right",
  })
  for (const region of filteredOwner.regions) {
    if (region.regionId === "left" || region.regionId === "right") region.d!.netId = -1
  }
  const filteredLoaded = loadSerializedHyperGraph(filteredOwner)
  expect(filteredLoaded.problem.routeCount).toBe(1)
  expect([...filteredLoaded.problem.routeNet]).toEqual([1])
  expect(filteredLoaded.problem.portNetId?.[0]).toBe(-2)
  const filteredSolver = new TinyHyperGraphSolver(filteredLoaded.topology, filteredLoaded.problem, permissionSolveOptions)
  filteredSolver.solve()
  expect(filteredSolver.solved).toBe(true)
  const filteredOutput = filteredSolver.getOutput()
  expect(filteredOutput.ports[0]!.d?.allowedNetId).toBe("net-a")
  expect(loadSerializedHyperGraph(filteredOutput).problem.portNetId?.[0]).toBe(-2)

  const blocked = createSerializedPermissionFixture(["net-c"])
  blocked.ports[0]!.d!.allowedNetId = null
  expect(loadSerializedHyperGraph(blocked).problem.portNetId?.[0]).toBe(-2)
  for (const invalid of ["", 0, false, [], ["net-a"], {}]) {
    const graph = createSerializedPermissionFixture()
    graph.ports[0]!.d!.allowedNetId = invalid
    expect(() => loadSerializedHyperGraph(graph)).toThrow()
  }
  const unrestricted = createSerializedPermissionFixture()
  delete unrestricted.ports[0]!.d!.allowedNetId
  expect(loadSerializedHyperGraph(unrestricted).problem.portNetId).toBeUndefined()
  const numeric = createNativePermissionFixture()
  const numericSolver = new TinyHyperGraphSolver(numeric.topology, numeric.problem, permissionSolveOptions)
  numericSolver.solve()
  const numericOutput = numericSolver.getOutput()
  expect(numericOutput.ports[1]!.d?.allowedNetId).toBe("net-0")
  expect(loadSerializedHyperGraph(numericOutput).problem.portNetId?.[1]).toBe(0)
  numeric.problem.portNetId![1] = 99
  expect(() => numericSolver.getOutput()).toThrow()

  const numericBlocked = createNativePermissionFixture()
  numericBlocked.problem.portNetId![1] = -2
  const numericBlockedSolver = new TinyHyperGraphSolver(numericBlocked.topology, numericBlocked.problem, permissionSolveOptions)
  numericBlockedSolver.solve()
  expect(numericBlockedSolver.solved).toBe(true)
  const numericBlockedOutput = numericBlockedSolver.getOutput()
  expect(numericBlockedOutput.ports[1]!.d?.allowedNetId).toBeNull()
  expect(loadSerializedHyperGraph(numericBlockedOutput).problem.portNetId?.[1]).toBe(-2)

  const inconsistent = loadSerializedHyperGraph(createSerializedPermissionFixture(["net-a", "net-b"]))
  const inconsistentSolver = new TinyHyperGraphSolver(inconsistent.topology, inconsistent.problem, permissionSolveOptions)
  inconsistentSolver.solve()
  expect(inconsistentSolver.solved).toBe(true)
  inconsistent.problem.portNetId![0] = -2
  expect(() => inconsistentSolver.getOutput()).toThrow()
})
