import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSolver,
  PreparedPortPointRoutingSolver,
} from "lib/index"

test("routes between layers beside an existing multilayer terminal", () => {
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
        regionId: "existing-terminal",
        pointIds: ["v0", "v1"],
        d: {
          center: { x: 0, y: 0 },
          width: 1e-6,
          height: 1e-6,
          availableZ: [0, 1],
          netId: 0,
          _tinyTerminal: true,
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
        region2Id: "existing-terminal",
        d: { x: 0, y: 0, z: 0 },
      },
      {
        portId: "v1",
        region1Id: "existing-terminal",
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
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    for (const virtual of [false, true]) {
      const input = structuredClone(graph)
      input.regions.find(
        (region) => region.regionId === "existing-terminal",
      )!.d._tinyTerminal = virtual
      const loaded = loadSerializedHyperGraph(input)
      const solver = new Solver(loaded.topology, loaded.problem)
      solver.solve()
      expect(solver.solved).toBeTrue()
      const path = solver
        .getOutput()
        .solvedRoutes![0]!.path.map((point) => point.portId)
      expect(path.includes("v0")).toBe(virtual)
      expect(path.includes("v1")).toBe(virtual)
      expect(path.includes("d0")).toBe(!virtual)
      if (virtual && Solver === TinyHyperGraphSolver) {
        expect(
          getSvgFromGraphicsObject(solver.visualize(), {
            svgWidth: 1000,
            svgHeight: 650,
          }),
        ).toMatchSvgSnapshot(import.meta.path)
      }
    }
  }
})
