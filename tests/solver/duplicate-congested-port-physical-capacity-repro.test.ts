import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  type GraphicsObject,
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { DuplicateCongestedPortSolver } from "lib/index"

const createRegion = (
  regionId: string,
  center: { x: number; y: number },
  width: number,
  height: number,
  pointIds: string[],
): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: { center, width, height },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
): SerializedHyperGraph["ports"][number] => ({
  portId,
  region1Id,
  region2Id,
  d: { x, y, z: 0 },
})

const TRACE_WIDTH = 0.1524
const TRACE_CLEARANCE = 0.15
const SHARED_EDGE_HEIGHT = 0.14008921839080485
const SHARED_PORT_Y = -SHARED_EDGE_HEIGHT / 2

const createPmp22650BoundaryFixture = (): SerializedHyperGraph => {
  const connections = Array.from({ length: 7 }, (_, index) => ({
    connectionId: `route-${index}`,
    startRegionId: `start-${index}`,
    endRegionId: `end-${index}`,
    mutuallyConnectedNetworkId: `net-${index}`,
  }))
  const startPorts = connections.map((_, index) =>
    createPort(
      `start-port-${index}`,
      `start-${index}`,
      "left",
      -0.3999992,
      0.94560191247129,
    ),
  )
  const endPorts = connections.map((_, index) =>
    createPort(`end-port-${index}`, "right", `end-${index}`, 0.02360041, 0),
  )

  return {
    regions: [
      ...connections.map((_, index) =>
        createRegion(
          `start-${index}`,
          { x: -0.45, y: 0.94560191247129 },
          0.1,
          0.1,
          [`start-port-${index}`],
        ),
      ),
      createRegion(
        "left",
        { x: -0.1999996, y: 0.94560191247129 },
        0.3999992,
        2.0312937233333295,
        [...startPorts.map((port) => port.portId), "pmp22650-opening"],
      ),
      createRegion(
        "right",
        { x: 0.011800205, y: 0 },
        0.02360041,
        SHARED_EDGE_HEIGHT,
        ["pmp22650-opening", ...endPorts.map((port) => port.portId)],
      ),
      ...connections.map((_, index) =>
        createRegion(`end-${index}`, { x: 0.07360041, y: 0 }, 0.1, 0.1, [
          `end-port-${index}`,
        ]),
      ),
    ],
    ports: [
      ...startPorts,
      createPort("pmp22650-opening", "left", "right", 0, SHARED_PORT_Y),
      ...endPorts,
    ],
    connections,
  }
}

test("visualizes the physical capacity of the PMP22650 narrow opening", () => {
  const solver = new DuplicateCongestedPortSolver(
    createPmp22650BoundaryFixture(),
    {
      duplicatePortProximity: 0.05,
      // Older implementations ignore these options, which is the issue this
      // snapshot reproduces.
      minimumDuplicatePortSpacing: TRACE_WIDTH + TRACE_CLEARANCE,
      duplicatePortWidth: TRACE_WIDTH,
    } as any,
  )
  solver.solve()

  const output = solver.getOutput()
  const lanes = output.ports
    .filter(
      (port) =>
        port.portId === "pmp22650-opening" ||
        port.d?.duplicatedFromPortId === "pmp22650-opening",
    )
    .sort((a, b) => Number(a.d?.y) - Number(b.d?.y))
  const graphics: GraphicsObject = {
    rects: [
      {
        center: { x: -0.1999996, y: 0.94560191247129 },
        width: 0.3999992,
        height: 2.0312937233333295,
        fill: "rgba(80, 140, 220, 0.16)",
        stroke: "rgb(80, 140, 220)",
        label: "left region",
      },
      {
        center: { x: 0.011800205, y: 0 },
        width: 0.02360041,
        height: SHARED_EDGE_HEIGHT,
        fill: "rgba(80, 140, 220, 0.16)",
        stroke: "rgb(80, 140, 220)",
        label: "right region",
      },
    ],
    lines: lanes.flatMap((port, index) => [
      {
        points: [
          { x: -0.1, y: Number(port.d?.y) },
          { x: 0.05, y: Number(port.d?.y) },
        ],
        strokeColor: "rgba(255, 120, 0, 0.2)",
        strokeWidth: TRACE_WIDTH + TRACE_CLEARANCE,
        label: `lane ${index + 1}: trace and clearance`,
      },
      {
        points: [
          { x: -0.1, y: Number(port.d?.y) },
          { x: 0.05, y: Number(port.d?.y) },
        ],
        strokeColor: "rgb(210, 45, 45)",
        strokeWidth: TRACE_WIDTH,
        label: `lane ${index + 1}: physical trace`,
      },
    ]),
    points: lanes.map((port, index) => ({
      x: Number(port.d?.x),
      y: Number(port.d?.y),
      color: "rgb(20, 20, 20)",
      label: `lane ${index + 1}`,
    })),
    circles: [],
  }

  const svg = getSvgFromGraphicsObject(
    stackGraphicsVertically([graphics], {
      titles: [
        `PMP22650 opening: ${lanes.length} graph lanes / 1 physical lane`,
      ],
    }),
  )
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
