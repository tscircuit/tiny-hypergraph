import { isKnownSingleLayerMask } from "./computeRegionCost"
import { countNewIntersectionsWithValues } from "./countNewIntersections"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphProblemSetup,
  TinyHyperGraphTopology,
} from "./core"
import type {
  NetId,
  PortId,
  RegionId,
  RegionIntersectionCache,
  RouteId,
} from "./types"

export interface MaxFlowUnroutableRouteSummary {
  routeId: RouteId
  connectionId: string
  startPortId: PortId
  endPortId: PortId
  startRegionId?: string
  endRegionId?: string
  pointIds: string[]
  maxFlow: number
}

export interface MaxFlowImpossibilityContext {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  problemSetup: TinyHyperGraphProblemSetup
  portAssignment: Int32Array
  routeIds: RouteId[]
  regionIntersectionCaches?: RegionIntersectionCache[]
  getStartingNextRegionId: (
    routeId: RouteId,
    startingPortId: PortId,
  ) => RegionId | undefined
  getRouteSummary: (
    routeId: RouteId,
  ) => Omit<MaxFlowUnroutableRouteSummary, "maxFlow">
}

interface Edge {
  to: number
  rev: number
  capacity: number
}

class Dinic {
  private graph: Edge[][]
  private levels: Int32Array
  private nextEdge: Int32Array

  constructor(nodeCount: number) {
    this.graph = Array.from({ length: nodeCount }, () => [])
    this.levels = new Int32Array(nodeCount)
    this.nextEdge = new Int32Array(nodeCount)
  }

  addEdge(from: number, to: number, capacity: number) {
    const forward: Edge = {
      to,
      rev: this.graph[to]!.length,
      capacity,
    }
    const backward: Edge = {
      to: from,
      rev: this.graph[from]!.length,
      capacity: 0,
    }
    this.graph[from]!.push(forward)
    this.graph[to]!.push(backward)
  }

  private bfs(source: number, sink: number) {
    this.levels.fill(-1)
    const queue = [source]
    this.levels[source] = 0

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const node = queue[queueIndex]!
      for (const edge of this.graph[node]!) {
        if (edge.capacity <= 0 || this.levels[edge.to] !== -1) continue
        this.levels[edge.to] = this.levels[node]! + 1
        if (edge.to === sink) return true
        queue.push(edge.to)
      }
    }

    return this.levels[sink] !== -1
  }

  private dfs(node: number, sink: number, flow: number): number {
    if (node === sink) return flow

    for (
      let edgeIndex = this.nextEdge[node]!;
      edgeIndex < this.graph[node]!.length;
      edgeIndex++
    ) {
      this.nextEdge[node] = edgeIndex
      const edge = this.graph[node]![edgeIndex]!
      if (
        edge.capacity <= 0 ||
        this.levels[node]! + 1 !== this.levels[edge.to]
      ) {
        continue
      }

      const pushedFlow = this.dfs(edge.to, sink, Math.min(flow, edge.capacity))
      if (pushedFlow <= 0) continue

      edge.capacity -= pushedFlow
      this.graph[edge.to]![edge.rev]!.capacity += pushedFlow
      return pushedFlow
    }

    return 0
  }

  maxFlow(
    source: number,
    sink: number,
    requiredFlow = Number.POSITIVE_INFINITY,
  ) {
    let totalFlow = 0

    while (totalFlow < requiredFlow && this.bfs(source, sink)) {
      this.nextEdge.fill(0)

      while (totalFlow < requiredFlow) {
        const pushedFlow = this.dfs(source, sink, requiredFlow - totalFlow)
        if (pushedFlow <= 0) break
        totalFlow += pushedFlow
      }
    }

    return totalFlow
  }
}

const INF = 1_000_000_000

const isPortEndpointReservedForDifferentNet = (
  problemSetup: TinyHyperGraphProblemSetup,
  routeNetId: NetId,
  portId: PortId,
) => {
  const reservedNetIds = problemSetup.portEndpointNetIds[portId]
  if (!reservedNetIds) return false

  for (const reservedNetId of reservedNetIds) {
    if (reservedNetId !== routeNetId) return true
  }

  return false
}

const isRegionReservedForDifferentNet = (
  problem: TinyHyperGraphProblem,
  routeNetId: NetId,
  regionId: RegionId,
) => {
  const reservedNetId = problem.regionNetId[regionId]
  return reservedNetId !== -1 && reservedNetId !== routeNetId
}

const getPortInNode = (portId: PortId) => portId * 2
const getPortOutNode = (portId: PortId) => portId * 2 + 1

const getSegmentLayerMask = (
  topology: TinyHyperGraphTopology,
  port1Id: PortId,
  port2Id: PortId,
) => (1 << topology.portZ[port1Id]!) | (1 << topology.portZ[port2Id]!)

const getPortAngleForRegion = (
  topology: TinyHyperGraphTopology,
  regionId: RegionId,
  portId: PortId,
) => {
  const incidentRegions = topology.incidentPortRegion[portId] ?? []

  return incidentRegions[0] === regionId || incidentRegions[1] !== regionId
    ? topology.portAngleForRegion1[portId]!
    : (topology.portAngleForRegion2?.[portId] ??
        topology.portAngleForRegion1[portId]!)
}

const isSegmentHardBlockedByExistingIntersections = (
  context: MaxFlowImpossibilityContext,
  routeNetId: NetId,
  regionId: RegionId,
  port1Id: PortId,
  port2Id: PortId,
) => {
  const regionAvailableZMask =
    context.topology.regionAvailableZMask?.[regionId] ?? 0
  if (!isKnownSingleLayerMask(regionAvailableZMask)) return false

  const regionCache = context.regionIntersectionCaches?.[regionId]
  if (!regionCache || regionCache.netIds.length === 0) return false

  const angle1 = getPortAngleForRegion(context.topology, regionId, port1Id)
  const angle2 = getPortAngleForRegion(context.topology, regionId, port2Id)
  const lesserAngle = angle1 < angle2 ? angle1 : angle2
  const greaterAngle = angle1 < angle2 ? angle2 : angle1
  const [sameLayerIntersectionCount] = countNewIntersectionsWithValues(
    regionCache,
    routeNetId,
    lesserAngle,
    greaterAngle,
    getSegmentLayerMask(context.topology, port1Id, port2Id),
    context.topology.portZ[port1Id] !== context.topology.portZ[port2Id] ? 1 : 0,
  )

  return sameLayerIntersectionCount > 0
}

const canUsePort = (
  context: MaxFlowImpossibilityContext,
  routeNetId: NetId,
  portId: PortId,
  startPortId: PortId,
  endPortId: PortId,
) => {
  if (portId !== startPortId && portId !== endPortId) {
    if (context.problem.portSectionMask[portId] === 0) return false
  }

  if (
    isPortEndpointReservedForDifferentNet(
      context.problemSetup,
      routeNetId,
      portId,
    )
  ) {
    return false
  }

  const assignedNetId = context.portAssignment[portId]
  return assignedNetId === -1 || assignedNetId === routeNetId
}

export const getRouteMaxFlow = (
  context: MaxFlowImpossibilityContext,
  routeId: RouteId,
  requiredFlow = 1,
) => {
  const { topology, problem } = context
  const routeNetId = problem.routeNet[routeId]!
  const startPortId = problem.routeStartPort[routeId]!
  const endPortId = problem.routeEndPort[routeId]!

  if (startPortId === endPortId) return requiredFlow
  if (
    !canUsePort(context, routeNetId, startPortId, startPortId, endPortId) ||
    !canUsePort(context, routeNetId, endPortId, startPortId, endPortId)
  ) {
    return 0
  }

  const startRegionId = context.getStartingNextRegionId(routeId, startPortId)
  if (
    startRegionId === undefined ||
    isRegionReservedForDifferentNet(problem, routeNetId, startRegionId)
  ) {
    return 0
  }

  const nodeCount = topology.portCount * 2 + topology.regionCount
  const regionNodeOffset = topology.portCount * 2
  const flow = new Dinic(nodeCount)
  const usablePorts = new Int8Array(topology.portCount)

  for (let portId = 0; portId < topology.portCount; portId++) {
    if (!canUsePort(context, routeNetId, portId, startPortId, endPortId)) {
      continue
    }

    usablePorts[portId] = 1
    const assignedNetId = context.portAssignment[portId]
    const capacity =
      portId === startPortId ||
      portId === endPortId ||
      assignedNetId === routeNetId
        ? INF
        : 1
    flow.addEdge(getPortInNode(portId), getPortOutNode(portId), capacity)
  }

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    if (isRegionReservedForDifferentNet(problem, routeNetId, regionId)) {
      continue
    }

    const regionNode = regionNodeOffset + regionId
    const incidentPorts = topology.regionIncidentPorts[regionId] ?? []

    for (const portId of incidentPorts) {
      if (usablePorts[portId] === 0) continue
      if (portId === startPortId && regionId !== startRegionId) continue
      flow.addEdge(getPortOutNode(portId), regionNode, INF)

      for (const neighborPortId of incidentPorts) {
        if (neighborPortId === portId || usablePorts[neighborPortId] === 0) {
          continue
        }
        if (
          isSegmentHardBlockedByExistingIntersections(
            context,
            routeNetId,
            regionId,
            portId,
            neighborPortId,
          )
        ) {
          continue
        }
        flow.addEdge(regionNode, getPortInNode(neighborPortId), INF)
      }
    }
  }

  const sourceRegionNode = regionNodeOffset + startRegionId
  flow.addEdge(getPortOutNode(startPortId), sourceRegionNode, INF)

  return flow.maxFlow(
    getPortInNode(startPortId),
    getPortInNode(endPortId),
    requiredFlow,
  )
}

export const getMaxFlowUnroutableRoutes = (
  context: MaxFlowImpossibilityContext,
): MaxFlowUnroutableRouteSummary[] => {
  const routeIds = [...new Set(context.routeIds)]
  const unroutableRoutes: MaxFlowUnroutableRouteSummary[] = []

  for (const routeId of routeIds) {
    const maxFlow = getRouteMaxFlow(context, routeId, 1)
    if (maxFlow >= 1) continue

    unroutableRoutes.push({
      ...context.getRouteSummary(routeId),
      maxFlow,
    })
  }

  return unroutableRoutes
}

export const getMaxFlowImpossibilityError = (
  unroutableRoutes: MaxFlowUnroutableRouteSummary[],
) => {
  const routeLabels = unroutableRoutes
    .slice(0, 5)
    .map((routeSummary) => {
      const pointPath =
        routeSummary.pointIds.length >= 2
          ? `${routeSummary.pointIds[0]}->${routeSummary.pointIds[1]}`
          : `${routeSummary.startPortId}->${routeSummary.endPortId}`

      return `${routeSummary.connectionId} (${pointPath}, maxFlow=${routeSummary.maxFlow})`
    })
    .join(", ")

  const remainingRouteCount = unroutableRoutes.length - 5

  return [
    "Max-flow impossibility check failed:",
    `${unroutableRoutes.length} route(s) have no legal path under the current capacity, reservation, and layer-intersection rules`,
    remainingRouteCount > 0
      ? `${routeLabels}, +${remainingRouteCount} more`
      : routeLabels,
  ].join(" ")
}
