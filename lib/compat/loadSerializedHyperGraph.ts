import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../index"
import {
  PORT_POINT_PATHING_SOLVER_TUNING_KEY,
  type PortPointPathingSolverTuning,
} from "./convertPortPointPathingSolverInputToSerializedHyperGraph"

const getSerializedRegionNetId = (
  region: SerializedHyperGraph["regions"][number],
) => {
  const netId =
    typeof region.d?.netId === "number"
      ? region.d.netId
      : typeof region.d?.NetId === "number"
        ? region.d.NetId
        : undefined

  return Number.isFinite(netId) ? netId : undefined
}

const isFullObstacleRegion = (
  region: SerializedHyperGraph["regions"][number],
) => {
  if (region.d?._containsObstacle !== true) {
    return false
  }

  if (region.d?._containsTarget !== true) {
    return true
  }

  const netId = getSerializedRegionNetId(region)
  return netId === undefined || netId === -1
}

const filterObstacleRegions = (serializedHyperGraph: SerializedHyperGraph) => {
  const connectedRegionIds = new Set<string>()
  for (const connection of serializedHyperGraph.connections ?? []) {
    connectedRegionIds.add(connection.startRegionId)
    connectedRegionIds.add(connection.endRegionId)
  }

  const removedRegionIds = new Set(
    serializedHyperGraph.regions
      .filter(
        (region) =>
          isFullObstacleRegion(region) &&
          !connectedRegionIds.has(region.regionId),
      )
      .map((region) => region.regionId),
  )

  if (removedRegionIds.size === 0) {
    return serializedHyperGraph
  }

  const filteredPorts = serializedHyperGraph.ports.filter(
    (port) =>
      !removedRegionIds.has(port.region1Id) &&
      !removedRegionIds.has(port.region2Id),
  )

  const invalidConnection = (serializedHyperGraph.connections ?? []).find(
    (connection) =>
      removedRegionIds.has(connection.startRegionId) ||
      removedRegionIds.has(connection.endRegionId),
  )

  if (invalidConnection) {
    throw new Error(
      `Connection "${invalidConnection.connectionId}" references full-obstacle region`,
    )
  }

  return {
    ...serializedHyperGraph,
    regions: serializedHyperGraph.regions.filter(
      (region) => !removedRegionIds.has(region.regionId),
    ),
    ports: filteredPorts,
  }
}

const addSerializedRegionIdToMetadata = (
  region: SerializedHyperGraph["regions"][number],
) => {
  const metadata =
    region.d && typeof region.d === "object" && !Array.isArray(region.d)
      ? { ...region.d }
      : { value: region.d }

  Object.defineProperty(metadata, "serializedRegionId", {
    value: region.regionId,
    enumerable: false,
    configurable: true,
    writable: true,
  })

  return metadata
}

const addSerializedPortIdToMetadata = (
  port: SerializedHyperGraph["ports"][number],
) => {
  const metadata =
    port.d && typeof port.d === "object" && !Array.isArray(port.d)
      ? { ...port.d }
      : { value: port.d }

  Object.defineProperty(metadata, "serializedPortId", {
    value: port.portId,
    enumerable: false,
    configurable: true,
    writable: true,
  })

  return metadata
}

const getRegionBounds = (region: SerializedHyperGraph["regions"][number]) => {
  const bounds = region.d?.bounds
  if (bounds) {
    return bounds
  }

  const center = region.d?.center
  const width = region.d?.width
  const height = region.d?.height
  if (
    center &&
    typeof center.x === "number" &&
    typeof center.y === "number" &&
    typeof width === "number" &&
    typeof height === "number"
  ) {
    return {
      minX: center.x - width / 2,
      maxX: center.x + width / 2,
      minY: center.y - height / 2,
      maxY: center.y + height / 2,
    }
  }

  return {
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  }
}

const getRegionGeometry = (
  region: SerializedHyperGraph["regions"][number],
): { centerX: number; centerY: number; width: number; height: number } => {
  const bounds = getRegionBounds(region)
  const width =
    typeof region.d?.width === "number"
      ? region.d.width
      : bounds.maxX - bounds.minX
  const height =
    typeof region.d?.height === "number"
      ? region.d.height
      : bounds.maxY - bounds.minY

  return {
    centerX:
      typeof region.d?.center?.x === "number"
        ? region.d.center.x
        : (bounds.minX + bounds.maxX) / 2,
    centerY:
      typeof region.d?.center?.y === "number"
        ? region.d.center.y
        : (bounds.minY + bounds.maxY) / 2,
    width,
    height,
  }
}

const getRegionAvailableZMask = (
  region: SerializedHyperGraph["regions"][number],
): number => {
  const availableZ = region.d?.availableZ
  if (!Array.isArray(availableZ)) {
    return 0
  }

  let mask = 0
  for (const z of availableZ) {
    if (!Number.isInteger(z) || z < 0 || z >= 31) {
      continue
    }
    mask |= 1 << z
  }

  return mask
}

const computePortAngle = (
  port: SerializedHyperGraph["ports"][number],
  region: SerializedHyperGraph["regions"][number] | undefined,
): number => {
  if (!region) return 0

  const bounds = getRegionBounds(region)
  const x = Number(port.d?.x ?? 0)
  const y = Number(port.d?.y ?? 0)

  const distLeft = Math.abs(x - bounds.minX)
  const distRight = Math.abs(x - bounds.maxX)
  const distBottom = Math.abs(y - bounds.minY)
  const distTop = Math.abs(y - bounds.maxY)
  const minDist = Math.min(distLeft, distRight, distBottom, distTop)

  const safeWidth = Math.max(bounds.maxX - bounds.minX, 1e-9)
  const safeHeight = Math.max(bounds.maxY - bounds.minY, 1e-9)

  if (minDist === distRight) {
    const t = (y - bounds.minY) / safeHeight
    return Math.round(t * 9000)
  }

  if (minDist === distTop) {
    const t = (bounds.maxX - x) / safeWidth
    return 9000 + Math.round(t * 9000)
  }

  if (minDist === distLeft) {
    const t = (bounds.maxY - y) / safeHeight
    return 18000 + Math.round(t * 9000)
  }

  const t = (x - bounds.minX) / safeWidth
  return 27000 + Math.round(t * 9000)
}

const getCentermostPortIdForRegion = (
  region: SerializedHyperGraph["regions"][number] | undefined,
  portById: Map<string, SerializedHyperGraph["ports"][number]>,
): string | undefined => {
  if (!region) return undefined

  const sortedPortIds = [...region.pointIds].sort((a, b) => {
    const portA = portById.get(a)
    const portB = portById.get(b)
    const distA = Number(
      portA?.d?.distToCentermostPortOnZ ?? Number.POSITIVE_INFINITY,
    )
    const distB = Number(
      portB?.d?.distToCentermostPortOnZ ?? Number.POSITIVE_INFINITY,
    )

    if (distA !== distB) return distA - distB

    const zA = Number(portA?.d?.z ?? 0)
    const zB = Number(portB?.d?.z ?? 0)
    if (zA !== zB) return zA - zB

    return a.localeCompare(b)
  })

  return sortedPortIds[0]
}

type ConnectionPointLike = {
  x?: unknown
  y?: unknown
  layer?: unknown
}

type ConnectionWithSimpleRoute = NonNullable<
  SerializedHyperGraph["connections"]
>[number] & {
  _bus?: {
    id?: unknown
    order?: unknown
    orderingVector?: unknown
  }
  simpleRouteConnection?: {
    pointsToConnect?: ConnectionPointLike[]
  }
}

const BUS_ENDPOINT_CANDIDATE_LIMIT = 4

const getLayerZForConnectionPoint = (layer: unknown): number | undefined => {
  if (typeof layer !== "string") {
    return undefined
  }

  switch (layer.toLowerCase()) {
    case "top":
      return 0
    case "bottom":
      return 1
    case "inner1":
      return 2
    case "inner2":
      return 3
    default:
      return undefined
  }
}

const getClosestPortIdsForConnectionEndpoint = (
  connection: NonNullable<SerializedHyperGraph["connections"]>[number],
  endpointIndex: 0 | 1,
  region: SerializedHyperGraph["regions"][number] | undefined,
  portById: Map<string, SerializedHyperGraph["ports"][number]>,
  limit = 1,
): string[] => {
  const point = (connection as ConnectionWithSimpleRoute).simpleRouteConnection
    ?.pointsToConnect?.[endpointIndex]

  if (
    !region ||
    !point ||
    typeof point.x !== "number" ||
    typeof point.y !== "number"
  ) {
    return []
  }

  const preferredZ = getLayerZForConnectionPoint(point.layer)
  const scoredPortIds: Array<{
    portId: string
    score: number
    centerDistance: number
  }> = []

  for (const pointId of region.pointIds) {
    const port = portById.get(pointId)

    if (!port) {
      continue
    }

    const portX = Number(port.d?.x)
    const portY = Number(port.d?.y)

    if (!Number.isFinite(portX) || !Number.isFinite(portY)) {
      continue
    }

    const portZ = Number(port.d?.z ?? 0)
    const layerPenalty =
      preferredZ !== undefined && portZ !== preferredZ ? 1_000 : 0
    const distance = Math.hypot(portX - point.x, portY - point.y)
    const centerDistance = Number(
      port.d?.distToCentermostPortOnZ ?? Number.POSITIVE_INFINITY,
    )
    scoredPortIds.push({
      portId: pointId,
      score: distance + layerPenalty,
      centerDistance,
    })
  }

  scoredPortIds.sort(
    (left, right) =>
      left.score - right.score ||
      left.centerDistance - right.centerDistance ||
      left.portId.localeCompare(right.portId),
  )

  return scoredPortIds.slice(0, limit).map(({ portId }) => portId)
}

const getClosestPortIdForConnectionEndpoint = (
  connection: NonNullable<SerializedHyperGraph["connections"]>[number],
  endpointIndex: 0 | 1,
  region: SerializedHyperGraph["regions"][number] | undefined,
  portById: Map<string, SerializedHyperGraph["ports"][number]>,
): string | undefined =>
  getClosestPortIdsForConnectionEndpoint(
    connection,
    endpointIndex,
    region,
    portById,
  )[0]

const isBusConnection = (
  connection: NonNullable<SerializedHyperGraph["connections"]>[number],
): boolean => {
  const bus = (connection as ConnectionWithSimpleRoute)._bus
  return bus !== undefined && typeof bus === "object" && bus !== null
}

const getSharedPortIdsForConnection = (
  serializedHyperGraph: SerializedHyperGraph,
  connection: NonNullable<SerializedHyperGraph["connections"]>[number],
): string[] =>
  serializedHyperGraph.ports
    .filter(
      (port) =>
        (port.region1Id === connection.startRegionId &&
          port.region2Id === connection.endRegionId) ||
        (port.region2Id === connection.startRegionId &&
          port.region1Id === connection.endRegionId),
    )
    .map((port) => port.portId)

const getSuggestedSolverOptionsFromSerializedHyperGraph = (
  serializedHyperGraph: SerializedHyperGraph,
): TinyHyperGraphSolverOptions | undefined => {
  const tuning = (
    serializedHyperGraph as SerializedHyperGraph & {
      [PORT_POINT_PATHING_SOLVER_TUNING_KEY]?: PortPointPathingSolverTuning
    }
  )[PORT_POINT_PATHING_SOLVER_TUNING_KEY]
  const weights = tuning?.weights

  if (!weights) {
    return undefined
  }

  const suggestedSolverOptions: TinyHyperGraphSolverOptions = {}

  if (typeof weights.START_RIPPING_PF_THRESHOLD === "number") {
    suggestedSolverOptions.RIP_THRESHOLD_START =
      weights.START_RIPPING_PF_THRESHOLD
  }
  if (typeof weights.END_RIPPING_PF_THRESHOLD === "number") {
    suggestedSolverOptions.RIP_THRESHOLD_END = weights.END_RIPPING_PF_THRESHOLD
  }
  if (
    typeof weights.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR === "number" &&
    weights.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR > 0
  ) {
    suggestedSolverOptions.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR =
      weights.STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR
  }

  return Object.keys(suggestedSolverOptions).length > 0
    ? suggestedSolverOptions
    : undefined
}

export const loadSerializedHyperGraph = (
  serializedHyperGraph: SerializedHyperGraph,
): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
} => {
  const suggestedSolverOptions =
    getSuggestedSolverOptionsFromSerializedHyperGraph(serializedHyperGraph)
  const filteredHyperGraph = filterObstacleRegions(serializedHyperGraph)
  const regionIdToIndex = new Map<string, number>()
  const portIdToIndex = new Map<string, number>()
  const portById = new Map<string, SerializedHyperGraph["ports"][number]>()
  const regionById = new Map<string, SerializedHyperGraph["regions"][number]>()
  const solvedRouteByConnectionId = new Map(
    (filteredHyperGraph.solvedRoutes ?? []).map((route) => [
      route.connection.connectionId,
      route,
    ]),
  )

  filteredHyperGraph.regions.forEach((region, regionIndex) => {
    regionIdToIndex.set(region.regionId, regionIndex)
    regionById.set(region.regionId, region)
  })

  filteredHyperGraph.ports.forEach((port, portIndex) => {
    portIdToIndex.set(port.portId, portIndex)
    portById.set(port.portId, port)
  })

  const regionCount = filteredHyperGraph.regions.length
  const portCount = filteredHyperGraph.ports.length

  const regionIncidentPorts = filteredHyperGraph.regions.map((region) =>
    region.pointIds
      .map((portId) => portIdToIndex.get(portId))
      .filter((portIndex): portIndex is number => portIndex !== undefined),
  )

  const incidentPortRegion = Array.from(
    { length: portCount },
    () => [] as number[],
  )
  const regionWidth = new Float64Array(regionCount)
  const regionHeight = new Float64Array(regionCount)
  const regionCenterX = new Float64Array(regionCount)
  const regionCenterY = new Float64Array(regionCount)
  const regionAvailableZMask = new Int32Array(regionCount)
  const regionNetId = new Int32Array(regionCount).fill(-1)

  filteredHyperGraph.regions.forEach((region, regionIndex) => {
    const geometry = getRegionGeometry(region)
    regionWidth[regionIndex] = geometry.width
    regionHeight[regionIndex] = geometry.height
    regionCenterX[regionIndex] = geometry.centerX
    regionCenterY[regionIndex] = geometry.centerY
    regionAvailableZMask[regionIndex] = getRegionAvailableZMask(region)
  })

  const portAngleForRegion1 = new Int32Array(portCount)
  const portAngleForRegion2 = new Int32Array(portCount)
  const portX = new Float64Array(portCount)
  const portY = new Float64Array(portCount)
  const portZ = new Int32Array(portCount)

  filteredHyperGraph.ports.forEach((port, portIndex) => {
    const region1Index = regionIdToIndex.get(port.region1Id)
    const region2Index = regionIdToIndex.get(port.region2Id)

    if (region1Index === undefined || region2Index === undefined) {
      throw new Error(
        `Port "${port.portId}" references missing regions "${port.region1Id}" or "${port.region2Id}"`,
      )
    }

    incidentPortRegion[portIndex] = [region1Index, region2Index]
    portX[portIndex] = Number(port.d?.x ?? 0)
    portY[portIndex] = Number(port.d?.y ?? 0)
    portZ[portIndex] = Number(port.d?.z ?? 0)
    portAngleForRegion1[portIndex] = computePortAngle(
      port,
      filteredHyperGraph.regions[region1Index],
    )
    portAngleForRegion2[portIndex] = computePortAngle(
      port,
      filteredHyperGraph.regions[region2Index],
    )
  })

  const connections = filteredHyperGraph.connections ?? []
  const netIdToIndex = new Map<string, number>()
  let nextNetIndex = 0
  const getNetIndex = (connection: (typeof connections)[number]) => {
    const netId =
      connection.mutuallyConnectedNetworkId ?? connection.connectionId
    let netIndex = netIdToIndex.get(netId)
    if (netIndex === undefined) {
      netIndex = nextNetIndex++
      netIdToIndex.set(netId, netIndex)
    }
    return netIndex
  }

  const regionNetCandidates = Array.from(
    { length: regionCount },
    () => new Set<number>(),
  )

  const assignRegionNet = (regionId: string, netIndex: number) => {
    const regionIndex = regionIdToIndex.get(regionId)
    if (regionIndex === undefined) {
      throw new Error(`Connection references missing region "${regionId}"`)
    }

    regionNetCandidates[regionIndex]!.add(netIndex)
  }

  for (const connection of connections) {
    const netIndex = getNetIndex(connection)
    assignRegionNet(connection.startRegionId, netIndex)
    assignRegionNet(connection.endRegionId, netIndex)
  }

  regionNetCandidates.forEach((candidateNetIndexes, regionIndex) => {
    if (candidateNetIndexes.size === 1) {
      regionNetId[regionIndex] = [...candidateNetIndexes][0]!
    }
  })

  const routableConnections = connections
    .map((connection) => {
      const solvedRoute = solvedRouteByConnectionId.get(connection.connectionId)
      const sharedPortIds = getSharedPortIdsForConnection(
        filteredHyperGraph,
        connection,
      )

      return {
        connection,
        solvedRoute,
        sharedPortIds,
      }
    })
    .filter(
      ({ solvedRoute, sharedPortIds }) =>
        sharedPortIds.length === 0 || (solvedRoute?.path.length ?? 0) > 1,
    )

  const routeCount = routableConnections.length
  const portSectionMask = new Int8Array(portCount).fill(1)
  const routeStartPort = new Int32Array(routeCount)
  const routeEndPort = new Int32Array(routeCount)
  const routeStartPortCandidates = Array.from(
    { length: routeCount },
    () => undefined as number[] | undefined,
  )
  const routeEndPortCandidates = Array.from(
    { length: routeCount },
    () => undefined as number[] | undefined,
  )
  const routeNet = new Int32Array(routeCount)

  routableConnections.forEach(({ connection, solvedRoute }, routeIndex) => {
    const startRegion = regionById.get(connection.startRegionId)
    const endRegion = regionById.get(connection.endRegionId)
    const preferredStartPortId = getClosestPortIdForConnectionEndpoint(
      connection,
      0,
      startRegion,
      portById,
    )
    const preferredEndPortId = getClosestPortIdForConnectionEndpoint(
      connection,
      1,
      endRegion,
      portById,
    )
    const busStartPortIds = isBusConnection(connection)
      ? getClosestPortIdsForConnectionEndpoint(
          connection,
          0,
          startRegion,
          portById,
          BUS_ENDPOINT_CANDIDATE_LIMIT,
        )
      : []
    const busEndPortIds = isBusConnection(connection)
      ? getClosestPortIdsForConnectionEndpoint(
          connection,
          1,
          endRegion,
          portById,
          BUS_ENDPOINT_CANDIDATE_LIMIT,
        )
      : []
    const fallbackStartPortId = getCentermostPortIdForRegion(
      startRegion,
      portById,
    )
    const fallbackEndPortId = getCentermostPortIdForRegion(endRegion, portById)

    const startPortId =
      solvedRoute?.path[0]?.portId ??
      preferredStartPortId ??
      fallbackStartPortId
    const endPortId =
      solvedRoute?.path[solvedRoute.path.length - 1]?.portId ??
      preferredEndPortId ??
      fallbackEndPortId

    const startPortIndex =
      startPortId !== undefined ? portIdToIndex.get(startPortId) : undefined
    const endPortIndex =
      endPortId !== undefined ? portIdToIndex.get(endPortId) : undefined

    if (startPortIndex === undefined || endPortIndex === undefined) {
      throw new Error(
        `Connection "${connection.connectionId}" could not be mapped to route endpoints`,
      )
    }

    routeStartPort[routeIndex] = startPortIndex
    routeEndPort[routeIndex] = endPortIndex

    const startPortCandidateIndexes = busStartPortIds
      .map((portId) => portIdToIndex.get(portId))
      .filter((portId): portId is number => portId !== undefined)
    const endPortCandidateIndexes = busEndPortIds
      .map((portId) => portIdToIndex.get(portId))
      .filter((portId): portId is number => portId !== undefined)

    if (startPortCandidateIndexes.length > 1) {
      routeStartPortCandidates[routeIndex] = startPortCandidateIndexes
    }
    if (endPortCandidateIndexes.length > 1) {
      routeEndPortCandidates[routeIndex] = endPortCandidateIndexes
    }

    routeNet[routeIndex] = getNetIndex(connection)
  })

  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount,
    regionIncidentPorts,
    incidentPortRegion,
    regionWidth,
    regionHeight,
    regionCenterX,
    regionCenterY,
    regionAvailableZMask,
    regionMetadata: filteredHyperGraph.regions.map((region) =>
      addSerializedRegionIdToMetadata(region),
    ),
    portAngleForRegion1,
    portAngleForRegion2,
    portX,
    portY,
    portZ,
    portMetadata: filteredHyperGraph.ports.map((port) =>
      addSerializedPortIdToMetadata(port),
    ),
  }

  const problem: TinyHyperGraphProblem = {
    routeCount,
    portSectionMask,
    routeMetadata: routableConnections.map(({ connection }) => connection),
    routeStartPort,
    routeEndPort,
    routeStartPortCandidates,
    routeEndPortCandidates,
    routeNet,
    regionNetId,
    suggestedSolverOptions,
  }

  const solvedRoutePathSegments: TinyHyperGraphSolution["solvedRoutePathSegments"] =
    []
  const solvedRoutePathRegionIds: NonNullable<
    TinyHyperGraphSolution["solvedRoutePathRegionIds"]
  > = []

  for (const { solvedRoute: route } of routableConnections) {
    if (!route) {
      solvedRoutePathSegments.push([])
      solvedRoutePathRegionIds.push([])
      continue
    }

    const segments: Array<[number, number]> = []
    const segmentRegionIds: Array<number | undefined> = []

    for (let i = 1; i < route.path.length; i++) {
      const fromCandidate = route.path[i - 1]
      const toCandidate = route.path[i]
      const fromPortId = fromCandidate?.portId
      const toPortId = toCandidate?.portId
      const fromPortIndex =
        fromPortId !== undefined ? portIdToIndex.get(fromPortId) : undefined
      const toPortIndex =
        toPortId !== undefined ? portIdToIndex.get(toPortId) : undefined

      if (fromPortIndex === undefined || toPortIndex === undefined) {
        continue
      }

      const serializedRegionId =
        typeof fromCandidate?.nextRegionId === "string"
          ? fromCandidate.nextRegionId
          : typeof toCandidate?.lastRegionId === "string"
            ? toCandidate.lastRegionId
            : undefined

      segments.push([fromPortIndex, toPortIndex])
      segmentRegionIds.push(
        serializedRegionId !== undefined
          ? regionIdToIndex.get(serializedRegionId)
          : undefined,
      )
    }

    solvedRoutePathSegments.push(segments)
    solvedRoutePathRegionIds.push(segmentRegionIds)
  }

  const solution: TinyHyperGraphSolution = {
    solvedRoutePathSegments,
    solvedRoutePathRegionIds,
  }

  return { topology, problem, solution }
}
