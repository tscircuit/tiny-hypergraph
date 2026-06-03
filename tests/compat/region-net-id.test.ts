import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

const createRegion = (
  regionId: string,
  pointIds: string[],
  d: Record<string, unknown> = {},
): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: {
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    ...d,
  },
})

test("loadSerializedHyperGraph maps serialized region net ids into problem reservations", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion("lowercase", [], { netId: 7 }),
      createRegion("uppercase", [], { NetId: 3 }),
      createRegion("unreserved", []),
      createRegion("explicit-free", [], { netId: -1 }),
    ],
    ports: [],
    connections: [],
  }

  const { problem } = loadSerializedHyperGraph(graph)

  expect(Array.from(problem.regionNetId)).toEqual([7, 3, -1, -1])
})

test("serialized region net ids take precedence over endpoint net inference", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion("reserved-start", ["s0"], { netId: 42 }),
      createRegion("middle", ["s0", "t0", "s1", "t1"]),
      createRegion("reserved-end", ["t0"]),
      createRegion("free-start", ["s1"], { netId: -1 }),
      createRegion("free-end", ["t1"]),
    ],
    ports: [
      {
        portId: "s0",
        region1Id: "reserved-start",
        region2Id: "middle",
        d: { x: 0, y: 0, z: 0 },
      },
      {
        portId: "t0",
        region1Id: "middle",
        region2Id: "reserved-end",
        d: { x: 1, y: 0, z: 0 },
      },
      {
        portId: "s1",
        region1Id: "free-start",
        region2Id: "middle",
        d: { x: 0, y: 1, z: 0 },
      },
      {
        portId: "t1",
        region1Id: "middle",
        region2Id: "free-end",
        d: { x: 1, y: 1, z: 0 },
      },
    ],
    connections: [
      {
        connectionId: "reserved-route",
        mutuallyConnectedNetworkId: "net-0",
        startRegionId: "reserved-start",
        endRegionId: "reserved-end",
      },
      {
        connectionId: "free-route",
        mutuallyConnectedNetworkId: "net-1",
        startRegionId: "free-start",
        endRegionId: "free-end",
      },
    ],
  }

  const { problem } = loadSerializedHyperGraph(graph)

  expect(Array.from(problem.routeNet)).toEqual([0, 1])
  expect(Array.from(problem.regionNetId)).toEqual([42, -1, 0, -1, 1])
})

test("target obstacle regions without net ids are preserved as routable topology", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion("start", ["s"]),
      createRegion("target-obstacle", ["s", "t"], {
        _containsObstacle: true,
        _containsTarget: true,
      }),
      createRegion("end", ["t"]),
      createRegion("full-obstacle", ["blocked"], {
        _containsObstacle: true,
      }),
    ],
    ports: [
      {
        portId: "s",
        region1Id: "start",
        region2Id: "target-obstacle",
        d: { x: 0, y: 0, z: 0 },
      },
      {
        portId: "t",
        region1Id: "target-obstacle",
        region2Id: "end",
        d: { x: 1, y: 0, z: 0 },
      },
      {
        portId: "blocked",
        region1Id: "full-obstacle",
        region2Id: "target-obstacle",
        d: { x: 0.5, y: 0.5, z: 0 },
      },
    ],
    connections: [
      {
        connectionId: "through-target-obstacle",
        mutuallyConnectedNetworkId: "net-0",
        startRegionId: "start",
        endRegionId: "end",
      },
    ],
  }

  const { topology } = loadSerializedHyperGraph(graph)
  const serializedRegionIds = topology.regionMetadata?.map(
    (metadata) => metadata.serializedRegionId,
  )
  const serializedPortIds = topology.portMetadata?.map(
    (metadata) => metadata.serializedPortId,
  )

  expect(serializedRegionIds).toEqual(["start", "target-obstacle", "end"])
  expect(serializedPortIds).toEqual(["s", "t"])
})
