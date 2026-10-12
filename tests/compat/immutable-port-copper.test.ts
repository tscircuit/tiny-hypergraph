import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/core"
import { createImmutablePortCopperGraph } from "tests/fixtures/immutable-port-copper"

test("immutable port copper uses canonical nets without changing legacy topology", (): void => {
  const legacyGraph = createImmutablePortCopperGraph(["net-a", "net-b"])
  const legacy = loadSerializedHyperGraph(legacyGraph)
  expect(legacy.topology.portReservedNetId).toBeUndefined()
  const empty = loadSerializedHyperGraph(
    createImmutablePortCopperGraph(["net-a", "net-b"], []),
  )
  expect(empty.topology.portReservedNetId).toBeUndefined()
  expect(empty.problem).toEqual(legacy.problem)

  const loaded = loadSerializedHyperGraph(
    createImmutablePortCopperGraph(["net-a", "net-b"], ["net-a", "net-a"]),
  )
  const occupiedPort = loaded.topology.portCount - 2
  expect(loaded.topology.portReservedNetId?.[occupiedPort]).toBe(
    loaded.problem.routeNet[0],
  )
  expect(loaded.problem.routeNet).toEqual(legacy.problem.routeNet)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  expect(solver.problemSetup.portEndpointNetIds[occupiedPort]).toBeUndefined()
  expect(solver.problemSetup.portEndpointReservationNetId[occupiedPort]).toBe(
    loaded.problem.routeNet[0],
  )
  expect(loaded.topology.portReservedNetId?.[0]).toBe(-1)

  const immutableOnly = loadSerializedHyperGraph(
    createImmutablePortCopperGraph(["net-a", "net-b"], ["immutable-only"]),
  )
  expect(immutableOnly.topology.portReservedNetId?.[occupiedPort]).toBe(2)
  expect(immutableOnly.problem.routeNet).toEqual(legacy.problem.routeNet)
  const multiple = loadSerializedHyperGraph(
    createImmutablePortCopperGraph(["net-a", "net-b"], ["net-a", "net-b"]),
  )
  expect(multiple.topology.portReservedNetId?.[occupiedPort]).toBe(-2)

  for (const invalid of ["net-a", ["net-a", 1], null]) {
    const graph = createImmutablePortCopperGraph(["net-a"])
    graph.ports[graph.ports.length - 2]!.d.immutableCopperNetIds = invalid
    expect((): void => {
      loadSerializedHyperGraph(graph)
    }).toThrow('Port "occupied" has invalid immutable copper nets')
  }
})
