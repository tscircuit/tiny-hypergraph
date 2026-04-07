import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
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
  TinyHyperGraphSolution,
  TinyHyperGraphSolver,
  TinyHyperGraphTopology,
} from "../core"
import { MinHeap } from "../MinHeap"
import {
  getActiveSectionRouteIds,
  TinyHyperGraphSectionSolver,
  type TinyHyperGraphSectionSolverOptions,
} from "../section-solver"
import { visualizeTinyGraph } from "../visualizeTinyGraph"

type OrderedRoutePath = {
  orderedPortIds: PortId[]
  orderedRegionIds: RegionId[]
}

type OrderedRouteSegment = {
  routeId: RouteId
  regionId: RegionId
  segmentIndex: number
  fromPortId: PortId
  toPortId: PortId
  fromPathIndex: number
  toPathIndex: number
}

type RegionCostSummary = {
  maxRegionCost: number
  totalRegionCost: number
}

type SameLayerCrossingIssue = {
  type: "same-layer-crossing"
  regionId: RegionId
  regionCost: number
  segmentA: OrderedRouteSegment
  segmentB: OrderedRouteSegment
}

type TransitionViaIssue = {
  type: "transition-via"
  regionId: RegionId
  regionCost: number
  segment: OrderedRouteSegment
}

type UnravelIssue = SameLayerCrossingIssue | TransitionViaIssue

type SwapBoundaryPortsMutation = {
  type: "swap-boundary-ports"
  label: string
  rootRegionId: RegionId
  affectedRegionIds: RegionId[]
  routeIdA: RouteId
  routeIdB: RouteId
  pathIndexA: number
  pathIndexB: number
  newPortIdA: PortId
  newPortIdB: PortId
}

type ChangeLayerMutation = {
  type: "change-layer"
  label: string
  rootRegionId: RegionId
  affectedRegionIds: RegionId[]
  substitutions: Array<{
    routeId: RouteId
    pathIndex: number
    newPortId: PortId
  }>
}

type UnravelMutation = SwapBoundaryPortsMutation | ChangeLayerMutation

type MutationSummary = {
  label: string
  type: UnravelMutation["type"]
  rootRegionId: RegionId
  fromMaxRegionCost: number
  toMaxRegionCost: number
  affectedRegionIds: RegionId[]
}

type UnravelSearchState = {
  serializedHyperGraph: SerializedHyperGraph
  summary: RegionCostSummary
  depth: number
  priority: number
  mutationPath: MutationSummary[]
  nextRootRegionIds?: RegionId[]
}

type SegmentGeometry = {
  lesserAngle: number
  greaterAngle: number
  layerMask: number
  entryExitLayerChanges: number
}

type PendingUnravelMutation = {
  issue: UnravelIssue
  mutation: UnravelMutation
}

type QueuedMutationEvaluation = {
  outputGraph: SerializedHyperGraph
  summary: RegionCostSummary
  nextRootRegionIds: RegionId[]
  mutationSummary: MutationSummary
  priority: number
  pendingMutation: PendingUnravelMutation
}

type ActiveExpansionState = {
  searchState: UnravelSearchState
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
  solver: TinyHyperGraphSolver
  rootRegionIds: RegionId[]
  issues: UnravelIssue[]
  pendingMutations: PendingUnravelMutation[]
  candidateEvaluations: QueuedMutationEvaluation[]
  highlightedRootRegionId?: RegionId
  sectionPortMask?: Int8Array
  lastEvaluatedMutation?: PendingUnravelMutation
  lastEvaluatedAccepted?: boolean
  committed: boolean
}

const DEFAULT_SECTION_SOLVER_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_RAMP_ATTEMPTS: 16,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  MAX_ITERATIONS: 1e6,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.POSITIVE_INFINITY,
}

const DEFAULT_IMPROVEMENT_EPSILON = 1e-9
const PORT_LAYER_POINT_OFFSET = 0.002
const PORT_LAYER_CIRCLE_OFFSET = 0.01

const compareSearchStates = (
  left: UnravelSearchState,
  right: UnravelSearchState,
) => {
  if (left.priority !== right.priority) {
    return left.priority - right.priority
  }

  if (left.summary.maxRegionCost !== right.summary.maxRegionCost) {
    return left.summary.maxRegionCost - right.summary.maxRegionCost
  }

  if (left.summary.totalRegionCost !== right.summary.totalRegionCost) {
    return left.summary.totalRegionCost - right.summary.totalRegionCost
  }

  return left.depth - right.depth
}

const getRegionCostSummary = (solver: TinyHyperGraphSolver): RegionCostSummary =>
  solver.state.regionIntersectionCaches.reduce(
    (summary, regionIntersectionCache) => ({
      maxRegionCost: Math.max(
        summary.maxRegionCost,
        regionIntersectionCache.existingRegionCost,
      ),
      totalRegionCost:
        summary.totalRegionCost + regionIntersectionCache.existingRegionCost,
    }),
    {
      maxRegionCost: 0,
      totalRegionCost: 0,
    },
  )

const compareRegionCostSummaries = (
  left: RegionCostSummary,
  right: RegionCostSummary,
) => {
  if (left.maxRegionCost !== right.maxRegionCost) {
    return left.maxRegionCost - right.maxRegionCost
  }

  return left.totalRegionCost - right.totalRegionCost
}

const roundMutationCost = (value: number) => Number(value.toFixed(12))

const getSharedRegionIdForPorts = (
  topology: TinyHyperGraphTopology,
  fromPortId: PortId,
  toPortId: PortId,
): RegionId => {
  const fromIncidentRegions = topology.incidentPortRegion[fromPortId] ?? []
  const toIncidentRegions = topology.incidentPortRegion[toPortId] ?? []
  const sharedRegionId = fromIncidentRegions.find((regionId) =>
    toIncidentRegions.includes(regionId),
  )

  if (sharedRegionId === undefined) {
    throw new Error(`Ports ${fromPortId} and ${toPortId} do not share a region`)
  }

  return sharedRegionId
}

const getOrderedRoutePath = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  routeId: RouteId,
): OrderedRoutePath => {
  const routeSegments = solution.solvedRoutePathSegments[routeId] ?? []
  const routeSegmentRegionIds = solution.solvedRoutePathRegionIds?.[routeId] ?? []
  const startPortId = problem.routeStartPort[routeId]
  const endPortId = problem.routeEndPort[routeId]

  if (routeSegments.length === 0) {
    if (startPortId === endPortId) {
      return {
        orderedPortIds: [startPortId],
        orderedRegionIds: [],
      }
    }

    throw new Error(`Route ${routeId} does not have an existing solved path`)
  }

  const segmentsByPort = new Map<
    PortId,
    Array<{
      segmentIndex: number
      fromPortId: PortId
      toPortId: PortId
      regionId?: RegionId
    }>
  >()

  routeSegments.forEach(([fromPortId, toPortId], segmentIndex) => {
    const indexedSegment = {
      segmentIndex,
      fromPortId,
      toPortId,
      regionId: routeSegmentRegionIds[segmentIndex],
    }

    const fromSegments = segmentsByPort.get(fromPortId) ?? []
    fromSegments.push(indexedSegment)
    segmentsByPort.set(fromPortId, fromSegments)

    const toSegments = segmentsByPort.get(toPortId) ?? []
    toSegments.push(indexedSegment)
    segmentsByPort.set(toPortId, toSegments)
  })

  const orderedPortIds = [startPortId]
  const orderedRegionIds: RegionId[] = []
  const usedSegmentIndices = new Set<number>()
  let currentPortId = startPortId
  let previousPortId: PortId | undefined

  while (currentPortId !== endPortId) {
    const nextSegments = (segmentsByPort.get(currentPortId) ?? []).filter(
      ({ segmentIndex, fromPortId, toPortId }) => {
        if (usedSegmentIndices.has(segmentIndex)) {
          return false
        }

        const nextPortId = fromPortId === currentPortId ? toPortId : fromPortId

        return nextPortId !== previousPortId
      },
    )

    if (nextSegments.length !== 1) {
      throw new Error(
        `Route ${routeId} is not a single ordered path from ${startPortId} to ${endPortId}`,
      )
    }

    const nextSegment = nextSegments[0]!
    const nextPortId =
      nextSegment.fromPortId === currentPortId
        ? nextSegment.toPortId
        : nextSegment.fromPortId

    usedSegmentIndices.add(nextSegment.segmentIndex)
    orderedRegionIds.push(
      nextSegment.regionId ??
        getSharedRegionIdForPorts(
          topology,
          nextSegment.fromPortId,
          nextSegment.toPortId,
        ),
    )
    orderedPortIds.push(nextPortId)
    previousPortId = currentPortId
    currentPortId = nextPortId
  }

  if (usedSegmentIndices.size !== routeSegments.length) {
    throw new Error(`Route ${routeId} contains disconnected solved segments`)
  }

  return {
    orderedPortIds,
    orderedRegionIds,
  }
}

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

  return [...adjacentRegionIds]
}

const getRegionIdsWithinHops = (
  topology: TinyHyperGraphTopology,
  seedRegionIds: RegionId[],
  hops: number,
) => {
  let currentRegionIds = [...seedRegionIds]

  for (let hop = 0; hop < hops; hop++) {
    currentRegionIds = getAdjacentRegionIds(topology, currentRegionIds)
  }

  return currentRegionIds
}

const createPortSectionMaskForRegionIds = (
  topology: TinyHyperGraphTopology,
  regionIds: RegionId[],
) => {
  const selectedRegionIds = new Set(regionIds)

  return Int8Array.from({ length: topology.portCount }, (_, portId) => {
    const incidentRegionIds = topology.incidentPortRegion[portId] ?? []
    return incidentRegionIds.some((regionId) => selectedRegionIds.has(regionId))
      ? 1
      : 0
  })
}

const createProblemWithPortSectionMask = (
  problem: TinyHyperGraphProblem,
  portSectionMask: Int8Array,
): TinyHyperGraphProblem => ({
  routeCount: problem.routeCount,
  portSectionMask,
  routeMetadata: problem.routeMetadata,
  routeStartPort: new Int32Array(problem.routeStartPort),
  routeEndPort: new Int32Array(problem.routeEndPort),
  routeNet: new Int32Array(problem.routeNet),
  regionNetId: new Int32Array(problem.regionNetId),
})

const normalizePortSectionMaskToContiguousRouteSpans = (
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  solution: TinyHyperGraphSolution,
  portSectionMask: Int8Array,
) => {
  const normalizedPortSectionMask = new Int8Array(portSectionMask)

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const { orderedPortIds } = getOrderedRoutePath(
      topology,
      problem,
      solution,
      routeId,
    )
    let firstMaskedIndex: number | undefined
    let lastMaskedIndex: number | undefined

    for (let pathIndex = 0; pathIndex < orderedPortIds.length; pathIndex++) {
      if (normalizedPortSectionMask[orderedPortIds[pathIndex]!] !== 1) {
        continue
      }

      if (firstMaskedIndex === undefined) {
        firstMaskedIndex = pathIndex
      }
      lastMaskedIndex = pathIndex
    }

    if (
      firstMaskedIndex === undefined ||
      lastMaskedIndex === undefined ||
      firstMaskedIndex === lastMaskedIndex
    ) {
      continue
    }

    for (
      let pathIndex = firstMaskedIndex;
      pathIndex <= lastMaskedIndex;
      pathIndex++
    ) {
      normalizedPortSectionMask[orderedPortIds[pathIndex]!] = 1
    }
  }

  return normalizedPortSectionMask
}

const getOppositeRegionIdForPort = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  regionId: RegionId,
) => {
  const incidentRegionIds = topology.incidentPortRegion[portId] ?? []
  return incidentRegionIds.find((candidateRegionId) => candidateRegionId !== regionId)
}

const createBoundaryPairKey = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
) => {
  const incidentRegionIds = [...(topology.incidentPortRegion[portId] ?? [])].sort(
    (left, right) => left - right,
  )
  return incidentRegionIds.join(":")
}

const createLayerVariantKey = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
) =>
  `${createBoundaryPairKey(topology, portId)}:${topology.portX[portId].toFixed(9)}:${topology.portY[portId].toFixed(9)}`

const createGraphFingerprint = (serializedHyperGraph: SerializedHyperGraph) =>
  (serializedHyperGraph.solvedRoutes ?? [])
    .map((solvedRoute) =>
      [
        solvedRoute.connection.connectionId,
        solvedRoute.path.map((candidate) => candidate.portId).join(">"),
      ].join("="),
    )
    .join("||")

export interface TinyHyperGraphUnravelSolverOptions
  extends TinyHyperGraphSectionSolverOptions {
  MAX_MUTATION_DEPTH?: number
  MAX_SEARCH_STATES?: number
  MAX_ENQUEUED_MUTATIONS_PER_STATE?: number
  MUTATION_DEPTH_PENALTY?: number
  IMPROVEMENT_EPSILON?: number
  MAX_ROOT_REGIONS?: number
  MUTABLE_HOPS?: number
}

export class TinyHyperGraphUnravelSolver extends BaseSolver {
  baselineSolver: TinyHyperGraphSolver
  baselineSerializedHyperGraph: SerializedHyperGraph
  bestSerializedHyperGraph: SerializedHyperGraph
  bestReplaySolver?: TinyHyperGraphSolver
  baselineOutputSummary: RegionCostSummary
  bestSummary: RegionCostSummary
  bestMutationPath: MutationSummary[] = []
  searchQueue = new MinHeap<UnravelSearchState>([], compareSearchStates)
  bestCostByFingerprint = new Map<string, number>()
  activeExpansion?: ActiveExpansionState
  boundaryPairKeyByPortId: string[]
  layerVariantPortIdsByKey = new Map<string, PortId[]>()
  serializedPortIdByPortId: string[]

  MAX_MUTATION_DEPTH = 2
  MAX_SEARCH_STATES = 6
  MAX_ENQUEUED_MUTATIONS_PER_STATE = 2
  MUTATION_DEPTH_PENALTY = 1e-3
  IMPROVEMENT_EPSILON = DEFAULT_IMPROVEMENT_EPSILON
  MAX_ROOT_REGIONS = 1
  MUTABLE_HOPS = 1

  searchStartTime = 0
  expandedStateCount = 0
  enqueuedStateCount = 0
  cacheHitCount = 0
  generatedIssueCount = 0
  generatedMutationCount = 0
  attemptedMutationCount = 0
  acceptedMutationCount = 0
  totalMutationSolveMs = 0
  totalMutationReplayMs = 0
  totalIssueScanMs = 0
  totalMutationApplyMs = 0

  sectionSolverOptions: TinyHyperGraphSectionSolverOptions

  constructor(
    public topology: TinyHyperGraphTopology,
    public problem: TinyHyperGraphProblem,
    public initialSolution: TinyHyperGraphSolution,
    options?: TinyHyperGraphUnravelSolverOptions,
  ) {
    super()

    this.sectionSolverOptions = {
      ...DEFAULT_SECTION_SOLVER_OPTIONS,
      ...options,
    }
    if (options?.MAX_MUTATION_DEPTH !== undefined) {
      this.MAX_MUTATION_DEPTH = options.MAX_MUTATION_DEPTH
    }
    if (options?.MAX_SEARCH_STATES !== undefined) {
      this.MAX_SEARCH_STATES = options.MAX_SEARCH_STATES
    }
    if (options?.MAX_ENQUEUED_MUTATIONS_PER_STATE !== undefined) {
      this.MAX_ENQUEUED_MUTATIONS_PER_STATE =
        options.MAX_ENQUEUED_MUTATIONS_PER_STATE
    }
    if (options?.MUTATION_DEPTH_PENALTY !== undefined) {
      this.MUTATION_DEPTH_PENALTY = options.MUTATION_DEPTH_PENALTY
    }
    if (options?.IMPROVEMENT_EPSILON !== undefined) {
      this.IMPROVEMENT_EPSILON = options.IMPROVEMENT_EPSILON
    }
    if (options?.MAX_ROOT_REGIONS !== undefined) {
      this.MAX_ROOT_REGIONS = options.MAX_ROOT_REGIONS
    }
    if (options?.MUTABLE_HOPS !== undefined) {
      this.MUTABLE_HOPS = options.MUTABLE_HOPS
    }

    const baselineSectionSolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      initialSolution,
      this.sectionSolverOptions,
    )
    this.baselineSolver = baselineSectionSolver.baselineSolver
    this.baselineSerializedHyperGraph = this.baselineSolver.getOutput()
    this.bestSerializedHyperGraph = this.baselineSerializedHyperGraph
    this.baselineOutputSummary = this.getSerializedOutputSummary(
      this.baselineSerializedHyperGraph,
    )
    this.bestSummary = this.baselineOutputSummary
    this.boundaryPairKeyByPortId = Array.from(
      { length: topology.portCount },
      (_, portId) => createBoundaryPairKey(topology, portId),
    )
    this.serializedPortIdByPortId = Array.from(
      { length: topology.portCount },
      (_, portId) =>
        String(topology.portMetadata?.[portId]?.serializedPortId ?? `port-${portId}`),
    )

    for (let portId = 0; portId < topology.portCount; portId++) {
      const layerVariantKey = createLayerVariantKey(topology, portId)
      const layerVariantPortIds =
        this.layerVariantPortIdsByKey.get(layerVariantKey) ?? []
      layerVariantPortIds.push(portId)
      this.layerVariantPortIdsByKey.set(layerVariantKey, layerVariantPortIds)
    }
  }

  override _setup() {
    this.searchStartTime = performance.now()

    const initialState: UnravelSearchState = {
      serializedHyperGraph: this.baselineSerializedHyperGraph,
      summary: this.bestSummary,
      depth: 0,
      priority: this.bestSummary.maxRegionCost,
      mutationPath: [],
    }

    this.bestCostByFingerprint.set(
      createGraphFingerprint(this.baselineSerializedHyperGraph),
      roundMutationCost(this.bestSummary.maxRegionCost),
    )
    this.searchQueue.queue(initialState)
    this.enqueuedStateCount = 1

    this.stats = {
      ...this.stats,
      baselineMaxRegionCost: this.bestSummary.maxRegionCost,
      baselineTotalRegionCost: this.bestSummary.totalRegionCost,
      finalMaxRegionCost: this.bestSummary.maxRegionCost,
      finalTotalRegionCost: this.bestSummary.totalRegionCost,
      delta: 0,
      optimized: false,
      mutationDepth: 0,
      mutationPathLabels: [],
    }
  }

  getSerializedOutputSummary(
    serializedHyperGraph: SerializedHyperGraph,
  ): RegionCostSummary {
    const replay = loadSerializedHyperGraph(serializedHyperGraph)
    const replayedSectionSolver = new TinyHyperGraphSectionSolver(
      replay.topology,
      replay.problem,
      replay.solution,
    )

    return getRegionCostSummary(replayedSectionSolver.baselineSolver)
  }

  getRouteLabel(problem: TinyHyperGraphProblem, routeId: RouteId) {
    const routeMetadata = problem.routeMetadata?.[routeId]
    return (
      routeMetadata?.connectionId ??
      routeMetadata?.mutuallyConnectedNetworkId ??
      `route-${routeId}`
    )
  }

  getPortRenderPoint(
    topology: TinyHyperGraphTopology,
    portId: PortId,
  ) {
    const layerOffset = topology.portZ[portId] * PORT_LAYER_POINT_OFFSET
    return {
      x: topology.portX[portId] + layerOffset,
      y: topology.portY[portId] + layerOffset,
    }
  }

  getPortCircleCenter(
    topology: TinyHyperGraphTopology,
    portId: PortId,
  ) {
    const layerOffset = topology.portZ[portId] * PORT_LAYER_CIRCLE_OFFSET
    return {
      x: topology.portX[portId] + layerOffset,
      y: topology.portY[portId] + layerOffset,
    }
  }

  getRegionCenter(
    topology: TinyHyperGraphTopology,
    regionId: RegionId,
  ) {
    return {
      x: topology.regionCenterX[regionId],
      y: topology.regionCenterY[regionId],
    }
  }

  getRegionHighlightRadius(
    topology: TinyHyperGraphTopology,
    regionId: RegionId,
  ) {
    return Math.max(
      topology.regionWidth[regionId] ?? 0,
      topology.regionHeight[regionId] ?? 0,
      0.15,
    )
  }

  createSectionPortMaskForRootRegion(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    solution: TinyHyperGraphSolution,
    rootRegionId: RegionId,
  ) {
    const mutableRegionIds = getRegionIdsWithinHops(
      topology,
      [rootRegionId],
      this.MUTABLE_HOPS,
    )
    const sectionRegionIds = getAdjacentRegionIds(topology, mutableRegionIds)

    return normalizePortSectionMaskToContiguousRouteSpans(
      topology,
      problem,
      solution,
      createPortSectionMaskForRegionIds(topology, sectionRegionIds),
    )
  }

  createVisualizationSolver(
    serializedHyperGraph: SerializedHyperGraph,
  ) {
    const replay = loadSerializedHyperGraph(serializedHyperGraph)
    const replayedSectionSolver = new TinyHyperGraphSectionSolver(
      replay.topology,
      replay.problem,
      replay.solution,
      this.sectionSolverOptions,
    )
    replayedSectionSolver.baselineSolver.iterations = 1
    return replayedSectionSolver.baselineSolver
  }

  createSegmentGeometry(
    topology: TinyHyperGraphTopology,
    regionId: RegionId,
    port1Id: PortId,
    port2Id: PortId,
  ): SegmentGeometry {
    const port1IncidentRegions = topology.incidentPortRegion[port1Id] ?? []
    const port2IncidentRegions = topology.incidentPortRegion[port2Id] ?? []
    const angle1 =
      port1IncidentRegions[0] === regionId || port1IncidentRegions[1] !== regionId
        ? topology.portAngleForRegion1[port1Id]
        : topology.portAngleForRegion2?.[port1Id] ??
          topology.portAngleForRegion1[port1Id]
    const angle2 =
      port2IncidentRegions[0] === regionId || port2IncidentRegions[1] !== regionId
        ? topology.portAngleForRegion1[port2Id]
        : topology.portAngleForRegion2?.[port2Id] ??
          topology.portAngleForRegion1[port2Id]
    const z1 = topology.portZ[port1Id]
    const z2 = topology.portZ[port2Id]

    return {
      lesserAngle: angle1 < angle2 ? angle1 : angle2,
      greaterAngle: angle1 < angle2 ? angle2 : angle1,
      layerMask: (1 << z1) | (1 << z2),
      entryExitLayerChanges: z1 !== z2 ? 1 : 0,
    }
  }

  doSegmentsCross(
    left: SegmentGeometry,
    right: SegmentGeometry,
  ) {
    const lesserAngleIsInsideInterval =
      left.lesserAngle < right.lesserAngle &&
      right.lesserAngle < left.greaterAngle
    const greaterAngleIsInsideInterval =
      left.lesserAngle < right.greaterAngle &&
      right.greaterAngle < left.greaterAngle

    return lesserAngleIsInsideInterval !== greaterAngleIsInsideInterval
  }

  getOrderedRoutePaths(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    solution: TinyHyperGraphSolution,
  ) {
    return Array.from({ length: problem.routeCount }, (_, routeId) =>
      getOrderedRoutePath(topology, problem, solution, routeId),
    )
  }

  getSegmentsByRegion(
    orderedRoutePaths: OrderedRoutePath[],
  ) {
    const segmentsByRegion = new Map<RegionId, OrderedRouteSegment[]>()

    orderedRoutePaths.forEach((orderedRoutePath, routeId) => {
      for (
        let segmentIndex = 0;
        segmentIndex < orderedRoutePath.orderedRegionIds.length;
        segmentIndex++
      ) {
        const regionId = orderedRoutePath.orderedRegionIds[segmentIndex]!
        const segments = segmentsByRegion.get(regionId) ?? []
        segments.push({
          routeId,
          regionId,
          segmentIndex,
          fromPortId: orderedRoutePath.orderedPortIds[segmentIndex]!,
          toPortId: orderedRoutePath.orderedPortIds[segmentIndex + 1]!,
          fromPathIndex: segmentIndex,
          toPathIndex: segmentIndex + 1,
        })
        segmentsByRegion.set(regionId, segments)
      }
    })

    return segmentsByRegion
  }

  getHotRootRegionIds(
    solver: TinyHyperGraphSolver,
    preferredRegionIds?: RegionId[],
  ) {
    const preferredRegionIdSet = preferredRegionIds
      ? new Set(preferredRegionIds)
      : undefined
    const sortedRegionIds = solver.state.regionIntersectionCaches
      .map((regionIntersectionCache, regionId) => ({
        regionId,
        regionCost: regionIntersectionCache.existingRegionCost,
      }))
      .filter(
        ({ regionId, regionCost }) =>
          regionCost > 0 &&
          (preferredRegionIdSet === undefined || preferredRegionIdSet.has(regionId)),
      )
      .sort((left, right) => right.regionCost - left.regionCost)
      .slice(0, this.MAX_ROOT_REGIONS)
      .map(({ regionId }) => regionId)

    if (sortedRegionIds.length > 0 || preferredRegionIds === undefined) {
      return sortedRegionIds
    }

    return solver.state.regionIntersectionCaches
      .map((regionIntersectionCache, regionId) => ({
        regionId,
        regionCost: regionIntersectionCache.existingRegionCost,
      }))
      .filter(({ regionCost }) => regionCost > 0)
      .sort((left, right) => right.regionCost - left.regionCost)
      .slice(0, this.MAX_ROOT_REGIONS)
      .map(({ regionId }) => regionId)
  }

  getIssuesForRootRegion(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    solver: TinyHyperGraphSolver,
    segmentsByRegion: Map<RegionId, OrderedRouteSegment[]>,
    rootRegionId: RegionId,
  ): UnravelIssue[] {
    const mutableRegionIds = getRegionIdsWithinHops(
      topology,
      [rootRegionId],
      this.MUTABLE_HOPS,
    )
    const mutableRegionIdSet = new Set(mutableRegionIds)
    const issues: UnravelIssue[] = []

    for (const regionId of mutableRegionIds) {
      const regionCost =
        solver.state.regionIntersectionCaches[regionId]?.existingRegionCost ?? 0
      if (regionCost <= 0) {
        continue
      }

      const segments = segmentsByRegion.get(regionId) ?? []

      for (const segment of segments) {
        const segmentGeometry = this.createSegmentGeometry(
          topology,
          regionId,
          segment.fromPortId,
          segment.toPortId,
        )

        if (segmentGeometry.entryExitLayerChanges > 0) {
          issues.push({
            type: "transition-via",
            regionId,
            regionCost,
            segment,
          })
          this.generatedIssueCount += 1
        }
      }

      for (let leftIndex = 0; leftIndex < segments.length; leftIndex++) {
        const leftSegment = segments[leftIndex]!
        const leftGeometry = this.createSegmentGeometry(
          topology,
          regionId,
          leftSegment.fromPortId,
          leftSegment.toPortId,
        )

        for (
          let rightIndex = leftIndex + 1;
          rightIndex < segments.length;
          rightIndex++
        ) {
          const rightSegment = segments[rightIndex]!
          if (
            problem.routeNet[leftSegment.routeId] === problem.routeNet[rightSegment.routeId]
          ) {
            continue
          }

          const rightGeometry = this.createSegmentGeometry(
            topology,
            regionId,
            rightSegment.fromPortId,
            rightSegment.toPortId,
          )

          if (!this.doSegmentsCross(leftGeometry, rightGeometry)) {
            continue
          }

          if ((leftGeometry.layerMask & rightGeometry.layerMask) === 0) {
            continue
          }

          issues.push({
            type: "same-layer-crossing",
            regionId,
            regionCost,
            segmentA: leftSegment,
            segmentB: rightSegment,
          })
          this.generatedIssueCount += 1
        }
      }
    }

    return issues.sort((left, right) => {
      if (right.regionCost !== left.regionCost) {
        return right.regionCost - left.regionCost
      }

      if (left.type !== right.type) {
        return left.type.localeCompare(right.type)
      }

      return left.regionId - right.regionId
    })
  }

  getLayerVariantsForPort(portId: PortId) {
    return (
      this.layerVariantPortIdsByKey.get(createLayerVariantKey(this.topology, portId)) ??
      []
    ).filter((candidatePortId) => candidatePortId !== portId)
  }

  isInternalPathIndex(
    orderedRoutePath: OrderedRoutePath,
    pathIndex: number,
  ) {
    return pathIndex > 0 && pathIndex < orderedRoutePath.orderedPortIds.length - 1
  }

  getMutationsForSameLayerCrossingIssue(
    topology: TinyHyperGraphTopology,
    orderedRoutePaths: OrderedRoutePath[],
    issue: SameLayerCrossingIssue,
  ): UnravelMutation[] {
    const mutations: UnravelMutation[] = []
    const seenMutationKeys = new Set<string>()
    const candidateEndpointPairs: Array<
      [
        OrderedRouteSegment["fromPathIndex"] | OrderedRouteSegment["toPathIndex"],
        OrderedRouteSegment["fromPathIndex"] | OrderedRouteSegment["toPathIndex"],
        PortId,
        PortId,
      ]
    > = [
      [
        issue.segmentA.fromPathIndex,
        issue.segmentB.fromPathIndex,
        issue.segmentA.fromPortId,
        issue.segmentB.fromPortId,
      ],
      [
        issue.segmentA.fromPathIndex,
        issue.segmentB.toPathIndex,
        issue.segmentA.fromPortId,
        issue.segmentB.toPortId,
      ],
      [
        issue.segmentA.toPathIndex,
        issue.segmentB.fromPathIndex,
        issue.segmentA.toPortId,
        issue.segmentB.fromPortId,
      ],
      [
        issue.segmentA.toPathIndex,
        issue.segmentB.toPathIndex,
        issue.segmentA.toPortId,
        issue.segmentB.toPortId,
      ],
    ]

    for (const [pathIndexA, pathIndexB, portIdA, portIdB] of candidateEndpointPairs) {
      if (
        this.boundaryPairKeyByPortId[portIdA] !==
        this.boundaryPairKeyByPortId[portIdB]
      ) {
        continue
      }

      const orderedRoutePathA = orderedRoutePaths[issue.segmentA.routeId]!
      const orderedRoutePathB = orderedRoutePaths[issue.segmentB.routeId]!
      if (
        !this.isInternalPathIndex(orderedRoutePathA, pathIndexA) ||
        !this.isInternalPathIndex(orderedRoutePathB, pathIndexB)
      ) {
        continue
      }

      const mutationKey = [
        issue.segmentA.routeId,
        pathIndexA,
        portIdB,
        issue.segmentB.routeId,
        pathIndexB,
        portIdA,
      ].join(":")
      if (seenMutationKeys.has(mutationKey)) {
        continue
      }
      seenMutationKeys.add(mutationKey)

      mutations.push({
        type: "swap-boundary-ports",
        label: `swap-r${issue.segmentA.routeId}-p${pathIndexA}-r${issue.segmentB.routeId}-p${pathIndexB}-region-${issue.regionId}`,
        rootRegionId: issue.regionId,
        affectedRegionIds: getRegionIdsWithinHops(topology, [issue.regionId], 1),
        routeIdA: issue.segmentA.routeId,
        routeIdB: issue.segmentB.routeId,
        pathIndexA,
        pathIndexB,
        newPortIdA: portIdB,
        newPortIdB: portIdA,
      })
    }

    const layerShiftMutations = [issue.segmentA, issue.segmentB].flatMap((segment) => {
      const orderedRoutePath = orderedRoutePaths[segment.routeId]!
      const mutationsForSegment: UnravelMutation[] = []
      const seenLayerMutationKeys = new Set<string>()
      const endpointPairs: Array<[number, PortId, number, PortId]> = [
        [segment.fromPathIndex, segment.fromPortId, segment.toPathIndex, segment.toPortId],
      ]

      for (const [pathIndexA, portIdA, pathIndexB, portIdB] of endpointPairs) {
        if (
          !this.isInternalPathIndex(orderedRoutePath, pathIndexA) ||
          !this.isInternalPathIndex(orderedRoutePath, pathIndexB)
        ) {
          continue
        }

        const altPortsA = this.getLayerVariantsForPort(portIdA)
        const altPortsB = this.getLayerVariantsForPort(portIdB)

        for (const altPortIdA of altPortsA) {
          for (const altPortIdB of altPortsB) {
            if (
              topology.portZ[altPortIdA] !== topology.portZ[altPortIdB] ||
              topology.portZ[altPortIdA] === topology.portZ[portIdA]
            ) {
              continue
            }

            const mutationKey = [
              segment.routeId,
              pathIndexA,
              altPortIdA,
              pathIndexB,
              altPortIdB,
            ].join(":")
            if (seenLayerMutationKeys.has(mutationKey)) {
              continue
            }
            seenLayerMutationKeys.add(mutationKey)

            mutationsForSegment.push({
              type: "change-layer",
              label: `layer-r${segment.routeId}-s${segment.segmentIndex}-z${topology.portZ[altPortIdA]}-region-${issue.regionId}`,
              rootRegionId: issue.regionId,
              affectedRegionIds: getRegionIdsWithinHops(topology, [issue.regionId], 1),
              substitutions: [
                {
                  routeId: segment.routeId,
                  pathIndex: pathIndexA,
                  newPortId: altPortIdA,
                },
                {
                  routeId: segment.routeId,
                  pathIndex: pathIndexB,
                  newPortId: altPortIdB,
                },
              ],
            })
          }
        }
      }

      return mutationsForSegment
    })

    return [...mutations, ...layerShiftMutations]
  }

  getMutationsForTransitionViaIssue(
    topology: TinyHyperGraphTopology,
    orderedRoutePaths: OrderedRoutePath[],
    issue: TransitionViaIssue,
  ): UnravelMutation[] {
    const orderedRoutePath = orderedRoutePaths[issue.segment.routeId]!
    const mutations: UnravelMutation[] = []
    const seenMutationKeys = new Set<string>()
    const endpointData: Array<[number, PortId, number]> = [
      [
        issue.segment.fromPathIndex,
        issue.segment.fromPortId,
        topology.portZ[issue.segment.toPortId],
      ],
      [
        issue.segment.toPathIndex,
        issue.segment.toPortId,
        topology.portZ[issue.segment.fromPortId],
      ],
    ]

    for (const [pathIndex, portId, targetZ] of endpointData) {
      if (!this.isInternalPathIndex(orderedRoutePath, pathIndex)) {
        continue
      }

      for (const altPortId of this.getLayerVariantsForPort(portId)) {
        if (topology.portZ[altPortId] !== targetZ) {
          continue
        }

        const mutationKey = [issue.segment.routeId, pathIndex, altPortId].join(":")
        if (seenMutationKeys.has(mutationKey)) {
          continue
        }
        seenMutationKeys.add(mutationKey)

        mutations.push({
          type: "change-layer",
          label: `via-r${issue.segment.routeId}-p${pathIndex}-z${targetZ}-region-${issue.regionId}`,
          rootRegionId: issue.regionId,
          affectedRegionIds: getRegionIdsWithinHops(topology, [issue.regionId], 1),
          substitutions: [
            {
              routeId: issue.segment.routeId,
              pathIndex,
              newPortId: altPortId,
            },
          ],
        })
      }
    }

    return mutations
  }

  getMutationsForIssue(
    topology: TinyHyperGraphTopology,
    orderedRoutePaths: OrderedRoutePath[],
    issue: UnravelIssue,
  ) {
    if (issue.type === "same-layer-crossing") {
      return this.getMutationsForSameLayerCrossingIssue(
        topology,
        orderedRoutePaths,
        issue,
      )
    }

    return this.getMutationsForTransitionViaIssue(topology, orderedRoutePaths, issue)
  }

  applyMutationToSerializedGraph(
    serializedHyperGraph: SerializedHyperGraph,
    mutation: UnravelMutation,
  ) {
    const solvedRoutes = (serializedHyperGraph.solvedRoutes ?? []).map((solvedRoute) => ({
      ...solvedRoute,
      path: solvedRoute.path.map((candidate) => ({ ...candidate })),
    }))

    const setRoutePortId = (
      routeId: RouteId,
      pathIndex: number,
      newPortId: PortId,
    ) => {
      const solvedRoute = solvedRoutes[routeId]
      const pathCandidate = solvedRoute?.path?.[pathIndex]
      if (!solvedRoute || !pathCandidate) {
        throw new Error(
          `Mutation references missing route/path routeId=${routeId} pathIndex=${pathIndex}`,
        )
      }

      pathCandidate.portId = this.serializedPortIdByPortId[newPortId]!
    }

    if (mutation.type === "swap-boundary-ports") {
      setRoutePortId(mutation.routeIdA, mutation.pathIndexA, mutation.newPortIdA)
      setRoutePortId(mutation.routeIdB, mutation.pathIndexB, mutation.newPortIdB)
    } else {
      for (const substitution of mutation.substitutions) {
        setRoutePortId(
          substitution.routeId,
          substitution.pathIndex,
          substitution.newPortId,
        )
      }
    }

    solvedRoutes.forEach((solvedRoute) => {
      solvedRoute.path.forEach((candidate, pathIndex) => {
        candidate.lastPortId =
          pathIndex > 0 ? solvedRoute.path[pathIndex - 1]!.portId : undefined
      })
    })

    return {
      ...serializedHyperGraph,
      solvedRoutes,
    }
  }

  evaluateMutation(
    baseState: UnravelSearchState,
    mutation: UnravelMutation,
  ): {
    outputGraph: SerializedHyperGraph
    summary: RegionCostSummary
    nextRootRegionIds: RegionId[]
    mutationSummary: MutationSummary
  } | null {
    const applyStartTime = performance.now()
    const mutatedSerializedHyperGraph = this.applyMutationToSerializedGraph(
      baseState.serializedHyperGraph,
      mutation,
    )
    this.totalMutationApplyMs += performance.now() - applyStartTime

    const { topology, problem, solution } = loadSerializedHyperGraph(
      mutatedSerializedHyperGraph,
    )
    const mutableRegionIds = getRegionIdsWithinHops(
      topology,
      [mutation.rootRegionId],
      this.MUTABLE_HOPS,
    )
    const sectionRegionIds = getAdjacentRegionIds(topology, mutableRegionIds)
    const portSectionMask = normalizePortSectionMaskToContiguousRouteSpans(
      topology,
      problem,
      solution,
      createPortSectionMaskForRegionIds(topology, sectionRegionIds),
    )
    const candidateProblem = createProblemWithPortSectionMask(
      problem,
      portSectionMask,
    )

    const activeRouteIds = getActiveSectionRouteIds(
      topology,
      candidateProblem,
      solution,
    )
    if (activeRouteIds.length === 0) {
      return null
    }

    const mutationSolveStartTime = performance.now()
    const sectionSolver = new TinyHyperGraphSectionSolver(
      topology,
      candidateProblem,
      solution,
      this.sectionSolverOptions,
    )
    sectionSolver.solve()
    this.totalMutationSolveMs += performance.now() - mutationSolveStartTime

    if (sectionSolver.failed || !sectionSolver.solved) {
      return null
    }

    const replayStartTime = performance.now()
    let outputGraph: SerializedHyperGraph
    let candidateSummary: RegionCostSummary
    try {
      outputGraph = sectionSolver.getOutput()
      candidateSummary = this.getSerializedOutputSummary(outputGraph)
    } catch {
      return null
    }
    this.totalMutationReplayMs += performance.now() - replayStartTime

    return {
      outputGraph,
      summary: candidateSummary,
      nextRootRegionIds: mutation.affectedRegionIds,
      mutationSummary: {
        label: mutation.label,
        type: mutation.type,
        rootRegionId: mutation.rootRegionId,
        fromMaxRegionCost: baseState.summary.maxRegionCost,
        toMaxRegionCost: candidateSummary.maxRegionCost,
        affectedRegionIds: mutation.affectedRegionIds,
      },
    }
  }

  prepareStateExpansion(searchState: UnravelSearchState) {
    const issueScanStartTime = performance.now()
    const { topology, problem, solution } = loadSerializedHyperGraph(
      searchState.serializedHyperGraph,
    )
    const solvedSectionSolver = new TinyHyperGraphSectionSolver(
      topology,
      problem,
      solution,
      this.sectionSolverOptions,
    )
    const solvedSolver = solvedSectionSolver.baselineSolver
    solvedSolver.iterations = 1
    let orderedRoutePaths: OrderedRoutePath[]
    let segmentsByRegion: Map<RegionId, OrderedRouteSegment[]>
    try {
      orderedRoutePaths = this.getOrderedRoutePaths(topology, problem, solution)
      segmentsByRegion = this.getSegmentsByRegion(orderedRoutePaths)
    } catch {
      return
    }
    const rootRegionIds = this.getHotRootRegionIds(
      solvedSolver,
      searchState.nextRootRegionIds,
    )
    this.totalIssueScanMs += performance.now() - issueScanStartTime

    const issues: UnravelIssue[] = []
    const pendingMutations: PendingUnravelMutation[] = []
    const seenMutationKeys = new Set<string>()

    for (const rootRegionId of rootRegionIds) {
      const issuesForRoot = this.getIssuesForRootRegion(
        topology,
        problem,
        solvedSolver,
        segmentsByRegion,
        rootRegionId,
      )
      issues.push(...issuesForRoot)

      for (const issue of issuesForRoot) {
        const mutations = this.getMutationsForIssue(topology, orderedRoutePaths, issue)

        for (const mutation of mutations) {
          const mutationKey = JSON.stringify(mutation)
          if (seenMutationKeys.has(mutationKey)) {
            this.cacheHitCount += 1
            continue
          }
          seenMutationKeys.add(mutationKey)
          this.generatedMutationCount += 1
          pendingMutations.push({ issue, mutation })
        }
      }
    }

    const highlightedRootRegionId = rootRegionIds[0]
    this.activeExpansion = {
      searchState,
      topology,
      problem,
      solution,
      solver: solvedSolver,
      rootRegionIds,
      issues,
      pendingMutations,
      candidateEvaluations: [],
      highlightedRootRegionId,
      sectionPortMask:
        highlightedRootRegionId !== undefined
          ? this.createSectionPortMaskForRootRegion(
              topology,
              problem,
              solution,
              highlightedRootRegionId,
            )
          : undefined,
      committed: false,
    }
  }

  evaluateNextPendingMutation(activeExpansion: ActiveExpansionState) {
    const pendingMutation = activeExpansion.pendingMutations.shift()
    if (!pendingMutation) {
      return
    }

    activeExpansion.lastEvaluatedMutation = pendingMutation
    activeExpansion.highlightedRootRegionId =
      pendingMutation.mutation.rootRegionId
    activeExpansion.sectionPortMask = this.createSectionPortMaskForRootRegion(
      activeExpansion.topology,
      activeExpansion.problem,
      activeExpansion.solution,
      pendingMutation.mutation.rootRegionId,
    )

    this.attemptedMutationCount += 1
    const evaluation = this.evaluateMutation(
      activeExpansion.searchState,
      pendingMutation.mutation,
    )
    activeExpansion.lastEvaluatedAccepted = Boolean(evaluation)
    if (!evaluation) {
      return
    }

    activeExpansion.candidateEvaluations.push({
      ...evaluation,
      priority:
        evaluation.summary.maxRegionCost +
        (activeExpansion.searchState.depth + 1) * this.MUTATION_DEPTH_PENALTY,
      pendingMutation,
    })
  }

  commitActiveExpansion(activeExpansion: ActiveExpansionState) {
    activeExpansion.candidateEvaluations
      .sort((left, right) =>
        compareRegionCostSummaries(left.summary, right.summary),
      )
      .slice(0, this.MAX_ENQUEUED_MUTATIONS_PER_STATE)
      .forEach((candidateEvaluation) => {
        const mutationPath = [
          ...activeExpansion.searchState.mutationPath,
          candidateEvaluation.mutationSummary,
        ]
        const graphFingerprint = createGraphFingerprint(
          candidateEvaluation.outputGraph,
        )
        const roundedCandidateCost = roundMutationCost(
          candidateEvaluation.summary.maxRegionCost,
        )
        const seenBestCost = this.bestCostByFingerprint.get(graphFingerprint)

        if (
          seenBestCost !== undefined &&
          seenBestCost <=
            roundedCandidateCost + this.IMPROVEMENT_EPSILON
        ) {
          this.cacheHitCount += 1
          return
        }

        this.bestCostByFingerprint.set(graphFingerprint, roundedCandidateCost)
        this.searchQueue.queue({
          serializedHyperGraph: candidateEvaluation.outputGraph,
          summary: candidateEvaluation.summary,
          depth: mutationPath.length,
          priority: candidateEvaluation.priority,
          mutationPath,
          nextRootRegionIds: candidateEvaluation.nextRootRegionIds,
        })
        this.enqueuedStateCount += 1
        this.acceptedMutationCount += 1

        if (
          compareRegionCostSummaries(
            candidateEvaluation.summary,
            this.bestSummary,
          ) < 0
        ) {
          this.bestSerializedHyperGraph = candidateEvaluation.outputGraph
          this.bestReplaySolver = undefined
          this.bestSummary = candidateEvaluation.summary
          this.bestMutationPath = mutationPath
        }
      })
    activeExpansion.committed = true
  }

  updateLiveStats(phase: string) {
    const activeExpansion = this.activeExpansion
    const sectionPortCount = activeExpansion?.sectionPortMask
      ? activeExpansion.sectionPortMask.reduce(
          (count, inSection) => count + Number(inSection === 1),
          0,
        )
      : 0

    this.stats = {
      ...this.stats,
      searchPhase: phase,
      currentMaxRegionCost:
        activeExpansion?.searchState.summary.maxRegionCost ??
        this.bestSummary.maxRegionCost,
      currentTotalRegionCost:
        activeExpansion?.searchState.summary.totalRegionCost ??
        this.bestSummary.totalRegionCost,
      currentMutationDepth:
        activeExpansion?.searchState.depth ?? this.bestMutationPath.length,
      currentMutationPathLabels: activeExpansion
        ? activeExpansion.searchState.mutationPath.map((mutation) => mutation.label)
        : this.bestMutationPath.map((mutation) => mutation.label),
      activeRootRegionIds: activeExpansion?.rootRegionIds ?? [],
      activeRootRegionId: activeExpansion?.highlightedRootRegionId ?? null,
      activeIssueCount: activeExpansion?.issues.length ?? 0,
      pendingMutationCount: activeExpansion?.pendingMutations.length ?? 0,
      currentSectionPortCount: sectionPortCount,
      currentCandidateEvaluationCount:
        activeExpansion?.candidateEvaluations.length ?? 0,
      lastEvaluatedMutationLabel:
        activeExpansion?.lastEvaluatedMutation?.mutation.label ?? null,
      lastEvaluatedMutationAccepted:
        activeExpansion?.lastEvaluatedAccepted ?? null,
      searchStatesExpanded: this.expandedStateCount,
      searchStatesQueued: this.enqueuedStateCount,
      searchStatesRemaining: this.searchQueue.length,
      generatedCandidateCount: this.generatedMutationCount,
      attemptedCandidateCount: this.attemptedMutationCount,
      successfulMutationCount: this.acceptedMutationCount,
      finalMaxRegionCost: this.bestSummary.maxRegionCost,
      finalTotalRegionCost: this.bestSummary.totalRegionCost,
      delta:
        this.baselineOutputSummary.maxRegionCost - this.bestSummary.maxRegionCost,
    }
  }

  finalizeSearch() {
    this.stats = {
      ...this.stats,
      baselineMaxRegionCost: this.baselineOutputSummary.maxRegionCost,
      baselineTotalRegionCost: this.baselineOutputSummary.totalRegionCost,
      finalMaxRegionCost: this.bestSummary.maxRegionCost,
      finalTotalRegionCost: this.bestSummary.totalRegionCost,
      delta: this.baselineOutputSummary.maxRegionCost - this.bestSummary.maxRegionCost,
      optimized:
        compareRegionCostSummaries(this.bestSummary, this.baselineOutputSummary) < 0,
      mutationDepth: this.bestMutationPath.length,
      mutationPathLabels: this.bestMutationPath.map((mutation) => mutation.label),
      mutationPathTypes: this.bestMutationPath.map((mutation) => mutation.type),
      mutationPathFamilies: this.bestMutationPath.map((mutation) => mutation.type),
      searchStatesExpanded: this.expandedStateCount,
      searchStatesQueued: this.enqueuedStateCount,
      searchStatesRemaining: this.searchQueue.length,
      searchGraphCacheSize: this.bestCostByFingerprint.size,
      searchCacheHits: this.cacheHitCount,
      generatedIssueCount: this.generatedIssueCount,
      generatedCandidateCount: this.generatedMutationCount,
      attemptedCandidateCount: this.attemptedMutationCount,
      successfulMutationCount: this.acceptedMutationCount,
      candidateEligibilityMs: 0,
      candidateInitMs: this.totalMutationApplyMs,
      candidateSolveMs: this.totalMutationSolveMs,
      candidateReplayScoreMs: this.totalMutationReplayMs,
      issueScanMs: this.totalIssueScanMs,
      mutationApplyMs: this.totalMutationApplyMs,
      searchMs: performance.now() - this.searchStartTime,
    }
    this.solved = true
  }

  override _step() {
    if (this.activeExpansion) {
      if (!this.activeExpansion.committed) {
        if (this.activeExpansion.pendingMutations.length > 0) {
          this.evaluateNextPendingMutation(this.activeExpansion)
          this.updateLiveStats("evaluating-mutation")
          return
        }

        this.commitActiveExpansion(this.activeExpansion)
        this.updateLiveStats("committing-state")
        return
      }

      this.activeExpansion = undefined
    }

    if (
      this.searchQueue.length === 0 ||
      this.expandedStateCount >= this.MAX_SEARCH_STATES
    ) {
      this.finalizeSearch()
      return
    }

    const nextState = this.searchQueue.dequeue()
    if (!nextState) {
      this.finalizeSearch()
      return
    }

    this.expandedStateCount += 1
    if (nextState.depth >= this.MAX_MUTATION_DEPTH) {
      this.updateLiveStats("depth-limit")
      return
    }

    this.prepareStateExpansion(nextState)
    this.updateLiveStats("prepared-state")
  }

  getSolvedSolver(): TinyHyperGraphSolver {
    if (!this.solved || this.failed) {
      throw new Error(
        "TinyHyperGraphUnravelSolver does not have a solved output yet",
      )
    }

    if (!this.bestReplaySolver) {
      const replay = loadSerializedHyperGraph(this.bestSerializedHyperGraph)
      const replayedSectionSolver = new TinyHyperGraphSectionSolver(
        replay.topology,
        replay.problem,
        replay.solution,
      )

      this.bestReplaySolver = replayedSectionSolver.baselineSolver
    }

    return this.bestReplaySolver
  }

  override visualize(): GraphicsObject {
    if (this.activeExpansion) {
      const graphics = visualizeTinyGraph(this.activeExpansion.solver, {
        highlightSectionMask: Boolean(this.activeExpansion.sectionPortMask),
        sectionPortMask: this.activeExpansion.sectionPortMask,
        showIdlePortRegionConnectors: false,
        showInitialRouteHints: false,
      }) as GraphicsObject & {
        points?: any[]
        lines?: any[]
        circles?: any[]
        rects?: any[]
      }

      graphics.points ??= []
      graphics.lines ??= []
      graphics.circles ??= []
      graphics.rects ??= []

      for (const rootRegionId of this.activeExpansion.rootRegionIds) {
        graphics.circles.push({
          center: this.getRegionCenter(this.activeExpansion.topology, rootRegionId),
          radius:
            this.getRegionHighlightRadius(
              this.activeExpansion.topology,
              rootRegionId,
            ) * 0.28,
          fill:
            rootRegionId === this.activeExpansion.highlightedRootRegionId
              ? "rgba(239, 68, 68, 0.18)"
              : "rgba(245, 158, 11, 0.12)",
          stroke:
            rootRegionId === this.activeExpansion.highlightedRootRegionId
              ? "rgba(239, 68, 68, 0.95)"
              : "rgba(245, 158, 11, 0.95)",
          label: [
            rootRegionId === this.activeExpansion.highlightedRootRegionId
              ? "active root region"
              : "candidate root region",
            `region-${rootRegionId}`,
            `cost=${(
              this.activeExpansion.solver.state.regionIntersectionCaches[rootRegionId]
                ?.existingRegionCost ?? 0
            ).toFixed(3)}`,
          ].join("\n"),
        })
      }

      const highlightedIssues = this.activeExpansion.issues
        .filter(
          (issue) =>
            issue.regionId === this.activeExpansion?.highlightedRootRegionId,
        )
        .slice(0, 12)

      for (const issue of highlightedIssues) {
        if (issue.type === "transition-via") {
          for (const portId of [issue.segment.fromPortId, issue.segment.toPortId]) {
            graphics.circles.push({
              center: this.getPortCircleCenter(this.activeExpansion.topology, portId),
              radius: 0.08,
              fill: "rgba(239, 68, 68, 0.12)",
              stroke: "rgba(239, 68, 68, 0.95)",
              label: [
                "transition via",
                `region-${issue.regionId}`,
                `route=${this.getRouteLabel(
                  this.activeExpansion.problem,
                  issue.segment.routeId,
                )}`,
                `port=${this.serializedPortIdByPortId[portId]}`,
                `z=${this.activeExpansion.topology.portZ[portId]}`,
              ].join("\n"),
            })
          }
          continue
        }

        for (const segment of [issue.segmentA, issue.segmentB]) {
          graphics.lines.push({
            points: [
              this.getPortRenderPoint(this.activeExpansion.topology, segment.fromPortId),
              this.getPortRenderPoint(this.activeExpansion.topology, segment.toPortId),
            ],
            strokeColor: "rgba(239, 68, 68, 0.5)",
            strokeWidth: 0.03,
            label: [
              "same-layer crossing",
              `region-${issue.regionId}`,
              `route=${this.getRouteLabel(
                this.activeExpansion.problem,
                segment.routeId,
              )}`,
            ].join("\n"),
          })
        }
      }

      const lastMutation = this.activeExpansion.lastEvaluatedMutation?.mutation
      if (lastMutation) {
        const mutationStroke = this.activeExpansion.lastEvaluatedAccepted
          ? "rgba(16, 185, 129, 0.95)"
          : "rgba(59, 130, 246, 0.95)"
        const mutationFill = this.activeExpansion.lastEvaluatedAccepted
          ? "rgba(16, 185, 129, 0.16)"
          : "rgba(59, 130, 246, 0.16)"

        if (lastMutation.type === "swap-boundary-ports") {
          for (const portId of [lastMutation.newPortIdA, lastMutation.newPortIdB]) {
            graphics.circles.push({
              center: this.getPortCircleCenter(this.activeExpansion.topology, portId),
              radius: 0.085,
              fill: mutationFill,
              stroke: mutationStroke,
              label: [
                this.activeExpansion.lastEvaluatedAccepted
                  ? "accepted swap"
                  : "rejected swap",
                lastMutation.label,
                `port=${this.serializedPortIdByPortId[portId]}`,
                `z=${this.activeExpansion.topology.portZ[portId]}`,
              ].join("\n"),
            })
          }
        } else {
          for (const substitution of lastMutation.substitutions) {
            graphics.circles.push({
              center: this.getPortCircleCenter(
                this.activeExpansion.topology,
                substitution.newPortId,
              ),
              radius: 0.085,
              fill: mutationFill,
              stroke: mutationStroke,
              label: [
                this.activeExpansion.lastEvaluatedAccepted
                  ? "accepted layer change"
                  : "rejected layer change",
                lastMutation.label,
                `route=${this.getRouteLabel(
                  this.activeExpansion.problem,
                  substitution.routeId,
                )}`,
                `port=${this.serializedPortIdByPortId[substitution.newPortId]}`,
                `z=${this.activeExpansion.topology.portZ[substitution.newPortId]}`,
              ].join("\n"),
            })
          }
        }
      }

      const sectionPortCount = this.activeExpansion.sectionPortMask
        ? this.activeExpansion.sectionPortMask.reduce(
            (count, inSection) => count + Number(inSection === 1),
            0,
          )
        : 0

      graphics.title = [
        "Unravel Solver",
        `iter=${this.iterations}`,
        `phase=${this.activeExpansion.committed ? "committed" : "expanding"}`,
        `depth=${this.activeExpansion.searchState.depth}`,
        `queue=${this.searchQueue.length}`,
        `issues=${this.activeExpansion.issues.length}`,
        `generated=${this.generatedMutationCount}`,
        `attempted=${this.attemptedMutationCount}`,
        `accepted=${this.acceptedMutationCount}`,
        `pendingMutations=${this.activeExpansion.pendingMutations.length}`,
        this.activeExpansion.sectionPortMask
          ? `sectionPorts=${sectionPortCount}`
          : undefined,
        this.activeExpansion.lastEvaluatedMutation
          ? this.activeExpansion.lastEvaluatedAccepted
            ? "lastMutation=accepted"
            : "lastMutation=rejected"
          : "lastMutation=none",
      ]
        .filter(Boolean)
        .join(" | ")

      return graphics
    }

    if (!this.solved || this.failed) {
      return this.baselineSolver.visualize()
    }

    const bestRootRegionId =
      this.bestMutationPath[this.bestMutationPath.length - 1]?.rootRegionId
    const replay = loadSerializedHyperGraph(this.bestSerializedHyperGraph)
    const solver = this.createVisualizationSolver(this.bestSerializedHyperGraph)
    const sectionPortMask =
      bestRootRegionId !== undefined
        ? this.createSectionPortMaskForRootRegion(
            replay.topology,
            replay.problem,
            replay.solution,
            bestRootRegionId,
          )
        : undefined
    const graphics = visualizeTinyGraph(solver, {
      highlightSectionMask: Boolean(sectionPortMask),
      sectionPortMask,
      showIdlePortRegionConnectors: false,
      showInitialRouteHints: false,
    })
    graphics.title = [
      "Unravel Solver",
      `iter=${this.iterations}`,
      "solved",
      `depth=${this.bestMutationPath.length}`,
      `generated=${this.generatedMutationCount}`,
      `attempted=${this.attemptedMutationCount}`,
      `accepted=${this.acceptedMutationCount}`,
      `expanded=${this.expandedStateCount}`,
      `finalMax=${this.bestSummary.maxRegionCost.toFixed(3)}`,
    ].join(" | ")
    return graphics
  }

  override getOutput() {
    if (!this.solved || this.failed) {
      throw new Error(
        "TinyHyperGraphUnravelSolver does not have a solved output yet",
      )
    }

    return this.bestSerializedHyperGraph
  }
}
