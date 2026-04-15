import type {
  TinyHyperGraphProblem,
  TinyHyperGraphProblemSetup,
  TinyHyperGraphTopology,
} from "./core"
import type { NetId, PortId, RegionId, RouteId } from "./types"

type StaticReachabilityRouteMetadata = {
  connectionId?: unknown
  startRegionId?: unknown
  endRegionId?: unknown
  simpleRouteConnection?: {
    pointsToConnect?: Array<{
      pointId?: unknown
    }>
  }
}

export interface StaticallyUnroutableRouteSummary {
  routeId: RouteId
  connectionId: string
  startPortId: PortId
  endPortId: PortId
  startRegionId?: string
  endRegionId?: string
  pointIds: string[]
}

interface StaticReachabilityRouteSummaryContext {
  problem: TinyHyperGraphProblem
  routeId: RouteId
  getRouteMetadata?: (
    routeId: RouteId,
  ) => StaticReachabilityRouteMetadata | undefined
  getRouteConnectionId?: (routeId: RouteId) => string
}

interface StaticReachabilityContext {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  problemSetup: TinyHyperGraphProblemSetup
  portAssignment: Int32Array
  routeIds: RouteId[]
  maxPrecheckHops: number
  getStartingNextRegionId: (
    routeId: RouteId,
    startingPortId: PortId,
  ) => RegionId | undefined
  getRouteSummary: (routeId: RouteId) => StaticallyUnroutableRouteSummary
}

const getRouteMetadataFromProblem = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
) =>
  problem.routeMetadata?.[routeId] as
    | StaticReachabilityRouteMetadata
    | undefined

const getRoutePointIds = (
  routeMetadata: StaticReachabilityRouteMetadata | undefined,
) =>
  routeMetadata?.simpleRouteConnection?.pointsToConnect
    ?.map(({ pointId }) => (typeof pointId === "string" ? pointId : null))
    .filter((pointId): pointId is string => pointId !== null) ?? []

const getDefaultRouteConnectionId = (
  problem: TinyHyperGraphProblem,
  routeId: RouteId,
) => {
  const connectionId = getRouteMetadataFromProblem(
    problem,
    routeId,
  )?.connectionId
  return typeof connectionId === "string" ? connectionId : `route-${routeId}`
}

const isPortEndpointReservedForStaticReachability = (
  problemSetup: TinyHyperGraphProblemSetup,
  routeNetId: NetId,
  portId: PortId,
) => {
  const reservedNetIds = problemSetup.portEndpointNetIds[portId]
  if (!reservedNetIds) {
    return false
  }

  for (const reservedNetId of reservedNetIds) {
    if (reservedNetId !== routeNetId) {
      return true
    }
  }

  return false
}

const isRegionBlockedForStaticReachability = (
  problem: TinyHyperGraphProblem,
  routeNetId: NetId,
  regionId: RegionId,
) => {
  const reservedNetId = problem.regionNetId[regionId]
  return reservedNetId !== -1 && reservedNetId !== routeNetId
}

const hasStaticReachabilityPath = (
  context: StaticReachabilityContext,
  routeId: RouteId,
): boolean => {
  const { topology, problem, problemSetup, portAssignment, maxPrecheckHops } =
    context
  const routeNetId = problem.routeNet[routeId]!
  const startPortId = problem.routeStartPort[routeId]!
  const goalPortId = problem.routeEndPort[routeId]!

  if (startPortId === goalPortId) {
    return true
  }

  const startRegionId = context.getStartingNextRegionId(routeId, startPortId)
  if (startRegionId === undefined) {
    return false
  }

  const queue: Array<{ portId: PortId; nextRegionId: RegionId }> = [
    {
      portId: startPortId,
      nextRegionId: startRegionId,
    },
  ]
  const seenHops = new Set<number>([
    startPortId * topology.regionCount + startRegionId,
  ])

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const currentCandidate = queue[queueIndex]!

    if (
      isRegionBlockedForStaticReachability(
        problem,
        routeNetId,
        currentCandidate.nextRegionId,
      )
    ) {
      continue
    }

    for (const neighborPortId of topology.regionIncidentPorts[
      currentCandidate.nextRegionId
    ] ?? []) {
      const assignedNetId = portAssignment[neighborPortId]

      if (
        isPortEndpointReservedForStaticReachability(
          problemSetup,
          routeNetId,
          neighborPortId,
        )
      ) {
        continue
      }
      if (neighborPortId === goalPortId) {
        if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
          continue
        }
        return true
      }
      if (neighborPortId === currentCandidate.portId) {
        continue
      }
      if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
        continue
      }
      if (problem.portSectionMask[neighborPortId] === 0) {
        continue
      }

      const incidentRegions = topology.incidentPortRegion[neighborPortId] ?? []
      const nextRegionId =
        incidentRegions[0] === currentCandidate.nextRegionId
          ? incidentRegions[1]
          : incidentRegions[0]

      if (
        nextRegionId === undefined ||
        isRegionBlockedForStaticReachability(problem, routeNetId, nextRegionId)
      ) {
        continue
      }

      const hopId = neighborPortId * topology.regionCount + nextRegionId
      if (seenHops.has(hopId)) {
        continue
      }
      if (seenHops.size >= maxPrecheckHops) {
        return true
      }

      seenHops.add(hopId)
      queue.push({
        portId: neighborPortId,
        nextRegionId,
      })
    }
  }

  return false
}

export const createStaticallyUnroutableRouteSummary = ({
  problem,
  routeId,
  getRouteMetadata,
  getRouteConnectionId,
}: StaticReachabilityRouteSummaryContext): StaticallyUnroutableRouteSummary => {
  const routeMetadata =
    getRouteMetadata?.(routeId) ?? getRouteMetadataFromProblem(problem, routeId)

  return {
    routeId,
    connectionId:
      getRouteConnectionId?.(routeId) ??
      getDefaultRouteConnectionId(problem, routeId),
    startPortId: problem.routeStartPort[routeId]!,
    endPortId: problem.routeEndPort[routeId]!,
    startRegionId:
      typeof routeMetadata?.startRegionId === "string"
        ? routeMetadata.startRegionId
        : undefined,
    endRegionId:
      typeof routeMetadata?.endRegionId === "string"
        ? routeMetadata.endRegionId
        : undefined,
    pointIds: getRoutePointIds(routeMetadata),
  }
}

export const getStaticallyUnroutableRoutes = (
  context: StaticReachabilityContext,
): StaticallyUnroutableRouteSummary[] => {
  const routeIds = [...new Set(context.routeIds)]

  return routeIds
    .filter((routeId) => !hasStaticReachabilityPath(context, routeId))
    .map((routeId) => context.getRouteSummary(routeId))
}

export const getStaticReachabilityError = (
  staticallyUnroutableRoutes: StaticallyUnroutableRouteSummary[],
) => {
  const routeLabels = staticallyUnroutableRoutes
    .slice(0, 5)
    .map((routeSummary) => {
      const pointPath =
        routeSummary.pointIds.length >= 2
          ? `${routeSummary.pointIds[0]}->${routeSummary.pointIds[1]}`
          : `${routeSummary.startPortId}->${routeSummary.endPortId}`

      return `${routeSummary.connectionId} (${pointPath})`
    })
    .join(", ")

  const remainingRouteCount = staticallyUnroutableRoutes.length - 5

  return [
    "Static reachability precheck failed:",
    `${staticallyUnroutableRoutes.length} route(s) have no legal path under the current reservation and start-region rules`,
    remainingRouteCount > 0
      ? `${routeLabels}, +${remainingRouteCount} more`
      : routeLabels,
  ].join(" ")
}
