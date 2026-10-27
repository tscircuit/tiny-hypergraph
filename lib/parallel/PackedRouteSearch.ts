import type { Candidate } from "../core"
import type { DistanceAwareTinyHyperGraphSolver } from "../distance-aware-tiny-hypergraph-solver"

type Result = {
  candidate?: Candidate
  exhausted: boolean
  iterations: number
  canceled: boolean
}

/** The original indexed A* order, using hop IDs instead of candidate objects. */
export class PackedRouteSearch {
  private readonly stride: number
  private readonly heap: Int32Array
  private readonly index: Int32Array
  private readonly stamps: Uint32Array
  private readonly g: Float64Array
  private readonly h: Float64Array
  private readonly f: Float64Array
  private readonly parents: Int32Array
  private readonly offsets: Int32Array
  private readonly ports: Int32Array
  private readonly nextRegions: Int32Array
  private readonly hops: Int32Array
  private readonly next: Int32Array
  private readonly heads: Int32Array
  private readonly regionStamps: Uint32Array
  private readonly allowed: Uint8Array
  private generation = 0
  private length = 0

  constructor(private readonly solver: DistanceAwareTinyHyperGraphSolver) {
    const topology = solver.topology
    this.stride = topology.incidentPortRegion.reduce(
      (max, regions) => Math.max(max, regions.length),
      1,
    )
    const capacity = topology.portCount * this.stride
    this.heap = new Int32Array(capacity)
    this.index = new Int32Array(capacity)
    this.stamps = new Uint32Array(capacity)
    this.parents = new Int32Array(capacity)
    this.g = new Float64Array(capacity)
    this.h = new Float64Array(capacity)
    this.f = new Float64Array(capacity)
    this.offsets = new Int32Array(topology.regionCount + 1)
    let count = 0
    for (let region = 0; region < topology.regionCount; region++) {
      this.offsets[region] = count
      count += topology.regionIncidentPorts[region]!.length
    }
    this.offsets[topology.regionCount] = count
    this.ports = new Int32Array(count)
    this.nextRegions = new Int32Array(count).fill(-1)
    this.hops = new Int32Array(count).fill(-1)
    this.next = new Int32Array(count)
    this.allowed = new Uint8Array(count)
    this.heads = new Int32Array(topology.regionCount)
    this.regionStamps = new Uint32Array(topology.regionCount)
    for (let region = 0; region < topology.regionCount; region++) {
      const ports = topology.regionIncidentPorts[region]!
      for (let i = 0; i < ports.length; i++) {
        const position = this.offsets[region]! + i,
          port = ports[i]!
        this.ports[position] = port
        const incident = topology.incidentPortRegion[port]!
        const nextRegion = incident[0] === region ? incident[1] : incident[0]
        if (nextRegion !== undefined) {
          this.nextRegions[position] = nextRegion
          this.hops[position] = solver.getHopId(port, nextRegion)
        }
      }
    }
  }
  private up(start: number): void {
    const hop = this.heap[start]!,
      value = this.f[hop]!
    let position = start
    while (position > 0) {
      const parent = (position - 1) >> 1,
        parentHop = this.heap[parent]!
      if (this.f[parentHop]! <= value) break
      this.heap[position] = parentHop
      this.index[parentHop] = position
      position = parent
    }
    this.heap[position] = hop
    this.index[hop] = position
  }
  private down(start: number): void {
    const hop = this.heap[start]!,
      value = this.f[hop]!
    let position = start
    while (true) {
      const left = position * 2 + 1
      if (left >= this.length) break
      const right = left + 1
      const child =
        right < this.length &&
        this.f[this.heap[right]!]! < this.f[this.heap[left]!]!
          ? right
          : left
      const childHop = this.heap[child]!
      if (value <= this.f[childHop]!) break
      this.heap[position] = childHop
      this.index[childHop] = position
      position = child
    }
    this.heap[position] = hop
    this.index[hop] = position
  }
  private queue(hop: number, g: number, h: number, parent: number): void {
    const existed = this.stamps[hop] === this.generation
    const position = existed ? this.index[hop]! : this.length
    const previousF = this.f[hop]!
    this.stamps[hop] = this.generation
    this.g[hop] = g
    this.h[hop] = h
    this.f[hop] = g + h
    this.parents[hop] = parent
    if (existed) {
      if (this.f[hop]! <= previousF) this.up(position)
      else this.down(position)
    } else {
      this.heap[this.length++] = hop
      this.up(position)
    }
  }
  private pop(): number {
    const hop = this.heap[0]!,
      last = this.heap[--this.length]!
    this.index[hop] = -1
    if (this.length > 0) {
      this.heap[0] = last
      this.down(0)
    }
    return hop
  }
  private prepare(region: number, net: number): void {
    if (this.regionStamps[region] === this.generation) return
    this.regionStamps[region] = this.generation
    const start = this.offsets[region]!,
      end = this.offsets[region + 1]!
    this.heads[region] = start < end ? start : -1
    const { problem, state, problemSetup } = this.solver
    const reserved = problemSetup.portEndpointReservationNetId
    for (let position = start; position < end; position++) {
      this.next[position] = position + 1 < end ? position + 1 : -1
      const port = this.ports[position]!,
        nextRegion = this.nextRegions[position]!
      const assigned = state.portAssignment[port]!,
        reservation = reserved[port] ?? -1
      this.allowed[position] =
        problem.portSectionMask[port] !== 0 &&
        nextRegion >= 0 &&
        (assigned === -1 || assigned === net) &&
        reservation !== -2 &&
        (reservation === -1 || reservation === net) &&
        (problem.regionNetId[nextRegion] === -1 ||
          problem.regionNetId[nextRegion] === net)
          ? 1
          : 0
    }
  }
  private candidate(hop: number): Candidate {
    const chain: number[] = []
    for (let current = hop; current !== -1; current = this.parents[current]!) {
      if (chain.length > this.parents.length)
        throw new Error("Packed route predecessor cycle")
      chain.push(current)
    }
    let result: Candidate | undefined
    for (let i = chain.length - 1; i >= 0; i--) {
      const current = chain[i]!,
        port = Math.floor(current / this.stride)
      result = {
        hopId: current,
        portId: port,
        nextRegionId:
          this.solver.topology.incidentPortRegion[port]![
            current % this.stride
          ]!,
        g: this.g[current]!,
        h: this.h[current]!,
        f: this.f[current]!,
        prevCandidate: result,
        prevRegionId: result?.nextRegionId,
      }
    }
    return result!
  }
  search(
    route: number,
    budget: number,
    control: Int32Array,
    regions: Set<number>,
    onRegionRead?: (region: number) => boolean,
  ): Result {
    if (++this.generation === 0xffffffff) {
      this.stamps.fill(0)
      this.regionStamps.fill(0)
      this.generation = 1
    }
    this.length = 0
    const solver = this.solver,
      { topology, problem, state } = solver
    const start = problem.routeStartPort[route]!,
      goal = problem.routeEndPort[route]!,
      net = problem.routeNet[route]!
    state.currentRouteId = route
    state.currentRouteNetId = net
    state.goalPortId = goal
    state.unroutedRoutes = []
    const startingRegion = solver.getStartingNextRegionId(route, start)
    if (startingRegion === undefined)
      throw new Error("Route source has no incident region")
    this.queue(solver.getHopId(start, startingRegion), 0, 0, -1)
    const view: Candidate = {
      portId: start,
      nextRegionId: startingRegion,
      g: 0,
      f: 0,
      h: 0,
    }
    const reserved = solver.problemSetup.portEndpointReservationNetId
    let iterations = 0
    while (iterations < budget) {
      if (
        (iterations & 255) === 0 &&
        (Atomics.load(control, 0) === 3 || Atomics.load(control, 9))
      )
        return { exhausted: false, canceled: true, iterations }
      iterations++
      if (this.length === 0)
        return { exhausted: true, canceled: false, iterations }
      const hop = this.pop(),
        port = Math.floor(hop / this.stride)
      const region = topology.incidentPortRegion[port]![hop % this.stride]!
      if (onRegionRead && !regions.has(region) && !onRegionRead(region))
        return { exhausted: false, canceled: true, iterations }
      regions.add(region)
      if (
        problem.regionNetId[region] !== -1 &&
        problem.regionNetId[region] !== net
      )
        continue
      if (port === goal)
        return {
          candidate: this.candidate(hop),
          exhausted: false,
          canceled: false,
          iterations,
        }
      const currentG = this.g[hop]!
      view.portId = port
      view.nextRegionId = region
      view.g = currentG
      this.prepare(region, net)
      let position = this.heads[region]!,
        previous = -1
      while (position !== -1) {
        const current = position,
          before = previous
        position = this.next[current]!
        previous = current
        const neighbor = this.ports[current]!
        if (neighbor === goal) {
          const assigned = state.portAssignment[neighbor]!,
            reservation = reserved[neighbor] ?? -1
          if (
            (assigned !== -1 && assigned !== net) ||
            reservation === -2 ||
            (reservation !== -1 && reservation !== net)
          )
            continue
          const goalHop = solver.getHopId(goal, region),
            g = solver.computeG(view, goal)
          const best =
            this.stamps[goalHop] === this.generation
              ? this.g[goalHop]!
              : Infinity
          if (Number.isFinite(g) && g < best) this.queue(goalHop, g, 0, hop)
          break
        }
        if (neighbor === port) continue
        const nextHop = this.hops[current]!
        if (
          nextHop >= 0 &&
          this.stamps[nextHop] === this.generation &&
          this.index[nextHop] === -1
        ) {
          if (before === -1) this.heads[region] = position
          else this.next[before] = position
          previous = before
          continue
        }
        if (!this.allowed[current]) continue
        const best =
          this.stamps[nextHop] === this.generation ? this.g[nextHop]! : Infinity
        if (currentG >= best) continue
        const dx = topology.portX[port]! - topology.portX[neighbor]!,
          dy = topology.portY[port]! - topology.portY[neighbor]!
        const distance = Math.sqrt(dx * dx + dy * dy)
        const lower =
          currentG +
          state.regionCongestionCost[region]! +
          (problem.portPenalty?.[neighbor] ?? 0) +
          distance * solver.DISTANCE_TO_COST
        if (lower >= best) continue
        const g = solver.computeG(view, neighbor, best, distance)
        if (!Number.isFinite(g) || g >= best) continue
        this.queue(nextHop, g, solver.computeH(neighbor), hop)
      }
    }
    return { exhausted: false, canceled: false, iterations }
  }
}
