import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { TinyHyperGraphSolver } from "../core"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import { TinyHyperGraphSectionSolver } from "../section-solver"

type SerializedConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]
type SerializedPort = SerializedHyperGraph["ports"][number]

type BusAugmentedConnection = SerializedConnection & {
  _bus?: {
    id: string
  }
  busEndpointPointIds?: string[]
  busRouteIndex?: number
}

export interface TinyHyperGraphBusConnectionPatch {
  connectionId: string
  pointIds: string[]
  _bus: {
    id: string
  }
}

export interface TinyHyperGraphBusData {
  busId: string
  pointIds: string[]
  connectionPatches: TinyHyperGraphBusConnectionPatch[]
}

export interface TinyHyperGraphBusPathPoint {
  portId: string
  x: number
  y: number
  z: number
}

export interface TinyHyperGraphBusTracePath {
  connectionId: string
  routeIndex: number
  points: TinyHyperGraphBusPathPoint[]
  regionIds: string[]
}

export interface TinyHyperGraphBusTracePolyline {
  points: TinyHyperGraphBusPathPoint[]
  cumulativeLengths: number[]
  totalLength: number
}

export interface TinyHyperGraphBusCenterlinePoint {
  x: number
  y: number
}

export interface TinyHyperGraphBusBaselineStageOutput {
  busId: string
  serializedHyperGraph: SerializedHyperGraph
  baselineNoIntersectionCostPaths: TinyHyperGraphBusTracePath[]
}

export interface TinyHyperGraphBusRouterPipelineOutput
  extends TinyHyperGraphBusBaselineStageOutput {
  centerlinePath: TinyHyperGraphBusCenterlinePoint[]
  centerlineSegmentCount: number
}

const getPortCoordinate = (
  port: SerializedPort | undefined,
  coordinate: "x" | "y" | "z",
) => {
  const value = port?.d?.[coordinate]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export const createBusSerializedHyperGraph = (
  serializedHyperGraph: SerializedHyperGraph,
  bus: TinyHyperGraphBusData,
): SerializedHyperGraph => {
  const connectionById = new Map(
    (serializedHyperGraph.connections ?? []).map((connection) => [
      connection.connectionId,
      connection,
    ]),
  )
  const seenConnectionIds = new Set<string>()

  const orderedConnections = bus.connectionPatches.map(
    (connectionPatch, busRouteIndex) => {
      if (connectionPatch._bus.id !== bus.busId) {
        throw new Error(
          `Connection patch "${connectionPatch.connectionId}" targets bus "${connectionPatch._bus.id}" instead of "${bus.busId}"`,
        )
      }

      if (seenConnectionIds.has(connectionPatch.connectionId)) {
        throw new Error(
          `Bus "${bus.busId}" contains duplicate connection "${connectionPatch.connectionId}"`,
        )
      }
      seenConnectionIds.add(connectionPatch.connectionId)

      const connection = connectionById.get(connectionPatch.connectionId)
      if (!connection) {
        throw new Error(
          `Connection "${connectionPatch.connectionId}" is not present in the serialized hypergraph`,
        )
      }

      const busConnection: BusAugmentedConnection = {
        ...connection,
        _bus: { id: bus.busId },
        busEndpointPointIds: [...connectionPatch.pointIds],
        busRouteIndex,
      }

      return busConnection as SerializedConnection
    },
  )

  return {
    ...serializedHyperGraph,
    connections: orderedConnections,
    solvedRoutes: undefined,
  }
}

export const extractBusTracePaths = (
  serializedHyperGraph: SerializedHyperGraph,
): TinyHyperGraphBusTracePath[] => {
  const portById = new Map(
    serializedHyperGraph.ports.map((port) => [port.portId, port]),
  )
  const connections = serializedHyperGraph.connections ?? []
  const solvedRoutes = serializedHyperGraph.solvedRoutes ?? []

  return connections.map((connection, routeIndex) => {
    const solvedRoute = solvedRoutes[routeIndex]
    if (!solvedRoute || solvedRoute.path.length === 0) {
      throw new Error(
        `Connection "${connection.connectionId}" does not have a solved route path`,
      )
    }

    const regionIds = solvedRoute.path
      .slice(0, -1)
      .map((candidate) => candidate.nextRegionId)

    if (regionIds.some((regionId) => typeof regionId !== "string")) {
      throw new Error(
        `Connection "${connection.connectionId}" has a solved route with missing region ids`,
      )
    }

    const resolvedRegionIds = regionIds as string[]

    return {
      connectionId: connection.connectionId,
      routeIndex,
      points: solvedRoute.path.map((candidate) => {
        const port = portById.get(candidate.portId)
        if (!port) {
          throw new Error(
            `Solved route for "${connection.connectionId}" references missing port "${candidate.portId}"`,
          )
        }

        return {
          portId: candidate.portId,
          x: getPortCoordinate(port, "x"),
          y: getPortCoordinate(port, "y"),
          z: getPortCoordinate(port, "z"),
        }
      }),
      regionIds: resolvedRegionIds,
    }
  })
}

export const createBusTracePolyline = (
  tracePath: TinyHyperGraphBusTracePath,
): TinyHyperGraphBusTracePolyline => {
  const cumulativeLengths = [0]
  let totalLength = 0

  for (let pointIndex = 1; pointIndex < tracePath.points.length; pointIndex++) {
    const previousPoint = tracePath.points[pointIndex - 1]!
    const currentPoint = tracePath.points[pointIndex]!
    totalLength += Math.hypot(
      currentPoint.x - previousPoint.x,
      currentPoint.y - previousPoint.y,
    )
    cumulativeLengths.push(totalLength)
  }

  return {
    points: tracePath.points,
    cumulativeLengths,
    totalLength,
  }
}

export const sampleBusTracePolylineAtProgress = (
  tracePolyline: TinyHyperGraphBusTracePolyline,
  progress: number,
): TinyHyperGraphBusCenterlinePoint => {
  const clampedProgress = Math.min(1, Math.max(0, progress))
  const firstPoint = tracePolyline.points[0]
  const lastPoint = tracePolyline.points[tracePolyline.points.length - 1]

  if (!firstPoint || !lastPoint) {
    throw new Error("Bus trace polyline must contain at least one point")
  }

  if (tracePolyline.points.length === 1 || tracePolyline.totalLength === 0) {
    return {
      x: firstPoint.x,
      y: firstPoint.y,
    }
  }

  const targetLength = tracePolyline.totalLength * clampedProgress
  for (
    let pointIndex = 1;
    pointIndex < tracePolyline.points.length;
    pointIndex++
  ) {
    const segmentStartLength = tracePolyline.cumulativeLengths[pointIndex - 1]!
    const segmentEndLength = tracePolyline.cumulativeLengths[pointIndex]!

    if (targetLength < segmentStartLength || targetLength > segmentEndLength) {
      continue
    }

    const segmentLength = segmentEndLength - segmentStartLength
    const startPoint = tracePolyline.points[pointIndex - 1]!
    const endPoint = tracePolyline.points[pointIndex]!

    if (segmentLength === 0) {
      return {
        x: startPoint.x,
        y: startPoint.y,
      }
    }

    const t = (targetLength - segmentStartLength) / segmentLength
    return {
      x: startPoint.x + (endPoint.x - startPoint.x) * t,
      y: startPoint.y + (endPoint.y - startPoint.y) * t,
    }
  }

  return {
    x: lastPoint.x,
    y: lastPoint.y,
  }
}

export const createBusReplaySolver = (
  serializedHyperGraph: SerializedHyperGraph,
): TinyHyperGraphSolver => {
  const { topology, problem, solution } =
    loadSerializedHyperGraph(serializedHyperGraph)
  const replaySolver = new TinyHyperGraphSectionSolver(
    topology,
    problem,
    solution,
  )

  return replaySolver.baselineSolver
}
