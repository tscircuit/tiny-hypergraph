import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
  type GraphicsObject,
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

const createSample4BoundaryFixture = (): SerializedHyperGraph => {
  const connections = Array.from({ length: 7 }, (_, index) => ({
    connectionId: `route-${index}`,
    startRegionId: `start-${index}`,
    endRegionId: `end-${index}`,
    mutuallyConnectedNetworkId: `net-${index}`,
  }))
  const startPorts = connections.map((_, index) =>
    createPort(`start-port-${index}`, `start-${index}`, "left", -0.3, 0),
  )
  const endPorts = connections.map((_, index) =>
    createPort(`end-port-${index}`, "right", `end-${index}`, 0.3, 0),
  )

  return {
    regions: [
      ...connections.map((_, index) =>
        createRegion(`start-${index}`, { x: -0.4, y: 0 }, 0.1, 0.1, [
          `start-port-${index}`,
        ]),
      ),
      // Exact sample 4 shared opening: 0.396 mm tall with a 0.05 mm gap.
      createRegion("left", { x: -0.127, y: 0 }, 0.204, 0.396, [
        ...startPorts.map((port) => port.portId),
        "sample4-opening",
      ]),
      createRegion("right", { x: 0.103, y: 0 }, 0.156, 0.396, [
        "sample4-opening",
        ...endPorts.map((port) => port.portId),
      ]),
      ...connections.map((_, index) =>
        createRegion(`end-${index}`, { x: 0.4, y: 0 }, 0.1, 0.1, [
          `end-port-${index}`,
        ]),
      ),
    ],
    ports: [
      ...startPorts,
      createPort("sample4-opening", "left", "right", 0, 0),
      ...endPorts,
    ],
    connections,
  }
}

test("visualizes the physical capacity of a real sample 4 opening", () => {
  const solver = new DuplicateCongestedPortSolver(
    createSample4BoundaryFixture(),
    {
      duplicatePortProximity: 0.05,
      // Older implementations ignore these options, which is the issue this
      // snapshot reproduces.
      minimumDuplicatePortSpacing: 0.2,
      duplicatePortWidth: 0.1,
    } as any,
  )
  solver.solve()

  const output = solver.getOutput()
  const lanes = output.ports
    .filter(
      (port) =>
        port.portId === "sample4-opening" ||
        port.d?.duplicatedFromPortId === "sample4-opening",
    )
    .sort((a, b) => Number(a.d?.y) - Number(b.d?.y))
  const graphics: GraphicsObject = {
    rects: [
      {
        center: { x: -0.127, y: 0 },
        width: 0.204,
        height: 0.396,
        fill: "rgba(80, 140, 220, 0.16)",
        stroke: "rgb(80, 140, 220)",
        label: "left region",
      },
      {
        center: { x: 0.103, y: 0 },
        width: 0.156,
        height: 0.396,
        fill: "rgba(80, 140, 220, 0.16)",
        stroke: "rgb(80, 140, 220)",
        label: "right region",
      },
    ],
    lines: lanes.flatMap((port, index) => [
      {
        points: [
          { x: -0.16, y: Number(port.d?.y) },
          { x: 0.16, y: Number(port.d?.y) },
        ],
        strokeColor: "rgba(255, 120, 0, 0.2)",
        strokeWidth: 0.2,
        label: `lane ${index + 1}: 0.1 mm trace + 0.1 mm clearance`,
      },
      {
        points: [
          { x: -0.16, y: Number(port.d?.y) },
          { x: 0.16, y: Number(port.d?.y) },
        ],
        strokeColor: "rgb(210, 45, 45)",
        strokeWidth: 0.1,
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
      titles: [`Sample 4 opening: ${lanes.length} lanes / 2 physical capacity`],
    }),
  )
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
