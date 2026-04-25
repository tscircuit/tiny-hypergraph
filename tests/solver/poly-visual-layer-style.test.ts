import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { PolyHyperGraphSolver, loadSerializedHyperGraphAsPoly } from "lib/index"

const createPolyLayerStyleFixture = (): SerializedHyperGraph => ({
  regions: [
    {
      regionId: "z0-region",
      pointIds: ["p0"],
      d: {
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
        availableZ: [0],
      },
    },
    {
      regionId: "multi-region",
      pointIds: ["p0", "p1", "p2", "p3", "p4"],
      d: { bounds: { minX: 1, maxX: 2, minY: 0, maxY: 1 } },
    },
    {
      regionId: "z1-region-a",
      pointIds: ["p1"],
      d: {
        bounds: { minX: 2, maxX: 3, minY: 0, maxY: 1 },
        availableZ: [1],
      },
    },
    {
      regionId: "z1-region-b",
      pointIds: ["p2"],
      d: {
        bounds: { minX: 2, maxX: 3, minY: 1, maxY: 2 },
        availableZ: [1],
      },
    },
    {
      regionId: "z2-region",
      pointIds: ["p3"],
      d: {
        bounds: { minX: 2, maxX: 3, minY: 2, maxY: 3 },
        availableZ: [2],
      },
    },
    {
      regionId: "z3-region",
      pointIds: ["p4"],
      d: {
        bounds: { minX: 2, maxX: 3, minY: 3, maxY: 4 },
        availableZ: [3],
      },
    },
  ],
  ports: [
    {
      portId: "p0",
      region1Id: "z0-region",
      region2Id: "multi-region",
      d: { x: 1, y: 0.5, z: 0 },
    },
    {
      portId: "p1",
      region1Id: "multi-region",
      region2Id: "z1-region-a",
      d: { x: 2, y: 0.5, z: 1 },
    },
    {
      portId: "p2",
      region1Id: "multi-region",
      region2Id: "z1-region-b",
      d: { x: 2, y: 1.5, z: 1 },
    },
    {
      portId: "p3",
      region1Id: "multi-region",
      region2Id: "z2-region",
      d: { x: 2, y: 2.5, z: 2 },
    },
    {
      portId: "p4",
      region1Id: "multi-region",
      region2Id: "z3-region",
      d: { x: 2, y: 3.5, z: 3 },
    },
  ],
  connections: [
    {
      connectionId: "route",
      startRegionId: "z0-region",
      endRegionId: "z3-region",
      mutuallyConnectedNetworkId: "net",
    },
  ],
})

test("poly visualization styles ports, polygons, and segment dashes by z layer", () => {
  const { topology, problem, mapping } = loadSerializedHyperGraphAsPoly(
    createPolyLayerStyleFixture(),
  )
  const solver = new PolyHyperGraphSolver(topology, problem)
  const getPortId = (portId: string) =>
    mapping.serializedPortIdToPortId.get(portId)!
  const multiRegionId =
    mapping.serializedRegionIdToRegionId.get("multi-region")!

  solver.state.regionSegments[multiRegionId] = [
    [0, getPortId("p1"), getPortId("p2")],
    [0, getPortId("p0"), getPortId("p1")],
    [0, getPortId("p1"), getPortId("p3")],
  ]

  const graphics = solver.visualize()
  const circleByPort = (portId: string) =>
    (graphics.circles ?? []).find((circle) =>
      circle.label?.includes(`port: ${portId}`),
    )
  const polygonByRegion = (regionId: string) =>
    (graphics.polygons ?? []).find((polygon) =>
      polygon.label?.includes(`region: ${regionId}`),
    )

  expect(circleByPort("p0")?.fill).toBe("rgba(220, 38, 38, 0.65)")
  expect(circleByPort("p1")?.fill).toBe("rgba(37, 99, 235, 0.65)")
  expect(circleByPort("p3")?.fill).toBe("rgba(22, 163, 74, 0.65)")
  expect(circleByPort("p4")?.fill).toBe("rgba(249, 115, 22, 0.65)")

  expect(polygonByRegion("z0-region")?.fill).toBe("rgba(128, 128, 128, 0.2)")
  expect(polygonByRegion("z0-region")?.stroke).toBe("rgba(220, 38, 38, 0.95)")
  expect(polygonByRegion("z1-region-a")?.stroke).toBe("rgba(37, 99, 235, 0.95)")
  expect(polygonByRegion("z2-region")?.stroke).toBe("rgba(22, 163, 74, 0.95)")
  expect(polygonByRegion("z3-region")?.stroke).toBe("rgba(249, 115, 22, 0.95)")
  expect(polygonByRegion("multi-region")?.stroke).toBe(
    "rgba(128, 128, 128, 0.85)",
  )
  expect(
    (graphics.lines ?? []).some(
      (line) =>
        line.label?.includes("layer outline: multi-region") &&
        line.strokeDash === "4 3" &&
        line.strokeColor === "rgba(128, 128, 128, 0.85)",
    ),
  ).toBe(true)

  const routeLines = (graphics.lines ?? []).filter((line) =>
    line.label?.includes("route: route"),
  )
  expect(routeLines.map((line) => line.strokeDash)).toEqual([
    "3 2",
    "2 4 2",
    "2 4 2",
  ])
})
