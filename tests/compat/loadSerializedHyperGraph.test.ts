import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

const getRegionIndexBySerializedId = (
  regionMetadata: any[] | undefined,
  serializedRegionId: string,
) =>
  regionMetadata?.findIndex(
    (metadata) => metadata?.serializedRegionId === serializedRegionId,
  ) ?? -1

test("loadSerializedHyperGraph removes full-obstacle regions and attached ports", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "free",
        pointIds: ["p-start", "p-blocked", "p-end"],
        d: { center: { x: 0, y: 0 }, width: 3, height: 1 },
      },
      {
        regionId: "target-a",
        pointIds: ["p-start"],
        d: {
          center: { x: -1, y: 0 },
          width: 1,
          height: 1,
          _containsTarget: true,
        },
      },
      {
        regionId: "obstacle",
        pointIds: ["p-blocked"],
        d: {
          center: { x: 0, y: -1 },
          width: 1,
          height: 1,
          _containsObstacle: true,
        },
      },
      {
        regionId: "target-b",
        pointIds: ["p-end"],
        d: {
          center: { x: 1, y: 0 },
          width: 1,
          height: 1,
          _containsTarget: true,
        },
      },
    ],
    ports: [
      {
        portId: "p-start",
        region1Id: "target-a",
        region2Id: "free",
        d: { x: -0.5, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "p-blocked",
        region1Id: "free",
        region2Id: "obstacle",
        d: { x: 0, y: -0.5, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "p-end",
        region1Id: "free",
        region2Id: "target-b",
        d: { x: 0.5, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
    ],
    connections: [
      {
        connectionId: "route-0",
        startRegionId: "target-a",
        endRegionId: "target-b",
      },
    ],
  }

  const { topology, problem } = loadSerializedHyperGraph(graph)
  const freeRegionId = getRegionIndexBySerializedId(
    topology.regionMetadata,
    "free",
  )
  const startRegionId = getRegionIndexBySerializedId(
    topology.regionMetadata,
    "target-a",
  )
  const endRegionId = getRegionIndexBySerializedId(
    topology.regionMetadata,
    "target-b",
  )

  expect(topology.regionCount).toBe(3)
  expect(topology.portCount).toBe(2)
  expect(
    getRegionIndexBySerializedId(topology.regionMetadata, "obstacle"),
  ).toBe(-1)
  expect(
    topology.portMetadata?.map((metadata) => metadata?.serializedPortId).sort(),
  ).toEqual(["p-end", "p-start"])
  expect(problem.routeCount).toBe(1)
  expect(problem.regionNetId[startRegionId]).toBe(problem.routeNet[0])
  expect(problem.regionNetId[endRegionId]).toBe(problem.routeNet[0])
  expect(problem.regionNetId[freeRegionId]).toBe(-1)
  expect(problem.congestionWindowSize).toBe(7)
  expect(problem.congestionCostFactor).toBe(1)
  expect(problem.congestionFalloff).toBe(0.75)
})

test("loadSerializedHyperGraph removes obstacle-target regions without a usable net id", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "free",
        pointIds: ["p-no-net", "p-net-minus-one"],
        d: { center: { x: 0, y: 0 }, width: 2, height: 2 },
      },
      {
        regionId: "start",
        pointIds: ["p-keep-connected"],
        d: {
          center: { x: 0, y: -2 },
          width: 1,
          height: 1,
          _containsTarget: true,
        },
      },
      {
        regionId: "no-net",
        pointIds: ["p-no-net"],
        d: {
          center: { x: -2, y: 0 },
          width: 1,
          height: 1,
          _containsObstacle: true,
          _containsTarget: true,
        },
      },
      {
        regionId: "net-minus-one",
        pointIds: ["p-net-minus-one"],
        d: {
          center: { x: 2, y: 0 },
          width: 1,
          height: 1,
          _containsObstacle: true,
          _containsTarget: true,
          netId: -1,
        },
      },
      {
        regionId: "kept-net",
        pointIds: ["p-keep-connected"],
        d: {
          center: { x: 0, y: 2 },
          width: 1,
          height: 1,
          _containsObstacle: true,
          _containsTarget: true,
          netId: 7,
        },
      },
    ],
    ports: [
      {
        portId: "p-keep-connected",
        region1Id: "start",
        region2Id: "kept-net",
        d: { x: 0, y: 1, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "p-no-net",
        region1Id: "free",
        region2Id: "no-net",
        d: { x: -1, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
      {
        portId: "p-net-minus-one",
        region1Id: "free",
        region2Id: "net-minus-one",
        d: { x: 1, y: 0, z: 0, distToCentermostPortOnZ: 0 },
      },
    ],
    connections: [
      {
        connectionId: "route-0",
        startRegionId: "start",
        endRegionId: "kept-net",
      },
    ],
  }

  const { topology, problem } = loadSerializedHyperGraph(graph)
  const keptRegionId = getRegionIndexBySerializedId(
    topology.regionMetadata,
    "kept-net",
  )

  expect(topology.regionCount).toBe(3)
  expect(topology.portCount).toBe(1)
  expect(
    topology.regionMetadata
      ?.map((metadata) => metadata?.serializedRegionId)
      .sort(),
  ).toEqual(["kept-net", "start", "free"].sort())
  expect(
    topology.portMetadata?.map((metadata) => metadata?.serializedPortId).sort(),
  ).toEqual(["p-keep-connected"])
  expect(problem.regionNetId[keptRegionId]).not.toBe(-1)
})
