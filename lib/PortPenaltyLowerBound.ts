import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "./core"
import { MinHeap } from "./MinHeap"
import type { NetId, PortId, RegionId } from "./types"

type ComponentId = number
type PendingComponent = { component: ComponentId; cost: number }

/**
 * Remaining port cost with geometry and current route ownership relaxed.
 * Collapse zero-cost regions once per net, then search the small weighted
 * component graph lazily from the goal. Only the current net/goal is retained.
 * Static reservations stay in the graph; ignoring direction and occupied
 * routes can only reduce the estimate, so it remains a lower bound.
 */
export class PortPenaltyLowerBound {
  private netId?: NetId
  private goalPortId?: PortId
  private readonly componentByRegion: Int32Array
  private edges: Map<ComponentId, number>[] = []
  private distances = new Float64Array(0)
  private settled = new Uint8Array(0)
  private readonly pending = new MinHeap<PendingComponent>(
    [],
    (a, b) => a.cost - b.cost,
  )

  constructor(
    private readonly input: {
      topology: TinyHyperGraphTopology
      problem: TinyHyperGraphProblem
      endpointReservations: Int32Array
    },
  ) {
    this.componentByRegion = new Int32Array(input.topology.regionCount).fill(-1)
  }

  private canCross(port: PortId, netId: NetId): boolean {
    const { problem, endpointReservations } = this.input
    const reservation = endpointReservations[port]
    return (
      problem.portSectionMask[port] !== 0 &&
      (reservation === -1 || reservation === netId)
    )
  }

  private buildComponents(netId: NetId): void {
    const { topology, problem } = this.input
    const components = this.componentByRegion
    components.fill(-1)
    this.edges = []
    const stack: RegionId[] = []
    for (let seed = 0; seed < topology.regionCount; seed++) {
      if (
        components[seed] !== -1 ||
        (problem.regionNetId[seed] !== -1 &&
          problem.regionNetId[seed] !== netId)
      )
        continue
      const component = this.edges.length
      this.edges.push(new Map())
      components[seed] = component
      stack.push(seed)
      while (stack.length) {
        const region = stack.pop()!
        for (const port of topology.regionIncidentPorts[region]) {
          if (!this.canCross(port, netId) || problem.portPenalty![port] !== 0)
            continue
          for (const next of topology.incidentPortRegion[port]) {
            if (
              components[next] !== -1 ||
              (problem.regionNetId[next] !== -1 &&
                problem.regionNetId[next] !== netId)
            )
              continue
            components[next] = component
            stack.push(next)
          }
        }
      }
    }
    for (let port = 0; port < topology.portCount; port++) {
      if (!this.canCross(port, netId)) continue
      const penalty = problem.portPenalty![port]
      if (penalty === 0 || penalty === Infinity) continue
      if (!Number.isFinite(penalty) || penalty < 0)
        throw new Error("Port penalties must be nonnegative numbers")
      for (const region of topology.incidentPortRegion[port]) {
        const from = components[region]
        if (from < 0) continue
        for (const other of topology.incidentPortRegion[port]) {
          const to = components[other]
          if (to < 0 || from === to) continue
          const previous = this.edges[from].get(to)
          if (previous === undefined || penalty < previous)
            this.edges[from].set(to, penalty)
        }
      }
    }
    this.distances = new Float64Array(this.edges.length)
    this.settled = new Uint8Array(this.edges.length)
    this.netId = netId
    this.goalPortId = undefined
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
    if (netId !== this.netId) this.buildComponents(netId)
    const { topology } = this.input
    if (endPortId !== this.goalPortId) {
      this.distances.fill(Infinity)
      this.settled.fill(0)
      this.pending.clear()
      for (const region of topology.incidentPortRegion[endPortId]) {
        const component = this.componentByRegion[region]
        if (component < 0 || this.distances[component] === 0) continue
        this.distances[component] = 0
        this.pending.queue({ component, cost: 0 })
      }
      this.goalPortId = endPortId
    }
    const targets = topology.incidentPortRegion[portId].map(
      (region) => this.componentByRegion[region],
    )
    // Either incident region is allowed in this relaxation. The queried
    // port's cost has already been paid by the forward search.
    let known = Infinity
    for (const target of targets) {
      if (target >= 0 && this.settled[target])
        known = Math.min(known, this.distances[target])
    }
    if (known !== Infinity) return known
    while (this.pending.length) {
      const { component, cost } = this.pending.dequeue()!
      if (this.settled[component] || cost !== this.distances[component])
        continue
      this.settled[component] = 1
      for (const [next, penalty] of this.edges[component]) {
        const nextCost = cost + penalty
        if (nextCost >= this.distances[next]) continue
        this.distances[next] = nextCost
        this.pending.queue({ component: next, cost: nextCost })
      }
      if (targets.includes(component)) return cost
    }
    return Infinity
  }
}
