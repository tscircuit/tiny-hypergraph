import "bun-match-svg"
import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  type GraphicsObject,
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { DuplicateCongestedPortSolver } from "lib/index"

const PMP22650_ROUTE_NAMES = [
  "source_net_altium_pcb_119_mst51",
  "source_net_altium_pcb_369_mst4",
  "source_net_altium_pcb_364_mst4",
  "source_net_altium_pcb_275_mst1",
  "source_net_altium_pcb_269_mst1",
  "source_net_altium_pcb_178",
  "source_net_altium_pcb_142",
  "source_net_altium_pcb_137",
  "source_net_altium_pcb_112",
  "source_net_altium_pcb_107",
]

const CRAMPED_PORT_ID = "ce385851_pp0_z0_cramped::0"
const CRAMPED_PORT_X = 256.48340098499995
const CRAMPED_PORT_Y = 128.2826
const SHARED_BOUNDARY_LENGTH = 0.006799970000088251
const TRACE_WIDTH = 0.1
const TRACE_CLEARANCE = 0.15

const createPmp22650CrampedPortFixture = (): SerializedHyperGraph => {
  const startPorts = PMP22650_ROUTE_NAMES.map((_, index) => ({
    portId: `start-port-${index}`,
    region1Id: `start-${index}`,
    region2Id: "cmn_540",
    d: { x: 252, y: 127 + index * 0.01, z: 0 },
  }))
  const endPorts = PMP22650_ROUTE_NAMES.map((_, index) => ({
    portId: `end-port-${index}`,
    region1Id: "cmn_565-outer-merge-287__sub_0_0",
    region2Id: `end-${index}`,
    d: { x: 257, y: 128.3 + index * 0.01, z: 0 },
  }))

  return {
    regions: [
      ...startPorts.map((port, index) => ({
        regionId: `start-${index}`,
        pointIds: [port.portId],
        d: {
          center: { x: 251.9, y: 127 + index * 0.01 },
          width: 0.2,
          height: 0.2,
        },
      })),
      {
        regionId: "cmn_540",
        pointIds: [
          ...startPorts.map((port) => port.portId),
          CRAMPED_PORT_ID,
          "neighbor-port",
        ],
        d: {
          center: { x: 253.1040748817116, y: 127.0826 },
          width: 6.765452176576787,
          height: 2.4000000000000057,
        },
      },
      {
        regionId: "cmn_565-outer-merge-287__sub_0_0",
        pointIds: [
          CRAMPED_PORT_ID,
          "neighbor-port",
          ...endPorts.map((port) => port.portId),
        ],
        d: {
          center: { x: CRAMPED_PORT_X, y: 128.303 },
          width: SHARED_BOUNDARY_LENGTH,
          height: 0.0408,
        },
      },
      ...endPorts.map((port, index) => ({
        regionId: `end-${index}`,
        pointIds: [port.portId],
        d: {
          center: { x: 257.1, y: 128.3 + index * 0.01 },
          width: 0.2,
          height: 0.2,
        },
      })),
    ],
    ports: [
      ...startPorts,
      {
        portId: CRAMPED_PORT_ID,
        region1Id: "cmn_540",
        region2Id: "cmn_565-outer-merge-287__sub_0_0",
        d: {
          x: CRAMPED_PORT_X,
          y: CRAMPED_PORT_Y,
          z: 0,
          cramped: true,
        },
      },
      {
        portId: "neighbor-port",
        region1Id: "cmn_540",
        region2Id: "cmn_565-outer-merge-287__sub_0_0",
        d: { x: CRAMPED_PORT_X, y: CRAMPED_PORT_Y - 0.1, z: 0 },
      },
      ...endPorts,
    ],
    connections: PMP22650_ROUTE_NAMES.map((connectionName, index) => ({
      connectionId: connectionName,
      startRegionId: `start-${index}`,
      endRegionId: `end-${index}`,
      mutuallyConnectedNetworkId: connectionName.replace(/_mst\d+$/, ""),
    })),
  }
}

test("PMP22650 does not overstate a cramped boundary's route capacity", () => {
  const solver = new DuplicateCongestedPortSolver(
    createPmp22650CrampedPortFixture(),
    { duplicatePortProximity: 0.05 },
  )
  solver.solve()

  const lanes = solver
    .getOutput()
    .ports.filter(
      (port) =>
        port.portId === CRAMPED_PORT_ID ||
        port.d?.duplicatedFromPortId === CRAMPED_PORT_ID,
    )
    .sort((left, right) => Number(left.d?.y) - Number(right.d?.y))
  expect(lanes).toHaveLength(1)

  const graphics: GraphicsObject = {
    rects: [
      {
        center: { x: CRAMPED_PORT_X, y: CRAMPED_PORT_Y },
        width: SHARED_BOUNDARY_LENGTH,
        height: 0.12,
        fill: "rgba(37, 99, 235, 0.16)",
        stroke: "#2563eb",
        label: "real shared boundary",
      },
    ],
    lines: lanes.flatMap((port, index) => [
      {
        points: [
          { x: CRAMPED_PORT_X - 0.08, y: Number(port.d?.y) },
          { x: CRAMPED_PORT_X + 0.08, y: Number(port.d?.y) },
        ],
        strokeColor: "rgba(249, 115, 22, 0.2)",
        strokeWidth: TRACE_WIDTH + TRACE_CLEARANCE,
        label: `lane ${index + 1}: trace and clearance`,
      },
      {
        points: [
          { x: CRAMPED_PORT_X - 0.08, y: Number(port.d?.y) },
          { x: CRAMPED_PORT_X + 0.08, y: Number(port.d?.y) },
        ],
        strokeColor: "#dc2626",
        strokeWidth: TRACE_WIDTH,
        label: `lane ${index + 1}: physical trace`,
      },
    ]),
    points: lanes.map((port, index) => ({
      x: Number(port.d?.x),
      y: Number(port.d?.y),
      color: "#111827",
      label: `lane ${index + 1}`,
    })),
    circles: [],
  }
  const svg = getSvgFromGraphicsObject(
    stackGraphicsVertically([graphics], {
      titles: [
        `PMP22650 0.0068 mm cramped boundary: ${lanes.length} graph lanes`,
      ],
    }),
  )

  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
