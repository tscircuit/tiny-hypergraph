import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { DuplicateCongestedPortSolver } from "lib/index"

type SerializedPort = SerializedHyperGraph["ports"][number]

const LEFT_PORT_ID = "ce366474_pp0_z0::0"
const RIGHT_PORT_ID = "ce366571_pp0_z0_cramped::0"
const CONNECTION_COUNT = 7
const LEFT_X = 265.68020016
const RIGHT_X = 266.08019936
const PORT_Y = 122.75039966

const createRegion = (
  regionId: string,
  center: { x: number; y: number },
  pointIds: string[],
): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: { center, width: 0.4, height: 2.4 },
})

const createPort = (
  portId: string,
  region1Id: string,
  region2Id: string,
  x: number,
  y: number,
  penalty = 0,
): SerializedPort => ({
  portId,
  region1Id,
  region2Id,
  d: { x, y, z: 0, tinyHypergraphPortPenalty: penalty },
})

const createPmp22650OrderingFixture = (): SerializedHyperGraph => {
  const connections = Array.from({ length: CONNECTION_COUNT }, (_, index) => ({
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
      LEFT_X - 0.4,
      PORT_Y,
    ),
  )
  const endPorts = connections.map((_, index) =>
    createPort(
      `end-port-${index}`,
      "right",
      `end-${index}`,
      RIGHT_X + 0.4,
      PORT_Y,
    ),
  )

  return {
    regions: [
      ...connections.map((_, index) =>
        createRegion(`start-${index}`, { x: LEFT_X - 0.6, y: PORT_Y }, [
          `start-port-${index}`,
        ]),
      ),
      createRegion("left", { x: LEFT_X - 0.2, y: PORT_Y }, [
        ...startPorts.map(({ portId }) => portId),
        LEFT_PORT_ID,
        "left-neighbor",
      ]),
      createRegion("center", { x: (LEFT_X + RIGHT_X) / 2, y: PORT_Y }, [
        LEFT_PORT_ID,
        "left-neighbor",
        RIGHT_PORT_ID,
        "right-neighbor",
      ]),
      createRegion("right", { x: RIGHT_X + 0.2, y: PORT_Y }, [
        RIGHT_PORT_ID,
        "right-neighbor",
        ...endPorts.map(({ portId }) => portId),
      ]),
      ...connections.map((_, index) =>
        createRegion(`end-${index}`, { x: RIGHT_X + 0.6, y: PORT_Y }, [
          `end-port-${index}`,
        ]),
      ),
    ],
    ports: [
      ...startPorts,
      createPort(LEFT_PORT_ID, "left", "center", LEFT_X, PORT_Y),
      createPort("left-neighbor", "left", "center", LEFT_X, PORT_Y + 1, 1_000),
      createPort(RIGHT_PORT_ID, "center", "right", RIGHT_X, PORT_Y),
      createPort(
        "right-neighbor",
        "center",
        "right",
        RIGHT_X,
        PORT_Y - 1,
        1_000,
      ),
      ...endPorts,
    ],
    connections,
  }
}

const getDuplicateIndex = (port: SerializedPort) =>
  typeof port.d?.duplicateIndex === "number" ? port.d.duplicateIndex : 0

const getPortsForSource = (ports: SerializedPort[], sourcePortId: string) =>
  ports
    .filter(
      (port) =>
        port.portId === sourcePortId ||
        port.d?.duplicatedFromPortId === sourcePortId,
    )
    .sort((a, b) => getDuplicateIndex(a) - getDuplicateIndex(b))

const getCrossingCount = (
  leftPorts: SerializedPort[],
  rightPorts: SerializedPort[],
) => {
  let crossingCount = 0
  for (let firstIndex = 0; firstIndex < leftPorts.length; firstIndex++) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < leftPorts.length;
      secondIndex++
    ) {
      const leftDelta =
        Number(leftPorts[firstIndex].d?.y) - Number(leftPorts[secondIndex].d?.y)
      const rightDelta =
        Number(rightPorts[firstIndex].d?.y) -
        Number(rightPorts[secondIndex].d?.y)
      if (leftDelta * rightDelta < 0) crossingCount++
    }
  }
  return crossingCount
}

test("visualizes duplicate-port ordering from PMP22650", () => {
  const solver = new DuplicateCongestedPortSolver(
    createPmp22650OrderingFixture(),
    { duplicatePortProximity: 0.05 },
  )
  solver.solve()

  const output = solver.getOutput()
  const leftPorts = getPortsForSource(output.ports, LEFT_PORT_ID)
  const rightPorts = getPortsForSource(output.ports, RIGHT_PORT_ID)
  const crossingCount = getCrossingCount(leftPorts, rightPorts)
  const svg = getSvgFromGraphicsObject({
    rects: [
      {
        center: { x: (LEFT_X + RIGHT_X) / 2, y: PORT_Y + 0.025 },
        width: RIGHT_X - LEFT_X,
        height: 0.12,
        fill: "rgba(80, 140, 220, 0.12)",
        stroke: "rgb(80, 140, 220)",
        label: "PMP22650 capacity-mesh node",
      },
    ],
    lines: leftPorts.map((leftPort, index) => ({
      points: [
        { x: Number(leftPort.d?.x), y: Number(leftPort.d?.y) },
        {
          x: Number(rightPorts[index].d?.x),
          y: Number(rightPorts[index].d?.y),
        },
      ],
      strokeColor: `hsl(${(index * 360) / CONNECTION_COUNT} 75% 45%)`,
      strokeWidth: 0.004,
      label: `duplicate ${index}`,
    })),
    points: [...leftPorts, ...rightPorts].map((port) => ({
      x: Number(port.d?.x),
      y: Number(port.d?.y),
      color: "rgb(20, 20, 20)",
      label: `duplicate ${getDuplicateIndex(port)}`,
    })),
    circles: [],
  })

  expect(leftPorts).toHaveLength(CONNECTION_COUNT)
  expect(rightPorts).toHaveLength(CONNECTION_COUNT)
  expect(crossingCount).toBe(0)
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
