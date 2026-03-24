import type {
  RegionCostSummary,
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphTopology,
} from "../core"
import type { PortId, RegionId, RouteId } from "../types"

type QuarterTurn = 0 | 1 | 2 | 3
type ScaleBucket = 1 | 2 | 3 | 4
type CacheLookupResult = "hit" | "miss" | "rejected"

interface SectionCacheRoutePlan {
  routeId: RouteId
  fixedSegments: Array<{
    regionId: RegionId
    fromPortId: PortId
    toPortId: PortId
  }>
  activeStartPortId?: PortId
  activeEndPortId?: PortId
  forcedStartRegionId?: RegionId
}

interface SectionCachePolicySignature {
  DISTANCE_TO_COST: number
  RIP_THRESHOLD_START: number
  RIP_THRESHOLD_END: number
  RIP_THRESHOLD_RAMP_ATTEMPTS: number
  RIP_CONGESTION_REGION_COST_FACTOR: number
  MAX_ITERATIONS: number
  MAX_RIPS: number
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: number
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: number
}

export interface SectionSolverCacheTransform {
  anchorRegionId: RegionId
  anchorCenterX: number
  anchorCenterY: number
  scaleBucket: ScaleBucket
  scaleDivisor: number
  rotationQuarterTurns: QuarterTurn
  canonicalRegionIdByActualRegionId: Map<RegionId, number>
  actualRegionIdByCanonicalRegionId: RegionId[]
  canonicalPortIdByActualPortId: Map<PortId, number>
  actualPortIdByCanonicalPortId: PortId[]
  canonicalRouteIdByActualRouteId: Map<RouteId, number>
  actualRouteIdByCanonicalRouteId: RouteId[]
}

export interface SectionSolverCacheContext {
  key: string
  transform: SectionSolverCacheTransform
}

export interface SectionSolverCacheEntry {
  optimized: boolean
  finalSummary: RegionCostSummary
  canonicalRouteSolutions?: Array<{
    segments: Array<[number, number]>
    regionIds: Array<number | undefined>
  }>
}

export interface SectionSolverScoreCacheEntry {
  optimized: boolean
  finalSummary: RegionCostSummary
}

export interface SectionSolverScoreCacheHit {
  entry: SectionSolverScoreCacheEntry
  trusted: boolean
  fromPreviousGeneration: boolean
}

interface SectionSolverLossyScoreCacheBucket {
  observedCount: number
  exactKeyCount: number
  trusted: boolean
  consistent: boolean
  generation: number
  summaryToken?: string
  entry?: SectionSolverScoreCacheEntry
}

export interface TinyHyperGraphSectionSolverCacheStats {
  entries: number
  scoreEntries: number
  lookups: number
  hits: number
  misses: number
  rejectedHits: number
  stores: number
  scoreLookups: number
  scoreHits: number
  scoreMisses: number
  scoreStores: number
  contextBuildMs: number
  hydrateSolutionMs: number
  hydratedSolverBuildMs: number
  storeValidationMs: number
  storeEntryBuildMs: number
}

export interface SectionSolverScoreCacheKeyStats {
  key: string
  lookups: number
  hits: number
  misses: number
  stores: number
}

export interface SectionSolverLossyDescriptor {
  scaleBucket: ScaleBucket
  policyToken: string
  regionTokens: string[]
  portTokens: string[]
  routeTokens: string[]
}

export interface SectionSolverLossyScoreKeyStats {
  key: string
  lookups: number
  distinctScoreKeys: number
}

interface OrientationCandidate {
  key: string
  transform: SectionSolverCacheTransform
}

interface ScoreKeyOrientationCandidate {
  key: string
}

interface SectionSolverLossyScoreFingerprint {
  scaleBucket: ScaleBucket
  policyToken: string
  regionTokenHashes: HashPair[]
  routeTokenHashes: HashPair[]
}

const SECTION_SOLVER_CACHE_VERSION = 1
const UNIT_REGION_SIZE_MM = 4
const SCALE_BUCKETS: ScaleBucket[] = [1, 2, 3, 4]
const GEOMETRY_QUANTIZATION = 1000

const sectionSolverCache = new Map<string, SectionSolverCacheEntry>()
const sectionSolverLossyScoreCache = new Map<
  string,
  SectionSolverLossyScoreCacheBucket
>()
const sectionSolverScoreCacheKeyStatsByKey = new Map<
  string,
  Omit<SectionSolverScoreCacheKeyStats, "key">
>()
const sectionSolverLossyScoreKeyStatsByKey = new Map<
  string,
  { lookups: number; scoreKeys: Set<string> }
>()
let sectionSolverLossyScoreKeyObservationEnabled = false
let sectionSolverScoreCacheGeneration = 0
const sectionSolverCacheStats = {
  lookups: 0,
  hits: 0,
  misses: 0,
  rejectedHits: 0,
  stores: 0,
  scoreLookups: 0,
  scoreHits: 0,
  scoreMisses: 0,
  scoreStores: 0,
  contextBuildMs: 0,
  hydrateSolutionMs: 0,
  hydratedSolverBuildMs: 0,
  storeValidationMs: 0,
  storeEntryBuildMs: 0,
}

const compareStrings = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const getOrCreateScoreCacheKeyStats = (key: string) => {
  let stats = sectionSolverScoreCacheKeyStatsByKey.get(key)
  if (!stats) {
    stats = {
      lookups: 0,
      hits: 0,
      misses: 0,
      stores: 0,
    }
    sectionSolverScoreCacheKeyStatsByKey.set(key, stats)
  }
  return stats
}

const summarizeScoreEntry = (entry: SectionSolverScoreCacheEntry) =>
  JSON.stringify({
    optimized: entry.optimized ? 1 : 0,
    finalSummary: {
      maxRegionCost: Number(entry.finalSummary.maxRegionCost.toFixed(9)),
      totalRegionCost: Number(entry.finalSummary.totalRegionCost.toFixed(9)),
    },
  })

const getOrCreateLossyScoreKeyStats = (key: string) => {
  let stats = sectionSolverLossyScoreKeyStatsByKey.get(key)
  if (!stats) {
    stats = {
      lookups: 0,
      scoreKeys: new Set<string>(),
    }
    sectionSolverLossyScoreKeyStatsByKey.set(key, stats)
  }
  return stats
}

const compareNumbers = (left: number, right: number) => left - right

type HashPair = readonly [number, number]

const HASH_A_OFFSET = 2166136261
const HASH_B_OFFSET = 33554467
const HASH_A_PRIME = 16777619
const HASH_B_PRIME = 2246822519
const HASH_DELIMITER = 0x9e3779b9

const mixHash32 = (hash: number, value: number, prime: number) =>
  Math.imul(hash ^ (value >>> 0), prime) >>> 0

const hashNumbers = (values: Iterable<number>): HashPair => {
  let hashA = HASH_A_OFFSET
  let hashB = HASH_B_OFFSET

  for (const value of values) {
    hashA = mixHash32(hashA, value, HASH_A_PRIME)
    hashB = mixHash32(hashB, value + HASH_DELIMITER, HASH_B_PRIME)
  }

  hashA = mixHash32(hashA, HASH_DELIMITER, HASH_A_PRIME)
  hashB = mixHash32(hashB, HASH_DELIMITER, HASH_B_PRIME)
  return [hashA >>> 0, hashB >>> 0]
}

const compareHashPairs = (left: HashPair, right: HashPair) =>
  compareNumbers(left[0], right[0]) || compareNumbers(left[1], right[1])

const pushHashPair = (values: number[], hash: HashPair) => {
  values.push(hash[0], hash[1], HASH_DELIMITER)
}

const hashHashPairs = (hashes: Iterable<HashPair>): HashPair => {
  const values: number[] = []
  for (const hash of hashes) {
    pushHashPair(values, hash)
  }
  return hashNumbers(values)
}

const hashHashPairWithValue = (
  hash: HashPair | undefined | null,
  value: number,
): HashPair =>
  hashNumbers(hash ? [hash[0], hash[1], value] : [HASH_DELIMITER, value])

const hashTriples = (triples: Array<[number, number, number]>): HashPair => {
  const values: number[] = []
  for (const [first, second, third] of triples) {
    values.push(first, second, third, HASH_DELIMITER)
  }
  return hashNumbers(values)
}

const formatHashPair = (hash: HashPair) =>
  `${hash[0].toString(16).padStart(8, "0")}${hash[1].toString(16).padStart(8, "0")}`

const getSideFromAngle = (angle: number) =>
  ((((Math.round(angle / 9000) % 4) + 4) % 4) as 0 | 1 | 2 | 3)

const getSideOrderCoordinate = (
  canonicalPoint: { x: number; y: number },
  side: 0 | 1 | 2 | 3,
) => {
  if (side === 0 || side === 2) {
    return quantize(canonicalPoint.y)
  }

  return quantize(canonicalPoint.x)
}

const getOrdinalBucket = (ordinal: number, sideCount: number) => {
  if (sideCount <= 1) {
    return 0
  }

  return Math.round((ordinal * 3) / Math.max(sideCount - 1, 1))
}

const bucketCount = (count: number) => (count <= 0 ? 0 : count === 1 ? 1 : 2)
const getNormalizedSizeBucket = (normalizedSize: number) =>
  Math.max(1, Math.min(4, Math.round(normalizedSize)))

const quantize = (value: number) => Math.round(value * GEOMETRY_QUANTIZATION)

const uniqueNumberList = <T extends number>(values: Iterable<T>) => [...new Set(values)]

const getSerializedPortId = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
) => topology.portMetadata?.[portId]?.serializedPortId ?? `port-${portId}`

const getSerializedRegionId = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
) => topology.regionMetadata?.[regionId]?.serializedRegionId ?? `region-${regionId}`

const rotatePoint = (
  x: number,
  y: number,
  quarterTurns: QuarterTurn,
): { x: number; y: number } => {
  switch (quarterTurns) {
    case 0:
      return { x, y }
    case 1:
      return { x: -y, y: x }
    case 2:
      return { x: -x, y: -y }
    case 3:
      return { x: y, y: -x }
  }
}

const inverseRotatePoint = (
  x: number,
  y: number,
  quarterTurns: QuarterTurn,
): { x: number; y: number } =>
  rotatePoint(x, y, ((4 - quarterTurns) % 4) as QuarterTurn)

const rotateAngle = (angle: number, quarterTurns: QuarterTurn) => {
  const rotated = (angle + quarterTurns * 9000) % 36000
  return rotated < 0 ? rotated + 36000 : rotated
}

const getClosestScaleBucket = (width: number, height: number): ScaleBucket => {
  const rawScale = (width / UNIT_REGION_SIZE_MM + height / UNIT_REGION_SIZE_MM) / 2
  let bestScaleBucket = SCALE_BUCKETS[0]
  let bestDistance = Number.POSITIVE_INFINITY

  for (const scaleBucket of SCALE_BUCKETS) {
    const distance = Math.abs(rawScale - scaleBucket)
    if (distance < bestDistance) {
      bestDistance = distance
      bestScaleBucket = scaleBucket
    }
  }

  return bestScaleBucket
}

const getRegionScaleFactor = (width: number, height: number) =>
  Math.max(
    (width / UNIT_REGION_SIZE_MM + height / UNIT_REGION_SIZE_MM) / 2,
    Number.EPSILON,
  )

const selectAnchorRegionId = (
  topology: TinyHyperGraphTopology,
  sectionRegionIds: RegionId[],
  baselineRegionCosts: ArrayLike<number>,
): RegionId => {
  const regionCount = Math.max(sectionRegionIds.length, 1)
  const centroidX =
    sectionRegionIds.reduce(
      (sum, regionId) => sum + topology.regionCenterX[regionId],
      0,
    ) / regionCount
  const centroidY =
    sectionRegionIds.reduce(
      (sum, regionId) => sum + topology.regionCenterY[regionId],
      0,
    ) / regionCount

  let bestRegionId = sectionRegionIds[0] ?? 0
  let bestCost = Number.NEGATIVE_INFINITY
  let bestDistanceToCentroid = Number.POSITIVE_INFINITY

  for (const regionId of sectionRegionIds) {
    const regionCost = baselineRegionCosts[regionId] ?? 0
    const dx = topology.regionCenterX[regionId] - centroidX
    const dy = topology.regionCenterY[regionId] - centroidY
    const distanceToCentroid = Math.hypot(dx, dy)

    if (
      regionCost > bestCost + Number.EPSILON ||
      (Math.abs(regionCost - bestCost) <= Number.EPSILON &&
        distanceToCentroid < bestDistanceToCentroid - Number.EPSILON) ||
      (Math.abs(regionCost - bestCost) <= Number.EPSILON &&
        Math.abs(distanceToCentroid - bestDistanceToCentroid) <=
          Number.EPSILON &&
        regionId < bestRegionId)
    ) {
      bestRegionId = regionId
      bestCost = regionCost
      bestDistanceToCentroid = distanceToCentroid
    }
  }

  return bestRegionId
}

const createTransform = (
  topology: TinyHyperGraphTopology,
  anchorRegionId: RegionId,
  scaleBucket: ScaleBucket,
  scaleDivisor: number,
  rotationQuarterTurns: QuarterTurn,
): Omit<
  SectionSolverCacheTransform,
  | "canonicalRegionIdByActualRegionId"
  | "actualRegionIdByCanonicalRegionId"
  | "canonicalPortIdByActualPortId"
  | "actualPortIdByCanonicalPortId"
  | "canonicalRouteIdByActualRouteId"
  | "actualRouteIdByCanonicalRouteId"
> => ({
  anchorRegionId,
  anchorCenterX: topology.regionCenterX[anchorRegionId],
  anchorCenterY: topology.regionCenterY[anchorRegionId],
  scaleBucket,
  scaleDivisor,
  rotationQuarterTurns,
})

const toCanonicalPoint = (
  transform: Pick<
    SectionSolverCacheTransform,
    | "anchorCenterX"
    | "anchorCenterY"
    | "scaleDivisor"
    | "rotationQuarterTurns"
  >,
  x: number,
  y: number,
) => {
  const translatedX = (x - transform.anchorCenterX) / transform.scaleDivisor
  const translatedY = (y - transform.anchorCenterY) / transform.scaleDivisor
  return rotatePoint(
    translatedX,
    translatedY,
    transform.rotationQuarterTurns,
  )
}

export const toActualPoint = (
  transform: Pick<
    SectionSolverCacheTransform,
    | "anchorCenterX"
    | "anchorCenterY"
    | "scaleDivisor"
    | "rotationQuarterTurns"
  >,
  x: number,
  y: number,
) => {
  const unrotated = inverseRotatePoint(x, y, transform.rotationQuarterTurns)
  return {
    x: unrotated.x * transform.scaleDivisor + transform.anchorCenterX,
    y: unrotated.y * transform.scaleDivisor + transform.anchorCenterY,
  }
}

const cloneRegionSegments = (
  regionSegments: Array<[RouteId, PortId, PortId][]>,
): Array<[RouteId, PortId, PortId][]> =>
  regionSegments.map((segments) =>
    segments.map(
      ([routeId, fromPortId, toPortId]) =>
        [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
    ),
  )

const getSectionLocalPortIds = (
  topology: TinyHyperGraphTopology,
  sectionRegionIds: RegionId[],
) => {
  const portIds = new Set<PortId>()

  for (const regionId of sectionRegionIds) {
    for (const portId of topology.regionIncidentPorts[regionId] ?? []) {
      portIds.add(portId)
    }
  }

  return [...portIds]
}

const getLocalRoutePortAndRegionIds = (
  routePlans: SectionCacheRoutePlan[],
  activeRouteIds: RouteId[],
) => {
  const activeRouteIdSet = new Set(activeRouteIds)
  const portIds = new Set<PortId>()
  const regionIds = new Set<RegionId>()

  for (const routePlan of routePlans) {
    if (
      !activeRouteIdSet.has(routePlan.routeId) &&
      routePlan.fixedSegments.length === 0
    ) {
      continue
    }

    for (const fixedSegment of routePlan.fixedSegments) {
      portIds.add(fixedSegment.fromPortId)
      portIds.add(fixedSegment.toPortId)
      regionIds.add(fixedSegment.regionId)
    }

    if (routePlan.activeStartPortId !== undefined) {
      portIds.add(routePlan.activeStartPortId)
    }
    if (routePlan.activeEndPortId !== undefined) {
      portIds.add(routePlan.activeEndPortId)
    }
    if (routePlan.forcedStartRegionId !== undefined) {
      regionIds.add(routePlan.forcedStartRegionId)
    }
  }

  return {
    portIds: [...portIds],
    regionIds: [...regionIds],
  }
}

const createPolicySignature = (policy: SectionCachePolicySignature) => ({
  DISTANCE_TO_COST: Number(policy.DISTANCE_TO_COST.toFixed(12)),
  RIP_THRESHOLD_RAMP_ATTEMPTS: policy.RIP_THRESHOLD_RAMP_ATTEMPTS,
  RIP_CONGESTION_REGION_COST_FACTOR: Number(
    policy.RIP_CONGESTION_REGION_COST_FACTOR.toFixed(12),
  ),
  MAX_ITERATIONS: policy.MAX_ITERATIONS,
  MAX_RIPS: Number.isFinite(policy.MAX_RIPS) ? policy.MAX_RIPS : "Infinity",
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: Number.isFinite(
    policy.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT,
  )
    ? policy.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT
    : "Infinity",
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.isFinite(
    policy.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST,
  )
    ? policy.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST
    : "Infinity",
})

export const createSectionSolverScoreCacheKey = ({
  topology,
  problem,
  sectionRegionIds,
  routePlans,
  activeRouteIds,
  baselineRegionCosts,
  policy,
}: {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  sectionRegionIds: RegionId[]
  routePlans: SectionCacheRoutePlan[]
  activeRouteIds: RouteId[]
  baselineRegionCosts: ArrayLike<number>
  policy: SectionCachePolicySignature
}): string | undefined => {
  const uniqueSectionRegionIds = uniqueNumberList(sectionRegionIds)
  if (uniqueSectionRegionIds.length === 0) {
    return undefined
  }

  const localIdsFromRoutes = getLocalRoutePortAndRegionIds(routePlans, activeRouteIds)
  const localPortIds = uniqueNumberList([
    ...getSectionLocalPortIds(topology, uniqueSectionRegionIds),
    ...localIdsFromRoutes.portIds,
  ])
  const localRegionIds = uniqueNumberList([
    ...uniqueSectionRegionIds,
    ...localIdsFromRoutes.regionIds,
  ])
  const localRegionIdSet = new Set(localRegionIds)
  const activeRouteIdSet = new Set(activeRouteIds)
  const routePlanByRouteId = new Map(routePlans.map((routePlan) => [routePlan.routeId, routePlan]))
  const localRouteIds = uniqueNumberList(
    routePlans
      .filter(
        (routePlan) =>
          activeRouteIdSet.has(routePlan.routeId) ||
          routePlan.fixedSegments.some((segment) =>
            localRegionIdSet.has(segment.regionId),
          ),
      )
      .map((routePlan) => routePlan.routeId),
  )

  const anchorRegionId = selectAnchorRegionId(
    topology,
    uniqueSectionRegionIds,
    baselineRegionCosts,
  )
  const scaleDivisor =
    UNIT_REGION_SIZE_MM *
    getRegionScaleFactor(
      topology.regionWidth[anchorRegionId],
      topology.regionHeight[anchorRegionId],
    )
  const scaleBucket = getClosestScaleBucket(
    topology.regionWidth[anchorRegionId],
    topology.regionHeight[anchorRegionId],
  )
  const policySignature = createPolicySignature(policy)
  const policyHash = hashNumbers([
    quantize(policySignature.DISTANCE_TO_COST),
    policySignature.RIP_THRESHOLD_RAMP_ATTEMPTS,
    quantize(policySignature.RIP_CONGESTION_REGION_COST_FACTOR),
    policySignature.MAX_ITERATIONS,
    typeof policySignature.MAX_RIPS === "number"
      ? policySignature.MAX_RIPS
      : HASH_DELIMITER,
    typeof policySignature.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT === "number"
      ? policySignature.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT
      : HASH_DELIMITER,
    typeof policySignature.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST ===
    "number"
      ? policySignature.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST
      : HASH_DELIMITER,
  ])
  let bestCandidate: ScoreKeyOrientationCandidate | undefined

  for (const rotationQuarterTurns of [0, 1, 2, 3] as QuarterTurn[]) {
    const transformBase = createTransform(
      topology,
      anchorRegionId,
      scaleBucket,
      scaleDivisor,
      rotationQuarterTurns,
    )
    const rawRegionHashById = new Map<RegionId, HashPair>()

    for (const regionId of localRegionIds) {
      const canonicalCenter = toCanonicalPoint(
        transformBase,
        topology.regionCenterX[regionId],
        topology.regionCenterY[regionId],
      )
      const width =
        rotationQuarterTurns % 2 === 0
          ? topology.regionWidth[regionId]
          : topology.regionHeight[regionId]
      const height =
        rotationQuarterTurns % 2 === 0
          ? topology.regionHeight[regionId]
          : topology.regionWidth[regionId]
      const incidentPortIds = topology.regionIncidentPorts[regionId] ?? []
      const maskedIncidentPortCount = incidentPortIds.filter(
        (portId) => problem.portSectionMask[portId] === 1,
      ).length

      rawRegionHashById.set(
        regionId,
        hashNumbers([
          quantize(canonicalCenter.x),
          quantize(canonicalCenter.y),
          quantize(width / transformBase.scaleDivisor),
          quantize(height / transformBase.scaleDivisor),
          incidentPortIds.length,
          maskedIncidentPortCount,
        ]),
      )
    }

    const rawPortHashById = new Map<PortId, HashPair>()

    for (const portId of localPortIds) {
      const canonicalPoint = toCanonicalPoint(
        transformBase,
        topology.portX[portId],
        topology.portY[portId],
      )
      const incidentRegionIds = topology.incidentPortRegion[portId] ?? []
      const localRegionDescriptors = incidentRegionIds
        .map((regionId, regionIndex) => {
          if (!localRegionIdSet.has(regionId)) {
            return undefined
          }

          const angle =
            regionIndex === 0
              ? topology.portAngleForRegion1[portId]
              : topology.portAngleForRegion2?.[portId] ??
                topology.portAngleForRegion1[portId]

          return {
            regionHash: rawRegionHashById.get(regionId),
            angle: rotateAngle(angle, rotationQuarterTurns),
          }
        })
        .filter(
          (
            descriptor,
          ): descriptor is { regionHash: HashPair; angle: number } =>
            descriptor?.regionHash !== undefined,
        )
        .sort((left, right) => {
          const regionComparison = compareHashPairs(
            left.regionHash,
            right.regionHash,
          )
          if (regionComparison !== 0) {
            return regionComparison
          }

          return left.angle - right.angle
        })

      const values = [
        quantize(canonicalPoint.x),
        quantize(canonicalPoint.y),
        topology.portZ[portId],
        problem.portSectionMask[portId],
        incidentRegionIds.length - localRegionDescriptors.length,
        HASH_DELIMITER,
      ]

      for (const descriptor of localRegionDescriptors) {
        pushHashPair(values, descriptor.regionHash)
        values.push(descriptor.angle, HASH_DELIMITER)
      }

      rawPortHashById.set(portId, hashNumbers(values))
    }

    const rawRouteHashWithoutNetById = new Map<RouteId, HashPair>()

    for (const routeId of localRouteIds) {
      const routePlan = routePlanByRouteId.get(routeId)
      const fixedSectionSegmentHashes =
        routePlan?.fixedSegments
          .filter((segment) => localRegionIdSet.has(segment.regionId))
          .map((segment) =>
            hashNumbers([
              ...(rawRegionHashById.get(segment.regionId) ?? [
                HASH_DELIMITER,
                HASH_DELIMITER,
              ]),
              ...(rawPortHashById.get(segment.fromPortId) ?? [
                HASH_DELIMITER,
                HASH_DELIMITER,
              ]),
              ...(rawPortHashById.get(segment.toPortId) ?? [
                HASH_DELIMITER,
                HASH_DELIMITER,
              ]),
            ]),
          ) ?? []

      rawRouteHashWithoutNetById.set(
        routeId,
        hashNumbers([
          activeRouteIdSet.has(routeId) ? 1 : 0,
          ...hashHashPairWithValue(
            routePlan?.activeStartPortId !== undefined
              ? rawPortHashById.get(routePlan.activeStartPortId) ?? null
              : null,
            1,
          ),
          ...hashHashPairWithValue(
            routePlan?.activeEndPortId !== undefined
              ? rawPortHashById.get(routePlan.activeEndPortId) ?? null
              : null,
            2,
          ),
          ...hashHashPairWithValue(
            routePlan?.forcedStartRegionId !== undefined &&
              localRegionIdSet.has(routePlan.forcedStartRegionId)
              ? rawRegionHashById.get(routePlan.forcedStartRegionId) ?? null
              : null,
            3,
          ),
          ...hashHashPairs(fixedSectionSegmentHashes),
        ]),
      )
    }

    const netUsageByNetId = new Map<
      number,
      { routeHashes: HashPair[]; regionHashes: HashPair[] }
    >()
    const ensureNetUsage = (netId: number) => {
      let usage = netUsageByNetId.get(netId)
      if (!usage) {
        usage = {
          routeHashes: [],
          regionHashes: [],
        }
        netUsageByNetId.set(netId, usage)
      }
      return usage
    }

    for (const routeId of localRouteIds) {
      ensureNetUsage(problem.routeNet[routeId]).routeHashes.push(
        rawRouteHashWithoutNetById.get(routeId) ?? [0, 0],
      )
    }

    for (const regionId of localRegionIds) {
      const regionNetId = problem.regionNetId[regionId]
      if (regionNetId === -1) {
        continue
      }

      ensureNetUsage(regionNetId).regionHashes.push(
        rawRegionHashById.get(regionId) ?? [0, 0],
      )
    }

    const orderedNetIds = [...netUsageByNetId.entries()]
      .map(([netId, usage]) => {
        const sortedRouteHashes = [...usage.routeHashes].sort(compareHashPairs)
        const sortedRegionHashes = [...usage.regionHashes].sort(compareHashPairs)
        return {
          netId,
          signatureHash: hashNumbers([
            ...hashHashPairs(sortedRouteHashes),
            ...hashHashPairs(sortedRegionHashes),
          ]),
        }
      })
      .sort(
        (left, right) =>
          compareHashPairs(left.signatureHash, right.signatureHash) ||
          left.netId - right.netId,
      )

    const netLabelByNetId = new Map<number, number>()
    orderedNetIds.forEach(({ netId }, index) => {
      netLabelByNetId.set(netId, index + 1)
    })

    const regionHashById = new Map<RegionId, HashPair>()
    for (const regionId of localRegionIds) {
      const regionNetId = problem.regionNetId[regionId]
      regionHashById.set(
        regionId,
        hashNumbers([
          ...(rawRegionHashById.get(regionId) ?? [0, 0]),
          regionNetId === -1 ? 0 : (netLabelByNetId.get(regionNetId) ?? 0),
        ]),
      )
    }

    const portHashById = new Map<PortId, HashPair>()
    for (const portId of localPortIds) {
      portHashById.set(portId, rawPortHashById.get(portId) ?? [0, 0])
    }

    const routeHashById = new Map<RouteId, HashPair>()
    for (const routeId of localRouteIds) {
      routeHashById.set(
        routeId,
        hashNumbers([
          ...(rawRouteHashWithoutNetById.get(routeId) ?? [0, 0]),
          netLabelByNetId.get(problem.routeNet[routeId]) ?? 0,
        ]),
      )
    }

    const actualRegionIdByCanonicalRegionId = [...localRegionIds].sort(
      (left, right) =>
        compareHashPairs(
          regionHashById.get(left) ?? [0, 0],
          regionHashById.get(right) ?? [0, 0],
        ) || left - right,
    )
    const actualPortIdByCanonicalPortId = [...localPortIds].sort(
      (left, right) =>
        compareHashPairs(
          portHashById.get(left) ?? [0, 0],
          portHashById.get(right) ?? [0, 0],
        ) || left - right,
    )
    const actualRouteIdByCanonicalRouteId = [...localRouteIds].sort(
      (left, right) =>
        compareHashPairs(
          routeHashById.get(left) ?? [0, 0],
          routeHashById.get(right) ?? [0, 0],
        ) || left - right,
    )

    const canonicalPortIdByActualPortId = new Map<PortId, number>()
    actualPortIdByCanonicalPortId.forEach((portId, canonicalPortId) => {
      canonicalPortIdByActualPortId.set(portId, canonicalPortId)
    })
    const canonicalRouteIdByActualRouteId = new Map<RouteId, number>()
    actualRouteIdByCanonicalRouteId.forEach((routeId, canonicalRouteId) => {
      canonicalRouteIdByActualRouteId.set(routeId, canonicalRouteId)
    })

    const fixedSectionSegmentHashes = actualRegionIdByCanonicalRegionId.map(
      (actualRegionId) =>
        hashTriples(
          (routePlans.flatMap((routePlan) =>
            routePlan.fixedSegments
              .filter((segment) => segment.regionId === actualRegionId)
              .map(
                (segment) =>
                  [
                    canonicalRouteIdByActualRouteId.get(routePlan.routeId) ?? -1,
                    canonicalPortIdByActualPortId.get(segment.fromPortId) ?? -1,
                    canonicalPortIdByActualPortId.get(segment.toPortId) ?? -1,
                  ] as [number, number, number],
              ),
          ) ?? []).sort((left, right) => {
            if (left[0] !== right[0]) {
              return left[0] - right[0]
            }
            if (left[1] !== right[1]) {
              return left[1] - right[1]
            }
            return left[2] - right[2]
          }),
        ),
    )

    const candidate: ScoreKeyOrientationCandidate = {
      key: [
        SECTION_SOLVER_CACHE_VERSION,
        scaleBucket,
        formatHashPair(policyHash),
        formatHashPair(
          hashHashPairs(
            actualRegionIdByCanonicalRegionId.map(
              (regionId) => regionHashById.get(regionId) ?? [0, 0],
            ),
          ),
        ),
        formatHashPair(
          hashHashPairs(
            actualPortIdByCanonicalPortId.map(
              (portId) => portHashById.get(portId) ?? [0, 0],
            ),
          ),
        ),
        formatHashPair(
          hashHashPairs(
            actualRouteIdByCanonicalRouteId.map(
              (routeId) => routeHashById.get(routeId) ?? [0, 0],
            ),
          ),
        ),
        formatHashPair(hashHashPairs(fixedSectionSegmentHashes)),
        actualRegionIdByCanonicalRegionId.length,
        actualPortIdByCanonicalPortId.length,
        actualRouteIdByCanonicalRouteId.length,
      ].join("|"),
    }

    if (
      !bestCandidate ||
      compareStrings(candidate.key, bestCandidate.key) < 0
    ) {
      bestCandidate = candidate
    }
  }

  return bestCandidate?.key
}

const buildMultisetDistance = (left: string[], right: string[]) => {
  if (left.length === 0 && right.length === 0) {
    return 0
  }

  const leftCounts = new Map<string, number>()
  const rightCounts = new Map<string, number>()

  for (const token of left) {
    leftCounts.set(token, (leftCounts.get(token) ?? 0) + 1)
  }
  for (const token of right) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1)
  }

  let overlap = 0
  const allTokens = new Set([...leftCounts.keys(), ...rightCounts.keys()])
  for (const token of allTokens) {
    overlap += Math.min(leftCounts.get(token) ?? 0, rightCounts.get(token) ?? 0)
  }

  return 1 - overlap / Math.max(left.length, right.length, 1)
}

export const getSectionSolverLossyDescriptorDistance = (
  left: SectionSolverLossyDescriptor,
  right: SectionSolverLossyDescriptor,
) => {
  const scaleDistance = left.scaleBucket === right.scaleBucket ? 0 : 1
  const policyDistance = left.policyToken === right.policyToken ? 0 : 1
  const regionDistance = buildMultisetDistance(
    left.regionTokens,
    right.regionTokens,
  )
  const portDistance = buildMultisetDistance(left.portTokens, right.portTokens)
  const routeDistance = buildMultisetDistance(left.routeTokens, right.routeTokens)

  return (
    scaleDistance * 0.1 +
    policyDistance * 0.1 +
    regionDistance * 0.25 +
    portDistance * 0.25 +
    routeDistance * 0.3
  )
}

const createSectionSolverLossyScoreFingerprint = ({
  topology,
  problem,
  sectionRegionIds,
  routePlans,
  activeRouteIds,
  baselineRegionCosts,
  policy,
}: {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  sectionRegionIds: RegionId[]
  routePlans: SectionCacheRoutePlan[]
  activeRouteIds: RouteId[]
  baselineRegionCosts: ArrayLike<number>
  policy: SectionCachePolicySignature
}): SectionSolverLossyScoreFingerprint | undefined => {
  const uniqueSectionRegionIds = uniqueNumberList(sectionRegionIds)
  if (uniqueSectionRegionIds.length === 0) {
    return undefined
  }

  const localIdsFromRoutes = getLocalRoutePortAndRegionIds(
    routePlans,
    activeRouteIds,
  )
  const localPortIds = uniqueNumberList([
    ...getSectionLocalPortIds(topology, uniqueSectionRegionIds),
    ...localIdsFromRoutes.portIds,
  ])
  const localRegionIds = uniqueNumberList([
    ...uniqueSectionRegionIds,
    ...localIdsFromRoutes.regionIds,
  ])
  const localRegionIdSet = new Set(localRegionIds)
  const activeRouteIdSet = new Set(activeRouteIds)
  const routePlanByRouteId = new Map(
    routePlans.map((routePlan) => [routePlan.routeId, routePlan]),
  )
  const localRouteIds = uniqueNumberList(
    routePlans
      .filter(
        (routePlan) =>
          activeRouteIdSet.has(routePlan.routeId) ||
          routePlan.fixedSegments.some((segment) =>
            localRegionIdSet.has(segment.regionId),
          ),
      )
      .map((routePlan) => routePlan.routeId),
  )

  const anchorRegionId = selectAnchorRegionId(
    topology,
    uniqueSectionRegionIds,
    baselineRegionCosts,
  )
  const scaleDivisor =
    UNIT_REGION_SIZE_MM *
    getRegionScaleFactor(
      topology.regionWidth[anchorRegionId],
      topology.regionHeight[anchorRegionId],
    )
  const scaleBucket = getClosestScaleBucket(
    topology.regionWidth[anchorRegionId],
    topology.regionHeight[anchorRegionId],
  )
  const policySignature = createPolicySignature(policy)
  const policyToken = formatHashPair(
    hashNumbers([
      quantize(policySignature.DISTANCE_TO_COST),
      policySignature.RIP_THRESHOLD_RAMP_ATTEMPTS,
      quantize(policySignature.RIP_CONGESTION_REGION_COST_FACTOR),
      policySignature.MAX_ITERATIONS,
      typeof policySignature.MAX_RIPS === "number"
        ? policySignature.MAX_RIPS
        : HASH_DELIMITER,
      typeof policySignature.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT ===
      "number"
        ? policySignature.MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT
        : HASH_DELIMITER,
      typeof policySignature.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST ===
      "number"
        ? policySignature.EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST
        : HASH_DELIMITER,
    ]),
  )
  const activeEndpointPortIds = new Set<PortId>()
  for (const routePlan of routePlans) {
    if (routePlan.activeStartPortId !== undefined) {
      activeEndpointPortIds.add(routePlan.activeStartPortId)
    }
    if (routePlan.activeEndPortId !== undefined) {
      activeEndpointPortIds.add(routePlan.activeEndPortId)
    }
  }

  let bestFingerprint: SectionSolverLossyScoreFingerprint | undefined
  let bestKey: string | undefined

  for (const rotationQuarterTurns of [0, 1, 2, 3] as QuarterTurn[]) {
    const regionSideEntriesByRegionId = new Map<
      RegionId,
      Array<{
        portId: PortId
        side: 0 | 1 | 2 | 3
        orderCoordinate: number
        masked: boolean
        hasExternalIncident: boolean
        activeEndpoint: boolean
      }>
    >()

    for (const regionId of localRegionIds) {
      regionSideEntriesByRegionId.set(regionId, [])
    }

    for (const portId of localPortIds) {
      const rotatedPoint = rotatePoint(
        topology.portX[portId],
        topology.portY[portId],
        rotationQuarterTurns,
      )
      const incidentRegionIds = topology.incidentPortRegion[portId] ?? []
      const localIncidentCount = incidentRegionIds.filter((regionId) =>
        localRegionIdSet.has(regionId),
      ).length

      incidentRegionIds.forEach((regionId, regionIndex) => {
        if (!localRegionIdSet.has(regionId)) {
          return
        }

        const rawAngle =
          regionIndex === 0
            ? topology.portAngleForRegion1[portId]
            : topology.portAngleForRegion2?.[portId] ??
              topology.portAngleForRegion1[portId]
        const side = getSideFromAngle(rotateAngle(rawAngle, rotationQuarterTurns))
        regionSideEntriesByRegionId.get(regionId)?.push({
          portId,
          side,
          orderCoordinate: getSideOrderCoordinate(rotatedPoint, side),
          masked: problem.portSectionMask[portId] === 1,
          hasExternalIncident: incidentRegionIds.length > localIncidentCount,
          activeEndpoint: activeEndpointPortIds.has(portId),
        })
      })
    }

    const incidentDescriptorHashesByPortId = new Map<PortId, HashPair[]>()
    const localIncidentCountByPortId = new Map<PortId, number>()
    const externalIncidentBucketByPortId = new Map<PortId, number>()
    const primarySideByRegionAndPortId = new Map<string, number>()
    const regionTokenHashes: HashPair[] = []

    for (const regionId of localRegionIds) {
      const width =
        rotationQuarterTurns % 2 === 0
          ? topology.regionWidth[regionId]
          : topology.regionHeight[regionId]
      const height =
        rotationQuarterTurns % 2 === 0
          ? topology.regionHeight[regionId]
          : topology.regionWidth[regionId]
      const sideEntries = regionSideEntriesByRegionId.get(regionId) ?? []
      const groupedSideEntries: Array<typeof sideEntries> = [[], [], [], []]
      for (const sideEntry of sideEntries) {
        groupedSideEntries[sideEntry.side]?.push(sideEntry)
      }

      const maskedSideBuckets = [0, 0, 0, 0]
      const boundarySideBuckets = [0, 0, 0, 0]
      const activeEndpointSideBuckets = [0, 0, 0, 0]

      groupedSideEntries.forEach((entries, side) => {
        entries.sort(
          (left, right) =>
            left.orderCoordinate - right.orderCoordinate ||
            left.portId - right.portId,
        )
        const sideCountBucket = bucketCount(entries.length)

        entries.forEach((entry, ordinal) => {
          const incidentDescriptorHash = hashNumbers([
            side,
            getOrdinalBucket(ordinal, entries.length),
            sideCountBucket,
          ])
          const incidentDescriptorHashes =
            incidentDescriptorHashesByPortId.get(entry.portId) ?? []
          incidentDescriptorHashes.push(incidentDescriptorHash)
          incidentDescriptorHashesByPortId.set(
            entry.portId,
            incidentDescriptorHashes,
          )
          localIncidentCountByPortId.set(
            entry.portId,
            (localIncidentCountByPortId.get(entry.portId) ?? 0) + 1,
          )
          externalIncidentBucketByPortId.set(
            entry.portId,
            bucketCount(
              (topology.incidentPortRegion[entry.portId]?.length ?? 0) -
                (localIncidentCountByPortId.get(entry.portId) ?? 0),
            ),
          )
          primarySideByRegionAndPortId.set(`${regionId}:${entry.portId}`, side)

          if (entry.masked) {
            maskedSideBuckets[side] += 1
          }
          if (entry.hasExternalIncident) {
            boundarySideBuckets[side] += 1
          }
          if (entry.activeEndpoint) {
            activeEndpointSideBuckets[side] += 1
          }
        })
      })

      const fixedSidePairBuckets = new Array(25).fill(0)
      for (const routePlan of routePlans) {
        for (const fixedSegment of routePlan.fixedSegments) {
          if (fixedSegment.regionId !== regionId) {
            continue
          }

          const fromSide =
            primarySideByRegionAndPortId.get(
              `${regionId}:${fixedSegment.fromPortId}`,
            ) ?? -1
          const toSide =
            primarySideByRegionAndPortId.get(
              `${regionId}:${fixedSegment.toPortId}`,
            ) ?? -1
          fixedSidePairBuckets[
            (Math.min(fromSide, toSide) + 1) * 5 +
              (Math.max(fromSide, toSide) + 1)
          ] += 1
        }
      }

      regionTokenHashes.push(
        hashNumbers([
          getNormalizedSizeBucket(width / scaleDivisor),
          getNormalizedSizeBucket(height / scaleDivisor),
          problem.regionNetId[regionId] === -1 ? 0 : 1,
          ...maskedSideBuckets.map(bucketCount),
          ...boundarySideBuckets.map(bucketCount),
          ...activeEndpointSideBuckets.map(bucketCount),
          ...fixedSidePairBuckets.map(bucketCount),
        ]),
      )
    }

    const portEndpointHashById = new Map<PortId, HashPair>()
    for (const portId of activeEndpointPortIds) {
      const incidentDescriptorHashes = (
        incidentDescriptorHashesByPortId.get(portId) ?? []
      ).sort(compareHashPairs)
      portEndpointHashById.set(
        portId,
        hashNumbers([
          topology.portZ[portId] ?? 0,
          localIncidentCountByPortId.get(portId) ?? 0,
          externalIncidentBucketByPortId.get(portId) ?? 0,
          ...hashHashPairs(incidentDescriptorHashes),
        ]),
      )
    }

    const routeTokenHashes = localRouteIds
      .map((routeId) => {
        if (!activeRouteIdSet.has(routeId)) {
          return undefined
        }

        const routePlan = routePlanByRouteId.get(routeId)
        const endpointHashes = [
          routePlan?.activeStartPortId !== undefined
            ? portEndpointHashById.get(routePlan.activeStartPortId) ?? null
            : null,
          routePlan?.activeEndPortId !== undefined
            ? portEndpointHashById.get(routePlan.activeEndPortId) ?? null
            : null,
        ].sort((left, right) => {
          if (left === null && right === null) {
            return 0
          }
          if (left === null) {
            return -1
          }
          if (right === null) {
            return 1
          }
          return compareHashPairs(left, right)
        })

        const fixedSegmentHashes =
          routePlan?.fixedSegments
            .filter((segment) => localRegionIdSet.has(segment.regionId))
            .map((segment) => {
              const fromSide =
                primarySideByRegionAndPortId.get(
                  `${segment.regionId}:${segment.fromPortId}`,
                ) ?? -1
              const toSide =
                primarySideByRegionAndPortId.get(
                  `${segment.regionId}:${segment.toPortId}`,
                ) ?? -1
              return hashNumbers([
                Math.min(fromSide, toSide),
                Math.max(fromSide, toSide),
              ])
            })
            .sort(compareHashPairs) ?? []

        return hashNumbers([
          ...hashHashPairWithValue(endpointHashes[0], 1),
          ...hashHashPairWithValue(endpointHashes[1], 2),
          ...hashHashPairs(fixedSegmentHashes),
          routePlan?.forcedStartRegionId !== undefined &&
          localRegionIdSet.has(routePlan.forcedStartRegionId)
            ? 1
            : 0,
        ])
      })
      .filter((hash): hash is HashPair => hash !== undefined)
      .sort(compareHashPairs)

    const fingerprint: SectionSolverLossyScoreFingerprint = {
      scaleBucket,
      policyToken,
      regionTokenHashes: regionTokenHashes.sort(compareHashPairs),
      routeTokenHashes,
    }

    const fingerprintKey = [
      SECTION_SOLVER_CACHE_VERSION,
      fingerprint.scaleBucket,
      fingerprint.policyToken,
      fingerprint.regionTokenHashes.length,
      formatHashPair(hashHashPairs(fingerprint.regionTokenHashes)),
      fingerprint.routeTokenHashes.length,
      formatHashPair(hashHashPairs(fingerprint.routeTokenHashes)),
    ].join("|")
    if (!bestKey || compareStrings(fingerprintKey, bestKey) < 0) {
      bestKey = fingerprintKey
      bestFingerprint = fingerprint
    }
  }

  return bestFingerprint
}

export const createSectionSolverLossyScoreDescriptor = (
  params: Parameters<typeof createSectionSolverLossyScoreFingerprint>[0],
): SectionSolverLossyDescriptor | undefined => {
  const fingerprint = createSectionSolverLossyScoreFingerprint(params)
  if (!fingerprint) {
    return undefined
  }

  return {
    scaleBucket: fingerprint.scaleBucket,
    policyToken: fingerprint.policyToken,
    regionTokens: fingerprint.regionTokenHashes.map(formatHashPair),
    portTokens: [],
    routeTokens: fingerprint.routeTokenHashes.map(formatHashPair),
  }
}

export const createSectionSolverLossyScoreCacheKey = (
  params: Parameters<typeof createSectionSolverLossyScoreFingerprint>[0],
) => {
  const fingerprint = createSectionSolverLossyScoreFingerprint(params)
  if (!fingerprint) {
    return undefined
  }

  return [
    SECTION_SOLVER_CACHE_VERSION,
    fingerprint.scaleBucket,
    fingerprint.policyToken,
    fingerprint.regionTokenHashes.length,
    formatHashPair(hashHashPairs(fingerprint.regionTokenHashes)),
    0,
    formatHashPair(hashHashPairs([])),
    fingerprint.routeTokenHashes.length,
    formatHashPair(hashHashPairs(fingerprint.routeTokenHashes)),
  ].join("|")
}

export const setSectionSolverLossyScoreKeyObservationEnabled = (
  enabled: boolean,
) => {
  sectionSolverLossyScoreKeyObservationEnabled = enabled
}

export const isSectionSolverLossyScoreKeyObservationEnabled = () =>
  sectionSolverLossyScoreKeyObservationEnabled

export const recordSectionSolverLossyScoreKeyObservation = (
  lossyKey: string,
  scoreKey: string,
) => {
  if (!sectionSolverLossyScoreKeyObservationEnabled) {
    return
  }

  const stats = getOrCreateLossyScoreKeyStats(lossyKey)
  stats.lookups += 1
  stats.scoreKeys.add(scoreKey)
}

export const getSectionSolverLossyScoreKeyStats = () =>
  [...sectionSolverLossyScoreKeyStatsByKey.entries()]
    .map(([key, stats]) => ({
      key,
      lookups: stats.lookups,
      distinctScoreKeys: stats.scoreKeys.size,
    }))
    .sort(
      (left, right) =>
        right.lookups - left.lookups ||
        right.distinctScoreKeys - left.distinctScoreKeys ||
        compareStrings(left.key, right.key),
    )

export const createSectionSolverCacheContext = ({
  topology,
  problem,
  sectionRegionIds,
  routePlans,
  activeRouteIds,
  baselineRegionCosts,
  policy,
}: {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  sectionRegionIds: RegionId[]
  routePlans: SectionCacheRoutePlan[]
  activeRouteIds: RouteId[]
  baselineRegionCosts: ArrayLike<number>
  policy: SectionCachePolicySignature
}): SectionSolverCacheContext | undefined => {
  const uniqueSectionRegionIds = uniqueNumberList(sectionRegionIds)
  if (uniqueSectionRegionIds.length === 0) {
    return undefined
  }

  const localIdsFromRoutes = getLocalRoutePortAndRegionIds(routePlans, activeRouteIds)
  const localPortIds = uniqueNumberList([
    ...getSectionLocalPortIds(topology, uniqueSectionRegionIds),
    ...localIdsFromRoutes.portIds,
  ])
  const localRegionIds = uniqueNumberList([
    ...uniqueSectionRegionIds,
    ...localIdsFromRoutes.regionIds,
  ])
  const localRegionIdSet = new Set(localRegionIds)
  const activeRouteIdSet = new Set(activeRouteIds)
  const routePlanByRouteId = new Map(routePlans.map((routePlan) => [routePlan.routeId, routePlan]))
  const localRouteIds = uniqueNumberList(
    routePlans
      .filter(
        (routePlan) =>
          activeRouteIdSet.has(routePlan.routeId) ||
          routePlan.fixedSegments.some((segment) =>
            localRegionIdSet.has(segment.regionId),
          ),
      )
      .map((routePlan) => routePlan.routeId),
  )

  const anchorRegionId = selectAnchorRegionId(
    topology,
    uniqueSectionRegionIds,
    baselineRegionCosts,
  )
  const scaleDivisor =
    UNIT_REGION_SIZE_MM *
    getRegionScaleFactor(
      topology.regionWidth[anchorRegionId],
      topology.regionHeight[anchorRegionId],
    )
  const scaleBucket = getClosestScaleBucket(
    topology.regionWidth[anchorRegionId],
    topology.regionHeight[anchorRegionId],
  )
  const policySignature = createPolicySignature(policy)
  let bestCandidate: OrientationCandidate | undefined

  for (const rotationQuarterTurns of [0, 1, 2, 3] as QuarterTurn[]) {
    const transformBase = createTransform(
      topology,
      anchorRegionId,
      scaleBucket,
      scaleDivisor,
      rotationQuarterTurns,
    )
    const rawRegionSignatureById = new Map<RegionId, string>()

    for (const regionId of localRegionIds) {
      const canonicalCenter = toCanonicalPoint(
        transformBase,
        topology.regionCenterX[regionId],
        topology.regionCenterY[regionId],
      )
      const width =
        rotationQuarterTurns % 2 === 0
          ? topology.regionWidth[regionId]
          : topology.regionHeight[regionId]
      const height =
        rotationQuarterTurns % 2 === 0
          ? topology.regionHeight[regionId]
          : topology.regionWidth[regionId]
      const incidentPortIds = topology.regionIncidentPorts[regionId] ?? []
      const maskedIncidentPortCount = incidentPortIds.filter(
        (portId) => problem.portSectionMask[portId] === 1,
      ).length

      rawRegionSignatureById.set(
        regionId,
        JSON.stringify({
          center: [quantize(canonicalCenter.x), quantize(canonicalCenter.y)],
          size: [
            quantize(width / transformBase.scaleDivisor),
            quantize(height / transformBase.scaleDivisor),
          ],
          incidentPortCount: incidentPortIds.length,
          maskedIncidentPortCount,
        }),
      )
    }

    const rawPortSignatureById = new Map<PortId, string>()

    for (const portId of localPortIds) {
      const canonicalPoint = toCanonicalPoint(
        transformBase,
        topology.portX[portId],
        topology.portY[portId],
      )
      const incidentRegionIds = topology.incidentPortRegion[portId] ?? []
      const localRegionDescriptors = incidentRegionIds
        .map((regionId, regionIndex) => {
          if (!localRegionIdSet.has(regionId)) {
            return undefined
          }

          const angle =
            regionIndex === 0
              ? topology.portAngleForRegion1[portId]
              : topology.portAngleForRegion2?.[portId] ??
                topology.portAngleForRegion1[portId]

          return {
            region: rawRegionSignatureById.get(regionId),
            angle: rotateAngle(angle, rotationQuarterTurns),
          }
        })
        .filter(
          (
            descriptor,
          ): descriptor is { region: string; angle: number } =>
            descriptor?.region !== undefined,
        )
        .sort((left, right) => {
          const regionComparison = compareStrings(left.region, right.region)
          if (regionComparison !== 0) {
            return regionComparison
          }

          return left.angle - right.angle
        })

      rawPortSignatureById.set(
        portId,
        JSON.stringify({
          point: [quantize(canonicalPoint.x), quantize(canonicalPoint.y)],
          z: topology.portZ[portId],
          masked: problem.portSectionMask[portId],
          localIncidents: localRegionDescriptors,
          externalIncidentCount:
            incidentRegionIds.length - localRegionDescriptors.length,
        }),
      )
    }

    const rawRouteSignatureWithoutNetById = new Map<RouteId, string>()

    for (const routeId of localRouteIds) {
      const routePlan = routePlanByRouteId.get(routeId)
      const fixedSectionSegments = routePlan?.fixedSegments
        .filter((segment) => localRegionIdSet.has(segment.regionId))
        .map((segment) => ({
          region: rawRegionSignatureById.get(segment.regionId),
          from: rawPortSignatureById.get(segment.fromPortId),
          to: rawPortSignatureById.get(segment.toPortId),
        }))

      rawRouteSignatureWithoutNetById.set(
        routeId,
        JSON.stringify({
          active: activeRouteIdSet.has(routeId),
          activeStartPort:
            routePlan?.activeStartPortId !== undefined
              ? rawPortSignatureById.get(routePlan.activeStartPortId) ?? null
              : null,
          activeEndPort:
            routePlan?.activeEndPortId !== undefined
              ? rawPortSignatureById.get(routePlan.activeEndPortId) ?? null
              : null,
          forcedStartRegion:
            routePlan?.forcedStartRegionId !== undefined &&
            localRegionIdSet.has(routePlan.forcedStartRegionId)
              ? rawRegionSignatureById.get(routePlan.forcedStartRegionId) ?? null
              : null,
          fixedSectionSegments: fixedSectionSegments ?? [],
        }),
      )
    }

    const netUsageByNetId = new Map<
      number,
      { routeSignatures: string[]; regionSignatures: string[] }
    >()
    const ensureNetUsage = (netId: number) => {
      let usage = netUsageByNetId.get(netId)
      if (!usage) {
        usage = {
          routeSignatures: [],
          regionSignatures: [],
        }
        netUsageByNetId.set(netId, usage)
      }
      return usage
    }

    for (const routeId of localRouteIds) {
      ensureNetUsage(problem.routeNet[routeId]).routeSignatures.push(
        rawRouteSignatureWithoutNetById.get(routeId) ?? "",
      )
    }

    for (const regionId of localRegionIds) {
      const regionNetId = problem.regionNetId[regionId]
      if (regionNetId === -1) {
        continue
      }

      ensureNetUsage(regionNetId).regionSignatures.push(
        rawRegionSignatureById.get(regionId) ?? "",
      )
    }

    const orderedNetIds = [...netUsageByNetId.entries()]
      .map(([netId, usage]) => ({
        netId,
        signature: JSON.stringify({
          routes: [...usage.routeSignatures].sort(),
          regions: [...usage.regionSignatures].sort(),
        }),
      }))
      .sort(
        (left, right) =>
          compareStrings(left.signature, right.signature) ||
          left.netId - right.netId,
      )

    const netLabelByNetId = new Map<number, string>()
    orderedNetIds.forEach(({ netId }, index) => {
      netLabelByNetId.set(netId, `n${index}`)
    })

    const regionSignatureById = new Map<RegionId, string>()
    for (const regionId of localRegionIds) {
      const regionNetId = problem.regionNetId[regionId]
      regionSignatureById.set(
        regionId,
        JSON.stringify({
          raw: rawRegionSignatureById.get(regionId),
          reservedNet:
            regionNetId === -1 ? null : netLabelByNetId.get(regionNetId) ?? null,
        }),
      )
    }

    const portSignatureById = new Map<PortId, string>()
    for (const portId of localPortIds) {
      portSignatureById.set(
        portId,
        JSON.stringify({
          raw: rawPortSignatureById.get(portId),
        }),
      )
    }

    const routeSignatureById = new Map<RouteId, string>()
    for (const routeId of localRouteIds) {
      routeSignatureById.set(
        routeId,
        JSON.stringify({
          raw: rawRouteSignatureWithoutNetById.get(routeId),
          net: netLabelByNetId.get(problem.routeNet[routeId]) ?? null,
        }),
      )
    }

    const actualRegionIdByCanonicalRegionId = [...localRegionIds].sort(
      (left, right) =>
        compareStrings(
          regionSignatureById.get(left) ?? "",
          regionSignatureById.get(right) ?? "",
        ) || left - right,
    )
    const actualPortIdByCanonicalPortId = [...localPortIds].sort(
      (left, right) =>
        compareStrings(
          portSignatureById.get(left) ?? "",
          portSignatureById.get(right) ?? "",
        ) || left - right,
    )
    const actualRouteIdByCanonicalRouteId = [...localRouteIds].sort(
      (left, right) =>
        compareStrings(
          routeSignatureById.get(left) ?? "",
          routeSignatureById.get(right) ?? "",
        ) || left - right,
    )

    const canonicalRegionIdByActualRegionId = new Map<RegionId, number>()
    actualRegionIdByCanonicalRegionId.forEach((regionId, canonicalRegionId) => {
      canonicalRegionIdByActualRegionId.set(regionId, canonicalRegionId)
    })

    const canonicalPortIdByActualPortId = new Map<PortId, number>()
    actualPortIdByCanonicalPortId.forEach((portId, canonicalPortId) => {
      canonicalPortIdByActualPortId.set(portId, canonicalPortId)
    })

    const canonicalRouteIdByActualRouteId = new Map<RouteId, number>()
    actualRouteIdByCanonicalRouteId.forEach((routeId, canonicalRouteId) => {
      canonicalRouteIdByActualRouteId.set(routeId, canonicalRouteId)
    })

    const fixedSectionSegments = actualRegionIdByCanonicalRegionId.map(
      (actualRegionId) =>
        (routePlans.flatMap((routePlan) =>
          routePlan.fixedSegments
            .filter((segment) => segment.regionId === actualRegionId)
            .map(
              (segment) =>
                [
                  canonicalRouteIdByActualRouteId.get(routePlan.routeId) ?? -1,
                  canonicalPortIdByActualPortId.get(segment.fromPortId) ?? -1,
                  canonicalPortIdByActualPortId.get(segment.toPortId) ?? -1,
                ] as [number, number, number],
            ),
        ) ?? []).sort((left, right) => {
          if (left[0] !== right[0]) {
            return left[0] - right[0]
          }
          if (left[1] !== right[1]) {
            return left[1] - right[1]
          }
          return left[2] - right[2]
        }),
    )

    const key = JSON.stringify({
      version: SECTION_SOLVER_CACHE_VERSION,
      policy: policySignature,
      scaleBucket,
      regions: actualRegionIdByCanonicalRegionId.map(
        (regionId) => regionSignatureById.get(regionId) ?? "",
      ),
      ports: actualPortIdByCanonicalPortId.map(
        (portId) => portSignatureById.get(portId) ?? "",
      ),
      routes: actualRouteIdByCanonicalRouteId.map(
        (routeId) => routeSignatureById.get(routeId) ?? "",
      ),
      fixedSectionSegments,
    })

    const candidate: OrientationCandidate = {
      key,
      transform: {
        ...transformBase,
        canonicalRegionIdByActualRegionId,
        actualRegionIdByCanonicalRegionId,
        canonicalPortIdByActualPortId,
        actualPortIdByCanonicalPortId,
        canonicalRouteIdByActualRouteId,
        actualRouteIdByCanonicalRouteId,
      },
    }

    if (
      !bestCandidate ||
      compareStrings(candidate.key, bestCandidate.key) < 0
    ) {
      bestCandidate = candidate
    }
  }

  if (!bestCandidate) {
    return undefined
  }

  return {
    key: bestCandidate.key,
    transform: bestCandidate.transform,
  }
}

export const createSectionSolverCacheEntry = ({
  context,
  currentTopology,
  replayTopology,
  finalSolution,
  optimized,
  finalSummary,
}: {
  context: SectionSolverCacheContext
  currentTopology: TinyHyperGraphTopology
  replayTopology: TinyHyperGraphTopology
  finalSolution: TinyHyperGraphSolution
  optimized: boolean
  finalSummary: RegionCostSummary
}): SectionSolverCacheEntry => {
  const { transform } = context

  if (!optimized) {
    return {
      optimized,
      finalSummary,
    }
  }

  const currentPortIdBySerializedPortId = new Map<string, PortId>()
  const currentRegionIdBySerializedRegionId = new Map<string, RegionId>()

  for (let portId = 0; portId < currentTopology.portCount; portId++) {
    currentPortIdBySerializedPortId.set(
      getSerializedPortId(currentTopology, portId),
      portId,
    )
  }

  for (let regionId = 0; regionId < currentTopology.regionCount; regionId++) {
    currentRegionIdBySerializedRegionId.set(
      getSerializedRegionId(currentTopology, regionId),
      regionId,
    )
  }

  return {
    optimized,
    finalSummary,
    canonicalRouteSolutions: transform.actualRouteIdByCanonicalRouteId.map(
      (actualRouteId) => ({
        segments: (finalSolution.solvedRoutePathSegments[actualRouteId] ?? []).map(
          ([replayFromPortId, replayToPortId]) => {
            const actualFromPortId = currentPortIdBySerializedPortId.get(
              getSerializedPortId(replayTopology, replayFromPortId),
            )
            const actualToPortId = currentPortIdBySerializedPortId.get(
              getSerializedPortId(replayTopology, replayToPortId),
            )

            if (actualFromPortId === undefined || actualToPortId === undefined) {
              throw new Error("Section solver cache store port map is incomplete")
            }

            return [
              transform.canonicalPortIdByActualPortId.get(actualFromPortId) ?? -1,
              transform.canonicalPortIdByActualPortId.get(actualToPortId) ?? -1,
            ] as [number, number]
          },
        ),
        regionIds: (finalSolution.solvedRoutePathRegionIds?.[actualRouteId] ?? []).map(
          (replayRegionId) => {
            if (replayRegionId === undefined) {
              return undefined
            }

            const actualRegionId = currentRegionIdBySerializedRegionId.get(
              getSerializedRegionId(replayTopology, replayRegionId),
            )

            if (actualRegionId === undefined) {
              throw new Error("Section solver cache store region map is incomplete")
            }

            return transform.canonicalRegionIdByActualRegionId.get(actualRegionId) ?? -1
          },
        ),
      }),
    ),
  }
}

export const hydrateSectionSolverCacheEntrySolution = (
  entry: SectionSolverCacheEntry,
  context: SectionSolverCacheContext,
  initialSolution: TinyHyperGraphSolution,
): TinyHyperGraphSolution => {
  const solvedRoutePathSegments = initialSolution.solvedRoutePathSegments.map(
    (routeSegments) =>
      routeSegments.map(
        ([fromPortId, toPortId]) =>
          [fromPortId, toPortId] as [PortId, PortId],
      ),
  )
  const solvedRoutePathRegionIds = (
    initialSolution.solvedRoutePathRegionIds?.map((regionIds) => [...regionIds]) ??
    Array.from({ length: solvedRoutePathSegments.length }, () => [])
  ) as NonNullable<TinyHyperGraphSolution["solvedRoutePathRegionIds"]>

  if (!entry.canonicalRouteSolutions) {
    return {
      solvedRoutePathSegments,
      solvedRoutePathRegionIds,
    }
  }

  const { transform } = context

  entry.canonicalRouteSolutions.forEach(
    (canonicalRouteSolution, canonicalRouteId) => {
      const actualRouteId =
        transform.actualRouteIdByCanonicalRouteId[canonicalRouteId]

      if (actualRouteId === undefined) {
        throw new Error("Section solver cache route hydration map is incomplete")
      }

      solvedRoutePathSegments[actualRouteId] = canonicalRouteSolution.segments.map(
        ([canonicalFromPortId, canonicalToPortId]) => {
          const actualFromPortId =
            transform.actualPortIdByCanonicalPortId[canonicalFromPortId]
          const actualToPortId =
            transform.actualPortIdByCanonicalPortId[canonicalToPortId]

          if (actualFromPortId === undefined || actualToPortId === undefined) {
            throw new Error("Section solver cache port hydration map is incomplete")
          }

          return [actualFromPortId, actualToPortId] as [PortId, PortId]
        },
      )
      solvedRoutePathRegionIds[actualRouteId] =
        canonicalRouteSolution.regionIds.map((canonicalRegionId) => {
          if (canonicalRegionId === undefined) {
            return undefined
          }

          const actualRegionId =
            transform.actualRegionIdByCanonicalRegionId[canonicalRegionId]

          if (actualRegionId === undefined) {
            throw new Error(
              "Section solver cache region hydration map is incomplete",
            )
          }

          return actualRegionId
        })
    },
  )

  return {
    solvedRoutePathSegments,
    solvedRoutePathRegionIds,
  }
}

export const getSectionSolverCacheEntry = (key: string) =>
  sectionSolverCache.get(key)

export const setSectionSolverCacheEntry = (
  key: string,
  entry: SectionSolverCacheEntry,
) => {
  sectionSolverCache.set(key, entry)
  sectionSolverCacheStats.stores += 1
}

export const getSectionSolverScoreCacheEntry = (lossyKey: string) => {
  const bucket = sectionSolverLossyScoreCache.get(lossyKey)
  const keyStats = getOrCreateScoreCacheKeyStats(lossyKey)

  sectionSolverCacheStats.scoreLookups += 1
  keyStats.lookups += 1

  if (
    bucket?.consistent &&
    bucket.entry &&
    (bucket.trusted || bucket.generation < sectionSolverScoreCacheGeneration)
  ) {
    sectionSolverCacheStats.scoreHits += 1
    keyStats.hits += 1
    return {
      entry: bucket.entry,
      trusted: bucket.trusted,
      fromPreviousGeneration:
        bucket.generation < sectionSolverScoreCacheGeneration,
    }
  }

  sectionSolverCacheStats.scoreMisses += 1
  keyStats.misses += 1
  return undefined
}

export const setSectionSolverScoreCacheEntry = ({
  lossyKey,
  exactKey,
  entry,
}: {
  lossyKey: string
  exactKey?: string
  entry: SectionSolverScoreCacheEntry
}) => {
  const entryToken = summarizeScoreEntry(entry)
  const previousBucket = sectionSolverLossyScoreCache.get(lossyKey)
  const observedCount = (previousBucket?.observedCount ?? 0) + 1
  const exactKeyCount =
    previousBucket?.exactKeyCount ??
    (exactKey !== undefined ? 1 : 0)
  let trusted = false
  let consistent = true
  let summaryToken: string | undefined = entryToken
  let storedEntry: SectionSolverScoreCacheEntry | undefined

  if (!previousBucket) {
    trusted = false
    consistent = true
    storedEntry = entry
  } else if (!previousBucket.consistent) {
    consistent = false
    trusted = false
    summaryToken = previousBucket.summaryToken
    storedEntry = previousBucket.entry
  } else if (previousBucket.summaryToken === entryToken) {
    consistent = true
    trusted = previousBucket.trusted || observedCount >= 2
    summaryToken = entryToken
    storedEntry = entry
  } else {
    consistent = false
    trusted = false
    summaryToken = undefined
    storedEntry = undefined
  }

  sectionSolverLossyScoreCache.set(lossyKey, {
    observedCount,
    exactKeyCount,
    trusted,
    consistent,
    generation: sectionSolverScoreCacheGeneration,
    summaryToken,
    entry: storedEntry,
  })
  sectionSolverCacheStats.scoreStores += 1
  getOrCreateScoreCacheKeyStats(lossyKey).stores += 1
}

export const recordSectionSolverCacheLookup = (result: CacheLookupResult) => {
  sectionSolverCacheStats.lookups += 1

  if (result === "hit") {
    sectionSolverCacheStats.hits += 1
    return
  }

  sectionSolverCacheStats.misses += 1
  if (result === "rejected") {
    sectionSolverCacheStats.rejectedHits += 1
  }
}

export const recordSectionSolverCacheTiming = ({
  contextBuildMs = 0,
  hydrateSolutionMs = 0,
  hydratedSolverBuildMs = 0,
  storeValidationMs = 0,
  storeEntryBuildMs = 0,
}: Partial<
  Omit<TinyHyperGraphSectionSolverCacheStats, "entries" | "lookups" | "hits" | "misses" | "rejectedHits" | "stores">
>) => {
  sectionSolverCacheStats.contextBuildMs += contextBuildMs
  sectionSolverCacheStats.hydrateSolutionMs += hydrateSolutionMs
  sectionSolverCacheStats.hydratedSolverBuildMs += hydratedSolverBuildMs
  sectionSolverCacheStats.storeValidationMs += storeValidationMs
  sectionSolverCacheStats.storeEntryBuildMs += storeEntryBuildMs
}

export const clearTinyHyperGraphSectionSolverCache = () => {
  sectionSolverCache.clear()
  sectionSolverLossyScoreCache.clear()
  sectionSolverScoreCacheKeyStatsByKey.clear()
  sectionSolverLossyScoreKeyStatsByKey.clear()
  sectionSolverScoreCacheGeneration = 0
  sectionSolverCacheStats.lookups = 0
  sectionSolverCacheStats.hits = 0
  sectionSolverCacheStats.misses = 0
  sectionSolverCacheStats.rejectedHits = 0
  sectionSolverCacheStats.stores = 0
  sectionSolverCacheStats.scoreLookups = 0
  sectionSolverCacheStats.scoreHits = 0
  sectionSolverCacheStats.scoreMisses = 0
  sectionSolverCacheStats.scoreStores = 0
  sectionSolverCacheStats.contextBuildMs = 0
  sectionSolverCacheStats.hydrateSolutionMs = 0
  sectionSolverCacheStats.hydratedSolverBuildMs = 0
  sectionSolverCacheStats.storeValidationMs = 0
  sectionSolverCacheStats.storeEntryBuildMs = 0
}

export const advanceTinyHyperGraphSectionSolverCacheGeneration = () => {
  sectionSolverScoreCacheGeneration += 1
}

export const getTinyHyperGraphSectionSolverCacheStats =
  (): TinyHyperGraphSectionSolverCacheStats => ({
    entries: sectionSolverCache.size,
    scoreEntries: sectionSolverLossyScoreCache.size,
    lookups: sectionSolverCacheStats.lookups,
    hits: sectionSolverCacheStats.hits,
    misses: sectionSolverCacheStats.misses,
    rejectedHits: sectionSolverCacheStats.rejectedHits,
    stores: sectionSolverCacheStats.stores,
    scoreLookups: sectionSolverCacheStats.scoreLookups,
    scoreHits: sectionSolverCacheStats.scoreHits,
    scoreMisses: sectionSolverCacheStats.scoreMisses,
    scoreStores: sectionSolverCacheStats.scoreStores,
    contextBuildMs: sectionSolverCacheStats.contextBuildMs,
    hydrateSolutionMs: sectionSolverCacheStats.hydrateSolutionMs,
    hydratedSolverBuildMs: sectionSolverCacheStats.hydratedSolverBuildMs,
    storeValidationMs: sectionSolverCacheStats.storeValidationMs,
    storeEntryBuildMs: sectionSolverCacheStats.storeEntryBuildMs,
  })

export const getSectionSolverScoreCacheKeyStats = () =>
  [...sectionSolverScoreCacheKeyStatsByKey.entries()]
    .map(([key, stats]) => ({
      key,
      lookups: stats.lookups,
      hits: stats.hits,
      misses: stats.misses,
      stores: stats.stores,
    }))
    .sort(
      (left, right) =>
        right.lookups - left.lookups ||
        right.hits - left.hits ||
        compareStrings(left.key, right.key),
    )
