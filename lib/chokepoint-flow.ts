import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import type { NetId, PortId, RegionId, RouteId } from "./types"

export interface FlowChokepointAnalysis {
  demand: number
  maxFlow: number
  minCutPortIds: PortId[]
  routeIds: RouteId[]
}

type FlowEdge = {
  to: number
  rev: number
  capacity: number
  originalCapacity: number
}

const INF_CAPACITY = 1_000_000

class Dinic {
  readonly graph: FlowEdge[][]
  private levels: number[]
  private nextEdgeIndexes: number[]

  constructor(nodeCount: number) {
    this.graph = Array.from({ length: nodeCount }, () => [])
    this.levels = new Array(nodeCount).fill(-1)
    this.nextEdgeIndexes = new Array(nodeCount).fill(0)
  }

  addEdge(from: number, to: number, capacity: number) {
    const forward: FlowEdge = {
      to,
      rev: this.graph[to]!.length,
      capacity,
      originalCapacity: capacity,
    }
    const reverse: FlowEdge = {
      to: from,
      rev: this.graph[from]!.length,
      capacity: 0,
      originalCapacity: 0,
    }
    this.graph[from]!.push(forward)
    this.graph[to]!.push(reverse)
  }

  private bfs(source: number, sink: number) {
    this.levels.fill(-1)
    this.levels[source] = 0
    const queue = [source]

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const node = queue[queueIndex]!
      for (const edge of this.graph[node]!) {
        if (edge.capacity <= 0 || this.levels[edge.to] >= 0) {
          continue
        }
        this.levels[edge.to] = this.levels[node]! + 1
        queue.push(edge.to)
      }
    }

    return this.levels[sink] >= 0
  }

  private dfs(node: number, sink: number, flow: number): number {
    if (node === sink) {
      return flow
    }

    for (
      ;
      this.nextEdgeIndexes[node]! < this.graph[node]!.length;
      this.nextEdgeIndexes[node]! += 1
    ) {
      const edge = this.graph[node]![this.nextEdgeIndexes[node]!]!
      if (
        edge.capacity <= 0 ||
        this.levels[node]! + 1 !== this.levels[edge.to]
      ) {
        continue
      }

      const pushed = this.dfs(edge.to, sink, Math.min(flow, edge.capacity))
      if (pushed <= 0) {
        continue
      }

      edge.capacity -= pushed
      this.graph[edge.to]![edge.rev]!.capacity += pushed
      return pushed
    }

    return 0
  }

  maxFlow(source: number, sink: number) {
    let totalFlow = 0

    while (this.bfs(source, sink)) {
      this.nextEdgeIndexes.fill(0)
      while (true) {
        const pushed = this.dfs(source, sink, INF_CAPACITY)
        if (pushed <= 0) {
          break
        }
        totalFlow += pushed
      }
    }

    return totalFlow
  }

  getReachableNodes(source: number) {
    const reachable = new Set<number>([source])
    const queue = [source]

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const node = queue[queueIndex]!
      for (const edge of this.graph[node]!) {
        if (edge.capacity <= 0 || reachable.has(edge.to)) {
          continue
        }
        reachable.add(edge.to)
        queue.push(edge.to)
      }
    }

    return reachable
  }
}

const getEndpointPortIds = (
  problem: TinyHyperGraphProblem,
  routeIds: RouteId[],
) => {
  const endpointPortIds = new Set<PortId>()

  for (const routeId of routeIds) {
    endpointPortIds.add(problem.routeStartPort[routeId]!)
    endpointPortIds.add(problem.routeEndPort[routeId]!)
  }

  return endpointPortIds
}

const isRegionAvailableToAnyNet = (
  problem: TinyHyperGraphProblem,
  routeNetIds: Set<NetId>,
  regionId: RegionId,
) => {
  const regionNetId = problem.regionNetId[regionId]
  return regionNetId === -1 || routeNetIds.has(regionNetId)
}

const getDefaultFlowRouteIds = (problem: TinyHyperGraphProblem) => {
  const routeIds: RouteId[] = []
  const seenNetIds = new Set<NetId>()

  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const routeNetId = problem.routeNet[routeId]!
    if (seenNetIds.has(routeNetId)) {
      continue
    }
    seenNetIds.add(routeNetId)
    routeIds.push(routeId)
  }

  return routeIds
}

export const analyzePortCapacityMinCut = ({
  topology,
  problem,
  routeIds = getDefaultFlowRouteIds(problem),
}: {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  routeIds?: RouteId[]
}): FlowChokepointAnalysis => {
  const sourceNode = topology.portCount * 2
  const sinkNode = sourceNode + 1
  const dinic = new Dinic(sinkNode + 1)
  const endpointPortIds = getEndpointPortIds(problem, routeIds)
  const routeNetIds = new Set(
    routeIds.map((routeId) => problem.routeNet[routeId]!),
  )
  const portInNode = (portId: PortId) => portId * 2
  const portOutNode = (portId: PortId) => portId * 2 + 1

  for (let portId = 0; portId < topology.portCount; portId++) {
    if (problem.portSectionMask[portId] === 0) {
      continue
    }
    dinic.addEdge(
      portInNode(portId),
      portOutNode(portId),
      endpointPortIds.has(portId) ? INF_CAPACITY : 1,
    )
  }

  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    if (!isRegionAvailableToAnyNet(problem, routeNetIds, regionId)) {
      continue
    }
    const portIds = topology.regionIncidentPorts[regionId] ?? []
    for (const fromPortId of portIds) {
      if (problem.portSectionMask[fromPortId] === 0) {
        continue
      }
      for (const toPortId of portIds) {
        if (
          fromPortId === toPortId ||
          problem.portSectionMask[toPortId] === 0
        ) {
          continue
        }
        dinic.addEdge(
          portOutNode(fromPortId),
          portInNode(toPortId),
          INF_CAPACITY,
        )
      }
    }
  }

  for (const routeId of routeIds) {
    dinic.addEdge(sourceNode, portInNode(problem.routeStartPort[routeId]!), 1)
    dinic.addEdge(portOutNode(problem.routeEndPort[routeId]!), sinkNode, 1)
  }

  const maxFlow = dinic.maxFlow(sourceNode, sinkNode)
  const reachable = dinic.getReachableNodes(sourceNode)
  const minCutPortIds: PortId[] = []

  for (let portId = 0; portId < topology.portCount; portId++) {
    if (endpointPortIds.has(portId) || problem.portSectionMask[portId] === 0) {
      continue
    }
    if (
      reachable.has(portInNode(portId)) &&
      !reachable.has(portOutNode(portId))
    ) {
      minCutPortIds.push(portId)
    }
  }

  return {
    demand: routeIds.length,
    maxFlow,
    minCutPortIds,
    routeIds,
  }
}
