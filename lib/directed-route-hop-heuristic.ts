import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import type { NetId, PortId, RegionId, RouteId } from "./types"

const UNREACHABLE_HOP_COUNT = -1

interface CreateDirectedRouteHopHeuristicContext {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  portEndpointReservationNetId: Int32Array
  portAssignment?: Int32Array
  routeId: RouteId
}

const getDirectedHopIndex = (
  topology: TinyHyperGraphTopology,
  portId: PortId,
  nextRegionId: RegionId,
) => {
  const incidentRegions = topology.incidentPortRegion[portId] ?? []
  if (incidentRegions[0] === nextRegionId) return portId * 2
  if (incidentRegions[1] === nextRegionId) return portId * 2 + 1
  return -1
}

const isRegionAvailableToNet = (
  problem: TinyHyperGraphProblem,
  routeNetId: NetId,
  regionId: RegionId,
) => {
  const reservedNetId = problem.regionNetId[regionId]
  return reservedNetId === -1 || reservedNetId === routeNetId
}

const isPortAvailableToNet = (
  problem: TinyHyperGraphProblem,
  portEndpointReservationNetId: Int32Array,
  portAssignment: Int32Array | undefined,
  routeNetId: NetId,
  portId: PortId,
) => {
  if (problem.portSectionMask[portId] === 0) return false

  const assignedNetId = portAssignment?.[portId] ?? -1
  if (assignedNetId !== -1 && assignedNetId !== routeNetId) return false

  const reservedNetId = portEndpointReservationNetId[portId] ?? -1
  return reservedNetId === -1 || reservedNetId === routeNetId
}

/**
 * Computes the remaining number of directed region traversals to a route's
 * goal. A directed hop is a port together with the region the candidate will
 * enter next, matching the state used by the A* candidate queue.
 */
export const createDirectedRouteHopHeuristic = ({
  topology,
  problem,
  portEndpointReservationNetId,
  portAssignment,
  routeId,
}: CreateDirectedRouteHopHeuristicContext): Int32Array => {
  const hopCountToGoal = new Int32Array(topology.portCount * 2).fill(
    UNREACHABLE_HOP_COUNT,
  )
  const routeNetId = problem.routeNet[routeId]!
  const goalPortId = problem.routeEndPort[routeId]!
  const queuedPortIds: PortId[] = []
  const queuedNextRegionIds: RegionId[] = []

  const queueHop = (
    portId: PortId,
    nextRegionId: RegionId,
    hopCount: number,
  ) => {
    const directedHopIndex = getDirectedHopIndex(topology, portId, nextRegionId)
    if (
      directedHopIndex === -1 ||
      hopCountToGoal[directedHopIndex] !== UNREACHABLE_HOP_COUNT
    ) {
      return
    }

    hopCountToGoal[directedHopIndex] = hopCount
    queuedPortIds.push(portId)
    queuedNextRegionIds.push(nextRegionId)
  }

  for (const goalRegionId of topology.incidentPortRegion[goalPortId] ?? []) {
    if (!isRegionAvailableToNet(problem, routeNetId, goalRegionId)) continue

    for (const portId of topology.regionIncidentPorts[goalRegionId] ?? []) {
      queueHop(portId, goalRegionId, 0)
    }
  }

  const reverseExpansionCountByRegion = new Uint8Array(topology.regionCount)

  for (let queueIndex = 0; queueIndex < queuedPortIds.length; queueIndex++) {
    const exitPortId = queuedPortIds[queueIndex]!
    const nextRegionId = queuedNextRegionIds[queueIndex]!
    if (
      !isPortAvailableToNet(
        problem,
        portEndpointReservationNetId,
        portAssignment,
        routeNetId,
        exitPortId,
      )
    ) {
      continue
    }

    const incidentRegions = topology.incidentPortRegion[exitPortId] ?? []
    const previousRegionId =
      incidentRegions[0] === nextRegionId
        ? incidentRegions[1]
        : incidentRegions[0]
    if (
      previousRegionId === undefined ||
      !isRegionAvailableToNet(problem, routeNetId, previousRegionId) ||
      reverseExpansionCountByRegion[previousRegionId]! >= 2
    ) {
      continue
    }

    reverseExpansionCountByRegion[previousRegionId] += 1
    const currentHopIndex = getDirectedHopIndex(
      topology,
      exitPortId,
      nextRegionId,
    )
    const previousHopCount = hopCountToGoal[currentHopIndex]! + 1

    for (const previousPortId of topology.regionIncidentPorts[
      previousRegionId
    ] ?? []) {
      if (previousPortId === exitPortId) continue
      queueHop(previousPortId, previousRegionId, previousHopCount)
    }
  }

  return hopCountToGoal
}

export const getDirectedRouteHopCount = (
  topology: TinyHyperGraphTopology,
  hopCountToGoal: Int32Array,
  portId: PortId,
  nextRegionId: RegionId,
) => {
  const directedHopIndex = getDirectedHopIndex(topology, portId, nextRegionId)
  return directedHopIndex === -1
    ? UNREACHABLE_HOP_COUNT
    : hopCountToGoal[directedHopIndex]!
}
