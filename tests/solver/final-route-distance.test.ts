import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphSolver } from "lib/core"

test("timeout routing accounts for distance already traveled around a detour", async () => {
  const ports: SerializedHyperGraph["ports"] = [
    {
      portId: "start",
      region1Id: "start",
      region2Id: "fork",
      d: { x: 0, y: 0, z: 0 },
    },
    {
      portId: "short",
      region1Id: "fork",
      region2Id: "finish",
      d: { x: 5, y: 4, z: 0 },
    },
    {
      portId: "detour-a",
      region1Id: "fork",
      region2Id: "a",
      d: { x: 7, y: 0, z: 0 },
    },
    {
      portId: "detour-b",
      region1Id: "a",
      region2Id: "b",
      d: { x: 13, y: 0, z: 0 },
    },
    {
      portId: "detour-c",
      region1Id: "b",
      region2Id: "finish",
      d: { x: 7, y: 1, z: 0 },
    },
    {
      portId: "end",
      region1Id: "finish",
      region2Id: "end",
      d: { x: 10, y: 0, z: 0 },
    },
  ]
  const graph: SerializedHyperGraph = {
    ports,
    regions: ["start", "fork", "a", "b", "finish", "end"].map((regionId) => ({
      regionId,
      d: {},
      pointIds: ports
        .filter(
          (port) => port.region1Id === regionId || port.region2Id === regionId,
        )
        .map((port) => port.portId),
    })),
    connections: [
      { connectionId: "route", startRegionId: "start", endRegionId: "end" },
    ],
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 1,
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.acceptedGreedyFinalRouteOnTimeout).toBe(true)
  expect(
    solver.getOutput().solvedRoutes?.[0]?.path.map(({ portId }) => portId),
  ).toEqual(["start", "short", "end"])
  const svg = getSvgFromGraphicsObject(solver.visualize(), {
    backgroundColor: "white",
  })
  await expect(svg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
  )
})
