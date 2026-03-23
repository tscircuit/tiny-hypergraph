import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { TinyHyperGraphTopology } from "lib/index"

const createSolvedRoutePath = (
  connection: NonNullable<SerializedHyperGraph["connections"]>[number],
  portIds: string[],
  traversedRegionIds: string[],
) =>
  portIds.map((portId, pathIndex) => ({
    portId,
    g: pathIndex,
    h: 0,
    f: pathIndex,
    hops: pathIndex,
    ripRequired: false,
    lastPortId: pathIndex > 0 ? portIds[pathIndex - 1] : undefined,
    lastRegionId: pathIndex > 0 ? traversedRegionIds[pathIndex - 1] : undefined,
    nextRegionId:
      pathIndex < traversedRegionIds.length
        ? traversedRegionIds[pathIndex]
        : connection.endRegionId,
  }))

const route0Connection = {
  connectionId: "route-0",
  startRegionId: "start-0",
  endRegionId: "end-0",
  mutuallyConnectedNetworkId: "net-0",
}

const route1Connection = {
  connectionId: "route-1",
  startRegionId: "start-1",
  endRegionId: "end-1",
  mutuallyConnectedNetworkId: "net-1",
}

export const sectionSolverFixtureGraph: SerializedHyperGraph = {
  regions: [
    {
      regionId: "start-0",
      pointIds: ["s0"],
      d: { center: { x: -5, y: 2 }, width: 1, height: 1 },
    },
    {
      regionId: "left-0",
      pointIds: ["s0", "a0"],
      d: { center: { x: -3.75, y: 2 }, width: 1.5, height: 1 },
    },
    {
      regionId: "start-1",
      pointIds: ["s1"],
      d: { center: { x: -5, y: -2 }, width: 1, height: 1 },
    },
    {
      regionId: "left-1",
      pointIds: ["s1", "a1"],
      d: { center: { x: -3.75, y: -2 }, width: 1.5, height: 1 },
    },
    {
      regionId: "section-left",
      pointIds: ["a0", "a1", "b0x", "b1x", "b0t", "b1b"],
      d: { center: { x: -2.25, y: 0 }, width: 1.5, height: 6 },
    },
    {
      regionId: "cross",
      pointIds: ["b0x", "b1x", "c0x", "c1x"],
      d: { center: { x: 0, y: 0 }, width: 3, height: 4 },
    },
    {
      regionId: "top",
      pointIds: ["b0t", "c0t"],
      d: { center: { x: 0, y: 2.5 }, width: 3, height: 1 },
    },
    {
      regionId: "bottom",
      pointIds: ["b1b", "c1b"],
      d: { center: { x: 0, y: -2.5 }, width: 3, height: 1 },
    },
    {
      regionId: "section-right",
      pointIds: ["c0x", "c1x", "c0t", "c1b", "d0", "d1"],
      d: { center: { x: 2.25, y: 0 }, width: 1.5, height: 6 },
    },
    {
      regionId: "right-0",
      pointIds: ["d0", "t0"],
      d: { center: { x: 3.75, y: 2 }, width: 1.5, height: 1 },
    },
    {
      regionId: "end-0",
      pointIds: ["t0"],
      d: { center: { x: 5, y: 2 }, width: 1, height: 1 },
    },
    {
      regionId: "right-1",
      pointIds: ["d1", "t1"],
      d: { center: { x: 3.75, y: -2 }, width: 1.5, height: 1 },
    },
    {
      regionId: "end-1",
      pointIds: ["t1"],
      d: { center: { x: 5, y: -2 }, width: 1, height: 1 },
    },
  ],
  ports: [
    {
      portId: "s0",
      region1Id: "start-0",
      region2Id: "left-0",
      d: { x: -4.5, y: 2, z: 0 },
    },
    {
      portId: "a0",
      region1Id: "left-0",
      region2Id: "section-left",
      d: { x: -3, y: 2, z: 0 },
    },
    {
      portId: "b0x",
      region1Id: "section-left",
      region2Id: "cross",
      d: { x: -1.5, y: 1.5, z: 0 },
    },
    {
      portId: "b0t",
      region1Id: "section-left",
      region2Id: "top",
      d: { x: -1.5, y: 2.5, z: 0 },
    },
    {
      portId: "s1",
      region1Id: "start-1",
      region2Id: "left-1",
      d: { x: -4.5, y: -2, z: 0 },
    },
    {
      portId: "a1",
      region1Id: "left-1",
      region2Id: "section-left",
      d: { x: -3, y: -2, z: 0 },
    },
    {
      portId: "b1x",
      region1Id: "section-left",
      region2Id: "cross",
      d: { x: -1.5, y: -1.5, z: 0 },
    },
    {
      portId: "b1b",
      region1Id: "section-left",
      region2Id: "bottom",
      d: { x: -1.5, y: -2.5, z: 0 },
    },
    {
      portId: "c0x",
      region1Id: "cross",
      region2Id: "section-right",
      d: { x: 1.5, y: 1.5, z: 0 },
    },
    {
      portId: "c0t",
      region1Id: "top",
      region2Id: "section-right",
      d: { x: 1.5, y: 2.5, z: 0 },
    },
    {
      portId: "d0",
      region1Id: "section-right",
      region2Id: "right-0",
      d: { x: 3, y: 2, z: 0 },
    },
    {
      portId: "t0",
      region1Id: "right-0",
      region2Id: "end-0",
      d: { x: 4.5, y: 2, z: 0 },
    },
    {
      portId: "c1x",
      region1Id: "cross",
      region2Id: "section-right",
      d: { x: 1.5, y: -1.5, z: 0 },
    },
    {
      portId: "c1b",
      region1Id: "bottom",
      region2Id: "section-right",
      d: { x: 1.5, y: -2.5, z: 0 },
    },
    {
      portId: "d1",
      region1Id: "section-right",
      region2Id: "right-1",
      d: { x: 3, y: -2, z: 0 },
    },
    {
      portId: "t1",
      region1Id: "right-1",
      region2Id: "end-1",
      d: { x: 4.5, y: -2, z: 0 },
    },
  ],
  connections: [route0Connection, route1Connection],
  solvedRoutes: [
    {
      connection: route0Connection,
      requiredRip: false,
      path: createSolvedRoutePath(
        route0Connection,
        ["s0", "a0", "b0x", "c1x", "d0", "t0"],
        ["left-0", "section-left", "cross", "section-right", "right-0"],
      ),
    },
    {
      connection: route1Connection,
      requiredRip: false,
      path: createSolvedRoutePath(
        route1Connection,
        ["s1", "a1", "b1x", "c0x", "d1", "t1"],
        ["left-1", "section-left", "cross", "section-right", "right-1"],
      ),
    },
  ],
}

export const sectionSolverFixturePortIds = [
  "b0x",
  "b0t",
  "b1x",
  "b1b",
  "c0x",
  "c0t",
  "c1x",
  "c1b",
]

export const createSectionSolverFixturePortMask = (
  topology: TinyHyperGraphTopology,
) => {
  const sectionPortIds = new Set(sectionSolverFixturePortIds)
  return Int8Array.from(
    topology.portMetadata?.map((metadata) =>
      sectionPortIds.has(metadata?.serializedPortId) ? 1 : 0,
    ) ?? [],
  )
}
