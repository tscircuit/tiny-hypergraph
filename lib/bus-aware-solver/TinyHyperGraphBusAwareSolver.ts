import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { loadSerializedHyperGraph } from "../compat/loadSerializedHyperGraph"
import type {
  PortId,
  RegionId,
  RouteId,
} from "../types"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "../core"
import { TinyHyperGraphSolver } from "../core"
import {
  createSolvedSolverFromSolution,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionSolverOptions,
} from "../section-solver"

type RegionSegments = Array<[RouteId, PortId, PortId][]>

type RouteMetadataWithConnectionPoint = {
  startRegionId?: unknown
  endRegionId?: unknown
  _bus?: {
    id?: unknown
    order?: unknown
  }
  simpleRouteConnection?: {
    pointsToConnect?: Array<{
      x?: unknown
      y?: unknown
      layer?: unknown
    }>
  }
}

type HotRegion = {
  regionId: RegionId
  cost: number
  routes: RouteId[]
}

type HotRegionGroupCandidate = {
  groupId: string
  routeIds: RouteId[]
  hotspotMemberCount: number
}

type SelfIntersectingBusGroup = {
  groupId: string
  totalIntersections: number
  sameLayerIntersections: number
  crossLayerIntersections: number
}

type SectionPolishCandidateFamily = "self-touch" | "onehop-all"

type SectionPolishCandidate = {
  label: string
  family: SectionPolishCandidateFamily
  regionIds: RegionId[]
  portSelectionRule: "touches-selected-region" | "all-incident-regions-selected"
}

export interface TinyHyperGraphBusAwareSolverOptions
  extends TinyHyperGraphSolverOptions {
  EXPLORATION_MAX_ITERATIONS?: number
  COMPLETION_MAX_ITERATIONS?: number
  HOTSPOT_REPAIR_MAX_ITERATIONS?: number
  ALTERNATING_REPAIR_CYCLES?: number
  REPRESENTATIVE_CORRIDOR_ROUNDS?: number
  REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT?: number
  SECTION_POLISH_ROUNDS?: number
  SECTION_POLISH_MAX_HOT_REGIONS?: number
  SECTION_POLISH_MAX_ITERATIONS?: number
  HOTSPOT_GROUP_REPAIR_ROUNDS?: number
  HOTSPOT_GROUP_CANDIDATE_LIMIT?: number
  AGGRESSIVE_ENDPOINT_CANDIDATE_LIMIT?: number
  HOTSPOT_CONGESTION_PENALTY?: number
  HOTSPOT_NEIGHBOR_CONGESTION_PENALTY?: number
}

const cloneProblem = (
  problem: TinyHyperGraphProblem,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask: new Int8Array(problem.portSectionMask),
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeStartPortCandidates: problem.routeStartPortCandidates?.map(
    (candidatePortIds) =>
      candidatePortIds ? [...candidatePortIds] : undefined,
  ),
  routeEndPortCandidates: problem.routeEndPortCandidates?.map(
    (candidatePortIds) =>
      candidatePortIds ? [...candidatePortIds] : undefined,
  ),
  routeNet: new Int32Array(problem.routeNet),
  regionNetId: new Int32Array(problem.regionNetId),
  suggestedSolverOptions: problem.suggestedSolverOptions,
})

const cloneRegionSegments = (regionSegments: RegionSegments): RegionSegments =>
  regionSegments.map((segments) =>
    segments.map(
      ([routeId, fromPortId, toPortId]) =>
        [routeId, fromPortId, toPortId] as [RouteId, PortId, PortId],
    ),
  )

const getMaxRegionCost = (solver: TinyHyperGraphSolver) =>
  solver.state.regionIntersectionCaches.reduce(
    (maxRegionCost, regionIntersectionCache) =>
      Math.max(maxRegionCost, regionIntersectionCache.existingRegionCost),
    0,
  )

const getRoutedRouteIdsFromRegionSegments = (
  regionSegments: RegionSegments,
): RouteId[] => {
  const routedRouteIds = new Set<RouteId>()

  for (const segments of regionSegments) {
    for (const [routeId] of segments) {
      routedRouteIds.add(routeId)
    }
  }

  return [...routedRouteIds].sort((left, right) => left - right)
}

const getMissingRouteIds = (
  routeCount: number,
  routedRouteIds: RouteId[],
): RouteId[] => {
  const routedRouteIdSet = new Set(routedRouteIds)
  const missingRouteIds: RouteId[] = []

  for (let routeId = 0; routeId < routeCount; routeId++) {
    if (!routedRouteIdSet.has(routeId)) {
      missingRouteIds.push(routeId)
    }
  }

  return missingRouteIds
}

const getHotRegions = (solver: TinyHyperGraphSolver): HotRegion[] =>
  solver.state.regionIntersectionCaches
    .map((regionIntersectionCache, regionId) => ({
      regionId,
      cost: regionIntersectionCache.existingRegionCost,
      routes: [
        ...new Set(
          (solver.state.regionSegments[regionId] ?? []).map(([routeId]) => routeId),
        ),
      ].sort((left, right) => left - right),
    }))
    .filter(({ cost, routes }) => cost > 0 && routes.length > 0)
    .sort((left, right) => right.cost - left.cost || left.regionId - right.regionId)

const getRouteGroupId = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
): string => {
  const routeMetadata = problem.routeMetadata?.[routeId] as
    | RouteMetadataWithConnectionPoint
    | undefined
  const busId = routeMetadata?._bus?.id

  return typeof busId === "string" ? busId : `single:${routeId}`
}

const getRouteGroupIds = (problem: TinyHyperGraphProblem): string[] =>
  Array.from({ length: problem.routeCount }, (_, routeId) =>
    getRouteGroupId(problem, routeId),
  )

const getRouteIdsByGroupId = (
  routeGroupIds: string[],
): Map<string, RouteId[]> => {
  const routeIdsByGroupId = new Map<string, RouteId[]>()

  for (let routeId = 0; routeId < routeGroupIds.length; routeId++) {
    const groupId = routeGroupIds[routeId]!
    const routeIds = routeIdsByGroupId.get(groupId)
    if (routeIds) {
      routeIds.push(routeId)
    } else {
      routeIdsByGroupId.set(groupId, [routeId])
    }
  }

  return routeIdsByGroupId
}

const getHotRegionGroupCandidates = (
  hotRegion: HotRegion,
  routeGroupIds: string[],
  routeIdsByGroupId: Map<string, RouteId[]>,
  maxCandidates: number,
): HotRegionGroupCandidate[] => {
  const hotspotRouteIdsByGroupId = new Map<string, Set<RouteId>>()

  for (const routeId of hotRegion.routes) {
    const groupId = routeGroupIds[routeId]!
    const hotspotRouteIds = hotspotRouteIdsByGroupId.get(groupId)
    if (hotspotRouteIds) {
      hotspotRouteIds.add(routeId)
    } else {
      hotspotRouteIdsByGroupId.set(groupId, new Set([routeId]))
    }
  }

  return [...hotspotRouteIdsByGroupId.entries()]
    .map(([groupId, hotspotRouteIds]) => ({
      groupId,
      routeIds: [...(routeIdsByGroupId.get(groupId) ?? [])].sort(
        (left, right) => left - right,
      ),
      hotspotMemberCount: hotspotRouteIds.size,
    }))
    .filter((groupCandidate) => groupCandidate.routeIds.length > 0)
    .sort(
      (left, right) =>
        right.hotspotMemberCount - left.hotspotMemberCount ||
        right.routeIds.length - left.routeIds.length ||
        left.groupId.localeCompare(right.groupId),
    )
    .slice(0, maxCandidates)
}

const intervalsCross = (
  leftLesserAngle: number,
  leftGreaterAngle: number,
  rightLesserAngle: number,
  rightGreaterAngle: number,
) => {
  const rightLesserIsInsideLeftInterval =
    leftLesserAngle < rightLesserAngle &&
    rightLesserAngle < leftGreaterAngle
  const rightGreaterIsInsideLeftInterval =
    leftLesserAngle < rightGreaterAngle &&
    rightGreaterAngle < leftGreaterAngle

  return rightLesserIsInsideLeftInterval !== rightGreaterIsInsideLeftInterval
}

const getSelfIntersectingBusGroups = (
  problem: TinyHyperGraphProblem,
  solvedSolver: TinyHyperGraphSolver,
  maxGroups: number,
): SelfIntersectingBusGroup[] => {
  const routeGroupIds = getRouteGroupIds(problem)
  const groupStats = new Map<
    string,
    {
      sameLayerIntersections: number
      crossLayerIntersections: number
    }
  >()

  for (
    let regionId = 0;
    regionId < solvedSolver.topology.regionCount;
    regionId++
  ) {
    const regionSegments = solvedSolver.state.regionSegments[regionId] ?? []
    const regionIntersectionCache =
      solvedSolver.state.regionIntersectionCaches[regionId]

    for (let leftIndex = 0; leftIndex < regionSegments.length; leftIndex++) {
      const [leftRouteId] = regionSegments[leftIndex]!
      const leftGroupId = routeGroupIds[leftRouteId]!
      if (leftGroupId.startsWith("single:")) {
        continue
      }

      for (
        let rightIndex = leftIndex + 1;
        rightIndex < regionSegments.length;
        rightIndex++
      ) {
        const [rightRouteId] = regionSegments[rightIndex]!
        if (problem.routeNet[leftRouteId] === problem.routeNet[rightRouteId]) {
          continue
        }

        const rightGroupId = routeGroupIds[rightRouteId]!
        if (leftGroupId !== rightGroupId) {
          continue
        }

        if (
          !intervalsCross(
            regionIntersectionCache.lesserAngles[leftIndex]!,
            regionIntersectionCache.greaterAngles[leftIndex]!,
            regionIntersectionCache.lesserAngles[rightIndex]!,
            regionIntersectionCache.greaterAngles[rightIndex]!,
          )
        ) {
          continue
        }

        const sameLayer =
          (regionIntersectionCache.layerMasks[leftIndex]! &
            regionIntersectionCache.layerMasks[rightIndex]!) !==
          0
        const groupStat = groupStats.get(leftGroupId) ?? {
          sameLayerIntersections: 0,
          crossLayerIntersections: 0,
        }

        if (sameLayer) {
          groupStat.sameLayerIntersections += 1
        } else {
          groupStat.crossLayerIntersections += 1
        }

        groupStats.set(leftGroupId, groupStat)
      }
    }
  }

  return [...groupStats.entries()]
    .map(([groupId, groupStat]) => ({
      groupId,
      totalIntersections:
        groupStat.sameLayerIntersections + groupStat.crossLayerIntersections,
      sameLayerIntersections: groupStat.sameLayerIntersections,
      crossLayerIntersections: groupStat.crossLayerIntersections,
    }))
    .sort(
      (left, right) =>
        right.totalIntersections - left.totalIntersections ||
        right.sameLayerIntersections - left.sameLayerIntersections ||
        right.crossLayerIntersections - left.crossLayerIntersections ||
        left.groupId.localeCompare(right.groupId),
    )
    .slice(0, maxGroups)
}

const getRepresentativeRouteId = (
  problem: TinyHyperGraphProblem,
  groupId: string,
): RouteId | undefined => {
  const busRoutes: Array<{ routeId: RouteId; order: number }> = []

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routeMetadata = problem.routeMetadata?.[routeId] as
      | RouteMetadataWithConnectionPoint
      | undefined
    if (routeMetadata?._bus?.id !== groupId) {
      continue
    }

    const order =
      typeof routeMetadata._bus?.order === "number"
        ? routeMetadata._bus.order
        : routeId
    busRoutes.push({ routeId, order })
  }

  busRoutes.sort(
    (left, right) => left.order - right.order || left.routeId - right.routeId,
  )

  return busRoutes[Math.floor((busRoutes.length - 1) / 2)]?.routeId
}

const getRouteRegionIds = (
  solvedSolver: TinyHyperGraphSolver,
  routeId: RouteId,
): RegionId[] => {
  const routeRegionIds: RegionId[] = []

  for (
    let regionId = 0;
    regionId < solvedSolver.topology.regionCount;
    regionId++
  ) {
    if (
      solvedSolver.state.regionSegments[regionId]?.some(
        ([candidateRouteId]) => candidateRouteId === routeId,
      )
    ) {
      routeRegionIds.push(regionId)
    }
  }

  return routeRegionIds
}

const getRegionAdjacency = (
  topology: TinyHyperGraphTopology,
): Array<Set<RegionId>> =>
  Array.from({ length: topology.regionCount }, (_, regionId) => {
    const adjacentRegionIds = new Set<RegionId>()

    for (const portId of topology.regionIncidentPorts[regionId] ?? []) {
      for (const adjacentRegionId of topology.incidentPortRegion[portId] ?? []) {
        adjacentRegionIds.add(adjacentRegionId)
      }
    }

    adjacentRegionIds.delete(regionId)
    return adjacentRegionIds
  })

const getAdjacentRegionIds = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: RegionId[],
) => {
  const adjacentRegionIds = new Set(seedRegionIds)

  for (const seedRegionId of seedRegionIds) {
    for (const portId of topology.regionIncidentPorts[seedRegionId] ?? []) {
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        adjacentRegionIds.add(regionId)
      }
    }
  }

  return [...adjacentRegionIds].sort((left, right) => left - right)
}

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: RegionId[],
  portSelectionRule:
    | "touches-selected-region"
    | "all-incident-regions-selected",
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []

    if (portSelectionRule === "touches-selected-region") {
      return incidentRegionIds.some((regionId) => selectedRegionIds.has(regionId))
        ? 1
        : 0
    }

    return incidentRegionIds.length > 0 &&
      incidentRegionIds.every((regionId) => selectedRegionIds.has(regionId))
      ? 1
      : 0
  })
}

const getSectionPolishCandidates = (
  solvedSolver: TinyHyperGraphSolver,
  topology: TinyHyperGraphTopology,
  maxHotRegions: number,
): SectionPolishCandidate[] => {
  const hotRegionIds = getHotRegions(solvedSolver)
    .slice(0, maxHotRegions)
    .map(({ regionId }) => regionId)
  const seenKeys = new Set<string>()
  const candidates: SectionPolishCandidate[] = []

  for (const hotRegionId of hotRegionIds) {
    const oneHopRegionIds = getAdjacentRegionIds(topology, [hotRegionId])

    for (const candidate of [
      {
        label: `hot-${hotRegionId}-self-touch`,
        family: "self-touch" as const,
        regionIds: [hotRegionId],
        portSelectionRule: "touches-selected-region" as const,
      },
      {
        label: `hot-${hotRegionId}-onehop-all`,
        family: "onehop-all" as const,
        regionIds: oneHopRegionIds,
        portSelectionRule: "all-incident-regions-selected" as const,
      },
    ]) {
      const key = `${candidate.portSelectionRule}:${candidate.regionIds.join(",")}`
      if (seenKeys.has(key)) {
        continue
      }
      seenKeys.add(key)
      candidates.push(candidate)
    }
  }

  return candidates
}

const maybeRunBunGc = () => {
  const bunLike = globalThis as typeof globalThis & {
    Bun?: {
      gc?: (force?: boolean) => void
    }
  }

  bunLike.Bun?.gc?.(true)
}

const removeRoutesFromRegionSegments = (
  regionSegments: RegionSegments,
  routeIdsToRemove: Set<RouteId>,
): RegionSegments =>
  regionSegments.map((segments) =>
    segments.filter(([routeId]) => !routeIdsToRemove.has(routeId)),
  )

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

const getRegionIndexBySerializedId = (topology: TinyHyperGraphTopology) =>
  new Map(
    topology.regionMetadata?.map((metadata, regionId) => [
      metadata?.serializedRegionId,
      regionId,
    ]),
  )

const getNearestPortsForRouteEndpoint = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  regionIndexBySerializedId: Map<string | undefined, number>,
  routeId: RouteId,
  endpointIndex: 0 | 1,
  limit: number,
): PortId[] => {
  const routeMetadata = problem.routeMetadata?.[routeId] as
    | RouteMetadataWithConnectionPoint
    | undefined
  const serializedRegionId =
    endpointIndex === 0
      ? routeMetadata?.startRegionId
      : routeMetadata?.endRegionId
  const point =
    routeMetadata?.simpleRouteConnection?.pointsToConnect?.[endpointIndex]
  const regionId =
    typeof serializedRegionId === "string"
      ? regionIndexBySerializedId.get(serializedRegionId)
      : undefined

  if (
    regionId === undefined ||
    !point ||
    typeof point.x !== "number" ||
    typeof point.y !== "number"
  ) {
    return []
  }

  const preferredZ = getLayerZForConnectionPoint(point.layer)
  const pointX = point.x
  const pointY = point.y

  return [...(topology.regionIncidentPorts[regionId] ?? [])]
    .sort((leftPortId, rightPortId) => {
      const leftMetadata = topology.portMetadata?.[leftPortId]
      const rightMetadata = topology.portMetadata?.[rightPortId]
      const leftLayerPenalty =
        preferredZ !== undefined && topology.portZ[leftPortId] !== preferredZ
          ? 1_000
          : 0
      const rightLayerPenalty =
        preferredZ !== undefined && topology.portZ[rightPortId] !== preferredZ
          ? 1_000
          : 0
      const leftDistance =
        Math.hypot(
          topology.portX[leftPortId] - pointX,
          topology.portY[leftPortId] - pointY,
        ) + leftLayerPenalty
      const rightDistance =
        Math.hypot(
          topology.portX[rightPortId] - pointX,
          topology.portY[rightPortId] - pointY,
        ) + rightLayerPenalty
      const leftCenterDistance = Number(
        leftMetadata?.distToCentermostPortOnZ ?? Number.POSITIVE_INFINITY,
      )
      const rightCenterDistance = Number(
        rightMetadata?.distToCentermostPortOnZ ?? Number.POSITIVE_INFINITY,
      )

      return (
        leftDistance - rightDistance ||
        leftCenterDistance - rightCenterDistance ||
        leftPortId - rightPortId
      )
    })
    .slice(0, limit)
}

const createAggressiveEndpointProblem = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  aggressiveEndpointCandidateLimit: number,
): TinyHyperGraphProblem => {
  const aggressiveProblem = cloneProblem(problem)
  const regionIndexBySerializedId = getRegionIndexBySerializedId(topology)

  aggressiveProblem.routeStartPortCandidates = Array.from(
    { length: problem.routeCount },
    () => undefined as PortId[] | undefined,
  )
  aggressiveProblem.routeEndPortCandidates = Array.from(
    { length: problem.routeCount },
    () => undefined as PortId[] | undefined,
  )

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const startCandidatePortIds = getNearestPortsForRouteEndpoint(
      topology,
      problem,
      regionIndexBySerializedId,
      routeId,
      0,
      aggressiveEndpointCandidateLimit,
    )
    const endCandidatePortIds = getNearestPortsForRouteEndpoint(
      topology,
      problem,
      regionIndexBySerializedId,
      routeId,
      1,
      aggressiveEndpointCandidateLimit,
    )

    if (startCandidatePortIds.length > 0) {
      aggressiveProblem.routeStartPort[routeId] = startCandidatePortIds[0]!
    }
    if (endCandidatePortIds.length > 0) {
      aggressiveProblem.routeEndPort[routeId] = endCandidatePortIds[0]!
    }
    if (startCandidatePortIds.length > 1) {
      aggressiveProblem.routeStartPortCandidates[routeId] = startCandidatePortIds
    }
    if (endCandidatePortIds.length > 1) {
      aggressiveProblem.routeEndPortCandidates[routeId] = endCandidatePortIds
    }
  }

  return aggressiveProblem
}

class BestStateTrackingSolver extends TinyHyperGraphSolver {
  bestRoutedCount = 0
  bestMaxRegionCost = Number.POSITIVE_INFINITY
  bestRegionSegments: RegionSegments
  bestRoutedRouteIds: RouteId[] = []

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.bestRegionSegments = cloneRegionSegments(this.state.regionSegments)
  }

  updateBestState() {
    const routedRouteIds = getRoutedRouteIdsFromRegionSegments(
      this.state.regionSegments,
    )
    const routedCount = routedRouteIds.length
    const maxRegionCost = getMaxRegionCost(this)

    if (
      routedCount > this.bestRoutedCount ||
      (routedCount === this.bestRoutedCount &&
        maxRegionCost < this.bestMaxRegionCost)
    ) {
      this.bestRoutedCount = routedCount
      this.bestMaxRegionCost = maxRegionCost
      this.bestRegionSegments = cloneRegionSegments(this.state.regionSegments)
      this.bestRoutedRouteIds = routedRouteIds
    }
  }

  override _step() {
    super._step()
    this.updateBestState()
  }
}

class AcceptOnAllRoutesSolver extends TinyHyperGraphSolver {
  override onAllRoutesRouted() {
    this.stats = {
      ...this.stats,
      maxRegionCost: getMaxRegionCost(this),
      ripCount: this.state.ripCount,
    }
    this.solved = true
    this.failed = false
    this.error = null
  }
}

export class TinyHyperGraphBusAwareSolver extends BaseSolver {
  EXPLORATION_MAX_ITERATIONS = 50_000
  COMPLETION_MAX_ITERATIONS = 200_000
  HOTSPOT_REPAIR_MAX_ITERATIONS = 50_000
  ALTERNATING_REPAIR_CYCLES = 3
  REPRESENTATIVE_CORRIDOR_ROUNDS = 3
  REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT = 6
  SECTION_POLISH_ROUNDS = 3
  SECTION_POLISH_MAX_HOT_REGIONS = 4
  SECTION_POLISH_MAX_ITERATIONS = 500_000
  HOTSPOT_GROUP_REPAIR_ROUNDS = 5
  HOTSPOT_GROUP_CANDIDATE_LIMIT = 6
  AGGRESSIVE_ENDPOINT_CANDIDATE_LIMIT = 6
  HOTSPOT_CONGESTION_PENALTY = 5
  HOTSPOT_NEIGHBOR_CONGESTION_PENALTY = 0

  explorationSolver?: BestStateTrackingSolver
  completionSolver?: AcceptOnAllRoutesSolver
  hotspotRepairSolver?: AcceptOnAllRoutesSolver
  finalSolver?: TinyHyperGraphSolver

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphBusAwareSolverOptions,
  ) {
    super()

    if (options?.EXPLORATION_MAX_ITERATIONS !== undefined) {
      this.EXPLORATION_MAX_ITERATIONS = options.EXPLORATION_MAX_ITERATIONS
    }
    if (options?.COMPLETION_MAX_ITERATIONS !== undefined) {
      this.COMPLETION_MAX_ITERATIONS = options.COMPLETION_MAX_ITERATIONS
    }
    if (options?.HOTSPOT_REPAIR_MAX_ITERATIONS !== undefined) {
      this.HOTSPOT_REPAIR_MAX_ITERATIONS =
        options.HOTSPOT_REPAIR_MAX_ITERATIONS
    }
    if (options?.ALTERNATING_REPAIR_CYCLES !== undefined) {
      this.ALTERNATING_REPAIR_CYCLES = options.ALTERNATING_REPAIR_CYCLES
    }
    if (options?.REPRESENTATIVE_CORRIDOR_ROUNDS !== undefined) {
      this.REPRESENTATIVE_CORRIDOR_ROUNDS =
        options.REPRESENTATIVE_CORRIDOR_ROUNDS
    }
    if (options?.REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT !== undefined) {
      this.REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT =
        options.REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT
    }
    if (options?.SECTION_POLISH_ROUNDS !== undefined) {
      this.SECTION_POLISH_ROUNDS = options.SECTION_POLISH_ROUNDS
    }
    if (options?.SECTION_POLISH_MAX_HOT_REGIONS !== undefined) {
      this.SECTION_POLISH_MAX_HOT_REGIONS =
        options.SECTION_POLISH_MAX_HOT_REGIONS
    }
    if (options?.SECTION_POLISH_MAX_ITERATIONS !== undefined) {
      this.SECTION_POLISH_MAX_ITERATIONS =
        options.SECTION_POLISH_MAX_ITERATIONS
    }
    if (options?.HOTSPOT_GROUP_REPAIR_ROUNDS !== undefined) {
      this.HOTSPOT_GROUP_REPAIR_ROUNDS = options.HOTSPOT_GROUP_REPAIR_ROUNDS
    }
    if (options?.HOTSPOT_GROUP_CANDIDATE_LIMIT !== undefined) {
      this.HOTSPOT_GROUP_CANDIDATE_LIMIT =
        options.HOTSPOT_GROUP_CANDIDATE_LIMIT
    }
    if (options?.AGGRESSIVE_ENDPOINT_CANDIDATE_LIMIT !== undefined) {
      this.AGGRESSIVE_ENDPOINT_CANDIDATE_LIMIT =
        options.AGGRESSIVE_ENDPOINT_CANDIDATE_LIMIT
    }
    if (options?.HOTSPOT_CONGESTION_PENALTY !== undefined) {
      this.HOTSPOT_CONGESTION_PENALTY = options.HOTSPOT_CONGESTION_PENALTY
    }
    if (options?.HOTSPOT_NEIGHBOR_CONGESTION_PENALTY !== undefined) {
      this.HOTSPOT_NEIGHBOR_CONGESTION_PENALTY =
        options.HOTSPOT_NEIGHBOR_CONGESTION_PENALTY
    }

    this.baseStageOptions = getBaseStageOptions(options)
  }

  private baseStageOptions: TinyHyperGraphSolverOptions

  getStageOptions(maxIterations: number): TinyHyperGraphSolverOptions {
    return {
      ...this.baseStageOptions,
      MAX_ITERATIONS: maxIterations,
    }
  }

  private getSectionPolishSolverOptions(): TinyHyperGraphSectionSolverOptions {
    return {
      ...this.baseStageOptions,
      MAX_ITERATIONS: this.SECTION_POLISH_MAX_ITERATIONS,
      MAX_RIPS: 24,
      MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 8,
      EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
        Number.POSITIVE_INFINITY,
    }
  }

  private getHotspotPenaltyEntries(
    hotRegionId: RegionId,
    regionAdjacency: Array<Set<RegionId>>,
  ): Array<[RegionId, number]> {
    const penaltyEntries: Array<[RegionId, number]> = [
      [hotRegionId, this.HOTSPOT_CONGESTION_PENALTY],
    ]

    if (this.HOTSPOT_NEIGHBOR_CONGESTION_PENALTY <= 0) {
      return penaltyEntries
    }

    for (const adjacentRegionId of regionAdjacency[hotRegionId] ?? []) {
      penaltyEntries.push([
        adjacentRegionId,
        this.HOTSPOT_NEIGHBOR_CONGESTION_PENALTY,
      ])
    }

    return penaltyEntries
  }

  private runHotspotGroupRepair(
    initialSolver: TinyHyperGraphSolver,
    problem: TinyHyperGraphProblem = this.problem,
    topology: TinyHyperGraphTopology = this.topology,
  ): {
    solver: TinyHyperGraphSolver
    initialHotRegion?: HotRegion
    finalHotRegion?: HotRegion
    committedGroupIds: string[]
  } {
    const routeGroupIds = getRouteGroupIds(problem)
    const routeIdsByGroupId = getRouteIdsByGroupId(routeGroupIds)
    const regionAdjacency = getRegionAdjacency(topology)
    const committedGroupIds: string[] = []

    let currentSolver = initialSolver
    let currentRegionSegments = cloneRegionSegments(
      initialSolver.state.regionSegments,
    )
    let initialHotRegion: HotRegion | undefined

    for (
      let repairRound = 0;
      repairRound < this.HOTSPOT_GROUP_REPAIR_ROUNDS;
      repairRound++
    ) {
      const hotRegion = getHotRegions(currentSolver)[0]
      if (!hotRegion || hotRegion.routes.length === 0) {
        break
      }
      if (!initialHotRegion) {
        initialHotRegion = hotRegion
      }

      const currentMaxRegionCost = getMaxRegionCost(currentSolver)
      const candidateGroups = getHotRegionGroupCandidates(
        hotRegion,
        routeGroupIds,
        routeIdsByGroupId,
        this.HOTSPOT_GROUP_CANDIDATE_LIMIT,
      )

      let bestCandidateSolver: AcceptOnAllRoutesSolver | undefined
      let bestCandidateCost = currentMaxRegionCost
      let bestCandidateGroupId: string | undefined

      for (const candidateGroup of candidateGroups) {
        const repairSolver = new AcceptOnAllRoutesSolver(
          topology,
          cloneProblem(problem),
          this.getStageOptions(this.HOTSPOT_REPAIR_MAX_ITERATIONS),
        )
        repairSolver.replayRoutedStateFromRegionSegments(
          removeRoutesFromRegionSegments(
            currentRegionSegments,
            new Set(candidateGroup.routeIds),
          ),
        )
        repairSolver.state.unroutedRoutes = [...candidateGroup.routeIds]

        for (const [regionId, penalty] of this.getHotspotPenaltyEntries(
          hotRegion.regionId,
          regionAdjacency,
        )) {
          repairSolver.state.regionCongestionCost[regionId] = penalty
        }

        repairSolver.solve()

        const candidateCost = getMaxRegionCost(repairSolver)
        if (
          repairSolver.solved &&
          candidateCost < bestCandidateCost - Number.EPSILON
        ) {
          bestCandidateSolver = repairSolver
          bestCandidateCost = candidateCost
          bestCandidateGroupId = candidateGroup.groupId
        }
      }

      if (!bestCandidateSolver || !bestCandidateGroupId) {
        break
      }

      currentSolver = bestCandidateSolver
      currentRegionSegments = cloneRegionSegments(
        bestCandidateSolver.state.regionSegments,
      )
      committedGroupIds.push(bestCandidateGroupId)
    }

    return {
      solver: currentSolver,
      initialHotRegion,
      finalHotRegion: getHotRegions(currentSolver)[0],
      committedGroupIds,
    }
  }

  private runIterativeSectionPolish(initialSolver: TinyHyperGraphSolver): {
    solver: TinyHyperGraphSolver
    committedCandidateLabels: string[]
  } {
    if (this.SECTION_POLISH_ROUNDS <= 0) {
      return {
        solver: initialSolver,
        committedCandidateLabels: [],
      }
    }

    let currentGraph = initialSolver.getOutput()
    if (!currentGraph) {
      return {
        solver: initialSolver,
        committedCandidateLabels: [],
      }
    }

    let currentSolver = initialSolver
    const committedCandidateLabels: string[] = []

    for (
      let polishRound = 0;
      polishRound < this.SECTION_POLISH_ROUNDS;
      polishRound++
    ) {
      const { topology, problem, solution } = loadSerializedHyperGraph(currentGraph)
      const replaySolver = createSolvedSolverFromSolution(
        topology,
        problem,
        solution,
        this.baseStageOptions,
      )
      const baselineMaxRegionCost = getMaxRegionCost(replaySolver)
      let bestCandidateCost = baselineMaxRegionCost
      let bestCandidateLabel: string | undefined
      let bestCandidateOutput:
        | ReturnType<TinyHyperGraphSectionSolver["getOutput"]>
        | undefined
      let bestCandidateSolver: TinyHyperGraphSolver | undefined

      for (const candidate of getSectionPolishCandidates(
        replaySolver,
        topology,
        this.SECTION_POLISH_MAX_HOT_REGIONS,
      )) {
        const candidateProblem = cloneProblem(problem)
        candidateProblem.portSectionMask = createPortSectionMaskForRegionIds(
          topology,
          candidate.regionIds,
          candidate.portSelectionRule,
        )

        const sectionSolver = new TinyHyperGraphSectionSolver(
          topology,
          candidateProblem,
          solution,
          this.getSectionPolishSolverOptions(),
        )
        sectionSolver.solve()

        if (!sectionSolver.solved || sectionSolver.failed) {
          maybeRunBunGc()
          continue
        }

        const candidateOutput = sectionSolver.getOutput()
        const replayedCandidate = loadSerializedHyperGraph(candidateOutput)
        const replayedCandidateSolver = createSolvedSolverFromSolution(
          replayedCandidate.topology,
          replayedCandidate.problem,
          replayedCandidate.solution,
          this.baseStageOptions,
        )
        const candidateCost = getMaxRegionCost(replayedCandidateSolver)

        if (candidateCost < bestCandidateCost - Number.EPSILON) {
          bestCandidateCost = candidateCost
          bestCandidateLabel = candidate.label
          bestCandidateOutput = candidateOutput
          bestCandidateSolver = replayedCandidateSolver
        }

        maybeRunBunGc()
      }

      if (
        !bestCandidateOutput ||
        !bestCandidateLabel ||
        !bestCandidateSolver
      ) {
        break
      }

      currentGraph = bestCandidateOutput
      currentSolver = bestCandidateSolver
      committedCandidateLabels.push(bestCandidateLabel)
      maybeRunBunGc()
    }

    return {
      solver: currentSolver,
      committedCandidateLabels,
    }
  }

  private runAlternatingRepair(
    initialSolver: TinyHyperGraphSolver,
    problem: TinyHyperGraphProblem = this.problem,
    topology: TinyHyperGraphTopology = this.topology,
  ): {
    solver: TinyHyperGraphSolver
    committedGroupIds: string[]
    committedSectionCandidateLabels: string[]
    alternatingRepairCycleCount: number
  } {
    let currentSolver = initialSolver
    const committedGroupIds: string[] = []
    const committedSectionCandidateLabels: string[] = []
    let alternatingRepairCycleCount = 0

    for (
      let cycleIndex = 0;
      cycleIndex < this.ALTERNATING_REPAIR_CYCLES;
      cycleIndex++
    ) {
      const preRepairCost = getMaxRegionCost(currentSolver)
      const repairResult = this.runHotspotGroupRepair(
        currentSolver,
        problem,
        topology,
      )
      const repairCost = getMaxRegionCost(repairResult.solver)
      const repairImproved = repairCost < preRepairCost - Number.EPSILON

      if (repairImproved) {
        this.hotspotRepairSolver = repairResult.solver as AcceptOnAllRoutesSolver
        currentSolver = repairResult.solver
        committedGroupIds.push(...repairResult.committedGroupIds)
      }

      const preSectionCost = getMaxRegionCost(currentSolver)
      const sectionPolishResult = this.runIterativeSectionPolish(currentSolver)
      const sectionPolishCost = getMaxRegionCost(sectionPolishResult.solver)
      const sectionPolishImproved =
        sectionPolishCost < preSectionCost - Number.EPSILON

      if (sectionPolishImproved) {
        currentSolver = sectionPolishResult.solver
        committedSectionCandidateLabels.push(
          ...sectionPolishResult.committedCandidateLabels,
        )
      }

      if (!repairImproved && !sectionPolishImproved) {
        break
      }

      alternatingRepairCycleCount += 1
      maybeRunBunGc()
    }

    return {
      solver: currentSolver,
      committedGroupIds,
      committedSectionCandidateLabels,
      alternatingRepairCycleCount,
    }
  }

  private runRepresentativeCorridorPolish(initialSolver: TinyHyperGraphSolver): {
    solver: TinyHyperGraphSolver
    committedGroupIds: string[]
    committedRepresentativeRouteIds: RouteId[]
    hotspotRepairCommittedGroupIds: string[]
    sectionPolishCommittedLabels: string[]
    alternatingRepairCycleCount: number
  } {
    if (
      this.REPRESENTATIVE_CORRIDOR_ROUNDS <= 0 ||
      this.REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT <= 0
    ) {
      return {
        solver: initialSolver,
        committedGroupIds: [],
        committedRepresentativeRouteIds: [],
        hotspotRepairCommittedGroupIds: [],
        sectionPolishCommittedLabels: [],
        alternatingRepairCycleCount: 0,
      }
    }

    let currentGraph = initialSolver.getOutput()
    if (!currentGraph) {
      return {
        solver: initialSolver,
        committedGroupIds: [],
        committedRepresentativeRouteIds: [],
        hotspotRepairCommittedGroupIds: [],
        sectionPolishCommittedLabels: [],
        alternatingRepairCycleCount: 0,
      }
    }

    let currentSolver = initialSolver
    const committedGroupIds: string[] = []
    const committedRepresentativeRouteIds: RouteId[] = []
    const hotspotRepairCommittedGroupIds: string[] = []
    const sectionPolishCommittedLabels: string[] = []
    let alternatingRepairCycleCount = 0

    for (
      let corridorRound = 0;
      corridorRound < this.REPRESENTATIVE_CORRIDOR_ROUNDS;
      corridorRound++
    ) {
      const { topology, problem, solution } = loadSerializedHyperGraph(currentGraph)
      problem.routeMetadata = this.problem.routeMetadata
      const replaySolver = createSolvedSolverFromSolution(
        topology,
        problem,
        solution,
        this.baseStageOptions,
      )
      const baselineMaxRegionCost = getMaxRegionCost(replaySolver)
      let bestCandidateCost = baselineMaxRegionCost
      let bestCandidateGroupId: string | undefined
      let bestRepresentativeRouteId: RouteId | undefined
      let bestCandidateOutput:
        | ReturnType<TinyHyperGraphSectionSolver["getOutput"]>
        | undefined
      let bestCandidateSolver: TinyHyperGraphSolver | undefined
      let bestCandidateProblem: TinyHyperGraphProblem | undefined
      let bestCandidateTopology: TinyHyperGraphTopology | undefined

      for (const candidateGroup of getSelfIntersectingBusGroups(
        problem,
        replaySolver,
        this.REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT,
      )) {
        const representativeRouteId = getRepresentativeRouteId(
          problem,
          candidateGroup.groupId,
        )
        if (representativeRouteId === undefined) {
          continue
        }

        const regionIds = getRouteRegionIds(replaySolver, representativeRouteId)
        if (regionIds.length === 0) {
          continue
        }

        const candidateProblem = cloneProblem(problem)
        candidateProblem.portSectionMask = createPortSectionMaskForRegionIds(
          topology,
          regionIds,
          "all-incident-regions-selected",
        )

        const sectionSolver = new TinyHyperGraphSectionSolver(
          topology,
          candidateProblem,
          solution,
          this.getSectionPolishSolverOptions(),
        )
        sectionSolver.solve()

        if (!sectionSolver.solved || sectionSolver.failed) {
          maybeRunBunGc()
          continue
        }

        const candidateOutput = sectionSolver.getOutput()
        const replayedCandidate = loadSerializedHyperGraph(candidateOutput)
        replayedCandidate.problem.routeMetadata = this.problem.routeMetadata
        const replayedCandidateSolver = createSolvedSolverFromSolution(
          replayedCandidate.topology,
          replayedCandidate.problem,
          replayedCandidate.solution,
          this.baseStageOptions,
        )
        const candidateCost = getMaxRegionCost(replayedCandidateSolver)

        if (candidateCost < bestCandidateCost - Number.EPSILON) {
          bestCandidateCost = candidateCost
          bestCandidateGroupId = candidateGroup.groupId
          bestRepresentativeRouteId = representativeRouteId
          bestCandidateOutput = candidateOutput
          bestCandidateSolver = replayedCandidateSolver
          bestCandidateProblem = replayedCandidate.problem
          bestCandidateTopology = replayedCandidate.topology
        }

        maybeRunBunGc()
      }

      if (
        !bestCandidateOutput ||
        !bestCandidateSolver ||
        !bestCandidateGroupId ||
        bestRepresentativeRouteId === undefined ||
        !bestCandidateProblem ||
        !bestCandidateTopology
      ) {
        break
      }

      currentGraph = bestCandidateOutput
      currentSolver = bestCandidateSolver
      committedGroupIds.push(bestCandidateGroupId)
      committedRepresentativeRouteIds.push(bestRepresentativeRouteId)
      maybeRunBunGc()

      const alternatingRepairWithCurrentProblem = this.runAlternatingRepair(
        currentSolver,
        bestCandidateProblem,
        bestCandidateTopology,
      )
      hotspotRepairCommittedGroupIds.push(
        ...alternatingRepairWithCurrentProblem.committedGroupIds,
      )
      sectionPolishCommittedLabels.push(
        ...alternatingRepairWithCurrentProblem.committedSectionCandidateLabels,
      )
      alternatingRepairCycleCount +=
        alternatingRepairWithCurrentProblem.alternatingRepairCycleCount

      if (
        getMaxRegionCost(alternatingRepairWithCurrentProblem.solver) <
        getMaxRegionCost(currentSolver) - Number.EPSILON
      ) {
        currentSolver = alternatingRepairWithCurrentProblem.solver
        currentGraph = currentSolver.getOutput() ?? currentGraph
      }

      maybeRunBunGc()
    }

    return {
      solver: currentSolver,
      committedGroupIds,
      committedRepresentativeRouteIds,
      hotspotRepairCommittedGroupIds,
      sectionPolishCommittedLabels,
      alternatingRepairCycleCount,
    }
  }

  override _setup() {
    const aggressiveProblem = createAggressiveEndpointProblem(
      this.topology,
      this.problem,
      this.AGGRESSIVE_ENDPOINT_CANDIDATE_LIMIT,
    )
    this.explorationSolver = new BestStateTrackingSolver(
      this.topology,
      aggressiveProblem,
      this.getStageOptions(this.EXPLORATION_MAX_ITERATIONS),
    )
    this.explorationSolver.solve()

    const explorationMissingRouteIds = getMissingRouteIds(
      this.problem.routeCount,
      this.explorationSolver.bestRoutedRouteIds,
    )

    this.completionSolver = new AcceptOnAllRoutesSolver(
      this.topology,
      cloneProblem(this.problem),
      this.getStageOptions(this.COMPLETION_MAX_ITERATIONS),
    )
    this.completionSolver.replayRoutedStateFromRegionSegments(
      this.explorationSolver.bestRegionSegments,
    )
    this.completionSolver.state.unroutedRoutes = [...explorationMissingRouteIds]
    this.completionSolver.solve()

    let finalSolver: TinyHyperGraphSolver = this.completionSolver
    let finalStage = "completion"
    let hottestRegion: HotRegion | undefined
    let finalHotRegion: HotRegion | undefined
    let committedGroupIds: string[] = []
    let committedSectionCandidateLabels: string[] = []
    let alternatingRepairCycleCount = 0
    let representativeCorridorCommittedGroupIds: string[] = []
    let representativeCorridorCommittedRepresentativeRouteIds: RouteId[] = []
    let representativeCorridorHotspotRepairCommittedGroupIds: string[] = []
    let representativeCorridorSectionPolishCommittedLabels: string[] = []
    let representativeCorridorAlternatingRepairCycleCount = 0

    if (this.completionSolver.solved) {
      hottestRegion = getHotRegions(this.completionSolver)[0]
      const alternatingRepairResult = this.runAlternatingRepair(
        this.completionSolver,
      )
      const alternatingRepairSolver = alternatingRepairResult.solver
      committedGroupIds = alternatingRepairResult.committedGroupIds
      committedSectionCandidateLabels =
        alternatingRepairResult.committedSectionCandidateLabels
      alternatingRepairCycleCount =
        alternatingRepairResult.alternatingRepairCycleCount

      if (
        getMaxRegionCost(alternatingRepairSolver) <
        getMaxRegionCost(finalSolver) - Number.EPSILON
      ) {
        finalSolver = alternatingRepairSolver
        finalStage = "alternating_hotspot_repair"
      }

      const representativeCorridorResult = this.runRepresentativeCorridorPolish(
        finalSolver,
      )
      representativeCorridorCommittedGroupIds =
        representativeCorridorResult.committedGroupIds
      representativeCorridorCommittedRepresentativeRouteIds =
        representativeCorridorResult.committedRepresentativeRouteIds
      representativeCorridorHotspotRepairCommittedGroupIds =
        representativeCorridorResult.hotspotRepairCommittedGroupIds
      representativeCorridorSectionPolishCommittedLabels =
        representativeCorridorResult.sectionPolishCommittedLabels
      representativeCorridorAlternatingRepairCycleCount =
        representativeCorridorResult.alternatingRepairCycleCount

      if (
        getMaxRegionCost(representativeCorridorResult.solver) <
        getMaxRegionCost(finalSolver) - Number.EPSILON
      ) {
        finalSolver = representativeCorridorResult.solver
        finalStage = "representative_corridor_polish"
      }
    }

    finalHotRegion = getHotRegions(finalSolver)[0]

    this.finalSolver = finalSolver
    this.stats = {
      ...this.stats,
      explorationBestRoutedCount: this.explorationSolver.bestRoutedCount,
      explorationBestMaxRegionCost: this.explorationSolver.bestMaxRegionCost,
      explorationMissingRouteCount: explorationMissingRouteIds.length,
      completionSolved: this.completionSolver.solved,
      completionFailed: this.completionSolver.failed,
      completionMaxRegionCost: getMaxRegionCost(this.completionSolver),
      finalStage,
      finalSolved: finalSolver.solved,
      finalFailed: finalSolver.failed,
      finalMaxRegionCost: getMaxRegionCost(finalSolver),
      alternatingRepairCycleCount,
      hotspotRepairCommittedGroupCount: committedGroupIds.length,
      hotspotRepairCommittedGroupIds: committedGroupIds,
      sectionPolishCommittedCount: committedSectionCandidateLabels.length,
      sectionPolishCommittedLabels: committedSectionCandidateLabels,
      representativeCorridorCommittedGroupCount:
        representativeCorridorCommittedGroupIds.length,
      representativeCorridorCommittedGroupIds,
      representativeCorridorCommittedRepresentativeRouteIds,
      representativeCorridorAlternatingRepairCycleCount,
      representativeCorridorHotspotRepairCommittedGroupCount:
        representativeCorridorHotspotRepairCommittedGroupIds.length,
      representativeCorridorHotspotRepairCommittedGroupIds,
      representativeCorridorSectionPolishCommittedCount:
        representativeCorridorSectionPolishCommittedLabels.length,
      representativeCorridorSectionPolishCommittedLabels,
      hotspotRegionId: hottestRegion?.regionId ?? null,
      hotspotRegionCost: hottestRegion?.cost ?? null,
      hotspotRouteCount: hottestRegion?.routes.length ?? 0,
      finalHotspotRegionId: finalHotRegion?.regionId ?? null,
      finalHotspotRegionCost: finalHotRegion?.cost ?? null,
      finalHotspotRouteCount: finalHotRegion?.routes.length ?? 0,
    }

    this.solved = finalSolver.solved
    this.failed = finalSolver.failed
    this.error = finalSolver.error
  }

  override _step() {
    if (!this.finalSolver) {
      this.failed = true
      this.error = "Bus-aware solver failed to initialize"
      return
    }

    this.solved = this.finalSolver.solved
    this.failed = this.finalSolver.failed
    this.error = this.finalSolver.error
  }

  override visualize(): GraphicsObject {
    return this.finalSolver?.visualize() ?? new TinyHyperGraphSolver(
      this.topology,
      this.problem,
    ).visualize()
  }

  override getOutput() {
    return this.finalSolver?.getOutput() ?? null
  }
}

const getBaseStageOptions = (
  options?: TinyHyperGraphBusAwareSolverOptions,
): TinyHyperGraphSolverOptions => {
  if (!options) {
    return {}
  }

  const {
    EXPLORATION_MAX_ITERATIONS,
    COMPLETION_MAX_ITERATIONS,
    HOTSPOT_REPAIR_MAX_ITERATIONS,
    ALTERNATING_REPAIR_CYCLES,
    REPRESENTATIVE_CORRIDOR_ROUNDS,
    REPRESENTATIVE_CORRIDOR_CANDIDATE_LIMIT,
    SECTION_POLISH_ROUNDS,
    SECTION_POLISH_MAX_HOT_REGIONS,
    SECTION_POLISH_MAX_ITERATIONS,
    HOTSPOT_GROUP_REPAIR_ROUNDS,
    HOTSPOT_GROUP_CANDIDATE_LIMIT,
    AGGRESSIVE_ENDPOINT_CANDIDATE_LIMIT,
    HOTSPOT_CONGESTION_PENALTY,
    HOTSPOT_NEIGHBOR_CONGESTION_PENALTY,
    ...baseStageOptions
  } = options

  return baseStageOptions
}
