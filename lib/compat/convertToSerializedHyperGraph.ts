import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { TinyHyperGraphSolver } from "../index"
import type { PortId, RegionId } from "../types"

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
  solver: TinyHyperGraphSolver,
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

  return `region-${regionId}`
}

const getSerializedPortId = (
  solver: TinyHyperGraphSolver,
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

  return `port-${portId}`
}

const getSerializedRegionData = (
  solver: TinyHyperGraphSolver,
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

  return data
}

const getSerializedPortData = (
  solver: TinyHyperGraphSolver,
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

  return data
}

const getRouteSegmentsByRoute = (
  solver: TinyHyperGraphSolver,
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
  solver: TinyHyperGraphSolver,
  portId: PortId,
  traversedRegionId: RegionId,
): RegionId => {
  const incidentRegionIds = solver.topology.incidentPortRegion[portId] ?? []
  const oppositeRegionId = incidentRegionIds.find(
    (regionId) => regionId !== traversedRegionId,
  )

  if (oppositeRegionId === undefined) {
    throw new Error(
      `Port ${portId} is not incident to a region outside route region ${traversedRegionId}`,
    )
  }

  return oppositeRegionId
}

const getOrderedRoutePath = (
  solver: TinyHyperGraphSolver,
  routeId: number,
  routeSegments: RouteSegment[],
): {
  orderedPortIds: PortId[]
  orderedRegionIds: RegionId[]
} => {
  if (routeSegments.length === 0) {
    throw new Error(`Route ${routeId} has no solved segments`)
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

  const usedSegmentIndices = new Set<number>()
  const stackPortIds = [startPortId]
  const stackIncomingSegmentIndices: Array<number | undefined> = [undefined]
  const reverseTrailPortIds: PortId[] = []
  const reverseTrailIncomingSegmentIndices: Array<number | undefined> = []

  while (stackPortIds.length > 0) {
    const currentPortId = stackPortIds[stackPortIds.length - 1]!
    const nextSegment = (segmentsByPort.get(currentPortId) ?? []).find(
      (routeSegment) => !usedSegmentIndices.has(routeSegment.segmentIndex),
    )

    if (nextSegment) {
      usedSegmentIndices.add(nextSegment.segmentIndex)
      stackPortIds.push(
        nextSegment.fromPortId === currentPortId
          ? nextSegment.toPortId
          : nextSegment.fromPortId,
      )
      stackIncomingSegmentIndices.push(nextSegment.segmentIndex)
      continue
    }

    reverseTrailPortIds.push(stackPortIds.pop()!)
    reverseTrailIncomingSegmentIndices.push(stackIncomingSegmentIndices.pop())
  }

  if (usedSegmentIndices.size !== routeSegments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }

  const orderedPortIds = reverseTrailPortIds.reverse()
  const orderedRegionIds: RegionId[] = []
  const orderedSegmentIndices = reverseTrailIncomingSegmentIndices
    .reverse()
    .slice(1)

  if (
    orderedPortIds[0] !== startPortId ||
    orderedPortIds[orderedPortIds.length - 1] !== endPortId
  ) {
    throw new Error(
      `Route ${routeId} is not a single ordered path from ${startPortId} to ${endPortId}`,
    )
  }

  for (let segmentOffset = 0; segmentOffset < orderedSegmentIndices.length; segmentOffset++) {
    const segmentIndex = orderedSegmentIndices[segmentOffset]
    if (segmentIndex === undefined) {
      throw new Error(`Route ${routeId} contains an invalid ordered segment`)
    }
    const nextSegment = routeSegments[segmentIndex]!
    const currentPortId = orderedPortIds[segmentOffset]!
    const nextPortId = orderedPortIds[segmentOffset + 1]!
    if (
      !(
        (nextSegment.fromPortId === currentPortId &&
          nextSegment.toPortId === nextPortId) ||
        (nextSegment.toPortId === currentPortId &&
          nextSegment.fromPortId === nextPortId)
      )
    ) {
      throw new Error(
        `Route ${routeId} is not a single ordered path from ${startPortId} to ${endPortId}`,
      )
    }

    orderedRegionIds.push(nextSegment.regionId)
  }

  if (orderedRegionIds.length !== routeSegments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }

  return {
    orderedPortIds,
    orderedRegionIds,
  }
}

const getSerializedConnection = (
  solver: TinyHyperGraphSolver,
  routeId: number,
  startRegionId: string,
  endRegionId: string,
): SerializedConnection => {
  const routeMetadata = solver.problem.routeMetadata?.[routeId]
  const metadataConnectionId =
    isRecord(routeMetadata) && typeof routeMetadata.connectionId === "string"
      ? routeMetadata.connectionId
      : undefined
  const metadataStartRegionId =
    isRecord(routeMetadata) && typeof routeMetadata.startRegionId === "string"
      ? routeMetadata.startRegionId
      : undefined
  const metadataEndRegionId =
    isRecord(routeMetadata) && typeof routeMetadata.endRegionId === "string"
      ? routeMetadata.endRegionId
      : undefined
  const metadataNetworkId =
    isRecord(routeMetadata) &&
    typeof routeMetadata.mutuallyConnectedNetworkId === "string"
      ? routeMetadata.mutuallyConnectedNetworkId
      : undefined

  return {
    connectionId: metadataConnectionId ?? `route-${routeId}`,
    startRegionId: metadataStartRegionId ?? startRegionId,
    endRegionId: metadataEndRegionId ?? endRegionId,
    mutuallyConnectedNetworkId:
      metadataNetworkId ?? `net-${solver.problem.routeNet[routeId]}`,
  }
}

const getSerializedSolvedRoute = (
  solver: TinyHyperGraphSolver,
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
    throw new Error(`Route ${routeId} could not determine endpoint regions`)
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
  solver: TinyHyperGraphSolver,
): SerializedHyperGraph => {
  if (!solver.solved || solver.failed) {
    throw new Error(
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
      throw new Error(`Port ${portId} is missing incident regions`)
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
