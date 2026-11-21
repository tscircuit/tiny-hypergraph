import "bun-match-svg"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphSolverOptions,
} from "lib/core"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"

type Capture = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
  routeId: number
  graphics: GraphicsObject
}

test("full motherboard graph searches across the board for a short STM32 power connection", async () => {
  const constructors = { Float64Array, Int32Array, Int8Array }
  const capture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/motherboard-port-penalty.json.gz",
          import.meta.url,
        ),
      ),
    ).toString(),
    (_key, value) => {
      if (value?.typedArray && Array.isArray(value.values)) {
        return constructors[value.typedArray as keyof typeof constructors].from(
          value.values,
        )
      }
      return value
    },
  ) as Capture
  const { topology, problem, routeId, graphics } = capture
  expect(topology.portCount).toBe(390_672)
  expect(topology.regionCount).toBe(110_415)
  expect(problem.routeCount).toBe(1_745)
  const solver = new PreparedPortPointRoutingSolver(
    topology,
    problem,
    capture.options,
  )
  // Keep the complete board topology and every net/endpoint reservation;
  // isolate only which connection is searched to measure the algorithm.
  solver.state.unroutedRoutes = [routeId]
  while (
    !solver.failed &&
    solver.state.unroutedRoutes.length +
      Number(solver.state.currentRouteId !== undefined) >
      0
  )
    solver.step()
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(300_001)
  const path = solver.state.regionSegments.flatMap((segments, region) =>
    segments.map(([, from, to]) => ({ region, from, to })),
  )
  expect(path).toHaveLength(16)
  let length = 0
  let penalty = 0
  for (const segment of path) {
    length += Math.hypot(
      topology.portX[segment.to] - topology.portX[segment.from],
      topology.portY[segment.to] - topology.portY[segment.from],
    )
    penalty += problem.portPenalty![segment.to]
  }
  expect(length).toBeCloseTo(3.3180040597829983, 10)
  expect(penalty).toBe(750)
  const cells = new Set<string>()
  let discovered = 0
  const generations = solver.state.candidateBestCostGenerationByHopId
  if (!(generations instanceof Uint32Array))
    throw new Error("Expected the captured dense search workspace")
  for (let port = 0; port < topology.portCount; port++) {
    if (
      !topology.incidentPortRegion[port].some(
        (region) =>
          generations[solver.getHopId(port, region)] ===
          solver.state.candidateBestCostGeneration,
      )
    )
      continue
    discovered++
    cells.add(
      `${Math.floor(topology.portX[port] / 2)},${Math.floor(topology.portY[port] / 2)}`,
    )
  }
  graphics.rects = [
    ...Array.from(cells, (cell) => {
      const [x, y] = cell.split(",").map(Number)
      return {
        center: { x: x * 2 + 1, y: y * 2 + 1 },
        width: 2,
        height: 2,
        fill: "rgba(251, 146, 60, 0.20)",
        stroke: "none",
      }
    }),
    ...graphics.rects!,
    {
      center: { x: 0, y: 0 },
      width: 154,
      height: 97,
      fill: "transparent",
      stroke: "#94a3b8",
    },
  ]
  graphics.lines = path.map(({ from, to }) => ({
    points: [
      { x: topology.portX[from], y: topology.portY[from] },
      { x: topology.portX[to], y: topology.portY[to] },
    ],
    strokeColor: "#2563eb",
    strokeWidth: 0.15,
  }))
  graphics.circles = [
    problem.routeStartPort[routeId],
    problem.routeEndPort[routeId],
  ].map((port) => ({
    center: { x: topology.portX[port], y: topology.portY[port] },
    radius: 0.8,
    fill: "#2563eb",
    stroke: "#2563eb",
  }))
  graphics.lines.push({
    points: [
      { x: 27, y: 24 },
      { x: 9, y: 16.4 },
    ],
    strokeColor: "#2563eb",
    strokeWidth: 0.12,
  })
  graphics.texts = [
    {
      x: 28,
      y: 25,
      text: "Short STM32 connection",
      fontSize: 1.4,
      anchorSide: "center_left",
    },
    {
      x: -77,
      y: 58,
      text: "4-Motor USB-C motherboard: STM32 H3_VBAT -> J5_VDD_PLL (2.88 mm apart)",
      fontSize: 2.4,
      anchorSide: "center_left",
    },
    {
      x: -77,
      y: 53,
      text: `Search iterations: ${solver.iterations} | Discovered search locations: ${discovered}`,
      fontSize: 2.2,
      anchorSide: "center_left",
    },
    {
      x: -77,
      y: -54,
      text: "Orange: searched areas (2 mm bins) | Gray: board geometry | Blue: returned graph path",
      fontSize: 2,
      anchorSide: "center_left",
    },
    {
      x: -77,
      y: -59,
      text: "Complete board graph; one isolated connection. This is path planning, not finished copper or DRC.",
      fontSize: 1.8,
      anchorSide: "center_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1400,
      svgHeight: 1050,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
