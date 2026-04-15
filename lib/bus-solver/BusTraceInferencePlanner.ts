import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "../core"
import type { PortId, RegionId, RouteId } from "../types"
import {
  ensurePortOwnership,
  getGuidePortIds,
  getPolylineLength,
  getTracePreviewLength,
  isPortIncidentToRegion,
} from "./busPathHelpers"
import type { BusTraceOrder } from "./deriveBusTraceOrder"
import {
  getDistanceFromPortToPolyline,
  getPortDistance,
  getPortProgressAlongPolyline,
} from "./geometry"
import {
  BUS_CANDIDATE_EPSILON,
  type BoundaryStep,
  type BusCenterCandidate,
  type TracePreview,
  type TraceSegment,
} from "./busSolverTypes"

interface AlongsideTraceSearchNode {
  portId: PortId
  regionId: RegionId
  segments: TraceSegment[]
  guideProgress: number
  travelCost: number
  priority: number
  visitedPortIds: Set<PortId>
  visitedStateKeys: Set<string>
}

interface AlongsideTraceSearchOption {
  segments: TraceSegment[]
  terminalPortId: PortId
  terminalRegionId: RegionId
  searchScore: number
}

interface BuildPrefixTracePreviewFn {
  (
    traceIndex: number,
    sharedStepCount: number,
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ): TracePreview | undefined
}

interface BusTraceInferencePlannerOptions {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  busTraceOrder: BusTraceOrder
  centerTraceIndex: number
  tracePitch: number
  DISTANCE_TO_COST: number
  BUS_MAX_REMAINDER_STEPS: number
  BUS_REMAINDER_GUIDE_WEIGHT: number
  BUS_REMAINDER_GOAL_WEIGHT: number
  BUS_REMAINDER_SIDE_WEIGHT: number
  TRACE_ALONGSIDE_SEARCH_BRANCH_LIMIT: number
  TRACE_ALONGSIDE_SEARCH_BEAM_WIDTH: number
  TRACE_ALONGSIDE_SEARCH_OPTION_LIMIT: number
  TRACE_ALONGSIDE_LANE_WEIGHT: number
  TRACE_ALONGSIDE_REGRESSION_WEIGHT: number
  buildPrefixTracePreview: BuildPrefixTracePreviewFn
  getStartingNextRegionId: (
    routeId: RouteId,
    startPortId: PortId,
  ) => RegionId | undefined
  isRegionReservedForDifferentBusNet: (
    currentNetId: number,
    regionId: RegionId,
  ) => boolean
  getTraceSidePenalty: (traceIndex: number, portId: PortId) => number
  getTraceLanePenalty: (traceIndex: number, portId: PortId) => number
  getRouteHeuristic: (routeId: RouteId, portId: PortId) => number
}

export class BusTraceInferencePlanner {
  constructor(private readonly options: BusTraceInferencePlannerOptions) {}

  buildBestPrefixTracePreview(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    maxSharedStepCount: number,
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    const centerPortIds = centerPath.map(
      (pathCandidate) => pathCandidate.portId,
    )
    const targetGuideProgress = getPolylineLength(
      this.options.topology,
      centerPortIds,
    )
    const minSharedStepCount = 0
    let bestExactPreview: TracePreview | undefined
    let bestScore = Number.POSITIVE_INFINITY
    let bestSharedStepCount = -1

    for (
      let sharedStepCount = maxSharedStepCount;
      sharedStepCount >= minSharedStepCount;
      sharedStepCount--
    ) {
      const prefixPreview = this.options.buildPrefixTracePreview(
        traceIndex,
        sharedStepCount,
        boundarySteps,
        boundaryPortIdsByStep,
        usedPortOwners,
      )
      if (!prefixPreview) {
        continue
      }

      const terminalGuideProgress = getPortProgressAlongPolyline(
        this.options.topology,
        prefixPreview.terminalPortId,
        centerPortIds,
      )
      const shortfallPenalty = Math.max(
        0,
        targetGuideProgress - terminalGuideProgress,
      )
      const overshootPenalty = Math.max(
        0,
        terminalGuideProgress - targetGuideProgress,
      )
      const lagPenalty =
        (maxSharedStepCount - sharedStepCount) * this.options.tracePitch
      const score = shortfallPenalty * 2 + overshootPenalty * 4 + lagPenalty

      if (
        !bestExactPreview ||
        score < bestScore - BUS_CANDIDATE_EPSILON ||
        (Math.abs(score - bestScore) <= BUS_CANDIDATE_EPSILON &&
          sharedStepCount > bestSharedStepCount)
      ) {
        bestExactPreview = {
          ...prefixPreview,
          previewCost: score,
        }
        bestScore = score
        bestSharedStepCount = sharedStepCount
      }
    }

    if (!bestExactPreview) {
      return undefined
    }

    if (bestSharedStepCount > 0) {
      return bestExactPreview
    }

    const searchPrefixPreview = this.options.buildPrefixTracePreview(
      traceIndex,
      bestSharedStepCount,
      boundarySteps,
      boundaryPortIdsByStep,
      usedPortOwners,
    )
    if (
      !searchPrefixPreview ||
      searchPrefixPreview.terminalRegionId === undefined
    ) {
      return bestExactPreview
    }

    const guidePortIds = getGuidePortIds(centerPath, bestSharedStepCount)
    const alongsideOptions = this.searchTraceAlongsideOptions({
      traceIndex,
      startPortId: searchPrefixPreview.terminalPortId,
      startRegionId: searchPrefixPreview.terminalRegionId,
      guidePortIds,
      usedPortOwners,
      targetGuideProgress: getPolylineLength(
        this.options.topology,
        guidePortIds,
      ),
      maxSteps: this.getPartialTraceSearchMaxSteps(maxSharedStepCount),
      maxOptions: 1,
      initialVisitedPortIds:
        this.getTracePreviewVisitedPortIds(searchPrefixPreview),
      initialVisitedStateKeys:
        this.getTracePreviewSearchStartStateKeys(searchPrefixPreview),
    })
    const bestAlongsideOption = alongsideOptions[0]

    if (!bestAlongsideOption) {
      return bestExactPreview
    }

    const searchScore =
      bestAlongsideOption.searchScore +
      maxSharedStepCount * this.options.tracePitch
    if (
      (bestExactPreview.previewCost ?? Number.POSITIVE_INFINITY) <= searchScore
    ) {
      return bestExactPreview
    }

    return {
      ...searchPrefixPreview,
      segments: [
        ...searchPrefixPreview.segments,
        ...bestAlongsideOption.segments,
      ],
      terminalPortId: bestAlongsideOption.terminalPortId,
      terminalRegionId: bestAlongsideOption.terminalRegionId,
      previewCost: searchScore,
    }
  }

  buildCompleteTracePreviewOptions(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    const routeId = this.options.busTraceOrder.traces[traceIndex]!.routeId
    const previewOptions: TracePreview[] = []
    const previewOptionKeys = new Set<string>()

    for (
      let sharedStepCount = boundarySteps.length;
      sharedStepCount >= 0;
      sharedStepCount--
    ) {
      const prefixPreview = this.options.buildPrefixTracePreview(
        traceIndex,
        sharedStepCount,
        boundarySteps,
        boundaryPortIdsByStep,
        usedPortOwners,
      )
      if (!prefixPreview) {
        continue
      }

      const currentRegionId =
        sharedStepCount === 0
          ? this.options.getStartingNextRegionId(
              routeId,
              this.options.problem.routeStartPort[routeId]!,
            )
          : boundarySteps[sharedStepCount - 1]!.toRegionId
      const currentPortId =
        sharedStepCount === 0
          ? this.options.problem.routeStartPort[routeId]!
          : boundaryPortIdsByStep[sharedStepCount - 1]?.[traceIndex]

      if (currentRegionId === undefined || currentPortId === undefined) {
        continue
      }

      const greedyRemainderSegments = this.inferEndRemainderSegmentsGreedy(
        traceIndex,
        currentPortId,
        currentRegionId,
        centerPath,
        sharedStepCount,
        usedPortOwners,
      )

      if (greedyRemainderSegments) {
        const greedySegments = [
          ...prefixPreview.segments,
          ...greedyRemainderSegments,
        ]
        const greedyPreviewKey = this.getTracePreviewPathKey(
          greedySegments,
          this.options.problem.routeEndPort[routeId]!,
          undefined,
        )

        if (!previewOptionKeys.has(greedyPreviewKey)) {
          previewOptionKeys.add(greedyPreviewKey)
          previewOptions.push({
            traceIndex,
            routeId,
            segments: greedySegments,
            complete: true,
            terminalPortId: this.options.problem.routeEndPort[routeId]!,
            previewCost: 0,
          })
        }
      }

      if (sharedStepCount === 0 || !greedyRemainderSegments) {
        const remainingBoundaryStepCount = Math.max(
          boundarySteps.length - sharedStepCount,
          0,
        )
        const guidePortIds = getGuidePortIds(centerPath, sharedStepCount)
        const completionOptions = this.searchTraceAlongsideOptions({
          traceIndex,
          startPortId: prefixPreview.terminalPortId,
          startRegionId: prefixPreview.terminalRegionId!,
          guidePortIds,
          usedPortOwners,
          goalPortId: this.options.problem.routeEndPort[routeId]!,
          maxSteps: this.getCompleteTraceSearchMaxSteps(
            remainingBoundaryStepCount,
          ),
          maxOptions: this.options.TRACE_ALONGSIDE_SEARCH_OPTION_LIMIT,
          initialVisitedPortIds:
            this.getTracePreviewVisitedPortIds(prefixPreview),
          initialVisitedStateKeys:
            this.getTracePreviewSearchStartStateKeys(prefixPreview),
        })

        for (const completionOption of completionOptions) {
          const combinedSegments = [
            ...prefixPreview.segments,
            ...completionOption.segments,
          ]
          const previewKey = this.getTracePreviewPathKey(
            combinedSegments,
            this.options.problem.routeEndPort[routeId]!,
            undefined,
          )

          if (previewOptionKeys.has(previewKey)) {
            continue
          }

          previewOptionKeys.add(previewKey)
          previewOptions.push({
            traceIndex,
            routeId,
            segments: combinedSegments,
            complete: true,
            terminalPortId: this.options.problem.routeEndPort[routeId]!,
            previewCost: completionOption.searchScore,
          })
        }
      }
    }

    return previewOptions
      .sort(
        (left, right) =>
          (left.previewCost ?? 0) - (right.previewCost ?? 0) ||
          getTracePreviewLength(this.options.topology, left) -
            getTracePreviewLength(this.options.topology, right),
      )
      .slice(0, this.options.TRACE_ALONGSIDE_SEARCH_OPTION_LIMIT)
  }

  private inferEndRemainderSegmentsGreedy(
    traceIndex: number,
    startPortId: PortId,
    startRegionId: RegionId,
    centerPath: BusCenterCandidate[],
    sharedStepCount: number,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ): TraceSegment[] | undefined {
    const routeId = this.options.busTraceOrder.traces[traceIndex]!.routeId
    const endPortId = this.options.problem.routeEndPort[routeId]!

    if (this.options.topology.portZ[endPortId] !== 0) {
      return undefined
    }

    if (
      isPortIncidentToRegion(this.options.topology, endPortId, startRegionId)
    ) {
      if (
        ensurePortOwnership(routeId, endPortId, new Map(usedPortOwners)) &&
        startPortId !== endPortId
      ) {
        return [
          {
            regionId: startRegionId,
            fromPortId: startPortId,
            toPortId: endPortId,
          },
        ]
      }

      return []
    }

    const guidePortIds = getGuidePortIds(centerPath, sharedStepCount)
    const goalTransitRegionIds =
      this.options.topology.incidentPortRegion[endPortId]?.filter(
        (regionId) => regionId !== undefined,
      ) ?? []
    const currentNetId = this.options.problem.routeNet[routeId]!
    const localOwners = new Map(usedPortOwners)
    if (!ensurePortOwnership(routeId, startPortId, localOwners)) {
      return undefined
    }

    const visitedStates = new Set([`${startPortId}:${startRegionId}`])
    const segments: TraceSegment[] = []
    let currentPortId = startPortId
    let currentRegionId = startRegionId

    for (
      let stepIndex = 0;
      stepIndex < this.options.BUS_MAX_REMAINDER_STEPS;
      stepIndex++
    ) {
      if (
        isPortIncidentToRegion(
          this.options.topology,
          endPortId,
          currentRegionId,
        )
      ) {
        if (!ensurePortOwnership(routeId, endPortId, localOwners)) {
          return undefined
        }

        if (currentPortId !== endPortId) {
          segments.push({
            regionId: currentRegionId,
            fromPortId: currentPortId,
            toPortId: endPortId,
          })
        }

        return segments
      }

      let bestMove:
        | {
            boundaryPortId: PortId
            nextRegionId: RegionId
            score: number
          }
        | undefined

      for (const boundaryPortId of this.options.topology.regionIncidentPorts[
        currentRegionId
      ] ?? []) {
        if (
          boundaryPortId === currentPortId ||
          this.options.topology.portZ[boundaryPortId] !== 0
        ) {
          continue
        }

        const nextRegionId =
          this.options.topology.incidentPortRegion[boundaryPortId]?.[0] ===
          currentRegionId
            ? this.options.topology.incidentPortRegion[boundaryPortId]?.[1]
            : this.options.topology.incidentPortRegion[boundaryPortId]?.[0]

        if (
          nextRegionId === undefined ||
          this.options.isRegionReservedForDifferentBusNet(
            currentNetId,
            nextRegionId,
          ) ||
          visitedStates.has(`${boundaryPortId}:${nextRegionId}`)
        ) {
          continue
        }

        const owner = localOwners.get(boundaryPortId)
        if (owner !== undefined && owner !== routeId) {
          continue
        }

        const goalDistance = getPortDistance(
          this.options.topology,
          boundaryPortId,
          endPortId,
        )
        const guideDistance = getDistanceFromPortToPolyline(
          this.options.topology,
          boundaryPortId,
          guidePortIds,
        )
        const sidePenalty = this.options.getTraceSidePenalty(
          traceIndex,
          boundaryPortId,
        )
        const goalRegionBonus = goalTransitRegionIds.includes(nextRegionId)
          ? -5
          : 0
        const score =
          guideDistance * this.options.BUS_REMAINDER_GUIDE_WEIGHT +
          goalDistance * this.options.BUS_REMAINDER_GOAL_WEIGHT +
          sidePenalty * this.options.BUS_REMAINDER_SIDE_WEIGHT +
          goalRegionBonus

        if (
          !bestMove ||
          score < bestMove.score - BUS_CANDIDATE_EPSILON ||
          (Math.abs(score - bestMove.score) <= BUS_CANDIDATE_EPSILON &&
            boundaryPortId < bestMove.boundaryPortId)
        ) {
          bestMove = {
            boundaryPortId,
            nextRegionId,
            score,
          }
        }
      }

      if (!bestMove) {
        return undefined
      }

      if (!ensurePortOwnership(routeId, bestMove.boundaryPortId, localOwners)) {
        return undefined
      }

      segments.push({
        regionId: currentRegionId,
        fromPortId: currentPortId,
        toPortId: bestMove.boundaryPortId,
      })
      currentPortId = bestMove.boundaryPortId
      currentRegionId = bestMove.nextRegionId
      visitedStates.add(`${currentPortId}:${currentRegionId}`)
    }

    return undefined
  }

  private searchTraceAlongsideOptions({
    traceIndex,
    startPortId,
    startRegionId,
    guidePortIds,
    usedPortOwners,
    maxSteps,
    maxOptions,
    targetGuideProgress,
    goalPortId,
    initialVisitedPortIds = [],
    initialVisitedStateKeys = [],
  }: {
    traceIndex: number
    startPortId: PortId
    startRegionId: RegionId
    guidePortIds: readonly PortId[]
    usedPortOwners: ReadonlyMap<PortId, RouteId>
    maxSteps: number
    maxOptions: number
    targetGuideProgress?: number
    goalPortId?: PortId
    initialVisitedPortIds?: readonly PortId[]
    initialVisitedStateKeys?: readonly string[]
  }): AlongsideTraceSearchOption[] {
    const routeId = this.options.busTraceOrder.traces[traceIndex]!.routeId
    const effectiveGuidePortIds =
      guidePortIds.length > 0 ? guidePortIds : [startPortId]
    const initialGuideProgress = getPortProgressAlongPolyline(
      this.options.topology,
      startPortId,
      effectiveGuidePortIds,
    )
    const visitedPortIds = new Set<PortId>(initialVisitedPortIds)
    const visitedStateKeys = new Set(initialVisitedStateKeys)
    visitedPortIds.add(startPortId)
    visitedStateKeys.add(
      this.getTraceSearchStateKey(startPortId, startRegionId),
    )

    const initialNode: AlongsideTraceSearchNode = {
      portId: startPortId,
      regionId: startRegionId,
      segments: [],
      guideProgress: initialGuideProgress,
      travelCost: 0,
      priority:
        goalPortId === undefined
          ? this.getPartialTraceSearchPriority(
              traceIndex,
              startPortId,
              effectiveGuidePortIds,
              initialGuideProgress,
              0,
              targetGuideProgress ?? 0,
            )
          : this.getCompleteTraceSearchPriority(
              traceIndex,
              routeId,
              startPortId,
              effectiveGuidePortIds,
              0,
            ),
      visitedPortIds,
      visitedStateKeys,
    }

    const searchOptions: AlongsideTraceSearchOption[] = []
    const searchOptionKeys = new Set<string>()
    const pushOption = (option: AlongsideTraceSearchOption) => {
      const optionKey = this.getTracePreviewPathKey(
        option.segments,
        option.terminalPortId,
        option.terminalRegionId,
      )

      if (searchOptionKeys.has(optionKey)) {
        return
      }

      searchOptionKeys.add(optionKey)
      searchOptions.push(option)
    }
    const tryCompleteFromNode = (node: AlongsideTraceSearchNode) => {
      if (
        goalPortId === undefined ||
        !isPortIncidentToRegion(
          this.options.topology,
          goalPortId,
          node.regionId,
        )
      ) {
        return
      }

      const owner = usedPortOwners.get(goalPortId)
      if (owner !== undefined && owner !== routeId) {
        return
      }

      const completionSegments =
        node.portId === goalPortId
          ? node.segments
          : [
              ...node.segments,
              {
                regionId: node.regionId,
                fromPortId: node.portId,
                toPortId: goalPortId,
              },
            ]
      const completionTravelCost =
        node.travelCost +
        (node.portId === goalPortId
          ? 0
          : getPortDistance(this.options.topology, node.portId, goalPortId) *
            this.options.DISTANCE_TO_COST)

      pushOption({
        segments: completionSegments,
        terminalPortId: goalPortId,
        terminalRegionId: node.regionId,
        searchScore: this.getCompleteTraceSearchPriority(
          traceIndex,
          routeId,
          goalPortId,
          effectiveGuidePortIds,
          completionTravelCost,
        ),
      })
    }
    const tryPartialFromNode = (node: AlongsideTraceSearchNode) => {
      if (targetGuideProgress === undefined) {
        return
      }

      pushOption({
        segments: node.segments,
        terminalPortId: node.portId,
        terminalRegionId: node.regionId,
        searchScore: this.getPartialTraceSearchPriority(
          traceIndex,
          node.portId,
          effectiveGuidePortIds,
          node.guideProgress,
          node.travelCost,
          targetGuideProgress,
        ),
      })
    }

    let beam = [initialNode]
    tryCompleteFromNode(initialNode)
    tryPartialFromNode(initialNode)

    for (
      let stepIndex = 0;
      stepIndex < maxSteps && beam.length > 0;
      stepIndex++
    ) {
      const nextBeamCandidates: AlongsideTraceSearchNode[] = []

      for (const node of beam) {
        const moveCandidates: AlongsideTraceSearchNode[] = []

        for (const boundaryPortId of this.options.topology.regionIncidentPorts[
          node.regionId
        ] ?? []) {
          if (
            boundaryPortId === node.portId ||
            this.options.topology.portZ[boundaryPortId] !== 0 ||
            node.visitedPortIds.has(boundaryPortId)
          ) {
            continue
          }

          const nextRegionId = this.getOppositeRegionId(
            boundaryPortId,
            node.regionId,
          )

          if (
            nextRegionId === undefined ||
            this.options.isRegionReservedForDifferentBusNet(
              this.options.problem.routeNet[routeId]!,
              nextRegionId,
            )
          ) {
            continue
          }

          const owner = usedPortOwners.get(boundaryPortId)
          if (owner !== undefined && owner !== routeId) {
            continue
          }

          const nextStateKey = this.getTraceSearchStateKey(
            boundaryPortId,
            nextRegionId,
          )
          if (node.visitedStateKeys.has(nextStateKey)) {
            continue
          }

          const nextGuideProgress = getPortProgressAlongPolyline(
            this.options.topology,
            boundaryPortId,
            effectiveGuidePortIds,
          )
          const regressionPenalty =
            Math.max(0, node.guideProgress - nextGuideProgress) *
            this.options.TRACE_ALONGSIDE_REGRESSION_WEIGHT
          const nextTravelCost =
            node.travelCost +
            getPortDistance(
              this.options.topology,
              node.portId,
              boundaryPortId,
            ) *
              this.options.DISTANCE_TO_COST +
            regressionPenalty
          const nextVisitedPortIds = new Set(node.visitedPortIds)
          const nextVisitedStateKeys = new Set(node.visitedStateKeys)
          nextVisitedPortIds.add(boundaryPortId)
          nextVisitedStateKeys.add(nextStateKey)

          moveCandidates.push({
            portId: boundaryPortId,
            regionId: nextRegionId,
            segments: [
              ...node.segments,
              {
                regionId: node.regionId,
                fromPortId: node.portId,
                toPortId: boundaryPortId,
              },
            ],
            guideProgress: nextGuideProgress,
            travelCost: nextTravelCost,
            priority:
              goalPortId === undefined
                ? this.getPartialTraceSearchPriority(
                    traceIndex,
                    boundaryPortId,
                    effectiveGuidePortIds,
                    nextGuideProgress,
                    nextTravelCost,
                    targetGuideProgress ?? 0,
                  )
                : this.getCompleteTraceSearchPriority(
                    traceIndex,
                    routeId,
                    boundaryPortId,
                    effectiveGuidePortIds,
                    nextTravelCost,
                  ),
            visitedPortIds: nextVisitedPortIds,
            visitedStateKeys: nextVisitedStateKeys,
          })
        }

        moveCandidates
          .sort(
            (left, right) =>
              left.priority - right.priority ||
              left.portId - right.portId ||
              left.regionId - right.regionId,
          )
          .slice(0, this.options.TRACE_ALONGSIDE_SEARCH_BRANCH_LIMIT)
          .forEach((candidate) => {
            nextBeamCandidates.push(candidate)
            tryCompleteFromNode(candidate)
            tryPartialFromNode(candidate)
          })
      }

      const bestCandidateByStateKey = new Map<
        string,
        AlongsideTraceSearchNode
      >()
      for (const candidate of nextBeamCandidates) {
        const candidateStateKey = this.getTraceSearchStateKey(
          candidate.portId,
          candidate.regionId,
        )
        const existingCandidate = bestCandidateByStateKey.get(candidateStateKey)

        if (
          !existingCandidate ||
          candidate.priority <
            existingCandidate.priority - BUS_CANDIDATE_EPSILON ||
          (Math.abs(candidate.priority - existingCandidate.priority) <=
            BUS_CANDIDATE_EPSILON &&
            candidate.segments.length < existingCandidate.segments.length)
        ) {
          bestCandidateByStateKey.set(candidateStateKey, candidate)
        }
      }

      beam = [...bestCandidateByStateKey.values()]
        .sort(
          (left, right) =>
            left.priority - right.priority ||
            left.portId - right.portId ||
            left.regionId - right.regionId,
        )
        .slice(0, this.options.TRACE_ALONGSIDE_SEARCH_BEAM_WIDTH)
    }

    return searchOptions
      .sort(
        (left, right) =>
          left.searchScore - right.searchScore ||
          left.segments.length - right.segments.length,
      )
      .slice(0, maxOptions)
  }

  private getPartialTraceSearchPriority(
    traceIndex: number,
    portId: PortId,
    guidePortIds: readonly PortId[],
    guideProgress: number,
    travelCost: number,
    targetGuideProgress: number,
  ) {
    const guideDistance = getDistanceFromPortToPolyline(
      this.options.topology,
      portId,
      guidePortIds,
    )
    const lanePenalty = this.options.getTraceLanePenalty(traceIndex, portId)
    const sidePenalty = this.options.getTraceSidePenalty(traceIndex, portId)
    const shortfallPenalty = Math.max(0, targetGuideProgress - guideProgress)
    const overshootPenalty = Math.max(0, guideProgress - targetGuideProgress)

    return (
      travelCost +
      guideDistance * this.options.BUS_REMAINDER_GUIDE_WEIGHT +
      lanePenalty * this.options.TRACE_ALONGSIDE_LANE_WEIGHT +
      sidePenalty * this.options.BUS_REMAINDER_SIDE_WEIGHT +
      shortfallPenalty * 2 +
      overshootPenalty * 4
    )
  }

  private getCompleteTraceSearchPriority(
    traceIndex: number,
    routeId: RouteId,
    portId: PortId,
    guidePortIds: readonly PortId[],
    travelCost: number,
  ) {
    const guideDistance = getDistanceFromPortToPolyline(
      this.options.topology,
      portId,
      guidePortIds,
    )
    const lanePenalty = this.options.getTraceLanePenalty(traceIndex, portId)
    const sidePenalty = this.options.getTraceSidePenalty(traceIndex, portId)
    const goalHeuristic = this.options.getRouteHeuristic(routeId, portId)

    return (
      travelCost +
      guideDistance * this.options.BUS_REMAINDER_GUIDE_WEIGHT +
      lanePenalty * this.options.TRACE_ALONGSIDE_LANE_WEIGHT +
      sidePenalty * this.options.BUS_REMAINDER_SIDE_WEIGHT +
      goalHeuristic * this.options.BUS_REMAINDER_GOAL_WEIGHT
    )
  }

  private getTracePreviewSearchStartStateKeys(tracePreview: TracePreview) {
    const visitedStateKeys: string[] = []
    let currentPortId =
      this.options.problem.routeStartPort[tracePreview.routeId]!
    let currentRegionId = this.options.getStartingNextRegionId(
      tracePreview.routeId,
      currentPortId,
    )

    if (currentRegionId === undefined) {
      return visitedStateKeys
    }

    visitedStateKeys.push(
      this.getTraceSearchStateKey(currentPortId, currentRegionId),
    )

    for (const segment of tracePreview.segments) {
      currentPortId = segment.toPortId
      const nextRegionId = this.getOppositeRegionId(
        currentPortId,
        segment.regionId,
      )

      if (nextRegionId === undefined) {
        break
      }

      currentRegionId = nextRegionId
      visitedStateKeys.push(
        this.getTraceSearchStateKey(currentPortId, currentRegionId),
      )
    }

    return visitedStateKeys
  }

  private getTracePreviewVisitedPortIds(tracePreview: TracePreview) {
    const visitedPortIds = new Set<PortId>([
      this.options.problem.routeStartPort[tracePreview.routeId]!,
    ])

    for (const segment of tracePreview.segments) {
      visitedPortIds.add(segment.fromPortId)
      visitedPortIds.add(segment.toPortId)
    }

    return [...visitedPortIds]
  }

  private getTraceSearchStateKey(portId: PortId, regionId: RegionId) {
    return `${portId}:${regionId}`
  }

  private getTracePreviewPathKey(
    segments: readonly TraceSegment[],
    terminalPortId: PortId,
    terminalRegionId?: RegionId,
  ) {
    return [
      ...segments.map(
        (segment) =>
          `${segment.regionId}:${segment.fromPortId}->${segment.toPortId}`,
      ),
      `end:${terminalPortId}:${terminalRegionId ?? -1}`,
    ].join("|")
  }

  private getOppositeRegionId(portId: PortId, regionId: RegionId) {
    const incidentRegionIds =
      this.options.topology.incidentPortRegion[portId] ?? []
    return incidentRegionIds[0] === regionId
      ? incidentRegionIds[1]
      : incidentRegionIds[0]
  }

  private getPartialTraceSearchMaxSteps(remainingBoundaryStepCount: number) {
    return Math.max(0, Math.min(Math.max(1, remainingBoundaryStepCount + 1), 4))
  }

  private getCompleteTraceSearchMaxSteps(remainingBoundaryStepCount: number) {
    return Math.max(
      0,
      Math.min(
        Math.max(
          2,
          remainingBoundaryStepCount * 2 + this.options.BUS_MAX_REMAINDER_STEPS,
        ),
        this.options.BUS_MAX_REMAINDER_STEPS * 3,
      ),
    )
  }
}
