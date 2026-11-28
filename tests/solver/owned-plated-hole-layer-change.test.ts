import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSolver,
  PreparedPortPointRoutingSolver,
} from "lib/index"

test("reuses an owned plated hole when changing layers", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      {
        regionId: "start",
        pointIds: ["s"],
        d: {
          center: { x: -4, y: 0 },
          width: 0.01,
          height: 0.01,
          availableZ: [0],
        },
      },
      {
        regionId: "top",
        pointIds: ["s", "v0", "t"],
        d: { center: { x: -2, y: 0 }, width: 4, height: 4, availableZ: [0] },
      },
      {
        regionId: "plated-hole",
        pointIds: ["v0", "v1"],
        d: {
          center: { x: 0, y: 0 },
          width: 0.3,
          height: 0.3,
          availableZ: [0, 1],
          netId: 0,
          _containsTarget: true,
          _containsObstacle: true,
        },
      },
      {
        regionId: "bottom",
        pointIds: ["v1", "b", "e"],
        d: { center: { x: 2, y: 0 }, width: 4, height: 4, availableZ: [1] },
      },
      {
        regionId: "end",
        pointIds: ["e"],
        d: {
          center: { x: 4, y: 0 },
          width: 0.01,
          height: 0.01,
          availableZ: [1],
        },
      },
      {
        regionId: "detour-top",
        pointIds: ["t", "d0"],
        d: { center: { x: -2, y: 4 }, width: 4, height: 4, availableZ: [0] },
      },
      {
        regionId: "new-via",
        pointIds: ["d0", "d1"],
        d: { center: { x: 0, y: 4 }, width: 2, height: 2, availableZ: [0, 1] },
      },
      {
        regionId: "detour-bottom",
        pointIds: ["d1", "b"],
        d: { center: { x: 2, y: 4 }, width: 4, height: 4, availableZ: [1] },
      },
    ],
    ports: [
      {
        portId: "s",
        region1Id: "start",
        region2Id: "top",
        d: { x: -4, y: 0, z: 0 },
      },
      {
        portId: "v0",
        region1Id: "top",
        region2Id: "plated-hole",
        d: { x: 0, y: 0, z: 0 },
      },
      {
        portId: "v1",
        region1Id: "plated-hole",
        region2Id: "bottom",
        d: { x: 0, y: 0, z: 1 },
      },
      {
        portId: "e",
        region1Id: "bottom",
        region2Id: "end",
        d: { x: 4, y: 0, z: 1 },
      },
      {
        portId: "t",
        region1Id: "top",
        region2Id: "detour-top",
        d: { x: -2, y: 2, z: 0 },
      },
      {
        portId: "d0",
        region1Id: "detour-top",
        region2Id: "new-via",
        d: { x: -1, y: 4, z: 0 },
      },
      {
        portId: "d1",
        region1Id: "new-via",
        region2Id: "detour-bottom",
        d: { x: 1, y: 4, z: 1 },
      },
      {
        portId: "b",
        region1Id: "detour-bottom",
        region2Id: "bottom",
        d: { x: 2, y: 2, z: 1 },
      },
    ],
    connections: [
      {
        connectionId: "power",
        mutuallyConnectedNetworkId: "power",
        startRegionId: "start",
        endRegionId: "end",
      },
    ],
  }
  const loaded = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 650,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
