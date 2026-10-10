import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

test("loads connected copper layers only when a net and available layers prove the connection", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "pad",
        pointIds: [],
        d: {
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          availableZ: [0, 1],
          connectedZ: [0, 1],
          netId: 0,
        },
      },
    ],
    ports: [],
    connections: [],
  }
  expect(
    Array.from(loadSerializedHyperGraph(graph).topology.regionConnectedZMask!),
  ).toEqual([3])
  graph.regions[0]!.d.netId = -1
  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    "connected copper without a net",
  )
  graph.regions[0]!.d.netId = 0
  graph.regions[0]!.d.connectedZ = [0, 2]
  expect(() => loadSerializedHyperGraph(graph)).toThrow(
    "connects unavailable layers",
  )
})
