import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  PolyHyperGraphSolver,
  TinyHyperGraphSolver,
  loadSerializedHyperGraphAsPoly,
} from "lib/index"

const createLayerFixture = (): SerializedHyperGraph => ({
  regions: [
    {
      regionId: "start",
      pointIds: ["p0"],
      d: {
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
        availableZ: [1, 0],
        layer: "top",
      },
    },
    {
      regionId: "middle",
      pointIds: ["p0", "p1"],
      d: { bounds: { minX: 1, maxX: 2, minY: 0, maxY: 1 } },
    },
    {
      regionId: "end",
      pointIds: ["p1"],
      d: {
        bounds: { minX: 2, maxX: 3, minY: 0, maxY: 1 },
        availableZ: [1],
      },
    },
    {
      regionId: "isolated",
      pointIds: [],
      d: { bounds: { minX: 0, maxX: 1, minY: 1, maxY: 2 } },
    },
  ],
  ports: [
    {
      portId: "p0",
      region1Id: "start",
      region2Id: "middle",
      d: { x: 1, y: 0.5, z: 0 },
    },
    {
      portId: "p1",
      region1Id: "middle",
      region2Id: "end",
      d: { x: 2, y: 0.5, z: 1, layer: "bottom" },
    },
  ],
  connections: [
    {
      connectionId: "route",
      startRegionId: "start",
      endRegionId: "end",
      mutuallyConnectedNetworkId: "net",
    },
  ],
})

test("loadSerializedHyperGraph assigns z layer labels to region and port metadata", () => {
  const { topology, problem } = loadSerializedHyperGraph(createLayerFixture())

  expect(topology.regionMetadata?.map((metadata) => metadata.layer)).toEqual([
    "z0,1",
    "z0,1",
    "z1",
    "z0",
  ])
  expect(topology.portMetadata?.map((metadata) => metadata.layer)).toEqual([
    "z0",
    "z1",
  ])

  const solver = new TinyHyperGraphSolver(topology, problem)
  const graphics = solver.visualize()
  const regionLayers = (graphics.rects ?? [])
    .filter((rect) => rect.label?.includes("region: region-"))
    .map((rect) => rect.layer)
  const portLayers = (graphics.circles ?? [])
    .filter((circle) => circle.label?.includes("port: p"))
    .map((circle) => circle.layer)

  expect(regionLayers).toEqual(["z0,1", "z0,1", "z1", "z0"])
  expect(portLayers).toEqual(["z0", "z1"])
})

test("serialized and poly outputs preserve z layer labels for regions and ports", () => {
  const graph = createLayerFixture()
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutput()
  expect(output.regions.map((region) => region.d?.layer)).toEqual([
    "z0,1",
    "z0,1",
    "z1",
    "z0",
  ])
  expect(output.ports.map((port) => port.d?.layer)).toEqual(["z0", "z1"])

  const polyLoaded = loadSerializedHyperGraphAsPoly(graph)
  const polySolver = new PolyHyperGraphSolver(
    polyLoaded.topology,
    polyLoaded.problem,
  )
  const polyGraphics = polySolver.visualize()

  expect((polyGraphics.polygons ?? []).map((polygon) => polygon.layer)).toEqual(
    ["z0,1", "z0,1", "z1", "z0"],
  )
  expect((polyGraphics.circles ?? []).map((circle) => circle.layer)).toEqual([
    "z0",
    "z1",
  ])
})
