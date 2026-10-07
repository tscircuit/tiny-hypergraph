import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

test("loadSerializedHyperGraph does not rescan every port for each connection", () => {
  const portCount = 100
  const connectionCount = 50
  let indexedPortReads = 0
  const ports = new Proxy(
    Array.from({ length: portCount }, (_, index) => ({
      portId: `port-${index}`,
      region1Id: "region-a",
      region2Id: "region-b",
      d: { x: index, y: 0, z: 0 },
    })),
    {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          indexedPortReads += 1
        }
        return Reflect.get(target, property, receiver)
      },
    },
  )
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "region-a",
        pointIds: ports.map((port) => port.portId),
        d: { center: { x: 0, y: 0 }, width: 1, height: 1 },
      },
      {
        regionId: "region-b",
        pointIds: ports.map((port) => port.portId),
        d: { center: { x: 1, y: 0 }, width: 1, height: 1 },
      },
    ],
    ports,
    connections: Array.from({ length: connectionCount }, (_, index) => ({
      connectionId: `connection-${index}`,
      startRegionId: "region-a",
      endRegionId: "region-b",
    })),
  }

  const { problem } = loadSerializedHyperGraph(graph)

  expect(problem.routeCount).toBe(0)
  expect(indexedPortReads).toBeLessThan(portCount * 10)
})
