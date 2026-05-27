import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import {
  getSinglePortPointPathingSolverParams,
  type SerializedHyperGraphPortPointPathingSolverInput,
} from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { ddr5Pipeline7PortPointPathingInput } from "tiny-hypergraph-repros"

const TINY_TERMINAL_REGION_SIZE = 1e-6

type SerializedRegion = SerializedHyperGraph["regions"][number]
type SerializedConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]
type Point = { x: number; y: number }
type ConnectionWithRouteDetails = SerializedConnection & {
  simpleRouteConnection?: {
    pointsToConnect?: readonly [Point?, Point?]
  }
}

const isPoint = (value: unknown): value is Point =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Point).x === "number" &&
  typeof (value as Point).y === "number"

const getConnectionPoint = (
  connection: SerializedConnection,
  pointIndex: 0 | 1,
): Point | undefined => {
  const connectionWithDetails = connection as ConnectionWithRouteDetails
  const point =
    connectionWithDetails.simpleRouteConnection?.pointsToConnect?.[pointIndex]

  return isPoint(point) ? point : undefined
}

const getRegionCenter = (region: SerializedRegion): Point => {
  const center = region.d?.center
  if (!isPoint(center)) {
    throw new Error(`Region "${region.regionId}" is missing a center point`)
  }

  return center
}

const getRegionAvailableZ = (region: SerializedRegion): number[] => {
  const availableZ = region.d?.availableZ
  if (!Array.isArray(availableZ)) {
    return [0]
  }

  return availableZ.filter((z): z is number => typeof z === "number")
}

const addConnectionTerminalPorts = (
  graph: SerializedHyperGraph,
): SerializedHyperGraph => {
  const regions = structuredClone(graph.regions)
  const ports = structuredClone(graph.ports)
  const connections = graph.connections ?? []
  const regionById = new Map(regions.map((region) => [region.regionId, region]))

  for (const connection of connections) {
    const startPoint = getConnectionPoint(connection, 0)
    const endPoint = getConnectionPoint(connection, 1)
    const startRegion = regionById.get(connection.startRegionId)
    const endRegion = regionById.get(connection.endRegionId)

    if (!startRegion || !endRegion) continue

    const startRegionCenter = getRegionCenter(startRegion)
    const endRegionCenter = getRegionCenter(endRegion)
    const startAvailableZ = getRegionAvailableZ(startRegion)
    const endAvailableZ = getRegionAvailableZ(endRegion)
    const startTerminalRegionId = `tiny-terminal:start-region:${connection.connectionId}`
    const endTerminalRegionId = `tiny-terminal:end-region:${connection.connectionId}`
    const startTerminalPortId = `tiny-terminal:start-port:${connection.connectionId}`
    const endTerminalPortId = `tiny-terminal:end-port:${connection.connectionId}`

    // The UI pipeline gives each connection concrete endpoint coordinates; mirror
    // those as tiny terminal regions so tiny-hypergraph sees the same endpoint
    // port/region shape as the crashing board input.
    regions.push({
      regionId: startTerminalRegionId,
      pointIds: [startTerminalPortId],
      d: {
        center: startPoint ?? startRegionCenter,
        width: TINY_TERMINAL_REGION_SIZE,
        height: TINY_TERMINAL_REGION_SIZE,
        availableZ: [...startAvailableZ],
      },
    })
    regions.push({
      regionId: endTerminalRegionId,
      pointIds: [endTerminalPortId],
      d: {
        center: endPoint ?? endRegionCenter,
        width: TINY_TERMINAL_REGION_SIZE,
        height: TINY_TERMINAL_REGION_SIZE,
        availableZ: [...endAvailableZ],
      },
    })

    ports.push({
      portId: startTerminalPortId,
      region1Id: connection.startRegionId,
      region2Id: startTerminalRegionId,
      d: {
        portId: startTerminalPortId,
        x: startPoint?.x ?? startRegionCenter.x,
        y: startPoint?.y ?? startRegionCenter.y,
        z: startAvailableZ[0] ?? 0,
        distToCentermostPortOnZ: 0,
      },
    })
    ports.push({
      portId: endTerminalPortId,
      region1Id: connection.endRegionId,
      region2Id: endTerminalRegionId,
      d: {
        portId: endTerminalPortId,
        x: endPoint?.x ?? endRegionCenter.x,
        y: endPoint?.y ?? endRegionCenter.y,
        z: endAvailableZ[0] ?? 0,
        distToCentermostPortOnZ: 0,
      },
    })

    startRegion.pointIds.push(startTerminalPortId)
    endRegion.pointIds.push(endTerminalPortId)
  }

  return {
    ...graph,
    regions,
    ports,
  }
}

test("repro: DDR5 pipeline7 port-point-pathing input implies multi-GB dense hop state", () => {
  const input = getSinglePortPointPathingSolverParams(
    ddr5Pipeline7PortPointPathingInput as SerializedHyperGraphPortPointPathingSolverInput,
  )
  const graph = addConnectionTerminalPorts({
    regions: input.graph.regions,
    ports: input.graph.ports,
    connections: input.connections,
  })
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const denseHopCount = topology.portCount * topology.regionCount
  const denseHopBytes = denseHopCount * (8 + 4)

  expect({
    boardName: "DDR5",
    source: "SRG 18 pipeline 7 circuit 6",
    regionCount: topology.regionCount,
    portCount: topology.portCount,
    routeCount: problem.routeCount,
    denseHopCount,
    denseHopBytes,
  }).toMatchInlineSnapshot(`
    {
      "boardName": "DDR5",
      "denseHopBytes": 4376940276,
      "denseHopCount": 364745023,
      "portCount": 28277,
      "regionCount": 12899,
      "routeCount": 79,
      "source": "SRG 18 pipeline 7 circuit 6",
    }
  `)

  expect(topology.regionCount).toBeGreaterThan(12_000)
  expect(topology.portCount).toBeGreaterThan(27_000)
  expect(denseHopBytes).toBeGreaterThan(4_000_000_000)

  // Do not construct TinyHyperGraphSolver in this repro: current construction
  // attempts to allocate dense hop state at this size, which is the crash.
})
