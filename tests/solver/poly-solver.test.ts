import "bun-match-svg"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  PolyHyperGraphSolver,
  TinyHyperGraphSolver,
  loadSerializedHyperGraphAsPoly,
} from "lib/index"
import { sameNetSharedBottleneckFixture } from "tests/fixtures/same-net-shared-bottleneck.fixture"

const getMaxRegionCost = (
  solver: TinyHyperGraphSolver | PolyHyperGraphSolver,
) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const nonRectConvexFixture: SerializedHyperGraph = {
  regions: [
    {
      regionId: "start-left",
      pointIds: ["left"],
      d: {
        polygon: [
          { x: 0, y: -0.7 },
          { x: 1, y: 0 },
          { x: 0, y: 0.7 },
        ],
      },
    },
    {
      regionId: "end-right",
      pointIds: ["right"],
      d: {
        polygon: [
          { x: 3, y: 0 },
          { x: 4, y: 0.7 },
          { x: 4, y: -0.7 },
        ],
      },
    },
    {
      regionId: "start-top",
      pointIds: ["top"],
      d: {
        polygon: [
          { x: 1.35, y: 2.1 },
          { x: 2, y: 1.2 },
          { x: 2.65, y: 2.1 },
        ],
      },
    },
    {
      regionId: "end-bottom",
      pointIds: ["bottom"],
      d: {
        polygon: [
          { x: 2, y: -1.2 },
          { x: 2.65, y: -2.1 },
          { x: 1.35, y: -2.1 },
        ],
      },
    },
    {
      regionId: "diamond-middle",
      pointIds: ["left", "right", "top", "bottom"],
      d: {
        polygon: [
          { x: 1, y: 0 },
          { x: 2, y: 1.2 },
          { x: 3, y: 0 },
          { x: 2, y: -1.2 },
        ],
      },
    },
  ],
  ports: [
    {
      portId: "left",
      region1Id: "start-left",
      region2Id: "diamond-middle",
      d: { x: 1, y: 0, z: 0 },
    },
    {
      portId: "right",
      region1Id: "diamond-middle",
      region2Id: "end-right",
      d: { x: 3, y: 0, z: 0 },
    },
    {
      portId: "top",
      region1Id: "start-top",
      region2Id: "diamond-middle",
      d: { x: 2, y: 1.2, z: 0 },
    },
    {
      portId: "bottom",
      region1Id: "diamond-middle",
      region2Id: "end-bottom",
      d: { x: 2, y: -1.2, z: 0 },
    },
  ],
  connections: [
    {
      connectionId: "left-to-right",
      startRegionId: "start-left",
      endRegionId: "end-right",
      mutuallyConnectedNetworkId: "net-lr",
    },
    {
      connectionId: "top-to-bottom",
      startRegionId: "start-top",
      endRegionId: "end-bottom",
      mutuallyConnectedNetworkId: "net-tb",
    },
  ],
}

test("loadSerializedHyperGraphAsPoly converts serialized rect regions to polygon topology", () => {
  const { topology, mapping } = loadSerializedHyperGraphAsPoly(
    datasetHg07.sample002 as SerializedHyperGraph,
  )

  expect(topology.regionVertexStart.length).toBe(topology.regionCount)
  expect(topology.regionVertexCount.length).toBe(topology.regionCount)
  expect(topology.regionArea[0]).toBeGreaterThan(0)
  expect(topology.regionPerimeter[0]).toBeGreaterThan(0)
  expect(topology.portBoundaryPositionForRegion1.length).toBe(
    topology.portCount,
  )
  expect(mapping.serializedRegionIdToRegionId.size).toBe(topology.regionCount)
})

test("poly solver roughly matches core solver max region cost on sample002", () => {
  const coreLoaded = loadSerializedHyperGraph(
    datasetHg07.sample002 as SerializedHyperGraph,
  )
  const polyLoaded = loadSerializedHyperGraphAsPoly(
    datasetHg07.sample002 as SerializedHyperGraph,
  )
  const coreSolver = new TinyHyperGraphSolver(
    coreLoaded.topology,
    coreLoaded.problem,
  )
  const polySolver = new PolyHyperGraphSolver(
    polyLoaded.topology,
    polyLoaded.problem,
  )

  coreSolver.solve()
  polySolver.solve()

  expect(coreSolver.solved).toBe(true)
  expect(polySolver.solved).toBe(true)
  expect(polySolver.failed).toBe(false)
  expect(
    Math.abs(getMaxRegionCost(polySolver) - getMaxRegionCost(coreSolver)),
  ).toBeLessThanOrEqual(0.05)
})

test("poly solver handles same-net shared bottleneck fixture", () => {
  const { topology, problem } = loadSerializedHyperGraphAsPoly(
    sameNetSharedBottleneckFixture,
  )
  const solver = new PolyHyperGraphSolver(topology, problem)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})

test("poly solver routes non-rect convex regions and renders polygon SVG", () => {
  const { topology, problem, mapping } =
    loadSerializedHyperGraphAsPoly(nonRectConvexFixture)
  const solver = new PolyHyperGraphSolver(topology, problem)
  const beforeSolveGraphics = solver.visualize()

  solver.solve()
  const afterSolveGraphics = solver.visualize()
  const diamondRegionId =
    mapping.serializedRegionIdToRegionId.get("diamond-middle")

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect((afterSolveGraphics.polygons ?? []).length).toBe(
    nonRectConvexFixture.regions.length,
  )
  expect(typeof diamondRegionId).toBe("number")
  expect(
    solver.state.regionIntersectionCaches[diamondRegionId!]
      ?.existingSameLayerIntersections,
  ).toBe(1)

  const stagedSvg = getSvgFromGraphicsObject(
    stackGraphicsVertically([beforeSolveGraphics, afterSolveGraphics], {
      titles: ["before solve", "after solve"],
    }),
  )
  expect(stagedSvg).toMatchSvgSnapshot(import.meta.path)
})
