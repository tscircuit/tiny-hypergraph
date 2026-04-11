import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import { MinHeap } from "./MinHeap"
import type { PortId, RegionId, RouteId } from "./types"

const DEFAULT_REGION_DISTANCE_COST = 0.04
const DEFAULT_NEW_EDGE_PENALTY = 0
const DEFAULT_EDGE_USAGE_PENALTY = 0
const DEFAULT_NEW_REGION_PENALTY = 0.02
const DEFAULT_REGION_USAGE_PENALTY = 0.08

interface TinyHyperGraphBusMetadata {
  id: string
  order?: number
  orderingVector: {
    x: number
    y: number
  }
}

interface TinyHyperGraphBusDefinition {
  busId: string
  routeIds: RouteId[]
  routeOrderByRouteId: Map<RouteId, number>
  orderingVector: {
    x: number
    y: number
  }
}

interface RegionPathCandidate {
  regionId: RegionId
  g: number
  h: number
  f: number
  prevCandidate?: RegionPathCandidate
}

interface RouteRegionPath {
  routeId: RouteId
  regionIds: RegionId[]
}

interface RouteRegionPathResult {
  regionIds: RegionId[]
  cost: number
}

export interface TinyHyperGraphFixedRouteSegments {
  fixedRouteIds: RouteId[]
  routeSegmentsByRegion: Array<[RouteId, PortId, PortId][]>
}

export interface TinyHyperGraphBusRouteGuides {
  guidedRegionIdsByRouteId: Array<RegionId[] | undefined>
  preferredBoundaryPortIdsByRouteId: Array<PortId[] | undefined>
  guidedRouteIdsInSolveOrder: RouteId[]
}

const compareRegionPathCandidates = (
  left: RegionPathCandidate,
  right: RegionPathCandidate,
) => left.f - right.f

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getTinyHyperGraphBusMetadata = (
  routeMetadata: unknown,
): TinyHyperGraphBusMetadata | undefined => {
  if (!isRecord(routeMetadata)) {
    return undefined
  }

  const busMetadata = isRecord(routeMetadata._bus)
    ? routeMetadata._bus
    : isRecord(routeMetadata.bus)
      ? routeMetadata.bus
      : undefined

  if (!busMetadata) {
    return undefined
  }

  const busId = typeof busMetadata.id === "string" ? busMetadata.id : undefined
  const orderingVector = isRecord(busMetadata.orderingVector)
    ? {
        x:
          typeof busMetadata.orderingVector.x === "number"
            ? busMetadata.orderingVector.x
            : 0,
        y:
          typeof busMetadata.orderingVector.y === "number"
            ? busMetadata.orderingVector.y
            : 0,
      }
    : undefined

  if (!busId || !orderingVector) {
    return undefined
  }

  return {
    id: busId,
    order:
      typeof busMetadata.order === "number" &&
      Number.isFinite(busMetadata.order)
        ? busMetadata.order
        : undefined,
    orderingVector,
  }
}

const getBusOrderingFallback = (
  routeMetadata: unknown,
  orderingVector: { x: number; y: number },
  routeId: RouteId,
) => {
  if (!isRecord(routeMetadata)) {
    return routeId
  }

  const simpleRouteConnection = isRecord(routeMetadata.simpleRouteConnection)
    ? routeMetadata.simpleRouteConnection
    : undefined
  const pointsToConnect = Array.isArray(simpleRouteConnection?.pointsToConnect)
    ? simpleRouteConnection.pointsToConnect
    : []
  const startPoint = isRecord(pointsToConnect[0])
    ? pointsToConnect[0]
    : undefined

  if (typeof startPoint?.x === "number" && typeof startPoint?.y === "number") {
    return (
      startPoint.x * orderingVector.x +
      startPoint.y * orderingVector.y +
      routeId * 1e-6
    )
  }

  return routeId
}

const getSerializedRegionIdToIndex = (topology: TinyHyperGraphTopology) => {
  const serializedRegionIdToIndex = new Map<string, RegionId>()

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const metadata = topology.regionMetadata?.[regionId]
    if (isRecord(metadata) && typeof metadata.serializedRegionId === "string") {
      serializedRegionIdToIndex.set(metadata.serializedRegionId, regionId)
    }
  }

  return serializedRegionIdToIndex
}

const getPreferredIncidentRegionIds = (
  incidentRegionIds: RegionId[],
  preferredRegionId?: RegionId,
) => {
  const uniqueIncidentRegionIds = [...new Set(incidentRegionIds)]
  if (
    preferredRegionId !== undefined &&
    uniqueIncidentRegionIds.includes(preferredRegionId)
  ) {
    return [
      preferredRegionId,
      ...uniqueIncidentRegionIds.filter(
        (regionId) => regionId !== preferredRegionId,
      ),
    ]
  }

  return uniqueIncidentRegionIds
}

const getRouteEndpointRegionChoices = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
) => {
  const serializedRegionIdToIndex = getSerializedRegionIdToIndex(topology)
  const routeStartRegionChoicesByRouteId = Array.from(
    { length: problem.routeCount },
    () => [] as RegionId[],
  )
  const routeEndRegionChoicesByRouteId = Array.from(
    { length: problem.routeCount },
    () => [] as RegionId[],
  )

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routeMetadata = problem.routeMetadata?.[routeId]
    const serializedStartRegionId =
      isRecord(routeMetadata) && typeof routeMetadata.startRegionId === "string"
        ? routeMetadata.startRegionId
        : undefined
    const serializedEndRegionId =
      isRecord(routeMetadata) && typeof routeMetadata.endRegionId === "string"
        ? routeMetadata.endRegionId
        : undefined
    const preferredStartRegionId =
      serializedStartRegionId !== undefined
        ? serializedRegionIdToIndex.get(serializedStartRegionId)
        : undefined
    const preferredEndRegionId =
      serializedEndRegionId !== undefined
        ? serializedRegionIdToIndex.get(serializedEndRegionId)
        : undefined
    const startIncidentRegionIds =
      topology.incidentPortRegion[problem.routeStartPort[routeId]] ?? []
    const endIncidentRegionIds =
      topology.incidentPortRegion[problem.routeEndPort[routeId]] ?? []

    routeStartRegionChoicesByRouteId[routeId] = getPreferredIncidentRegionIds(
      startIncidentRegionIds,
      preferredStartRegionId,
    )
    routeEndRegionChoicesByRouteId[routeId] = getPreferredIncidentRegionIds(
      endIncidentRegionIds,
      preferredEndRegionId,
    )

    if (
      routeStartRegionChoicesByRouteId[routeId]!.length === 0 &&
      preferredStartRegionId !== undefined
    ) {
      routeStartRegionChoicesByRouteId[routeId] = [preferredStartRegionId]
    }
    if (
      routeEndRegionChoicesByRouteId[routeId]!.length === 0 &&
      preferredEndRegionId !== undefined
    ) {
      routeEndRegionChoicesByRouteId[routeId] = [preferredEndRegionId]
    }
  }

  return {
    routeStartRegionChoicesByRouteId,
    routeEndRegionChoicesByRouteId,
  }
}

const getRouteIdsInMedianFirstOrder = (routeIds: RouteId[]) => {
  const order: RouteId[] = []
  let left = Math.floor((routeIds.length - 1) / 2)
  let right = left + 1

  if (left >= 0) {
    order.push(routeIds[left]!)
  }

  while (left > 0 || right < routeIds.length) {
    left -= 1
    if (left >= 0) {
      order.push(routeIds[left]!)
    }
    if (right < routeIds.length) {
      order.push(routeIds[right]!)
      right += 1
    }
  }

  return order
}

const getTinyHyperGraphBusDefinitions = (
  problem: TinyHyperGraphProblem,
): TinyHyperGraphBusDefinition[] => {
  const routeIdsByBusId = new Map<string, RouteId[]>()
  const orderingVectorByBusId = new Map<
    string,
    TinyHyperGraphBusMetadata["orderingVector"]
  >()
  const routeSortValueByBusId = new Map<string, Map<RouteId, number>>()

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routeMetadata = problem.routeMetadata?.[routeId]
    const busMetadata = getTinyHyperGraphBusMetadata(routeMetadata)
    if (!busMetadata) {
      continue
    }

    const existingOrderingVector = orderingVectorByBusId.get(busMetadata.id)
    if (
      existingOrderingVector &&
      (existingOrderingVector.x !== busMetadata.orderingVector.x ||
        existingOrderingVector.y !== busMetadata.orderingVector.y)
    ) {
      throw new Error(
        `Bus "${busMetadata.id}" has inconsistent ordering vectors across routes`,
      )
    }

    orderingVectorByBusId.set(busMetadata.id, busMetadata.orderingVector)

    const routeIds = routeIdsByBusId.get(busMetadata.id) ?? []
    routeIds.push(routeId)
    routeIdsByBusId.set(busMetadata.id, routeIds)

    const routeSortValue =
      busMetadata.order ??
      getBusOrderingFallback(routeMetadata, busMetadata.orderingVector, routeId)
    const routeSortValues =
      routeSortValueByBusId.get(busMetadata.id) ?? new Map()
    routeSortValues.set(routeId, routeSortValue)
    routeSortValueByBusId.set(busMetadata.id, routeSortValues)
  }

  return [...routeIdsByBusId.entries()]
    .map(([busId, routeIds]) => {
      const routeSortValues = routeSortValueByBusId.get(busId)
      routeIds.sort(
        (left, right) =>
          (routeSortValues?.get(left) ?? left) -
          (routeSortValues?.get(right) ?? right),
      )

      return {
        busId,
        routeIds,
        routeOrderByRouteId: new Map(
          routeIds.map((routeId, orderIndex) => [routeId, orderIndex]),
        ),
        orderingVector: orderingVectorByBusId.get(busId)!,
      }
    })
    .filter((bus) => bus.routeIds.length > 1)
}

const getRegionPairKey = (region1Id: RegionId, region2Id: RegionId) =>
  region1Id < region2Id
    ? `${region1Id}:${region2Id}`
    : `${region2Id}:${region1Id}`

const getSharedPortIdsByRegionPair = (topology: TinyHyperGraphTopology) => {
  const sharedPortIdsByRegionPair = new Map<string, PortId[]>()

  for (let portId = 0; portId < topology.portCount; portId++) {
    const [region1Id, region2Id] = topology.incidentPortRegion[portId] ?? []
    if (region1Id === undefined || region2Id === undefined) {
      continue
    }

    const key = getRegionPairKey(region1Id, region2Id)
    const sharedPortIds = sharedPortIdsByRegionPair.get(key) ?? []
    sharedPortIds.push(portId)
    sharedPortIdsByRegionPair.set(key, sharedPortIds)
  }

  return sharedPortIdsByRegionPair
}

const getAdjacentRegionIdsByRegionId = (
  topology: TinyHyperGraphTopology,
  sharedPortIdsByRegionPair: Map<string, PortId[]>,
) => {
  const adjacentRegionIdsByRegionId = Array.from(
    { length: topology.regionCount },
    () => [] as RegionId[],
  )

  for (const [regionPairKey] of sharedPortIdsByRegionPair) {
    const separatorIndex = regionPairKey.indexOf(":")
    const region1Id = Number(regionPairKey.slice(0, separatorIndex))
    const region2Id = Number(regionPairKey.slice(separatorIndex + 1))
    adjacentRegionIdsByRegionId[region1Id]!.push(region2Id)
    adjacentRegionIdsByRegionId[region2Id]!.push(region1Id)
  }

  return adjacentRegionIdsByRegionId
}

const getApproximateRegionCapacity = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
) => {
  const layerMask = topology.regionAvailableZMask?.[regionId] ?? 0
  const layerCount =
    layerMask === 0
      ? 1
      : Math.max(1, layerMask.toString(2).replaceAll("0", "").length)
  return Math.max(
    1,
    Math.floor(
      topology.regionIncidentPorts[regionId]!.length / (4 / layerCount),
    ),
  )
}

const getRegionDistance = (
  topology: TinyHyperGraphTopology,
  fromRegionId: RegionId,
  toRegionId: RegionId,
) =>
  Math.hypot(
    topology.regionCenterX[fromRegionId]! - topology.regionCenterX[toRegionId]!,
    topology.regionCenterY[fromRegionId]! - topology.regionCenterY[toRegionId]!,
  )

const getBusRoutingStepCost = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
  nextRegionId: RegionId,
  busRegionUsageByRegionId: Int32Array,
  busEdgeUsageByRegionPair: Map<string, number>,
  sharedPortIdsByRegionPair: Map<string, PortId[]>,
  preferExistingEdges: boolean,
) => {
  const regionPairKey = getRegionPairKey(regionId, nextRegionId)
  const sharedPortIds = sharedPortIdsByRegionPair.get(regionPairKey)

  if (!sharedPortIds || sharedPortIds.length === 0) {
    return Number.POSITIVE_INFINITY
  }

  const edgeUsage = busEdgeUsageByRegionPair.get(regionPairKey) ?? 0
  if (edgeUsage >= sharedPortIds.length) {
    return Number.POSITIVE_INFINITY
  }

  const regionCapacity = getApproximateRegionCapacity(topology, nextRegionId)
  const regionUsage = busRegionUsageByRegionId[nextRegionId]!

  return (
    getRegionDistance(topology, regionId, nextRegionId) *
      DEFAULT_REGION_DISTANCE_COST +
    (preferExistingEdges && edgeUsage === 0 ? DEFAULT_NEW_EDGE_PENALTY : 0) +
    (edgeUsage / sharedPortIds.length) * DEFAULT_EDGE_USAGE_PENALTY +
    (regionUsage === 0 ? DEFAULT_NEW_REGION_PENALTY : 0) +
    (regionUsage / regionCapacity) * DEFAULT_REGION_USAGE_PENALTY
  )
}

const getBusRouteRegionPath = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
  startRegionId: RegionId,
  endRegionId: RegionId,
  busRegionUsageByRegionId: Int32Array,
  busEdgeUsageByRegionPair: Map<string, number>,
  sharedPortIdsByRegionPair: Map<string, PortId[]>,
  adjacentRegionIdsByRegionId: RegionId[][],
  preferExistingEdges: boolean,
) => {
  if (startRegionId === endRegionId) {
    return {
      regionIds: [startRegionId],
      cost: 0,
    }
  }

  const bestCostByRegionId = new Float64Array(topology.regionCount).fill(
    Number.POSITIVE_INFINITY,
  )
  const candidateQueue = new MinHeap<RegionPathCandidate>(
    [],
    compareRegionPathCandidates,
  )

  bestCostByRegionId[startRegionId] = 0
  candidateQueue.queue({
    regionId: startRegionId,
    g: 0,
    h: getRegionDistance(topology, startRegionId, endRegionId),
    f: getRegionDistance(topology, startRegionId, endRegionId),
  })

  while (candidateQueue.length > 0) {
    const candidate = candidateQueue.dequeue()!

    if (candidate.g > bestCostByRegionId[candidate.regionId]!) {
      continue
    }

    if (candidate.regionId === endRegionId) {
      const path: RegionId[] = []
      let cursor: RegionPathCandidate | undefined = candidate
      while (cursor) {
        path.unshift(cursor.regionId)
        cursor = cursor.prevCandidate
      }
      return {
        regionIds: path,
        cost: candidate.g,
      }
    }

    for (const nextRegionId of adjacentRegionIdsByRegionId[
      candidate.regionId
    ]!) {
      if (
        problem.regionNetId[nextRegionId] !== -1 &&
        problem.regionNetId[nextRegionId] !== problem.routeNet[routeId] &&
        nextRegionId !== endRegionId
      ) {
        continue
      }

      const stepCost = getBusRoutingStepCost(
        topology,
        candidate.regionId,
        nextRegionId,
        busRegionUsageByRegionId,
        busEdgeUsageByRegionPair,
        sharedPortIdsByRegionPair,
        preferExistingEdges,
      )
      if (!Number.isFinite(stepCost)) {
        continue
      }

      const g = candidate.g + stepCost
      if (g >= bestCostByRegionId[nextRegionId]!) {
        continue
      }

      const h =
        getRegionDistance(topology, nextRegionId, endRegionId) *
        DEFAULT_REGION_DISTANCE_COST
      bestCostByRegionId[nextRegionId] = g
      candidateQueue.queue({
        regionId: nextRegionId,
        g,
        h,
        f: g + h,
        prevCandidate: candidate,
      })
    }
  }

  return undefined
}

const getBestBusRouteRegionPath = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
  startRegionIds: RegionId[],
  endRegionIds: RegionId[],
  busRegionUsageByRegionId: Int32Array,
  busEdgeUsageByRegionPair: Map<string, number>,
  sharedPortIdsByRegionPair: Map<string, PortId[]>,
  adjacentRegionIdsByRegionId: RegionId[][],
  preferExistingEdges: boolean,
) => {
  let bestRouteRegionPath: RouteRegionPathResult | undefined

  for (const startRegionId of startRegionIds) {
    for (const endRegionId of endRegionIds) {
      const routeRegionPath = getBusRouteRegionPath(
        topology,
        problem,
        routeId,
        startRegionId,
        endRegionId,
        busRegionUsageByRegionId,
        busEdgeUsageByRegionPair,
        sharedPortIdsByRegionPair,
        adjacentRegionIdsByRegionId,
        preferExistingEdges,
      )

      if (!routeRegionPath) {
        continue
      }

      if (
        !bestRouteRegionPath ||
        routeRegionPath.cost < bestRouteRegionPath.cost ||
        (routeRegionPath.cost === bestRouteRegionPath.cost &&
          routeRegionPath.regionIds.length <
            bestRouteRegionPath.regionIds.length)
      ) {
        bestRouteRegionPath = routeRegionPath
      }
    }
  }

  return bestRouteRegionPath
}

const sortPortIdsByOrderingVector = (
  topology: TinyHyperGraphTopology,
  portIds: PortId[],
  orderingVector: { x: number; y: number },
) =>
  [...portIds].sort((leftPortId, rightPortId) => {
    const leftProjection =
      topology.portX[leftPortId]! * orderingVector.x +
      topology.portY[leftPortId]! * orderingVector.y
    const rightProjection =
      topology.portX[rightPortId]! * orderingVector.x +
      topology.portY[rightPortId]! * orderingVector.y

    if (leftProjection !== rightProjection) {
      return leftProjection - rightProjection
    }

    return leftPortId - rightPortId
  })

const getAverage = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length

const fitIncreasingIndexesToDesiredPositions = (
  desiredPositions: number[],
  maxIndex: number,
) => {
  const fittedIndexes = new Int32Array(desiredPositions.length)

  for (let index = 0; index < desiredPositions.length; index++) {
    const minAllowedIndex = index === 0 ? 0 : fittedIndexes[index - 1]! + 1
    const maxAllowedIndex = maxIndex - (desiredPositions.length - 1 - index)
    fittedIndexes[index] = Math.min(
      maxAllowedIndex,
      Math.max(minAllowedIndex, Math.round(desiredPositions[index]!)),
    )
  }

  return fittedIndexes
}

const assignBoundaryPortIdsForBus = (
  topology: TinyHyperGraphTopology,
  busDefinition: TinyHyperGraphBusDefinition,
  routeRegionPaths: RouteRegionPath[],
  sharedPortIdsByRegionPair: Map<string, PortId[]>,
  reservedPortIds: Set<PortId>,
) => {
  const routeRegionPathByRouteId = new Map(
    routeRegionPaths.map((routeRegionPath) => [
      routeRegionPath.routeId,
      routeRegionPath,
    ]),
  )
  const routeBoundaryPortIdsByRouteId = new Map<RouteId, PortId[]>()
  const routeIdsByRegionPair = new Map<string, RouteId[]>()
  const localRouteOrderByRegionId = new Map<RegionId, Map<RouteId, number>>()
  const activeRouteCountByRegionId = new Int32Array(topology.regionCount)

  for (const routeRegionPath of routeRegionPaths) {
    for (
      let regionIndex = 1;
      regionIndex < routeRegionPath.regionIds.length;
      regionIndex++
    ) {
      const regionPairKey = getRegionPairKey(
        routeRegionPath.regionIds[regionIndex - 1]!,
        routeRegionPath.regionIds[regionIndex]!,
      )
      const routeIds = routeIdsByRegionPair.get(regionPairKey) ?? []
      routeIds.push(routeRegionPath.routeId)
      routeIdsByRegionPair.set(regionPairKey, routeIds)
    }
  }

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const activeRouteIds = routeRegionPaths
      .filter((routeRegionPath) => routeRegionPath.regionIds.includes(regionId))
      .map((routeRegionPath) => routeRegionPath.routeId)
      .sort(
        (leftRouteId, rightRouteId) =>
          busDefinition.routeOrderByRouteId.get(leftRouteId)! -
          busDefinition.routeOrderByRouteId.get(rightRouteId)!,
      )

    if (activeRouteIds.length === 0) {
      continue
    }

    activeRouteCountByRegionId[regionId] = activeRouteIds.length
    localRouteOrderByRegionId.set(
      regionId,
      new Map(
        activeRouteIds.map((routeId, orderIndex) => [routeId, orderIndex]),
      ),
    )
  }

  for (const [regionPairKey, routeIds] of routeIdsByRegionPair) {
    const sharedPortIds = (
      sharedPortIdsByRegionPair.get(regionPairKey) ?? []
    ).filter((portId) => !reservedPortIds.has(portId))
    if (!sharedPortIds || sharedPortIds.length < routeIds.length) {
      throw new Error(
        `Bus "${busDefinition.busId}" exceeded edge capacity on ${regionPairKey}`,
      )
    }

    const sortedSharedPortIds = sortPortIdsByOrderingVector(
      topology,
      sharedPortIds,
      busDefinition.orderingVector,
    )
    const sortedRouteIds = [...routeIds].sort(
      (leftRouteId, rightRouteId) =>
        busDefinition.routeOrderByRouteId.get(leftRouteId)! -
        busDefinition.routeOrderByRouteId.get(rightRouteId)!,
    )
    const separatorIndex = regionPairKey.indexOf(":")
    const region1Id = Number(regionPairKey.slice(0, separatorIndex))
    const region2Id = Number(regionPairKey.slice(separatorIndex + 1))
    const desiredPortPositions = sortedRouteIds.map((routeId) => {
      const region1LocalRouteOrder = localRouteOrderByRegionId
        .get(region1Id)
        ?.get(routeId)
      const region2LocalRouteOrder = localRouteOrderByRegionId
        .get(region2Id)
        ?.get(routeId)
      const region1ActiveRouteCount = activeRouteCountByRegionId[region1Id]!
      const region2ActiveRouteCount = activeRouteCountByRegionId[region2Id]!
      const region1Ratio =
        region1LocalRouteOrder === undefined || region1ActiveRouteCount <= 1
          ? 0.5
          : region1LocalRouteOrder / (region1ActiveRouteCount - 1)
      const region2Ratio =
        region2LocalRouteOrder === undefined || region2ActiveRouteCount <= 1
          ? 0.5
          : region2LocalRouteOrder / (region2ActiveRouteCount - 1)

      return (
        getAverage([region1Ratio, region2Ratio]) *
        Math.max(0, sortedSharedPortIds.length - 1)
      )
    })
    const fittedPortIndexes = fitIncreasingIndexesToDesiredPositions(
      desiredPortPositions,
      sortedSharedPortIds.length - 1,
    )

    for (let routeIndex = 0; routeIndex < sortedRouteIds.length; routeIndex++) {
      const routeId = sortedRouteIds[routeIndex]!
      const boundaryPortId =
        sortedSharedPortIds[fittedPortIndexes[routeIndex]!]!
      const boundaryPortIds = routeBoundaryPortIdsByRouteId.get(routeId) ?? []
      const routeRegionPath = routeRegionPathByRouteId.get(routeId)!

      for (
        let regionIndex = 1;
        regionIndex < routeRegionPath.regionIds.length;
        regionIndex++
      ) {
        const routeRegionPairKey = getRegionPairKey(
          routeRegionPath.regionIds[regionIndex - 1]!,
          routeRegionPath.regionIds[regionIndex]!,
        )
        if (routeRegionPairKey !== regionPairKey) {
          continue
        }
        boundaryPortIds[regionIndex - 1] = boundaryPortId
      }

      routeBoundaryPortIdsByRouteId.set(routeId, boundaryPortIds)
    }
  }

  return routeBoundaryPortIdsByRouteId
}

const addRoutePathSegmentsToResult = (
  result: TinyHyperGraphFixedRouteSegments,
  routeId: RouteId,
  routeRegionIds: RegionId[],
  boundaryPortIds: PortId[],
  startPortId: PortId,
  endPortId: PortId,
) => {
  for (
    let regionIndex = 0;
    regionIndex < routeRegionIds.length;
    regionIndex++
  ) {
    const fromPortId =
      regionIndex === 0 ? startPortId : boundaryPortIds[regionIndex - 1]
    const toPortId =
      regionIndex === routeRegionIds.length - 1
        ? endPortId
        : boundaryPortIds[regionIndex]

    if (fromPortId === undefined || toPortId === undefined) {
      throw new Error(
        `Bus route ${routeId} did not assign all boundary ports for region path`,
      )
    }

    if (fromPortId === toPortId) {
      continue
    }

    result.routeSegmentsByRegion[routeRegionIds[regionIndex]!]!.push([
      routeId,
      fromPortId,
      toPortId,
    ])
  }
}

export const computeTinyHyperGraphFixedBusRouteSegments = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): TinyHyperGraphFixedRouteSegments | undefined => {
  const busDefinitions = getTinyHyperGraphBusDefinitions(problem)
  if (busDefinitions.length === 0) {
    return undefined
  }

  const { routeStartRegionChoicesByRouteId, routeEndRegionChoicesByRouteId } =
    getRouteEndpointRegionChoices(topology, problem)
  const sharedPortIdsByRegionPair = getSharedPortIdsByRegionPair(topology)
  const adjacentRegionIdsByRegionId = getAdjacentRegionIdsByRegionId(
    topology,
    sharedPortIdsByRegionPair,
  )
  const result: TinyHyperGraphFixedRouteSegments = {
    fixedRouteIds: [],
    routeSegmentsByRegion: Array.from(
      { length: topology.regionCount },
      () => [],
    ),
  }
  const reservedPortIds = new Set<PortId>()
  const globalEdgeUsageByRegionPair = new Map<string, number>()
  const globalRegionUsageByRegionId = new Int32Array(topology.regionCount)

  for (const busDefinition of busDefinitions) {
    const routeRegionPaths: RouteRegionPath[] = []
    const currentRegionUsageByRegionId = new Int32Array(
      globalRegionUsageByRegionId,
    )
    const currentEdgeUsageByRegionPair = new Map(globalEdgeUsageByRegionPair)

    for (const routeId of getRouteIdsInMedianFirstOrder(
      busDefinition.routeIds,
    )) {
      const startRegionIds = routeStartRegionChoicesByRouteId[routeId] ?? []
      const endRegionIds = routeEndRegionChoicesByRouteId[routeId] ?? []

      if (startRegionIds.length === 0 || endRegionIds.length === 0) {
        throw new Error(
          `Bus "${busDefinition.busId}" route ${routeId} is missing endpoint region choices`,
        )
      }

      const routeRegionPath =
        getBestBusRouteRegionPath(
          topology,
          problem,
          routeId,
          startRegionIds,
          endRegionIds,
          currentRegionUsageByRegionId,
          currentEdgeUsageByRegionPair,
          sharedPortIdsByRegionPair,
          adjacentRegionIdsByRegionId,
          true,
        ) ??
        getBestBusRouteRegionPath(
          topology,
          problem,
          routeId,
          startRegionIds,
          endRegionIds,
          currentRegionUsageByRegionId,
          currentEdgeUsageByRegionPair,
          sharedPortIdsByRegionPair,
          adjacentRegionIdsByRegionId,
          false,
        )

      if (!routeRegionPath || routeRegionPath.regionIds.length === 0) {
        throw new Error(
          `Bus "${busDefinition.busId}" could not find a region path for route ${routeId}`,
        )
      }

      routeRegionPaths.push({
        routeId,
        regionIds: routeRegionPath.regionIds,
      })

      for (const regionId of routeRegionPath.regionIds) {
        currentRegionUsageByRegionId[regionId] += 1
      }
      for (
        let regionIndex = 1;
        regionIndex < routeRegionPath.regionIds.length;
        regionIndex++
      ) {
        const regionPairKey = getRegionPairKey(
          routeRegionPath.regionIds[regionIndex - 1]!,
          routeRegionPath.regionIds[regionIndex]!,
        )
        currentEdgeUsageByRegionPair.set(
          regionPairKey,
          (currentEdgeUsageByRegionPair.get(regionPairKey) ?? 0) + 1,
        )
      }
    }

    const boundaryPortIdsByRouteId = assignBoundaryPortIdsForBus(
      topology,
      busDefinition,
      routeRegionPaths,
      sharedPortIdsByRegionPair,
      reservedPortIds,
    )

    for (const routeRegionPath of routeRegionPaths) {
      const boundaryPortIds = boundaryPortIdsByRouteId.get(
        routeRegionPath.routeId,
      )
      if (!boundaryPortIds) {
        throw new Error(
          `Bus "${busDefinition.busId}" did not assign boundary ports for route ${routeRegionPath.routeId}`,
        )
      }

      addRoutePathSegmentsToResult(
        result,
        routeRegionPath.routeId,
        routeRegionPath.regionIds,
        boundaryPortIds,
        problem.routeStartPort[routeRegionPath.routeId]!,
        problem.routeEndPort[routeRegionPath.routeId]!,
      )
      result.fixedRouteIds.push(routeRegionPath.routeId)
      reservedPortIds.add(problem.routeStartPort[routeRegionPath.routeId]!)
      reservedPortIds.add(problem.routeEndPort[routeRegionPath.routeId]!)
      for (const boundaryPortId of boundaryPortIds) {
        reservedPortIds.add(boundaryPortId)
      }
      for (
        let regionIndex = 1;
        regionIndex < routeRegionPath.regionIds.length;
        regionIndex++
      ) {
        const regionPairKey = getRegionPairKey(
          routeRegionPath.regionIds[regionIndex - 1]!,
          routeRegionPath.regionIds[regionIndex]!,
        )
        globalEdgeUsageByRegionPair.set(
          regionPairKey,
          (globalEdgeUsageByRegionPair.get(regionPairKey) ?? 0) + 1,
        )
      }
      for (const regionId of routeRegionPath.regionIds) {
        globalRegionUsageByRegionId[regionId] += 1
      }
    }
  }

  return result.fixedRouteIds.length > 0 ? result : undefined
}

export const computeTinyHyperGraphBusRouteGuides = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
): TinyHyperGraphBusRouteGuides | undefined => {
  const busDefinitions = getTinyHyperGraphBusDefinitions(problem)
  if (busDefinitions.length === 0) {
    return undefined
  }

  const sortedBusDefinitions = [...busDefinitions].sort(
    (left, right) => right.routeIds.length - left.routeIds.length,
  )
  const { routeStartRegionChoicesByRouteId, routeEndRegionChoicesByRouteId } =
    getRouteEndpointRegionChoices(topology, problem)
  const sharedPortIdsByRegionPair = getSharedPortIdsByRegionPair(topology)
  const adjacentRegionIdsByRegionId = getAdjacentRegionIdsByRegionId(
    topology,
    sharedPortIdsByRegionPair,
  )
  const guidedRegionIdsByRouteId = Array.from(
    { length: problem.routeCount },
    () => undefined as RegionId[] | undefined,
  )
  const preferredBoundaryPortIdsByRouteId = Array.from(
    { length: problem.routeCount },
    () => undefined as PortId[] | undefined,
  )
  const guidedRouteIdsInSolveOrder: RouteId[] = []
  const globalEdgeUsageByRegionPair = new Map<string, number>()
  const globalRegionUsageByRegionId = new Int32Array(topology.regionCount)

  for (const busDefinition of sortedBusDefinitions) {
    const routeRegionPaths: RouteRegionPath[] = []
    const currentRegionUsageByRegionId = new Int32Array(
      globalRegionUsageByRegionId,
    )
    const currentEdgeUsageByRegionPair = new Map(globalEdgeUsageByRegionPair)

    for (const routeId of getRouteIdsInMedianFirstOrder(
      busDefinition.routeIds,
    )) {
      const startRegionIds = routeStartRegionChoicesByRouteId[routeId] ?? []
      const endRegionIds = routeEndRegionChoicesByRouteId[routeId] ?? []

      if (startRegionIds.length === 0 || endRegionIds.length === 0) {
        throw new Error(
          `Bus "${busDefinition.busId}" route ${routeId} is missing endpoint region choices`,
        )
      }

      const routeRegionPath =
        getBestBusRouteRegionPath(
          topology,
          problem,
          routeId,
          startRegionIds,
          endRegionIds,
          currentRegionUsageByRegionId,
          currentEdgeUsageByRegionPair,
          sharedPortIdsByRegionPair,
          adjacentRegionIdsByRegionId,
          true,
        ) ??
        getBestBusRouteRegionPath(
          topology,
          problem,
          routeId,
          startRegionIds,
          endRegionIds,
          currentRegionUsageByRegionId,
          currentEdgeUsageByRegionPair,
          sharedPortIdsByRegionPair,
          adjacentRegionIdsByRegionId,
          false,
        )

      if (!routeRegionPath || routeRegionPath.regionIds.length === 0) {
        throw new Error(
          `Bus "${busDefinition.busId}" could not find a region path for route ${routeId}`,
        )
      }

      guidedRegionIdsByRouteId[routeId] = routeRegionPath.regionIds
      routeRegionPaths.push({
        routeId,
        regionIds: routeRegionPath.regionIds,
      })

      for (const regionId of routeRegionPath.regionIds) {
        currentRegionUsageByRegionId[regionId] += 1
      }
      for (
        let regionIndex = 1;
        regionIndex < routeRegionPath.regionIds.length;
        regionIndex++
      ) {
        const regionPairKey = getRegionPairKey(
          routeRegionPath.regionIds[regionIndex - 1]!,
          routeRegionPath.regionIds[regionIndex]!,
        )
        currentEdgeUsageByRegionPair.set(
          regionPairKey,
          (currentEdgeUsageByRegionPair.get(regionPairKey) ?? 0) + 1,
        )
      }
    }

    const preferredBoundaryPortIdsForBusByRouteId = assignBoundaryPortIdsForBus(
      topology,
      busDefinition,
      routeRegionPaths,
      sharedPortIdsByRegionPair,
      new Set(),
    )

    for (const routeId of busDefinition.routeIds) {
      const preferredBoundaryPortIds =
        preferredBoundaryPortIdsForBusByRouteId.get(routeId)
      if (preferredBoundaryPortIds) {
        preferredBoundaryPortIdsByRouteId[routeId] = preferredBoundaryPortIds
      }
    }

    guidedRouteIdsInSolveOrder.push(
      ...getRouteIdsInMedianFirstOrder(busDefinition.routeIds),
    )

    for (const routeId of busDefinition.routeIds) {
      const regionIds = guidedRegionIdsByRouteId[routeId]
      if (!regionIds) {
        continue
      }

      for (const regionId of regionIds) {
        globalRegionUsageByRegionId[regionId] += 1
      }
      for (let regionIndex = 1; regionIndex < regionIds.length; regionIndex++) {
        const regionPairKey = getRegionPairKey(
          regionIds[regionIndex - 1]!,
          regionIds[regionIndex]!,
        )
        globalEdgeUsageByRegionPair.set(
          regionPairKey,
          (globalEdgeUsageByRegionPair.get(regionPairKey) ?? 0) + 1,
        )
      }
    }
  }

  return guidedRouteIdsInSolveOrder.length > 0
    ? {
        guidedRegionIdsByRouteId,
        preferredBoundaryPortIdsByRouteId,
        guidedRouteIdsInSolveOrder,
      }
    : undefined
}
