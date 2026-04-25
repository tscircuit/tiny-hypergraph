import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/index"

test("loadSerializedHyperGraph offsets serialized port coordinates by z layer", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "left",
        pointIds: ["p0"],
        d: { bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 } },
      },
      {
        regionId: "right",
        pointIds: ["p0"],
        d: { bounds: { minX: 1, maxX: 2, minY: 0, maxY: 1 } },
      },
    ],
    ports: [
      {
        portId: "p0",
        region1Id: "left",
        region2Id: "right",
        d: { x: 1, y: 0.5, z: 2 },
      },
    ],
    connections: [],
  }

  const { topology, problem } = loadSerializedHyperGraph(graph)

  expect(topology.portX[0]).toBeCloseTo(1.01)
  expect(topology.portY[0]).toBeCloseTo(0.51)
  expect(topology.portZ[0]).toBe(2)
  expect(topology.portAngleForRegion1[0]).toBe(4590)
  expect(topology.portAngleForRegion2?.[0]).toBe(22410)

  const solver = new TinyHyperGraphSolver(topology, problem)
  const portCircle = (solver.visualize().circles ?? []).find((circle) =>
    circle.label?.includes("port: p0"),
  )

  expect(portCircle?.center.x).toBeCloseTo(1.01)
  expect(portCircle?.center.y).toBeCloseTo(0.51)
})
