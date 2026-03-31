import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

test("loadSerializedHyperGraph maps region availableZ arrays into layer masks", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "single-layer",
        pointIds: [],
        d: {
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          availableZ: [0],
        },
      },
      {
        regionId: "inner-layers",
        pointIds: [],
        d: {
          center: { x: 1, y: 0 },
          width: 1,
          height: 1,
          availableZ: [1, 2],
        },
      },
      {
        regionId: "unknown",
        pointIds: [],
        d: {
          center: { x: 2, y: 0 },
          width: 1,
          height: 1,
        },
      },
    ],
    ports: [],
    connections: [],
  }

  const { topology } = loadSerializedHyperGraph(graph)

  expect(Array.from(topology.regionAvailableZMask ?? [])).toEqual([
    1 << 0,
    (1 << 1) | (1 << 2),
    0,
  ])
})
