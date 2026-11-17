import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { DistanceAwareTinyHyperGraphSolver } from "lib/distance-aware-tiny-hypergraph-solver"
import type { TinyHyperGraphTopology } from "lib/core"

test("searching a nearby destination behind an unavoidable penalized port", async () => {
  // A 12 x 8 open mesh, with the destination in an adjacent pocket whose
  // only entrance costs 150. Exploring the open mesh cannot avoid that cost.
  const columns = 12
  const rows = 8
  const pocket = columns * rows
  const regions: number[][] = Array.from({ length: pocket + 1 }, () => [])
  const incident: number[][] = []
  const x: number[] = []
  const y: number[] = []
  function addPort(px: number, py: number, regionIds: number[]): number {
    const port = x.length
    x.push(px)
    y.push(py)
    incident.push(regionIds)
    for (const region of regionIds) regions[region].push(port)
    return port
  }
  const start = addPort(0, 0, [0])
  const gate = addPort(-0.5, 0, [0, pocket])
  const goal = addPort(-1, 0, [pocket])
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const region = row * columns + column
      if (column + 1 < columns) addPort(column + 0.5, row, [region, region + 1])
      if (row + 1 < rows) addPort(column, row + 0.5, [region, region + columns])
    }
  }
  const topology: TinyHyperGraphTopology = {
    portCount: x.length,
    regionCount: regions.length,
    regionIncidentPorts: regions,
    incidentPortRegion: incident,
    regionWidth: new Float64Array(regions.length).fill(1),
    regionHeight: new Float64Array(regions.length).fill(1),
    regionCenterX: Float64Array.from(regions, (_, r) =>
      r === pocket ? -1 : r % columns,
    ),
    regionCenterY: Float64Array.from(regions, (_, r) =>
      r === pocket ? 0 : Math.floor(r / columns),
    ),
    regionAvailableZMask: new Int32Array(regions.length).fill(1),
    portAngleForRegion1: new Int32Array(x.length),
    portX: Float64Array.from(x),
    portY: Float64Array.from(y),
    portZ: new Int32Array(x.length),
  }
  const penalty = new Float64Array(x.length)
  penalty[gate] = 150
  const solver = new DistanceAwareTinyHyperGraphSolver(topology, {
    routeCount: 1,
    routeStartPort: new Int32Array([start]),
    routeEndPort: new Int32Array([goal]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array(regions.length).fill(-1),
    portSectionMask: new Int8Array(x.length).fill(1),
    portPenalty: penalty,
  })
  const visited = new Set<number>()
  // Observe actual expanded regions after setup installs the native heap.
  solver.step()
  const queue = solver.state.candidateQueue
  const nativeDequeue = queue.dequeue.bind(queue)
  queue.dequeue = () => {
    const candidate = nativeDequeue()
    if (candidate) visited.add(candidate.nextRegionId)
    return candidate
  }
  visited.add(0)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments[0]).toEqual([[0, start, gate]])
  expect(solver.state.regionSegments[pocket]).toEqual([[0, gate, goal]])
  expect(solver.iterations).toBe(4)
  const graphics: GraphicsObject = {
    rects: regions.map((_, region) => ({
      center: {
        x: topology.regionCenterX[region],
        y: topology.regionCenterY[region],
      },
      width: 0.94,
      height: 0.94,
      fill: visited.has(region)
        ? "rgba(251, 146, 60, 0.25)"
        : "rgba(226, 232, 240, 0.6)",
      stroke: "#94a3b8",
    })),
    lines: [
      {
        points: [
          { x: 0, y: 0 },
          { x: -1, y: 0 },
        ],
        strokeColor: "#2563eb",
        strokeWidth: 0.1,
      },
    ],
    circles: [{ center: { x: -0.5, y: 0 }, radius: 0.13, fill: "#dc2626" }],
    texts: [
      { x: 0, y: -0.65, text: "A", fontSize: 0.25 },
      { x: -1, y: -0.65, text: "B", fontSize: 0.25 },
      {
        x: -1.5,
        y: 9.3,
        text: "A nearby destination has one unavoidable narrow entrance",
        fontSize: 0.4,
        anchorSide: "center_left",
      },
      {
        x: -1.5,
        y: 8.5,
        text: `Search iterations: ${solver.iterations} | Regions expanded: ${visited.size} / ${regions.length}`,
        fontSize: 0.34,
        anchorSide: "center_left",
      },
      {
        x: -1.5,
        y: -1.2,
        text: "Blue: returned path (1 unit) | Red: entrance penalty = 150 | Orange: expanded regions",
        fontSize: 0.28,
        anchorSide: "center_left",
      },
      {
        x: -1.5,
        y: -1.9,
        text: "Exploring the open mesh cannot bypass the entrance. The path and its costs stay unchanged.",
        fontSize: 0.28,
        anchorSide: "center_left",
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 800,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
