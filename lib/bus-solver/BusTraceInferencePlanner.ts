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
import { getDistanceFromPortToPolyline, getPortDistance } from "./geometry"
import {
  BUS_CANDIDATE_EPSILON,
  type BoundaryStep,
  type BusCenterCandidate,
  type TracePreview,
  type TraceSegment,
} from "./busSolverTypes"

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
  isTracePreviewUsable: (
    tracePreview: TracePreview,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) => boolean
  isTraceSegmentUsable: (
    routeId: RouteId,
    segment: TraceSegment,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) => boolean
  getTraceSidePenalty: (traceIndex: number, portId: PortId) => number
  getTraceLanePenalty: (traceIndex: number, portId: PortId) => number
  getRouteHeuristic: (routeId: RouteId, portId: PortId) => number
}

interface ExactPrefixTracePreview {
  preview: TracePreview
  sharedStepCount: number
}

interface GreedyTraceExtensionResult {
  segments: TraceSegment[]
  terminalPortId: PortId
  terminalRegionId: RegionId
  previewCost: number
  madeProgress: boolean
}

interface ClosestValidPortMove {
  portId: PortId
  nextRegionId: RegionId
  guideDistance: number
  segmentLength: number
}

export class BusTraceInferencePlanner {
  constructor(private readonly options: BusTraceInferencePlannerOptions) {}

  hasRemainingTraceCandidate(
    tracePreview: TracePreview,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    if (tracePreview.complete) {
      return true
    }

    const routeId = tracePreview.routeId
    const routeNetId = this.options.problem.routeNet[routeId]!
    const currentPortId = tracePreview.terminalPortId
    const currentRegionId = tracePreview.terminalRegionId

    if (currentRegionId === undefined) {
      return false
    }

    const guidePortIds = [currentPortId]
    const visitedPortIds = this.getTracePreviewVisitedPortIds(tracePreview)
    const visitedStateKeys = this.getTracePreviewStateKeys(tracePreview)

    const completedTrace = this.tryCompleteTraceFromCurrentRegion({
      routeId,
      currentPortId,
      currentRegionId,
      currentGuideDeviation: tracePreview.previewCost ?? 0,
      guidePortIds,
      goalPortId: this.options.problem.routeEndPort[routeId]!,
      extensionSegments: [],
      usedPortOwners,
    })
    if (completedTrace) {
      return true
    }

    return (
      this.getClosestValidPortMove({
        routeId,
        routeNetId,
        currentPortId,
        currentRegionId,
        guidePortIds,
        usedPortOwners,
        visitedPortIds,
        visitedStateKeys,
        currentTraceLength: getTracePreviewLength(
          this.options.topology,
          tracePreview,
        ),
      }) !== undefined
    )
  }

  buildBestPrefixTracePreview(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    maxSharedStepCount: number,
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    let bestPreview: TracePreview | undefined
    let bestPreviewHasRemainingCandidate = false

    for (const exactPrefix of this.getExactPrefixSeedCandidates(
      traceIndex,
      maxSharedStepCount,
      boundarySteps,
      boundaryPortIdsByStep,
      usedPortOwners,
    )) {
      const preview = this.buildPartialPreviewFromSeed(
        traceIndex,
        centerPath,
        maxSharedStepCount,
        exactPrefix,
        usedPortOwners,
      )
      if (!preview) {
        continue
      }

      const previewHasRemainingCandidate = this.hasRemainingTraceCandidate(
        preview,
        usedPortOwners,
      )

      if (
        !bestPreview ||
        (previewHasRemainingCandidate &&
          !bestPreviewHasRemainingCandidate) ||
        (previewHasRemainingCandidate === bestPreviewHasRemainingCandidate &&
          (preview.previewCost ?? Number.POSITIVE_INFINITY) <
            (bestPreview.previewCost ?? Number.POSITIVE_INFINITY) -
              BUS_CANDIDATE_EPSILON) ||
        (previewHasRemainingCandidate === bestPreviewHasRemainingCandidate &&
          Math.abs(
            (preview.previewCost ?? Number.POSITIVE_INFINITY) -
              (bestPreview.previewCost ?? Number.POSITIVE_INFINITY),
          ) <= BUS_CANDIDATE_EPSILON &&
          getTracePreviewLength(this.options.topology, preview) <
            getTracePreviewLength(this.options.topology, bestPreview))
      ) {
        bestPreview = preview
        bestPreviewHasRemainingCandidate = previewHasRemainingCandidate
      }
    }

    return bestPreview
  }

  buildCompleteTracePreview(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    let bestPreview: TracePreview | undefined

    for (const exactPrefix of this.getExactPrefixSeedCandidates(
      traceIndex,
      boundarySteps.length,
      boundarySteps,
      boundaryPortIdsByStep,
      usedPortOwners,
    )) {
      const preview = this.buildCompletePreviewFromSeed(
        traceIndex,
        centerPath,
        boundarySteps.length,
        exactPrefix,
        usedPortOwners,
      )
      if (!preview) {
        continue
      }

      if (
        !bestPreview ||
        (preview.previewCost ?? Number.POSITIVE_INFINITY) <
          (bestPreview.previewCost ?? Number.POSITIVE_INFINITY) -
            BUS_CANDIDATE_EPSILON ||
        (Math.abs(
          (preview.previewCost ?? Number.POSITIVE_INFINITY) -
            (bestPreview.previewCost ?? Number.POSITIVE_INFINITY),
        ) <= BUS_CANDIDATE_EPSILON &&
          getTracePreviewLength(this.options.topology, preview) <
            getTracePreviewLength(this.options.topology, bestPreview))
      ) {
        bestPreview = preview
      }
    }

    return bestPreview
  }

  private buildPartialPreviewFromSeed(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    maxSharedStepCount: number,
    exactPrefix: ExactPrefixTracePreview,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    const routeId = this.options.busTraceOrder.traces[traceIndex]!.routeId
    const guidePortIds = getGuidePortIds(centerPath, exactPrefix.sharedStepCount)
    const centerSegmentCount = Math.max(centerPath.length - 1, 0)
    const centerTraceLength = getPolylineLength(
      this.options.topology,
      centerPath.map((pathCandidate) => pathCandidate.portId),
    )

    if (exactPrefix.sharedStepCount >= maxSharedStepCount) {
      const preview = {
        ...exactPrefix.preview,
        previewCost: this.getTracePreviewGuideDeviation(
          exactPrefix.preview,
          guidePortIds,
        ),
      }
      return this.isPreviewBehindCenterline(
        preview,
        centerSegmentCount,
        centerTraceLength,
      )
        ? preview
        : undefined
    }

    const extension = this.searchTraceAlongside({
      traceIndex,
      prefixPreview: exactPrefix.preview,
      usedPortOwners,
      guidePortIds,
      maxSteps: this.getPartialTraceSearchMaxSteps(
        maxSharedStepCount - exactPrefix.sharedStepCount,
      ),
      maxSegmentCount: centerSegmentCount,
      maxTraceLength: centerTraceLength,
    })
    if (!extension || !extension.madeProgress) {
      const preview = {
        ...exactPrefix.preview,
        previewCost: this.getTracePreviewGuideDeviation(
          exactPrefix.preview,
          guidePortIds,
        ),
      }
      return this.isPreviewBehindCenterline(
        preview,
        centerSegmentCount,
        centerTraceLength,
      )
        ? preview
        : undefined
    }

    const preview = {
      traceIndex,
      routeId,
      segments: [...exactPrefix.preview.segments, ...extension.segments],
      complete: false,
      terminalPortId: extension.terminalPortId,
      terminalRegionId: extension.terminalRegionId,
      previewCost: extension.previewCost,
    }
    return this.isPreviewBehindCenterline(
      preview,
      centerSegmentCount,
      centerTraceLength,
    )
      ? preview
      : undefined
  }

  private buildCompletePreviewFromSeed(
    traceIndex: number,
    centerPath: BusCenterCandidate[],
    maxSharedStepCount: number,
    exactPrefix: ExactPrefixTracePreview,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    const routeId = this.options.busTraceOrder.traces[traceIndex]!.routeId
    const guidePortIds = getGuidePortIds(centerPath, exactPrefix.sharedStepCount)
    const extension = this.searchTraceAlongside({
      traceIndex,
      prefixPreview: exactPrefix.preview,
      usedPortOwners,
      guidePortIds,
      maxSteps: this.getCompleteTraceSearchMaxSteps(
        maxSharedStepCount - exactPrefix.sharedStepCount,
      ),
      goalPortId: this.options.problem.routeEndPort[routeId]!,
    })
    if (!extension) {
      return undefined
    }

    return {
      traceIndex,
      routeId,
      segments: [...exactPrefix.preview.segments, ...extension.segments],
      complete: true,
      terminalPortId: this.options.problem.routeEndPort[routeId]!,
      previewCost: extension.previewCost,
    }
  }

  private buildLongestExactPrefixTracePreview(
    traceIndex: number,
    maxSharedStepCount: number,
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ): ExactPrefixTracePreview | undefined {
    for (
      let sharedStepCount = maxSharedStepCount;
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

      if (!this.options.isTracePreviewUsable(prefixPreview, usedPortOwners)) {
        continue
      }

      return {
        preview: prefixPreview,
        sharedStepCount,
      }
    }

    return undefined
  }

  private getExactPrefixSeedCandidates(
    traceIndex: number,
    maxSharedStepCount: number,
    boundarySteps: BoundaryStep[],
    boundaryPortIdsByStep: Array<PortId[] | undefined>,
    usedPortOwners: ReadonlyMap<PortId, RouteId>,
  ) {
    if (this.options.problem.routeCount > 6) {
      const candidates: ExactPrefixTracePreview[] = []

      for (
        let sharedStepCount = maxSharedStepCount;
        sharedStepCount >= 0;
        sharedStepCount--
      ) {
        const preview = this.options.buildPrefixTracePreview(
          traceIndex,
          sharedStepCount,
          boundarySteps,
          boundaryPortIdsByStep,
          usedPortOwners,
        )
        if (!preview || !this.options.isTracePreviewUsable(preview, usedPortOwners)) {
          continue
        }

        candidates.push({
          preview,
          sharedStepCount,
        })
      }

      return candidates
    }

    const candidates: ExactPrefixTracePreview[] = []
    const longestPrefix = this.buildLongestExactPrefixTracePreview(
      traceIndex,
      maxSharedStepCount,
      boundarySteps,
      boundaryPortIdsByStep,
      usedPortOwners,
    )

    if (longestPrefix) {
      candidates.push(longestPrefix)
    }

    if (!longestPrefix || longestPrefix.sharedStepCount > 0) {
      const zeroPrefix = this.options.buildPrefixTracePreview(
        traceIndex,
        0,
        boundarySteps,
        boundaryPortIdsByStep,
        usedPortOwners,
      )
      if (
        zeroPrefix &&
        this.options.isTracePreviewUsable(zeroPrefix, usedPortOwners)
      ) {
        candidates.push({
          preview: zeroPrefix,
          sharedStepCount: 0,
        })
      }
    }

    return candidates
  }

  private searchTraceAlongside({
    traceIndex,
    prefixPreview,
    usedPortOwners,
    guidePortIds,
    maxSteps,
    goalPortId,
    maxSegmentCount,
    maxTraceLength,
  }: {
    traceIndex: number
    prefixPreview: TracePreview
    usedPortOwners: ReadonlyMap<PortId, RouteId>
    guidePortIds: readonly PortId[]
    maxSteps: number
    goalPortId?: PortId
    maxSegmentCount?: number
    maxTraceLength?: number
  }): GreedyTraceExtensionResult | undefined {
    const routeId = prefixPreview.routeId
    const routeNetId = this.options.problem.routeNet[routeId]!
    let currentPortId = prefixPreview.terminalPortId
    let currentRegionId = prefixPreview.terminalRegionId
    if (currentRegionId === undefined) {
      return undefined
    }

    const visitedPortIds = this.getTracePreviewVisitedPortIds(prefixPreview)
    const visitedStateKeys = this.getTracePreviewStateKeys(prefixPreview)
    let cumulativeGuideDeviation = this.getTracePreviewGuideDeviation(
      prefixPreview,
      guidePortIds,
    )
    let currentTraceLength = getTracePreviewLength(
      this.options.topology,
      prefixPreview,
    )
    const segments: TraceSegment[] = []

    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
      if (
        maxSegmentCount !== undefined &&
        prefixPreview.segments.length + segments.length >= maxSegmentCount
      ) {
        break
      }

      if (goalPortId !== undefined) {
        const completedTrace = this.tryCompleteTraceFromCurrentRegion({
          routeId,
          currentPortId,
          currentRegionId,
          currentGuideDeviation: cumulativeGuideDeviation,
          guidePortIds,
          goalPortId,
          extensionSegments: segments,
          usedPortOwners,
        })
        if (completedTrace) {
          return completedTrace
        }
      }

      const nextMove = this.getClosestValidPortMove({
        routeId,
        routeNetId,
        currentPortId,
        currentRegionId,
        guidePortIds,
        usedPortOwners,
        visitedPortIds,
        visitedStateKeys,
        currentTraceLength,
        maxTraceLength,
      })
      if (!nextMove) {
        break
      }

      segments.push({
        regionId: currentRegionId,
        fromPortId: currentPortId,
        toPortId: nextMove.portId,
      })
      currentPortId = nextMove.portId
      currentRegionId = nextMove.nextRegionId
      cumulativeGuideDeviation += nextMove.guideDistance
      currentTraceLength += nextMove.segmentLength
      visitedPortIds.add(nextMove.portId)
      visitedStateKeys.add(
        this.getTraceSearchStateKey(nextMove.portId, nextMove.nextRegionId),
      )
    }

    return goalPortId === undefined
      ? {
          segments,
          terminalPortId: currentPortId,
          terminalRegionId: currentRegionId,
          previewCost: cumulativeGuideDeviation,
          madeProgress: segments.length > 0,
        }
      : undefined
  }

  private tryCompleteTraceFromCurrentRegion({
    routeId,
    currentPortId,
    currentRegionId,
    currentGuideDeviation,
    guidePortIds,
    goalPortId,
    extensionSegments,
    usedPortOwners,
  }: {
    routeId: RouteId
    currentPortId: PortId
    currentRegionId: RegionId
    currentGuideDeviation: number
    guidePortIds: readonly PortId[]
    goalPortId?: PortId
    extensionSegments: TraceSegment[]
    usedPortOwners: ReadonlyMap<PortId, RouteId>
  }): GreedyTraceExtensionResult | undefined {
    if (
      goalPortId === undefined ||
      !isPortIncidentToRegion(this.options.topology, goalPortId, currentRegionId)
    ) {
      return undefined
    }

    const goalOwner = usedPortOwners.get(goalPortId)
    if (goalOwner !== undefined && goalOwner !== routeId) {
      return undefined
    }

    if (
      currentPortId !== goalPortId &&
      !this.options.isTraceSegmentUsable(
        routeId,
        {
          regionId: currentRegionId,
          fromPortId: currentPortId,
          toPortId: goalPortId,
        },
        usedPortOwners,
      )
    ) {
      return undefined
    }

    const completionSegments =
      currentPortId === goalPortId
        ? extensionSegments
        : [
            ...extensionSegments,
            {
              regionId: currentRegionId,
              fromPortId: currentPortId,
              toPortId: goalPortId,
            },
          ]

    return {
      segments: completionSegments,
      terminalPortId: goalPortId,
      terminalRegionId: currentRegionId,
      previewCost:
        currentGuideDeviation +
        (currentPortId === goalPortId
          ? 0
          : getDistanceFromPortToPolyline(
              this.options.topology,
              goalPortId,
              guidePortIds,
            )),
      madeProgress: true,
    }
  }

  private getClosestValidPortMove({
    routeId,
    routeNetId,
    currentPortId,
    currentRegionId,
    guidePortIds,
    usedPortOwners,
    visitedPortIds,
    visitedStateKeys,
    currentTraceLength,
    maxTraceLength,
  }: {
    routeId: RouteId
    routeNetId: number
    currentPortId: PortId
    currentRegionId: RegionId
    guidePortIds: readonly PortId[]
    usedPortOwners: ReadonlyMap<PortId, RouteId>
    visitedPortIds: ReadonlySet<PortId>
    visitedStateKeys: ReadonlySet<number>
    currentTraceLength: number
    maxTraceLength?: number
  }) {
    const entryRegionId = this.getOppositeRegionId(currentPortId, currentRegionId)
    let bestCandidate: ClosestValidPortMove | undefined

    for (const boundaryPortId of this.options.topology.regionIncidentPorts[
      currentRegionId
    ] ?? []) {
      if (
        boundaryPortId === currentPortId ||
        this.options.topology.portZ[boundaryPortId] !== 0 ||
        visitedPortIds.has(boundaryPortId)
      ) {
        continue
      }

      const nextRegionId = this.getOppositeRegionId(boundaryPortId, currentRegionId)
      if (
        nextRegionId === undefined ||
        nextRegionId === entryRegionId ||
        this.options.isRegionReservedForDifferentBusNet(routeNetId, nextRegionId)
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
      if (visitedStateKeys.has(nextStateKey)) {
        continue
      }

      const segmentLength = getPortDistance(
        this.options.topology,
        currentPortId,
        boundaryPortId,
      )
      if (
        maxTraceLength !== undefined &&
        currentTraceLength + segmentLength > maxTraceLength + BUS_CANDIDATE_EPSILON
      ) {
        continue
      }

      if (
        this.options.isTraceSegmentUsable(
          routeId,
          {
            regionId: currentRegionId,
            fromPortId: currentPortId,
            toPortId: boundaryPortId,
          },
          usedPortOwners,
        )
      ) {
        const guideDistance = getDistanceFromPortToPolyline(
          this.options.topology,
          boundaryPortId,
          guidePortIds,
        )
        if (
          !bestCandidate ||
          guideDistance < bestCandidate.guideDistance ||
          (guideDistance === bestCandidate.guideDistance &&
            boundaryPortId < bestCandidate.portId)
        ) {
          bestCandidate = {
            portId: boundaryPortId,
            nextRegionId,
            guideDistance,
            segmentLength,
          }
        }
      }
    }

    return bestCandidate
  }

  private getTracePreviewGuideDeviation(
    tracePreview: TracePreview,
    guidePortIds: readonly PortId[],
  ) {
    return tracePreview.segments.reduce(
      (sum, segment) =>
        sum +
        getDistanceFromPortToPolyline(
          this.options.topology,
          segment.toPortId,
          guidePortIds,
        ),
      0,
    )
  }

  private isPreviewBehindCenterline(
    tracePreview: TracePreview,
    centerSegmentCount: number,
    centerTraceLength: number,
  ) {
    return (
      tracePreview.segments.length <= centerSegmentCount &&
      getTracePreviewLength(this.options.topology, tracePreview) <=
        centerTraceLength + BUS_CANDIDATE_EPSILON
    )
  }

  private getTracePreviewVisitedPortIds(tracePreview: TracePreview) {
    const visitedPortIds = new Set<PortId>([
      this.options.problem.routeStartPort[tracePreview.routeId]!,
    ])

    for (const segment of tracePreview.segments) {
      visitedPortIds.add(segment.fromPortId)
      visitedPortIds.add(segment.toPortId)
    }

    return visitedPortIds
  }

  private getTracePreviewStateKeys(tracePreview: TracePreview) {
    const visitedStateKeys = new Set<number>()
    let currentPortId = this.options.problem.routeStartPort[tracePreview.routeId]!
    let currentRegionId = this.options.getStartingNextRegionId(
      tracePreview.routeId,
      currentPortId,
    )

    if (currentRegionId === undefined) {
      return visitedStateKeys
    }

    visitedStateKeys.add(
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
      visitedStateKeys.add(
        this.getTraceSearchStateKey(currentPortId, currentRegionId),
      )
    }

    return visitedStateKeys
  }

  private getTraceSearchStateKey(portId: PortId, regionId: RegionId) {
    return portId * this.options.topology.regionCount + regionId
  }

  private getOppositeRegionId(portId: PortId, regionId: RegionId) {
    const incidentRegionIds =
      this.options.topology.incidentPortRegion[portId] ?? []
    return incidentRegionIds[0] === regionId
      ? incidentRegionIds[1]
      : incidentRegionIds[0]
  }

  private getPartialTraceSearchMaxSteps(remainingBoundaryStepCount: number) {
    return Math.max(
      1,
      Math.min(
        remainingBoundaryStepCount + 1,
        this.options.BUS_MAX_REMAINDER_STEPS * 2,
      ),
    )
  }

  private getCompleteTraceSearchMaxSteps(remainingBoundaryStepCount: number) {
    return Math.max(
      2,
      Math.min(
        remainingBoundaryStepCount * 2 + 2,
        this.options.BUS_MAX_REMAINDER_STEPS * 4,
      ),
    )
  }
}
