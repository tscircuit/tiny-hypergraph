import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import { MinHeap } from "./MinHeap"
import type { NetId, PortId, RegionId } from "./types"

type ComponentId = number
type PendingComponent = { component: ComponentId; cost: number }
type ComponentEdge = { component: ComponentId; penalty: number; netId: NetId }

/**
 * Remaining port cost with geometry and current route ownership relaxed.
 * Free regions joined by unreserved zero-cost ports are compressed once.
 * Reserved regions/ports stay separate so all nets can share this graph.
 * Ignoring direction and occupied routes can only reduce the estimate.
 */
export class PortPenaltyLowerBound {
  private netId?: NetId
  private goalPortId?: PortId
  private readonly topology: TinyHyperGraphTopology
  private readonly componentByRegion: Int32Array
  private readonly componentNetIds: NetId[] = []
  private readonly edges: ComponentEdge[][]
  private readonly distances: Float64Array
  private readonly settled: Uint8Array
  private readonly pending = new MinHeap<PendingComponent>(
    [],
    (a, b) => a.cost - b.cost,
  )

  constructor({
    topology,
    problem,
    endpointReservations,
  }: {
    topology: TinyHyperGraphTopology
    problem: TinyHyperGraphProblem
    endpointReservations: Int32Array
  }) {
    this.topology = topology
    const components = new Int32Array(topology.regionCount).fill(-1)
    this.componentByRegion = components
    const stack: RegionId[] = []
    for (let seed = 0; seed < topology.regionCount; seed++) {
      if (components[seed] !== -1) continue
      const component = this.componentNetIds.length
      this.componentNetIds.push(problem.regionNetId[seed])
      components[seed] = component
      // Keep each reserved region separate; only its owning net may use it.
      if (problem.regionNetId[seed] !== -1) continue
      stack.push(seed)
      while (stack.length) {
        const region = stack.pop()!
        for (const port of topology.regionIncidentPorts[region]) {
          if (
            problem.portSectionMask[port] === 0 ||
            endpointReservations[port] !== -1 ||
            (problem.portPenalty?.[port] ?? 0) !== 0
          )
            continue
          for (const next of topology.incidentPortRegion[port]) {
            if (components[next] !== -1 || problem.regionNetId[next] !== -1)
              continue
            components[next] = component
            stack.push(next)
          }
        }
      }
    }
    const edgeMaps = this.componentNetIds.map(
      () => new Map<ComponentId, Map<NetId, number>>(),
    )
    for (let port = 0; port < topology.portCount; port++) {
      const netId = endpointReservations[port]
      if (problem.portSectionMask[port] === 0 || netId === -2) continue
      const penalty = problem.portPenalty?.[port] ?? 0
      if (penalty === Infinity) continue
      if (!Number.isFinite(penalty) || penalty < 0)
        throw new Error("Port penalties must be nonnegative numbers")
      for (const region of topology.incidentPortRegion[port]) {
        const from = components[region]
        for (const other of topology.incidentPortRegion[port]) {
          const to = components[other]
          if (from === to) continue
          let costsByNet = edgeMaps[from].get(to)
          if (!costsByNet) {
            costsByNet = new Map()
            edgeMaps[from].set(to, costsByNet)
          }
          costsByNet.set(
            netId,
            Math.min(costsByNet.get(netId) ?? Infinity, penalty),
          )
        }
      }
    }
    this.edges = edgeMaps.map((edges) =>
      Array.from(edges).flatMap(([component, costs]) =>
        Array.from(costs, ([netId, penalty]) => ({
          component,
          netId,
          penalty,
        })),
      ),
    )
    this.distances = new Float64Array(this.edges.length)
    this.settled = new Uint8Array(this.edges.length)
  }

  getLowerBound({
    netId,
    endPortId,
    portId,
  }: {
    netId: NetId
    endPortId: PortId
    portId: PortId
  }): number {
    if (netId !== this.netId || endPortId !== this.goalPortId) {
      this.distances.fill(Infinity)
      this.settled.fill(0)
      this.pending.clear()
      for (const region of this.topology.incidentPortRegion[endPortId]) {
        const component = this.componentByRegion[region]
        const reservedNet = this.componentNetIds[component]
        if (
          (reservedNet !== -1 && reservedNet !== netId) ||
          this.distances[component] === 0
        )
          continue
        this.distances[component] = 0
        this.pending.queue({ component, cost: 0 })
      }
      this.netId = netId
      this.goalPortId = endPortId
    }
    // Either incident region is allowed in this relaxation. The queried
    // port's cost has already been paid by the forward search.
    const incidentRegions = this.topology.incidentPortRegion[portId]
    let known = Infinity
    for (const region of incidentRegions) {
      const target = this.componentByRegion[region]
      if (this.settled[target]) known = Math.min(known, this.distances[target])
    }
    if (known !== Infinity) return known
    while (this.pending.length) {
      const { component, cost } = this.pending.dequeue()!
      if (this.settled[component] || cost !== this.distances[component])
        continue
      this.settled[component] = 1
      for (const edge of this.edges[component]) {
        const reservedNet = this.componentNetIds[edge.component]
        if (
          (reservedNet !== -1 && reservedNet !== netId) ||
          (edge.netId !== -1 && edge.netId !== netId)
        )
          continue
        const nextCost = cost + edge.penalty
        if (nextCost >= this.distances[edge.component]) continue
        this.distances[edge.component] = nextCost
        this.pending.queue({ component: edge.component, cost: nextCost })
      }
      if (
        incidentRegions.some(
          (region) => this.componentByRegion[region] === component,
        )
      )
        return cost
    }
    return Infinity
  }
}
