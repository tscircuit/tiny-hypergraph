import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

test("shared-port routing retains exact region identities and solved-route exceptions", () => {
  const regionIds = ["a", "b:c", "a:b", "c", "hub", "self", "", "__proto__"]
  const graph: SerializedHyperGraph = {
    regions: regionIds.map((regionId, index) => ({
      regionId,
      pointIds: [],
      d: { center: { x: index, y: 0 }, width: 2, height: 2 },
    })),
    ports: [],
    connections: [],
    solvedRoutes: [],
  }
  const pairs = regionIds
    .filter((regionId) => regionId !== "hub")
    .map((regionId) => [regionId, "hub"])
    .concat([
      ["a", "b:c"],
      ["c", "a:b"],
      ["self", "self"],
      ["a", "b:c"],
    ])

  for (const [index, [region1Id, region2Id]] of pairs.entries()) {
    const portId = `port-${index === pairs.length - 1 ? 7 : index}`
    graph.ports.push({
      portId,
      region1Id,
      region2Id,
      d: { x: index / 10, y: 0, z: index % 2 },
    })
    for (const region of graph.regions) {
      if (region.regionId === region1Id || region.regionId === region2Id) {
        region.pointIds.push(portId)
      }
    }
  }

  for (const startRegionId of regionIds) {
    for (const endRegionId of regionIds) {
      const index = graph.connections!.length
      const connection = {
        connectionId: `c-${index}`,
        startRegionId,
        endRegionId,
      }
      graph.connections!.push(connection)
      if (index % 3 === 0) continue
      const portIds = [
        graph.regions.find((region) => region.regionId === startRegionId)!
          .pointIds[0],
        graph.regions.find((region) => region.regionId === endRegionId)!
          .pointIds[0],
      ].slice(0, index % 3)
      graph.solvedRoutes!.push({
        connection,
        requiredRip: false,
        path: portIds.map((portId, pathIndex) => ({
          portId,
          g: pathIndex,
          h: 0,
          f: pathIndex,
          hops: pathIndex,
          ripRequired: false,
          lastPortId: pathIndex > 0 ? portIds[pathIndex - 1] : undefined,
          lastRegionId: startRegionId,
          nextRegionId: endRegionId,
        })),
      })
    }
  }

  const original = structuredClone(graph)
  const expected = graph.connections!.filter((connection) => {
    const shared = graph.ports.filter(
      (port) =>
        (port.region1Id === connection.startRegionId &&
          port.region2Id === connection.endRegionId) ||
        (port.region2Id === connection.startRegionId &&
          port.region1Id === connection.endRegionId),
    )
    const route = graph.solvedRoutes!.find(
      (candidate) =>
        candidate.connection.connectionId === connection.connectionId,
    )
    return shared.length === 0 || (route?.path.length ?? 0) > 1
  })
  const loaded = loadSerializedHyperGraph(graph)

  expect(loaded.problem.routeMetadata).toEqual(expected)
  expect(loaded.problem.routeCount).toBe(expected.length)
  expect(loaded.solution.solvedRoutePathSegments).toHaveLength(expected.length)
  expect(loaded.topology.regionCount).toBe(regionIds.length)
  expect(loaded.topology.portCount).toBe(pairs.length)
  expect(graph).toEqual(original)
  for (const [index, metadata] of loaded.topology.regionMetadata!.entries()) {
    expect(
      Object.getOwnPropertyDescriptor(metadata, "serializedRegionId"),
    ).toEqual({
      value: regionIds[index],
      enumerable: false,
      configurable: true,
      writable: true,
    })
  }
})
