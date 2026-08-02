import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
} from "graphics-debug"
import { DuplicateCongestedPortSolver } from "lib/index"

const REQUIRED_CENTER_SPACING = 0.2
const TRACE_WIDTH = 0.1

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

const createFixture = (): SerializedHyperGraph => ({
  regions: [
    createRegion("start-a", { x: -1.5, y: 0 }, 1, 1, ["start-a-port"]),
    createRegion("start-b", { x: -1.5, y: -0.2 }, 1, 1, [
      "start-b-port",
    ]),
    createRegion("left", { x: -0.5, y: 0 }, 1, 1, [
      "start-a-port",
      "start-b-port",
      "shared",
      "neighbor",
    ]),
    createRegion("right", { x: 0.5, y: 0 }, 1, 1, [
      "shared",
      "neighbor",
      "end-a-port",
      "end-b-port",
    ]),
    createRegion("end-a", { x: 1.5, y: 0 }, 1, 1, ["end-a-port"]),
    createRegion("end-b", { x: 1.5, y: -0.2 }, 1, 1, ["end-b-port"]),
  ],
  ports: [
    createPort("start-a-port", "start-a", "left", -1, 0),
    createPort("start-b-port", "start-b", "left", -1, -0.2),
    createPort("shared", "left", "right", 0, 0),
    createPort("neighbor", "left", "right", 0, 0.4),
    createPort("end-a-port", "right", "end-a", 1, 0),
    createPort("end-b-port", "right", "end-b", 1, -0.2),
  ],
  connections: [
    {
      connectionId: "connection-a",
      startRegionId: "start-a",
      endRegionId: "end-a",
      mutuallyConnectedNetworkId: "net-a",
    },
    {
      connectionId: "connection-b",
      startRegionId: "start-b",
      endRegionId: "end-b",
      mutuallyConnectedNetworkId: "net-b",
    },
  ],
})

test("visualizes physical duplicate lanes when the boundary has sufficient capacity", () => {
  const solver = new DuplicateCongestedPortSolver(createFixture(), {
    duplicatePortProximity: 0.05,
    minimumDuplicatePortSpacing: REQUIRED_CENTER_SPACING,
    duplicatePortWidth: TRACE_WIDTH,
  })
  solver.solve()

  const lanePorts = solver
    .getOutput()
    .ports.filter(
      (port) =>
        port.portId === "shared" || port.d?.duplicatedFromPortId === "shared",
    )
    .sort((a, b) => Number(a.d?.y) - Number(b.d?.y))
  const actualCenterSpacing = Math.abs(
    Number(lanePorts[1]?.d?.y) - Number(lanePorts[0]?.d?.y),
  )

  const graphics: GraphicsObject = {
    rects: [
      {
        center: { x: -0.5, y: 0 },
        width: 1,
        height: 1,
        fill: "rgba(80, 140, 220, 0.12)",
        stroke: "rgb(80, 140, 220)",
        label: "left graph region",
      },
      {
        center: { x: 0.5, y: 0 },
        width: 1,
        height: 1,
        fill: "rgba(80, 140, 220, 0.12)",
        stroke: "rgb(80, 140, 220)",
        label: "right graph region",
      },
    ],
    lines: [
      {
        points: [
          { x: 0, y: -0.5 },
          { x: 0, y: 0.5 },
        ],
        strokeColor: "rgb(13, 148, 136)",
        strokeWidth: 0.012,
        label: "shared graph boundary",
      },
      ...lanePorts.flatMap((port, index) => [
        {
          points: [
            { x: -0.35, y: Number(port.d?.y) },
            { x: 0.35, y: Number(port.d?.y) },
          ],
          strokeColor: "rgba(245, 158, 11, 0.25)",
          strokeWidth: REQUIRED_CENTER_SPACING,
          label: `lane ${index + 1}: trace plus clearance`,
        },
        {
          points: [
            { x: -0.35, y: Number(port.d?.y) },
            { x: 0.35, y: Number(port.d?.y) },
          ],
          strokeColor: "rgb(220, 38, 38)",
          strokeWidth: TRACE_WIDTH,
          label: `lane ${index + 1}: physical trace`,
        },
      ]),
    ],
    points: lanePorts.map((port, index) => ({
      x: Number(port.d?.x),
      y: Number(port.d?.y),
      color: "rgb(17, 24, 39)",
      label: `graph port ${index + 1}`,
    })),
    texts: [
      {
        x: -0.95,
        y: 0.62,
        text: `Actual lane spacing: ${actualCenterSpacing.toFixed(3)} mm / ${REQUIRED_CENTER_SPACING.toFixed(3)} mm required`,
        fontSize: 0.045,
      },
      {
        x: -0.95,
        y: 0.55,
        text: "Red = 0.1 mm trace   Orange = trace + clearance   Teal = shared boundary",
        fontSize: 0.032,
        color: "rgb(75, 85, 99)",
      },
    ],
  }

  expect(lanePorts).toHaveLength(2)
  expect(
    getSvgFromGraphicsObject(graphics),
  ).toMatchSvgSnapshot(import.meta.path)
})
