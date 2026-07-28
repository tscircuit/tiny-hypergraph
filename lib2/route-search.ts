import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
  TinyHyperGraphWorkingState,
} from "./domain"
import type { HopId, PortId, RegionId, RouteId } from "./types"

/** Route search status when every route has been routed. */
export const ROUTE_SEARCH_ALL_ROUTES_ROUTED = "allRoutesRouted"

/** Route search status when work advanced but no lifecycle hook is needed. */
export const ROUTE_SEARCH_ADVANCED = "advanced"

/** Route search status when the current route has no candidates left. */
export const ROUTE_SEARCH_OUT_OF_CANDIDATES = "outOfCandidates"

/** Route search failure reason. */
export type RouteSearchFailureReason =
  | "noLegalStartingRegion"
  | "coarsePathNotFound"
  | "missingCurrentRouteNet"
  | "missingRegionIncidentPorts"
  | "missingPortIncidentRegions"
  | "portNotIncidentToCurrentRegion"

/** Route search failure result. */
export type RouteSearchFailure = {
  readonly _tag: "failed"
  readonly reason: RouteSearchFailureReason
  readonly error: string
}

/** Result of one lib2 route-search step. Hot statuses are interned strings. */
export type RouteSearchStepResult =
  | typeof ROUTE_SEARCH_ALL_ROUTES_ROUTED
  | typeof ROUTE_SEARCH_ADVANCED
  | typeof ROUTE_SEARCH_OUT_OF_CANDIDATES
  | Candidate
  | RouteSearchFailure

/** Runtime methods needed by route search. */
export type RouteSearchRuntime = {
  readonly topology: TinyHyperGraphTopology
  readonly problem: TinyHyperGraphProblem
  readonly state: TinyHyperGraphWorkingState
  readonly getHopId: (portId: PortId, nextRegionId: RegionId) => HopId
  readonly getCandidateBestCost: (hopId: HopId) => number
  readonly setCandidateBestCost: (hopId: HopId, cost: number) => void
  readonly resetCandidateBestCosts: () => void
  readonly getStartingNextRegionId: (
    routeId: RouteId,
    startingPortId: PortId,
  ) => RegionId | undefined
  readonly isPortReservedForDifferentNet: (portId: PortId) => boolean
  readonly isRegionReservedForDifferentNet: (regionId: RegionId) => boolean
  readonly computeG: (
    currentCandidate: Candidate,
    neighborPortId: PortId,
  ) => number
  readonly computeH: (portId: PortId) => number
  readonly onRouteAttempt: (routeId: RouteId) => void
  readonly prepareRouteSearch?: (input: {
    readonly routeId: RouteId
    readonly startPortId: PortId
    readonly startRegionId: RegionId
    readonly goalPortId: PortId
  }) => RouteSearchFailure | undefined
  readonly isRegionAllowedForRouteSearch?: (regionId: RegionId) => boolean
}

/**
 * Run one A* route-search step against mutable solver state.
 *
 * @param runtime - Solver state and route-search callbacks.
 * @returns The lifecycle result for the solver shell to handle.
 */
export function runRouteSearchStep(
  runtime: RouteSearchRuntime,
): RouteSearchStepResult {
  const { problem, state, topology } = runtime

  if (state.currentRouteId === undefined) {
    const nextRouteId = state.unroutedRoutes.shift()
    if (nextRouteId === undefined) {
      return ROUTE_SEARCH_ALL_ROUTES_ROUTED
    }

    state.currentRouteId = nextRouteId
    state.currentRouteNetId = problem.routeNet[nextRouteId]
    runtime.onRouteAttempt(nextRouteId)

    runtime.resetCandidateBestCosts()
    const startingPortId = problem.routeStartPort[nextRouteId]
    state.candidateQueue.clear()
    const startingNextRegionId = runtime.getStartingNextRegionId(
      nextRouteId,
      startingPortId,
    )

    if (startingNextRegionId === undefined) {
      return failed(
        "noLegalStartingRegion",
        `Start port ${startingPortId} has no legal starting region`,
      )
    }

    runtime.setCandidateBestCost(
      runtime.getHopId(startingPortId, startingNextRegionId),
      0,
    )
    state.candidateQueue.queue({
      nextRegionId: startingNextRegionId,
      portId: startingPortId,
      f: 0,
      g: 0,
      h: 0,
    })
    state.goalPortId = problem.routeEndPort[nextRouteId]

    const routeSearchFailure = runtime.prepareRouteSearch?.({
      routeId: nextRouteId,
      startPortId: startingPortId,
      startRegionId: startingNextRegionId,
      goalPortId: state.goalPortId,
    })
    if (routeSearchFailure) {
      return routeSearchFailure
    }
  }

  const currentRouteNetId = state.currentRouteNetId
  if (currentRouteNetId === undefined) {
    return failed(
      "missingCurrentRouteNet",
      "Current route net is missing during route search",
    )
  }

  const currentCandidate = state.candidateQueue.dequeue()
  if (!currentCandidate) {
    return ROUTE_SEARCH_OUT_OF_CANDIDATES
  }

  const currentCandidateHopId = runtime.getHopId(
    currentCandidate.portId,
    currentCandidate.nextRegionId,
  )
  if (
    currentCandidate.g > runtime.getCandidateBestCost(currentCandidateHopId)
  ) {
    return ROUTE_SEARCH_ADVANCED
  }

  if (runtime.isRegionReservedForDifferentNet(currentCandidate.nextRegionId)) {
    return ROUTE_SEARCH_ADVANCED
  }

  const neighbors = topology.regionIncidentPorts[currentCandidate.nextRegionId]
  if (neighbors === undefined) {
    return failed(
      "missingRegionIncidentPorts",
      `Region ${currentCandidate.nextRegionId} is missing incident ports during route search`,
    )
  }

  for (const neighborPortId of neighbors) {
    const assignedNetId = state.portAssignment[neighborPortId]
    if (runtime.isPortReservedForDifferentNet(neighborPortId)) {
      continue
    }

    if (neighborPortId === state.goalPortId) {
      if (assignedNetId !== -1 && assignedNetId !== currentRouteNetId) {
        continue
      }

      return currentCandidate
    }

    if (assignedNetId !== -1 && assignedNetId !== currentRouteNetId) {
      continue
    }

    if (neighborPortId === currentCandidate.portId) {
      continue
    }

    if (problem.portSectionMask[neighborPortId] === 0) {
      continue
    }

    const g = runtime.computeG(currentCandidate, neighborPortId)
    if (!Number.isFinite(g)) {
      continue
    }

    const h = runtime.computeH(neighborPortId)
    const incidentRegions = topology.incidentPortRegion[neighborPortId]
    if (incidentRegions === undefined) {
      return failed(
        "missingPortIncidentRegions",
        `Port ${neighborPortId} is missing incident regions during route search`,
      )
    }

    if (!incidentRegions.includes(currentCandidate.nextRegionId)) {
      return failed(
        "portNotIncidentToCurrentRegion",
        `Port ${neighborPortId} is not incident to current region ${currentCandidate.nextRegionId}`,
      )
    }

    const nextRegionId =
      incidentRegions[0] === currentCandidate.nextRegionId
        ? incidentRegions[1]
        : incidentRegions[0]

    if (
      nextRegionId === undefined ||
      runtime.isRegionReservedForDifferentNet(nextRegionId)
    ) {
      continue
    }

    if (
      runtime.isRegionAllowedForRouteSearch &&
      !runtime.isRegionAllowedForRouteSearch(nextRegionId)
    ) {
      continue
    }

    const nextCandidate: Candidate = {
      prevRegionId: currentCandidate.nextRegionId,
      nextRegionId,
      portId: neighborPortId,
      g,
      h,
      f: g + h,
      prevCandidate: currentCandidate,
    }

    if (neighborPortId === state.goalPortId) {
      return nextCandidate
    }

    const nextHopId = runtime.getHopId(neighborPortId, nextRegionId)
    if (g >= runtime.getCandidateBestCost(nextHopId)) {
      continue
    }

    runtime.setCandidateBestCost(nextHopId, g)
    state.candidateQueue.queue(nextCandidate)
  }

  return ROUTE_SEARCH_ADVANCED
}

const failed = (
  reason: RouteSearchFailureReason,
  error: string,
): RouteSearchFailure => ({
  _tag: "failed",
  reason,
  error,
})
