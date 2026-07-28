import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "./domain"
import { MinHeap } from "./min-heap"
import type { NetId, PortId, RegionId } from "./types"

export type CoarseRegionId = number

export interface LayeredSearchMap {
  readonly fineToCoarseRegionId: Int32Array
  readonly coarseRegionIds: RegionId[][]
  readonly coarseCenterX: Float64Array
  readonly coarseCenterY: Float64Array
  readonly coarseAvailableZMask: Int32Array
  readonly coarseAdjacency: CoarseRegionId[][]
}

export interface BuildLayeredSearchMapOptions {
  readonly bucketSize?: number
}

export interface FindLayeredRouteCorridorInput {
  readonly layeredMap: LayeredSearchMap
  readonly topology: TinyHyperGraphTopology
  readonly problem: TinyHyperGraphProblem
  readonly regionCongestionCost: ArrayLike<number>
  readonly currentRouteNetId: NetId
  readonly startRegionId: RegionId
  readonly goalPortId: PortId
  readonly distanceToCost: number
  readonly includeAdjacentCoarseRegions: boolean
}

export type LayeredRouteCorridorResult =
  | {
      readonly _tag: "found"
      readonly coarsePath: CoarseRegionId[]
      readonly allowedFineRegionMask: Uint8Array
    }
  | {
      readonly _tag: "notFound"
      readonly error: string
    }

interface CoarseCandidate {
  readonly coarseRegionId: CoarseRegionId
  readonly g: number
  readonly f: number
}

const compareCoarseCandidates = (
  left: CoarseCandidate,
  right: CoarseCandidate,
): number => left.f - right.f

export function buildLayeredSearchMap(
  topology: TinyHyperGraphTopology,
  options: BuildLayeredSearchMapOptions = {},
): LayeredSearchMap {
  const bucketSize = options.bucketSize ?? deriveBucketSize(topology)
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) {
    throw new Error(`Invalid layered-search bucket size: ${bucketSize}`)
  }

  const fineToCoarseRegionId = new Int32Array(topology.regionCount).fill(-1)
  const coarseRegionIds: RegionId[][] = []
  const coarseIdByBucketKey = new Map<string, CoarseRegionId>()

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const centerX = topology.regionCenterX[regionId]
    const centerY = topology.regionCenterY[regionId]
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      throw new Error(`Region ${regionId} has invalid center coordinates`)
    }

    const bucketX = Math.floor(centerX / bucketSize)
    const bucketY = Math.floor(centerY / bucketSize)
    const bucketKey = `${bucketX}:${bucketY}`
    let coarseRegionId = coarseIdByBucketKey.get(bucketKey)

    if (coarseRegionId === undefined) {
      coarseRegionId = coarseRegionIds.length
      coarseIdByBucketKey.set(bucketKey, coarseRegionId)
      coarseRegionIds.push([])
    }

    fineToCoarseRegionId[regionId] = coarseRegionId
    const fineRegionIds = coarseRegionIds[coarseRegionId]
    if (!fineRegionIds) {
      throw new Error(`Coarse region ${coarseRegionId} was not initialized`)
    }
    fineRegionIds.push(regionId)
  }

  const coarseCenterX = new Float64Array(coarseRegionIds.length)
  const coarseCenterY = new Float64Array(coarseRegionIds.length)
  const coarseAvailableZMask = new Int32Array(coarseRegionIds.length)
  for (let coarseRegionId = 0; coarseRegionId < coarseRegionIds.length; coarseRegionId++) {
    const regionIds = coarseRegionIds[coarseRegionId]
    if (!regionIds || regionIds.length === 0) {
      throw new Error(`Coarse region ${coarseRegionId} has no fine regions`)
    }

    let centerXSum = 0
    let centerYSum = 0
    let availableZMask = 0
    for (const regionId of regionIds) {
      centerXSum += topology.regionCenterX[regionId]
      centerYSum += topology.regionCenterY[regionId]
      availableZMask |= topology.regionAvailableZMask?.[regionId] ?? 0
    }
    coarseCenterX[coarseRegionId] = centerXSum / regionIds.length
    coarseCenterY[coarseRegionId] = centerYSum / regionIds.length
    coarseAvailableZMask[coarseRegionId] = availableZMask
  }

  const adjacencySets = Array.from(
    { length: coarseRegionIds.length },
    () => new Set<CoarseRegionId>(),
  )
  for (let portId = 0; portId < topology.portCount; portId++) {
    const incidentRegions = topology.incidentPortRegion[portId]
    if (incidentRegions === undefined) {
      throw new Error(`Port ${portId} is missing incident regions`)
    }
    if (incidentRegions.length < 2) {
      continue
    }

    const firstRegionId = incidentRegions[0]
    const secondRegionId = incidentRegions[1]
    if (firstRegionId === undefined || secondRegionId === undefined) {
      throw new Error(`Port ${portId} has invalid incident regions`)
    }

    const firstCoarseRegionId = fineToCoarseRegionId[firstRegionId]
    const secondCoarseRegionId = fineToCoarseRegionId[secondRegionId]
    if (firstCoarseRegionId === undefined || secondCoarseRegionId === undefined) {
      throw new Error(`Port ${portId} references an unmapped region`)
    }
    if (firstCoarseRegionId < 0 || secondCoarseRegionId < 0) {
      throw new Error(`Port ${portId} references an unmapped region`)
    }
    if (firstCoarseRegionId === secondCoarseRegionId) {
      continue
    }

    const firstAdjacency = adjacencySets[firstCoarseRegionId]
    const secondAdjacency = adjacencySets[secondCoarseRegionId]
    if (!firstAdjacency || !secondAdjacency) {
      throw new Error(`Port ${portId} references unknown coarse adjacency`)
    }
    firstAdjacency.add(secondCoarseRegionId)
    secondAdjacency.add(firstCoarseRegionId)
  }

  return {
    fineToCoarseRegionId,
    coarseRegionIds,
    coarseCenterX,
    coarseCenterY,
    coarseAvailableZMask,
    coarseAdjacency: adjacencySets.map((adjacentIds) =>
      Array.from(adjacentIds).sort((left, right) => left - right),
    ),
  }
}

export function findLayeredRouteCorridor(
  input: FindLayeredRouteCorridorInput,
): LayeredRouteCorridorResult {
  const startCoarseRegionId =
    input.layeredMap.fineToCoarseRegionId[input.startRegionId]
  if (startCoarseRegionId === undefined || startCoarseRegionId < 0) {
    throw new Error(`Start region ${input.startRegionId} is not in coarse map`)
  }

  const goalCoarseRegionIds = getLegalGoalCoarseRegionIds(input)
  if (goalCoarseRegionIds.size === 0) {
    return {
      _tag: "notFound",
      error: `Goal port ${input.goalPortId} has no legal coarse regions`,
    }
  }

  const coarsePath = runCoarseAStar(
    input,
    startCoarseRegionId,
    goalCoarseRegionIds,
  )
  if (coarsePath.length === 0) {
    return {
      _tag: "notFound",
      error: `No coarse path from region ${input.startRegionId} to goal port ${input.goalPortId}`,
    }
  }

  return {
    _tag: "found",
    coarsePath,
    allowedFineRegionMask: createAllowedFineRegionMask(input, coarsePath),
  }
}

function deriveBucketSize(topology: TinyHyperGraphTopology): number {
  const diameters: number[] = []
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const width = topology.regionWidth[regionId]
    const height = topology.regionHeight[regionId]
    if (Number.isFinite(width) && Number.isFinite(height)) {
      diameters.push(Math.max(width, height))
    }
  }

  diameters.sort((left, right) => left - right)
  const medianDiameter = diameters[Math.floor(diameters.length / 2)] ?? 1
  return Math.max(medianDiameter * 4, 1)
}

function getLegalGoalCoarseRegionIds(
  input: FindLayeredRouteCorridorInput,
): Set<CoarseRegionId> {
  const goalCoarseRegionIds = new Set<CoarseRegionId>()
  const incidentRegions = input.topology.incidentPortRegion[input.goalPortId]
  if (incidentRegions === undefined) {
    throw new Error(`Goal port ${input.goalPortId} is missing incident regions`)
  }

  for (const regionId of incidentRegions) {
    if (isRegionReservedForDifferentNet(input, regionId)) {
      continue
    }
    const coarseRegionId = input.layeredMap.fineToCoarseRegionId[regionId]
    if (coarseRegionId === undefined || coarseRegionId < 0) {
      throw new Error(`Goal region ${regionId} is not in coarse map`)
    }
    goalCoarseRegionIds.add(coarseRegionId)
  }

  return goalCoarseRegionIds
}

function runCoarseAStar(
  input: FindLayeredRouteCorridorInput,
  startCoarseRegionId: CoarseRegionId,
  goalCoarseRegionIds: Set<CoarseRegionId>,
): CoarseRegionId[] {
  const queue = new MinHeap<CoarseCandidate>([], compareCoarseCandidates)
  const bestCostByCoarseRegionId = new Float64Array(
    input.layeredMap.coarseRegionIds.length,
  ).fill(Number.POSITIVE_INFINITY)
  const previousCoarseRegionId = new Int32Array(
    input.layeredMap.coarseRegionIds.length,
  ).fill(-1)

  bestCostByCoarseRegionId[startCoarseRegionId] = 0
  queue.queue({
    coarseRegionId: startCoarseRegionId,
    g: 0,
    f: getCoarseHeuristic(input, startCoarseRegionId, goalCoarseRegionIds),
  })

  while (queue.length > 0) {
    const current = queue.dequeue()
    if (!current) {
      break
    }
    if (current.g > bestCostByCoarseRegionId[current.coarseRegionId]) {
      continue
    }
    if (goalCoarseRegionIds.has(current.coarseRegionId)) {
      return reconstructCoarsePath(
        previousCoarseRegionId,
        current.coarseRegionId,
      )
    }

    const adjacentCoarseRegionIds =
      input.layeredMap.coarseAdjacency[current.coarseRegionId]
    if (!adjacentCoarseRegionIds) {
      throw new Error(`Coarse region ${current.coarseRegionId} is missing adjacency`)
    }

    for (const nextCoarseRegionId of adjacentCoarseRegionIds) {
      if (isCoarseRegionReservedForDifferentNet(input, nextCoarseRegionId)) {
        continue
      }
      const g =
        current.g +
        getCoarseEdgeCost(input, current.coarseRegionId, nextCoarseRegionId)
      if (g >= bestCostByCoarseRegionId[nextCoarseRegionId]) {
        continue
      }

      bestCostByCoarseRegionId[nextCoarseRegionId] = g
      previousCoarseRegionId[nextCoarseRegionId] = current.coarseRegionId
      queue.queue({
        coarseRegionId: nextCoarseRegionId,
        g,
        f: g + getCoarseHeuristic(input, nextCoarseRegionId, goalCoarseRegionIds),
      })
    }
  }

  return []
}

function reconstructCoarsePath(
  previousCoarseRegionId: Int32Array,
  endCoarseRegionId: CoarseRegionId,
): CoarseRegionId[] {
  const coarsePath: CoarseRegionId[] = []
  let cursor = endCoarseRegionId

  while (cursor >= 0) {
    coarsePath.unshift(cursor)
    cursor = previousCoarseRegionId[cursor] ?? -1
  }

  return coarsePath
}

function createAllowedFineRegionMask(
  input: FindLayeredRouteCorridorInput,
  coarsePath: CoarseRegionId[],
): Uint8Array {
  const allowedCoarseRegionIds = new Set<CoarseRegionId>()
  for (const coarseRegionId of coarsePath) {
    allowedCoarseRegionIds.add(coarseRegionId)
    if (!input.includeAdjacentCoarseRegions) {
      continue
    }
    const adjacentCoarseRegionIds =
      input.layeredMap.coarseAdjacency[coarseRegionId]
    if (!adjacentCoarseRegionIds) {
      throw new Error(`Coarse region ${coarseRegionId} is missing adjacency`)
    }
    for (const adjacentCoarseRegionId of adjacentCoarseRegionIds) {
      allowedCoarseRegionIds.add(adjacentCoarseRegionId)
    }
  }

  const allowedFineRegionMask = new Uint8Array(input.topology.regionCount)
  for (const coarseRegionId of allowedCoarseRegionIds) {
    const fineRegionIds = input.layeredMap.coarseRegionIds[coarseRegionId]
    if (!fineRegionIds) {
      throw new Error(`Coarse region ${coarseRegionId} has no fine regions`)
    }
    for (const regionId of fineRegionIds) {
      allowedFineRegionMask[regionId] = 1
    }
  }

  return allowedFineRegionMask
}

function isCoarseRegionReservedForDifferentNet(
  input: FindLayeredRouteCorridorInput,
  coarseRegionId: CoarseRegionId,
): boolean {
  const fineRegionIds = input.layeredMap.coarseRegionIds[coarseRegionId]
  if (!fineRegionIds) {
    throw new Error(`Coarse region ${coarseRegionId} has no fine regions`)
  }

  for (const regionId of fineRegionIds) {
    if (!isRegionReservedForDifferentNet(input, regionId)) {
      return false
    }
  }

  return true
}

function isRegionReservedForDifferentNet(
  input: FindLayeredRouteCorridorInput,
  regionId: RegionId,
): boolean {
  const reservedNetId = input.problem.regionNetId[regionId]
  return reservedNetId !== -1 && reservedNetId !== input.currentRouteNetId
}

function getCoarseEdgeCost(
  input: FindLayeredRouteCorridorInput,
  fromCoarseRegionId: CoarseRegionId,
  toCoarseRegionId: CoarseRegionId,
): number {
  const dx =
    input.layeredMap.coarseCenterX[fromCoarseRegionId] -
    input.layeredMap.coarseCenterX[toCoarseRegionId]
  const dy =
    input.layeredMap.coarseCenterY[fromCoarseRegionId] -
    input.layeredMap.coarseCenterY[toCoarseRegionId]
  const congestionCost = getAverageCoarseCongestionCost(input, toCoarseRegionId)
  return Math.hypot(dx, dy) * input.distanceToCost + congestionCost
}

function getCoarseHeuristic(
  input: FindLayeredRouteCorridorInput,
  coarseRegionId: CoarseRegionId,
  goalCoarseRegionIds: Set<CoarseRegionId>,
): number {
  let bestDistance = Number.POSITIVE_INFINITY
  for (const goalCoarseRegionId of goalCoarseRegionIds) {
    const dx =
      input.layeredMap.coarseCenterX[coarseRegionId] -
      input.layeredMap.coarseCenterX[goalCoarseRegionId]
    const dy =
      input.layeredMap.coarseCenterY[coarseRegionId] -
      input.layeredMap.coarseCenterY[goalCoarseRegionId]
    bestDistance = Math.min(bestDistance, Math.hypot(dx, dy))
  }

  return bestDistance * input.distanceToCost
}

function getAverageCoarseCongestionCost(
  input: FindLayeredRouteCorridorInput,
  coarseRegionId: CoarseRegionId,
): number {
  const fineRegionIds = input.layeredMap.coarseRegionIds[coarseRegionId]
  if (!fineRegionIds || fineRegionIds.length === 0) {
    throw new Error(`Coarse region ${coarseRegionId} has no fine regions`)
  }

  let totalCongestionCost = 0
  for (const regionId of fineRegionIds) {
    totalCongestionCost += input.regionCongestionCost[regionId] ?? 0
  }

  return totalCongestionCost / fineRegionIds.length
}
