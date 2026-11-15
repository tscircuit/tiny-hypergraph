import { readFileSync } from "node:fs"
import type { Candidate, TinyHyperGraphSolver } from "../core"

const module = new WebAssembly.Module(
  readFileSync(new URL("./native-route-search.wasm", import.meta.url)),
)
interface Kernel {
  memory: WebAssembly.Memory
  ptr(field: number): number
  configure(
    regions: number,
    distance: number,
    via: number,
    density: number,
    trace: number,
    useDistance: number,
  ): void
  resetCaches(): void
  append(
    region: number,
    net: number,
    lesser: number,
    greater: number,
    mask: number,
    same: number,
    cross: number,
    changes: number,
    cost: number,
  ): number
  search(
    start: number,
    goal: number,
    net: number,
    route: number,
    limit: number,
  ): number
  searchSteps(): number
}

export class NativeRouteSearch {
  static supports(solver: TinyHyperGraphSolver) {
    const t = solver.topology
    return (
      t.portCount <= 65536 &&
      t.regionCount <= 16384 &&
      solver.RIP_CONGESTION_REGION_COST_FACTOR >= 0 &&
      !t.regionAvailableZMask?.some((mask) => mask < 0) &&
      t.portZ.every(Number.isInteger) &&
      t.portAngleForRegion1.every(Number.isInteger) &&
      (!t.portAngleForRegion2 ||
        t.portAngleForRegion2.every(Number.isInteger)) &&
      solver.state.regionIntersectionCaches.reduce(
        (n, c) => n + c.existingSegmentCount,
        0,
      ) *
        4 <=
        1048576 &&
      t.incidentPortRegion.every(
        (rs) => rs.length <= 2 && rs.every((r) => r >= 0 && r < t.regionCount),
      ) &&
      t.regionIncidentPorts.reduce((n, ps) => n + ps.length, 0) <= 262144 &&
      t.regionIncidentPorts.every((ps, r) =>
        ps.every(
          (p) =>
            p >= 0 && p < t.portCount && t.incidentPortRegion[p].includes(r),
        ),
      )
    )
  }
  private kernel: Kernel
  readonly assignments: Int32Array
  readonly congestion: Float64Array
  private g: Float64Array
  private h: Float64Array
  private f: Float64Array
  private parents: Int32Array
  private recordHops?: Int32Array
  constructor(
    private readonly solver: TinyHyperGraphSolver,
    private readonly distanceAware = true,
  ) {
    this.kernel = new WebAssembly.Instance(module, {
      env: {
        abort: (_message: number, _file: number, line: number) => {
          throw new Error(`Native route search aborted at line ${line}`)
        },
      },
    }).exports as unknown as Kernel
    const { topology: t, problem: p } = solver
    this.kernel.configure(
      t.regionCount,
      solver.DISTANCE_TO_COST,
      (solver.minViaPadDiameter + 0.15) ** 2,
      solver.TRACE_DENSITY_COST_FACTOR,
      0.1 ** 2,
      distanceAware ? 1 : 0,
    )
    const floats = (field: number, count: number) =>
      new Float64Array(this.kernel.memory.buffer, this.kernel.ptr(field), count)
    const ints = (field: number, count: number) =>
      new Int32Array(this.kernel.memory.buffer, this.kernel.ptr(field), count)
    floats(0, t.portCount).set(t.portX)
    floats(1, t.portCount).set(t.portY)
    ints(2, t.portCount).set(t.portZ)
    ints(3, t.portCount).set(t.portAngleForRegion1)
    ints(4, t.portCount).set(t.portAngleForRegion2 ?? t.portAngleForRegion1)
    const first = ints(5, t.portCount),
      second = ints(6, t.portCount)
    first.fill(-1)
    second.fill(-1)
    for (let port = 0; port < t.portCount; port++) {
      first[port] = t.incidentPortRegion[port][0] ?? -1
      second[port] = t.incidentPortRegion[port][1] ?? -1
    }
    ints(7, t.portCount).set(p.portSectionMask)
    ints(8, t.portCount).set(solver.problemSetup.portEndpointReservationNetId)
    this.assignments = ints(9, t.portCount)
    this.assignments.set(solver.state.portAssignment)
    if (p.portPenalty) floats(10, t.portCount).set(p.portPenalty)
    const area = floats(11, t.regionCount)
    for (let r = 0; r < t.regionCount; r++)
      area[r] = t.regionWidth[r] * t.regionHeight[r]
    if (t.regionAvailableZMask)
      ints(12, t.regionCount).set(t.regionAvailableZMask)
    ints(13, t.regionCount).set(p.regionNetId)
    this.congestion = floats(14, t.regionCount)
    this.congestion.set(solver.state.regionCongestionCost)
    const starts = ints(15, t.regionCount + 1)
    const count = t.regionIncidentPorts.reduce((n, ps) => n + ps.length, 0)
    const ports = ints(16, count),
      nextHops = ints(17, count)
    let cursor = 0
    for (let r = 0; r < t.regionCount; r++) {
      starts[r] = cursor
      for (const port of t.regionIncidentPorts[r]) {
        const incident = t.incidentPortRegion[port]
        const next = incident[0] === r ? incident[1] : incident[0]
        ports[cursor] = port
        nextHops[cursor] =
          next === undefined ? -1 : port * 2 + (incident[0] === next ? 0 : 1)
        cursor++
      }
    }
    starts[t.regionCount] = cursor
    if (!distanceAware) {
      const rows = ints(23, t.portCount * 2)
      rows.fill(-1)
      let cells = 0
      for (let r = 0; r < t.regionCount; r++) {
        const ps = t.regionIncidentPorts[r],
          n = ps.length
        if (cells + n * n > 4000000) continue
        for (let i = 0; i < n; i++) {
          const port = ps[i]
          rows[port * 2 + (t.incidentPortRegion[port][0] === r ? 0 : 1)] =
            cells + i * n
        }
        cells += n * n
      }
    }
    const records = distanceAware ? t.portCount * 2 : 2000000
    this.g = floats(18, records)
    this.h = floats(19, records)
    this.f = floats(20, records)
    this.parents = ints(21, records)
    if (!distanceAware) this.recordHops = ints(22, records)
    for (let r = 0; r < t.regionCount; r++) {
      const cache = solver.state.regionIntersectionCaches[r]
      for (let i = 0; i < cache.existingSegmentCount; i++) {
        if (!this.append(r, i))
          throw new Error("Native initial cache capacity exceeded")
      }
    }
  }
  append(region: number, index?: number) {
    const c = this.solver.state.regionIntersectionCaches[region]
    const i = index ?? c.existingSegmentCount - 1
    return (
      this.kernel.append(
        region,
        c.netIds[i],
        c.lesserAngles[i],
        c.greaterAngles[i],
        c.layerMasks[i],
        c.existingSameLayerIntersections,
        c.existingCrossingLayerIntersections,
        c.existingEntryExitLayerChanges,
        c.existingRegionCost,
      ) === 1
    )
  }
  reset() {
    this.kernel.resetCaches()
  }
  search(
    route: number,
    start: number,
    region: number,
    limit: number,
  ): {
    steps: number
    exhausted: boolean
    candidate?: Candidate
    overflow?: boolean
  } {
    const { topology: t, problem: p } = this.solver
    const startHop =
      start * 2 + (t.incidentPortRegion[start][0] === region ? 0 : 1)
    const result = this.kernel.search(
      startHop,
      p.routeEndPort[route],
      p.routeNet[route],
      route,
      Math.min(limit, this.distanceAware ? t.portCount * 2 + 1 : 2000001),
    )
    const steps = this.kernel.searchSteps()
    if (result <= 0)
      return { steps, exhausted: result === -1, overflow: result === -2 }
    const hops: number[] = []
    let cursor = result - 1
    while (cursor >= 0) {
      hops.push(cursor)
      cursor = this.parents[cursor]
      if (hops.length > t.portCount * 2)
        throw new Error("Native predecessor cycle")
    }
    let candidate: Candidate | undefined
    for (const record of hops.reverse()) {
      const hop = this.recordHops ? this.recordHops[record] : record
      const port = hop >> 1,
        nextRegion = t.incidentPortRegion[port][hop & 1]
      candidate = {
        hopId: this.solver.getHopId(port, nextRegion),
        portId: port,
        nextRegionId: nextRegion,
        g: this.g[record],
        h: this.h[record],
        f: this.f[record],
        ...(candidate
          ? { prevRegionId: candidate.nextRegionId, prevCandidate: candidate }
          : {}),
      }
    }
    return { steps, exhausted: false, candidate }
  }
}
