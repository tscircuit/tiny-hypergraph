import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { TinyHyperGraphSolver2View } from "./solver-view"
import { getAvailableZFromMask, getZLayerLabel } from "../lib/layerLabels"
import type { PortId, RegionId } from "./types"

type SerializedConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]
type SerializedSolvedRoute = NonNullable<
  SerializedHyperGraph["solvedRoutes"]
>[number]
type SerializedCandidate = SerializedSolvedRoute["path"][number]

interface RouteSegment {
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

export class SerializedGraphOutputInvariantError extends Error {
  readonly _tag = "SerializedGraphOutputInvariantError"

  constructor(readonly reason: string) {
    super(`Invalid serialized graph output invariant: ${reason}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toObjectRecord = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return { ...value }
  if (value === undefined) return {}
  return { value }
}

const normalizePortIdFallback = (value: string) =>
  value.includes("::") ? value.slice(0, value.indexOf("::")) : value

const getSerializedRegionId = (
  solver: TinyHyperGraphSolver2View,
  regionId: RegionId,
): string => {
  const metadata = solver.topology.regionMetadata?.[regionId]
  if (isRecord(metadata)) {
    if (typeof metadata.serializedRegionId === "string") {
      return metadata.serializedRegionId
    }

    if (typeof metadata.regionId === "string") {
      return metadata.regionId
    }

    if (typeof metadata.capacityMeshNodeId === "string") {
      return metadata.capacityMeshNodeId
    }
  }

  throw new SerializedGraphOutputInvariantError(
    `region ${regionId} is missing serializedRegionId, regionId, or capacityMeshNodeId metadata`,
  )
}

const getSerializedPortId = (
  solver: TinyHyperGraphSolver2View,
  portId: PortId,
): string => {
  const metadata = solver.topology.portMetadata?.[portId]
  if (isRecord(metadata)) {
    if (typeof metadata.serializedPortId === "string") {
      return metadata.serializedPortId
    }

    if (typeof metadata.portId === "string") {
      return normalizePortIdFallback(metadata.portId)
    }
  }

  throw new SerializedGraphOutputInvariantError(
    `port ${portId} is missing serializedPortId or portId metadata`,
  )
}

const getSerializedRegionData = (
  solver: TinyHyperGraphSolver2View,
  regionId: RegionId,
): Record<string, unknown> => {
  const data = toObjectRecord(solver.topology.regionMetadata?.[regionId])

  if (!isRecord(data.center)) {
    data.center = {
      x: solver.topology.regionCenterX[regionId],
      y: solver.topology.regionCenterY[regionId],
    }
  }

  if (typeof data.width !== "number") {
    data.width = solver.topology.regionWidth[regionId]
  }

  if (typeof data.height !== "number") {
    data.height = solver.topology.regionHeight[regionId]
  }

  if (!Array.isArray(data.availableZ)) {
    const availableZMask = solver.topology.regionAvailableZMask?.[regionId] ?? 0
    if (availableZMask !== 0) {
      data.availableZ = getAvailableZFromMask(availableZMask)
    }
  }

  data.layer =
    getZLayerLabel(Array.isArray(data.availableZ) ? data.availableZ : []) ??
    getZLayerLabel(
      (solver.topology.regionIncidentPorts[regionId] ?? []).map(
        (portId) => solver.topology.portZ[portId],
      ),
    ) ??
    "z0"

  return data
}

const getSerializedPortData = (
  solver: TinyHyperGraphSolver2View,
  portId: PortId,
): Record<string, unknown> => {
  const data = toObjectRecord(solver.topology.portMetadata?.[portId])

  if (typeof data.x !== "number") {
    data.x = solver.topology.portX[portId]
  }

  if (typeof data.y !== "number") {
    data.y = solver.topology.portY[portId]
  }

  if (typeof data.z !== "number") {
    data.z = solver.topology.portZ[portId]
  }

  data.layer = getZLayerLabel([solver.topology.portZ[portId]]) ?? "z0"

  return data
}

const getRouteSegmentsByRoute = (
  solver: TinyHyperGraphSolver2View,
): Array<RouteSegment[]> => {
  const routeSegmentsByRoute = Array.from(
    { length: solver.problem.routeCount },
    () => [] as RouteSegment[],
  )

  solver.state.regionSegments.forEach((regionSegments, regionId) => {
    for (const [routeId, fromPortId, toPortId] of regionSegments) {
      routeSegmentsByRoute[routeId]!.push({
        regionId,
        fromPortId,
        toPortId,
      })
    }
  })

  return routeSegmentsByRoute
}

const getOppositeRegionIdForPort = (
  solver: TinyHyperGraphSolver2View,
  portId: PortId,
  traversedRegionId: RegionId,
): RegionId => {
  const incidentRegionIds = solver.topology.incidentPortRegion[portId] ?? []
  const oppositeRegionIds = incidentRegionIds.filter(
    (regionId) => regionId !== traversedRegionId,
  )

  if (oppositeRegionIds.length !== 1) {
    throw new SerializedGraphOutputInvariantError(
      `port ${portId} has ${oppositeRegionIds.length} opposite regions for route region ${traversedRegionId}`,
    )
  }

  return oppositeRegionIds[0]!
}

const getOrderedRoutePath = (
  solver: TinyHyperGraphSolver2View,
  routeId: number,
  routeSegments: RouteSegment[],
): {
  orderedPortIds: PortId[]
  orderedRegionIds: RegionId[]
} => {
  if (routeSegments.length === 0) {
    throw new SerializedGraphOutputInvariantError(
      `route ${routeId} has no solved segments`,
    )
  }

  const startPortId = solver.problem.routeStartPort[routeId]
  const endPortId = solver.problem.routeEndPort[routeId]
  const segmentsByPort = new Map<
    PortId,
    Array<RouteSegment & { segmentIndex: number }>
  >()

  routeSegments.forEach((routeSegment, segmentIndex) => {
    const indexedRouteSegment = {
      ...routeSegment,
      segmentIndex,
    }

    const fromPortSegments = segmentsByPort.get(routeSegment.fromPortId) ?? []
    fromPortSegments.push(indexedRouteSegment)
    segmentsByPort.set(routeSegment.fromPortId, fromPortSegments)

    const toPortSegments = segmentsByPort.get(routeSegment.toPortId) ?? []
    toPortSegments.push(indexedRouteSegment)
    segmentsByPort.set(routeSegment.toPortId, toPortSegments)
  })

  const orderedPortIds = [startPortId]
  const orderedRegionIds: RegionId[] = []

  const appendSimplePathToEnd = (
    currentPortId: PortId,
    usedSegmentIndices: Set<number>,
    visitedPortIds: Set<PortId>,
  ): boolean => {
    if (currentPortId === endPortId) {
      return true
    }

    for (const routeSegment of segmentsByPort.get(currentPortId) ?? []) {
      if (usedSegmentIndices.has(routeSegment.segmentIndex)) continue

      const nextPortId =
        routeSegment.fromPortId === currentPortId
          ? routeSegment.toPortId
          : routeSegment.fromPortId

      if (visitedPortIds.has(nextPortId)) continue

      usedSegmentIndices.add(routeSegment.segmentIndex)
      visitedPortIds.add(nextPortId)
      orderedRegionIds.push(routeSegment.regionId)
      orderedPortIds.push(nextPortId)

      if (
        appendSimplePathToEnd(nextPortId, usedSegmentIndices, visitedPortIds)
      ) {
        return true
      }

      orderedPortIds.pop()
      orderedRegionIds.pop()
      visitedPortIds.delete(nextPortId)
      usedSegmentIndices.delete(routeSegment.segmentIndex)
    }

    return false
  }

  if (
    !appendSimplePathToEnd(
      startPortId,
      new Set<number>(),
      new Set([startPortId]),
    )
  ) {
    throw new SerializedGraphOutputInvariantError(
      `Route ${routeId} is not a single ordered path from ${startPortId} to ${endPortId}`,
    )
  }

  return {
    orderedPortIds,
    orderedRegionIds,
  }
}

const getSerializedConnection = (
  solver: TinyHyperGraphSolver2View,
  routeId: number,
  startRegionId: string,
  endRegionId: string,
): SerializedConnection => {
  const routeMetadata = solver.problem.routeMetadata?.[routeId]
  if (!isRecord(routeMetadata)) {
    throw new SerializedGraphOutputInvariantError(
      `route ${routeId} is missing route metadata`,
    )
  }

  const metadataConnectionId =
    typeof routeMetadata.connectionId === "string"
      ? routeMetadata.connectionId
      : undefined
  const metadataStartRegionId =
    typeof routeMetadata.startRegionId === "string"
      ? routeMetadata.startRegionId
      : undefined
  const metadataEndRegionId =
    typeof routeMetadata.endRegionId === "string"
      ? routeMetadata.endRegionId
      : undefined
  const metadataNetworkId =
    typeof routeMetadata.mutuallyConnectedNetworkId === "string"
      ? routeMetadata.mutuallyConnectedNetworkId
      : undefined

  if (!metadataConnectionId) {
    throw new SerializedGraphOutputInvariantError(
      `route ${routeId} is missing connectionId metadata`,
    )
  }

  if (!metadataNetworkId) {
    throw new SerializedGraphOutputInvariantError(
      `route ${routeId} is missing mutuallyConnectedNetworkId metadata`,
    )
  }

  return {
    connectionId: metadataConnectionId,
    startRegionId: metadataStartRegionId ?? startRegionId,
    endRegionId: metadataEndRegionId ?? endRegionId,
    mutuallyConnectedNetworkId: metadataNetworkId,
  }
}

const getSerializedSolvedRoute = (
  solver: TinyHyperGraphSolver2View,
  routeId: number,
  routeSegments: RouteSegment[],
): {
  connection: SerializedConnection
  solvedRoute: SerializedSolvedRoute
} => {
  const { orderedPortIds, orderedRegionIds } = getOrderedRoutePath(
    solver,
    routeId,
    routeSegments,
  )

  const firstRegionId = orderedRegionIds[0]
  const lastRegionId = orderedRegionIds[orderedRegionIds.length - 1]

  if (firstRegionId === undefined || lastRegionId === undefined) {
    throw new SerializedGraphOutputInvariantError(
      `route ${routeId} could not determine endpoint regions`,
    )
  }

  const fallbackStartRegionId = getSerializedRegionId(
    solver,
    getOppositeRegionIdForPort(solver, orderedPortIds[0]!, firstRegionId),
  )
  const fallbackEndRegionId = getSerializedRegionId(
    solver,
    getOppositeRegionIdForPort(
      solver,
      orderedPortIds[orderedPortIds.length - 1]!,
      lastRegionId,
    ),
  )
  const connection = getSerializedConnection(
    solver,
    routeId,
    fallbackStartRegionId,
    fallbackEndRegionId,
  )

  const path = orderedPortIds.map((portId, pathIndex) => {
    const serializedCandidate: SerializedCandidate = {
      portId: getSerializedPortId(solver, portId),
      g: pathIndex,
      h: 0,
      f: pathIndex,
      hops: pathIndex,
      ripRequired: false,
      nextRegionId:
        pathIndex < orderedRegionIds.length
          ? getSerializedRegionId(solver, orderedRegionIds[pathIndex]!)
          : connection.endRegionId,
    }

    if (pathIndex > 0) {
      serializedCandidate.lastPortId = getSerializedPortId(
        solver,
        orderedPortIds[pathIndex - 1]!,
      )
      serializedCandidate.lastRegionId = getSerializedRegionId(
        solver,
        orderedRegionIds[pathIndex - 1]!,
      )
    }

    return serializedCandidate
  })

  return {
    connection,
    solvedRoute: {
      connection,
      path,
      requiredRip: false,
    },
  }
}

export const convertToSerializedHyperGraph = (
  solver: TinyHyperGraphSolver2View,
): SerializedHyperGraph => {
  if (!solver.solved || solver.failed) {
    throw new SerializedGraphOutputInvariantError(
      "convertToSerializedHyperGraph requires a solved, non-failed solver",
    )
  }

  const { topology } = solver
  const routeSegmentsByRoute = getRouteSegmentsByRoute(solver)

  const regions = Array.from(
    { length: topology.regionCount },
    (_, regionId) => ({
      regionId: getSerializedRegionId(solver, regionId),
      pointIds: topology.regionIncidentPorts[regionId]!.map((portId) =>
        getSerializedPortId(solver, portId),
      ),
      d: getSerializedRegionData(solver, regionId),
    }),
  )

  const ports = Array.from({ length: topology.portCount }, (_, portId) => {
    const [region1Id, region2Id] = topology.incidentPortRegion[portId] ?? []

    if (region1Id === undefined || region2Id === undefined) {
      throw new SerializedGraphOutputInvariantError(
        `port ${portId} is missing incident regions`,
      )
    }

    return {
      portId: getSerializedPortId(solver, portId),
      region1Id: getSerializedRegionId(solver, region1Id),
      region2Id: getSerializedRegionId(solver, region2Id),
      d: getSerializedPortData(solver, portId),
    }
  })

  const serializedRoutes = routeSegmentsByRoute.map((routeSegments, routeId) =>
    getSerializedSolvedRoute(solver, routeId, routeSegments),
  )

  return {
    regions,
    ports,
    connections: serializedRoutes.map(({ connection }) => connection),
    solvedRoutes: serializedRoutes.map(({ solvedRoute }) => solvedRoute),
  }
}
