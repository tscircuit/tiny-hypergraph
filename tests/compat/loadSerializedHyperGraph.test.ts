import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import circuit149PortPointPathingConstructorParams from "../../bug-report/tiny-hypergraph-bugreport-08ca03f/circuit149.port-point-pathing-constructor-params.json"
import circuit158PortPointPathingConstructorParams from "../../bug-report/tiny-hypergraph-bugreport-08ca03f/circuit158.port-point-pathing-constructor-params.json"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"

type PortPointPathingConstructorParams = {
  graph: {
    regions: Array<{
      regionId: string
      d: Record<string, unknown>
      ports: Array<{
        portId: string
      }>
    }>
    ports: Array<{
      portId: string
      region1Id: string
      region2Id: string
      d: Record<string, unknown>
    }>
  }
  connections: SerializedHyperGraph["connections"]
}

const toSerializedHyperGraph = (
  params: PortPointPathingConstructorParams,
): SerializedHyperGraph => ({
  regions: params.graph.regions.map((region) => ({
    regionId: region.regionId,
    pointIds: region.ports.map((port) => port.portId),
    d: region.d,
  })),
  ports: params.graph.ports.map((port) => ({
    portId: port.portId,
    region1Id: port.region1Id,
    region2Id: port.region2Id,
    d: port.d,
  })),
  connections: params.connections,
  solvedRoutes: [],
})

const getRegionIndexBySerializedId = (
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"],
  serializedRegionId: string,
) =>
  (topology.regionMetadata ?? []).findIndex(
    (regionMetadata) => regionMetadata?.serializedRegionId === serializedRegionId,
  )

for (const [caseName, constructorParams] of [
  [
    "circuit149",
    circuit149PortPointPathingConstructorParams as PortPointPathingConstructorParams,
  ],
  [
    "circuit158",
    circuit158PortPointPathingConstructorParams as PortPointPathingConstructorParams,
  ],
] as const) {
  test(`loadSerializedHyperGraph allows shared endpoint regions for ${caseName}`, () => {
    const serializedHyperGraph = toSerializedHyperGraph(constructorParams)

    expect(() => loadSerializedHyperGraph(serializedHyperGraph)).not.toThrow()

    const { topology, problem } = loadSerializedHyperGraph(serializedHyperGraph)
    const regionToNets = new Map<string, Set<string>>()
    for (const connection of constructorParams.connections ?? []) {
      const netId =
        connection.mutuallyConnectedNetworkId ?? connection.connectionId
      for (const regionId of [connection.startRegionId, connection.endRegionId]) {
        const existingNetIds = regionToNets.get(regionId) ?? new Set<string>()
        existingNetIds.add(netId)
        regionToNets.set(regionId, existingNetIds)
      }
    }

    for (const [regionId, netIds] of regionToNets) {
      if (netIds.size <= 1) {
        continue
      }

      const regionIndex = getRegionIndexBySerializedId(topology, regionId)
      expect(regionIndex).toBeGreaterThanOrEqual(0)
      expect(problem.regionNetId[regionIndex]).toBe(-1)
    }
  })
}
