import type {
  RegionCostSummary,
  TinyHyperGraphProblem,
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
  sectionRegionSegments: Array<Array<[number, number, number]>>
}

export interface TinyHyperGraphSectionSolverCacheStats {
  entries: number
  lookups: number
  hits: number
  misses: number
  rejectedHits: number
  stores: number
}

interface OrientationCandidate {
  key: string
  transform: SectionSolverCacheTransform
}

const SECTION_SOLVER_CACHE_VERSION = 1
const UNIT_REGION_SIZE_MM = 4
const SCALE_BUCKETS: ScaleBucket[] = [1, 2, 3, 4]
const GEOMETRY_QUANTIZATION = 1000

const sectionSolverCache = new Map<string, SectionSolverCacheEntry>()
const sectionSolverCacheStats = {
  lookups: 0,
  hits: 0,
  misses: 0,
  rejectedHits: 0,
  stores: 0,
}

const compareStrings = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const quantize = (value: number) => Math.round(value * GEOMETRY_QUANTIZATION)

const uniqueNumberList = <T extends number>(values: Iterable<T>) => [...new Set(values)]

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

  const localPortIds = getSectionLocalPortIds(topology, uniqueSectionRegionIds)
  const sectionRegionIdSet = new Set(uniqueSectionRegionIds)
  const activeRouteIdSet = new Set(activeRouteIds)
  const routePlanByRouteId = new Map(routePlans.map((routePlan) => [routePlan.routeId, routePlan]))
  const localRouteIds = uniqueNumberList(
    routePlans
      .filter(
        (routePlan) =>
          activeRouteIdSet.has(routePlan.routeId) ||
          routePlan.fixedSegments.some((segment) =>
            sectionRegionIdSet.has(segment.regionId),
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

    for (const regionId of uniqueSectionRegionIds) {
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
          if (!sectionRegionIdSet.has(regionId)) {
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
        .filter((segment) => sectionRegionIdSet.has(segment.regionId))
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
            sectionRegionIdSet.has(routePlan.forcedStartRegionId)
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

    for (const regionId of uniqueSectionRegionIds) {
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
    for (const regionId of uniqueSectionRegionIds) {
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

    const actualRegionIdByCanonicalRegionId = [...uniqueSectionRegionIds].sort(
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
  finalRegionSegments,
  optimized,
  finalSummary,
}: {
  context: SectionSolverCacheContext
  finalRegionSegments: Array<[RouteId, PortId, PortId][]>
  optimized: boolean
  finalSummary: RegionCostSummary
}): SectionSolverCacheEntry => {
  const { transform } = context

  return {
    optimized,
    finalSummary,
    sectionRegionSegments: transform.actualRegionIdByCanonicalRegionId.map(
      (actualRegionId) =>
        (finalRegionSegments[actualRegionId] ?? [])
          .map(
            ([routeId, fromPortId, toPortId]) =>
              [
                transform.canonicalRouteIdByActualRouteId.get(routeId) ?? -1,
                transform.canonicalPortIdByActualPortId.get(fromPortId) ?? -1,
                transform.canonicalPortIdByActualPortId.get(toPortId) ?? -1,
              ] as [number, number, number],
          )
          .sort((left, right) => {
            if (left[0] !== right[0]) {
              return left[0] - right[0]
            }
            if (left[1] !== right[1]) {
              return left[1] - right[1]
            }
            return left[2] - right[2]
          }),
    ),
  }
}

export const hydrateSectionSolverCacheEntry = (
  entry: SectionSolverCacheEntry,
  context: SectionSolverCacheContext,
  baselineRegionSegments: Array<[RouteId, PortId, PortId][]>,
): Array<[RouteId, PortId, PortId][]> => {
  const hydratedRegionSegments = cloneRegionSegments(baselineRegionSegments)
  const { transform } = context

  entry.sectionRegionSegments.forEach((canonicalRegionSegments, canonicalRegionId) => {
    const actualRegionId =
      transform.actualRegionIdByCanonicalRegionId[canonicalRegionId]

    hydratedRegionSegments[actualRegionId] = canonicalRegionSegments.map(
      ([canonicalRouteId, canonicalFromPortId, canonicalToPortId]) => {
        const actualRouteId =
          transform.actualRouteIdByCanonicalRouteId[canonicalRouteId]
        const actualFromPortId =
          transform.actualPortIdByCanonicalPortId[canonicalFromPortId]
        const actualToPortId =
          transform.actualPortIdByCanonicalPortId[canonicalToPortId]

        if (
          actualRouteId === undefined ||
          actualFromPortId === undefined ||
          actualToPortId === undefined
        ) {
          throw new Error("Section solver cache hydration map is incomplete")
        }

        return [
          actualRouteId,
          actualFromPortId,
          actualToPortId,
        ] as [RouteId, PortId, PortId]
      },
    )
  })

  return hydratedRegionSegments
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

export const clearTinyHyperGraphSectionSolverCache = () => {
  sectionSolverCache.clear()
  sectionSolverCacheStats.lookups = 0
  sectionSolverCacheStats.hits = 0
  sectionSolverCacheStats.misses = 0
  sectionSolverCacheStats.rejectedHits = 0
  sectionSolverCacheStats.stores = 0
}

export const getTinyHyperGraphSectionSolverCacheStats =
  (): TinyHyperGraphSectionSolverCacheStats => ({
    entries: sectionSolverCache.size,
    lookups: sectionSolverCacheStats.lookups,
    hits: sectionSolverCacheStats.hits,
    misses: sectionSolverCacheStats.misses,
    rejectedHits: sectionSolverCacheStats.rejectedHits,
    stores: sectionSolverCacheStats.stores,
  })
