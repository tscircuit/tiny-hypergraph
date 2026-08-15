import type { NetId, PortId, RegionId, RouteId } from "./types"

export interface TinyHyperGraphInitialAssignment {
  routeId: RouteId
  regionId: RegionId
  fromPortId: PortId
  toPortId: PortId
}

interface InitialAssignmentTopology {
  portCount: number
  regionCount: number
  incidentPortRegion: RegionId[][]
}

interface InitialAssignmentProblem {
  routeCount: number
  routeStartPort: Int32Array
  routeEndPort: Int32Array
  routeNet: Int32Array
  initialAssignments?: TinyHyperGraphInitialAssignment[]
}

interface InitialAssignmentState {
  portAssignment: Int32Array
  regionSegments: Array<[RouteId, PortId, PortId][]>
  currentRouteId: RouteId | undefined
  currentRouteNetId: NetId | undefined
  unroutedRoutes: RouteId[]
}

const assertAssignmentsConnectRoute = (
  problem: InitialAssignmentProblem,
  routeId: RouteId,
  assignments: TinyHyperGraphInitialAssignment[],
) => {
  const startPortId = problem.routeStartPort[routeId]!
  const endPortId = problem.routeEndPort[routeId]!
  const adjacentPortIds = new Map<PortId, Set<PortId>>()

  for (const { fromPortId, toPortId } of assignments) {
    const fromNeighbors = adjacentPortIds.get(fromPortId) ?? new Set<PortId>()
    fromNeighbors.add(toPortId)
    adjacentPortIds.set(fromPortId, fromNeighbors)

    const toNeighbors = adjacentPortIds.get(toPortId) ?? new Set<PortId>()
    toNeighbors.add(fromPortId)
    adjacentPortIds.set(toPortId, toNeighbors)
  }

  const visitedPortIds = new Set<PortId>()
  const pendingPortIds = [startPortId]
  while (pendingPortIds.length > 0) {
    const portId = pendingPortIds.pop()!
    if (visitedPortIds.has(portId)) continue
    visitedPortIds.add(portId)
    for (const adjacentPortId of adjacentPortIds.get(portId) ?? []) {
      pendingPortIds.push(adjacentPortId)
    }
  }

  if (!visitedPortIds.has(endPortId)) {
    throw new Error(
      `Initial assignments for route ${routeId} do not connect ${startPortId} to ${endPortId}`,
    )
  }
  if (
    assignments.some(
      ({ fromPortId, toPortId }) =>
        !visitedPortIds.has(fromPortId) || !visitedPortIds.has(toPortId),
    )
  ) {
    throw new Error(
      `Initial assignments for route ${routeId} contain disconnected segments`,
    )
  }
}

export const applyInitialAssignments = ({
  topology,
  problem,
  state,
  routeSuccessCountByRouteId,
  appendSegmentToRegionCache,
}: {
  topology: InitialAssignmentTopology
  problem: InitialAssignmentProblem
  state: InitialAssignmentState
  routeSuccessCountByRouteId: Uint32Array
  appendSegmentToRegionCache: (
    regionId: RegionId,
    fromPortId: PortId,
    toPortId: PortId,
  ) => void
}):
  | {
      initialAssignmentCount: number
      initiallyRoutedRouteCount: number
    }
  | undefined => {
  const assignments = problem.initialAssignments ?? []
  if (assignments.length === 0) return

  const assignmentsByRoute = new Map<
    RouteId,
    TinyHyperGraphInitialAssignment[]
  >()

  for (const assignment of assignments) {
    const { routeId, regionId, fromPortId, toPortId } = assignment
    if (
      !Number.isInteger(routeId) ||
      routeId < 0 ||
      routeId >= problem.routeCount
    ) {
      throw new Error(`Initial assignment references invalid route ${routeId}`)
    }
    if (
      !Number.isInteger(regionId) ||
      regionId < 0 ||
      regionId >= topology.regionCount
    ) {
      throw new Error(
        `Initial assignment references invalid region ${regionId}`,
      )
    }
    for (const portId of [fromPortId, toPortId]) {
      if (
        !Number.isInteger(portId) ||
        portId < 0 ||
        portId >= topology.portCount
      ) {
        throw new Error(`Initial assignment references invalid port ${portId}`)
      }
      if (!topology.incidentPortRegion[portId]?.includes(regionId)) {
        throw new Error(
          `Initial assignment port ${portId} is not incident to region ${regionId}`,
        )
      }
    }

    const routeAssignments = assignmentsByRoute.get(routeId) ?? []
    routeAssignments.push(assignment)
    assignmentsByRoute.set(routeId, routeAssignments)
  }

  for (const [routeId, routeAssignments] of assignmentsByRoute) {
    assertAssignmentsConnectRoute(problem, routeId, routeAssignments)
  }

  const initiallyRoutedRouteIds = new Set(assignmentsByRoute.keys())
  for (const { routeId, regionId, fromPortId, toPortId } of assignments) {
    const routeNetId = problem.routeNet[routeId]!
    for (const portId of [fromPortId, toPortId]) {
      const assignedNetId = state.portAssignment[portId]!
      if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
        throw new Error(
          `Initial assignment port ${portId} is assigned to multiple nets`,
        )
      }
      state.portAssignment[portId] = routeNetId
    }

    state.currentRouteId = routeId
    state.currentRouteNetId = routeNetId
    state.regionSegments[regionId]!.push([routeId, fromPortId, toPortId])
    appendSegmentToRegionCache(regionId, fromPortId, toPortId)
  }

  state.currentRouteId = undefined
  state.currentRouteNetId = undefined
  state.unroutedRoutes = state.unroutedRoutes.filter(
    (routeId) => !initiallyRoutedRouteIds.has(routeId),
  )
  for (const routeId of initiallyRoutedRouteIds) {
    routeSuccessCountByRouteId[routeId] = 1
  }

  return {
    initialAssignmentCount: assignments.length,
    initiallyRoutedRouteCount: initiallyRoutedRouteIds.size,
  }
}
