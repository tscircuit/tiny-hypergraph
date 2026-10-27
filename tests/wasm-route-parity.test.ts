import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver, type Candidate, type TinyHyperGraphTopology, type TinyHyperGraphProblem } from "../lib/index"
import { WasmRoutePool } from "../lib/parallel/WasmRoutePool"
import type { WasmRouteInput } from "../lib/parallel/WasmRouteTask"

test("one and four Wasm threads preserve native costs, paths, and iterations on weighted grids", async () => {
  const workers = [0, 1, 2, 3].map(() => new Worker(new URL("./fixtures/wasmRoute.worker.ts", import.meta.url)))
  try {
    for (let seed = 1; seed <= 12; seed++) {
      let randomState = seed
      const random = (): number => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32 }
      const side = 6 + seed % 8, regions = side * side
      const incidentPortRegion: number[][] = [], regionIncidentPorts: number[][] = Array.from({ length: regions }, () => [])
      const xs: number[] = [], ys: number[] = []
      const add = (x: number, y: number, incident: number[]): number => {
        const port = xs.length
        xs.push(x); ys.push(y); incidentPortRegion.push(incident)
        for (const region of incident) regionIncidentPorts[region].push(port)
        return port
      }
      const start = add(0, 0, [0])
      const end = add(side, side, [regions - 1])
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const region = y * side + x
        if (x + 1 < side) add(x + 1, y + 0.5, [region, region + 1])
        if (y + 1 < side) add(x + 0.5, y + 1, [region, region + side])
      }
      const ports = xs.length
      const topology: TinyHyperGraphTopology = { portCount: ports, regionCount: regions, regionIncidentPorts, incidentPortRegion,
        regionWidth: new Float64Array(regions).fill(1), regionHeight: new Float64Array(regions).fill(1),
        regionCenterX: Float64Array.from({ length: regions }, (_, i) => i % side + 0.5),
        regionCenterY: Float64Array.from({ length: regions }, (_, i) => Math.floor(i / side) + 0.5),
        portX: Float64Array.from(xs), portY: Float64Array.from(ys), portZ: new Int32Array(ports),
        portAngleForRegion1: new Int32Array(ports), portAngleForRegion2: new Int32Array(ports) }
      for (let port = 0; port < ports; port++) {
        topology.portZ[port] = random() < 0.35 ? 1 : 0
        for (let slot = 0; slot < incidentPortRegion[port].length; slot++) {
          const region = incidentPortRegion[port][slot]
          const angle = Math.round((Math.atan2(ys[port] - topology.regionCenterY[region], xs[port] - topology.regionCenterX[region]) * 18000 / Math.PI + 36000) % 36000)
          if (slot === 0) topology.portAngleForRegion1[port] = angle
          else topology.portAngleForRegion2![port] = angle
        }
      }
      const problem: TinyHyperGraphProblem = { routeCount: 1, routeStartPort: Int32Array.of(start), routeEndPort: Int32Array.of(end),
        routeNet: Int32Array.of(7), regionNetId: new Int32Array(regions).fill(-1), portSectionMask: new Int8Array(ports).fill(1),
        portPenalty: Float64Array.from({ length: ports }, () => random() < 0.1 ? Infinity : Math.floor(random() * 7)) }
      problem.portPenalty![start] = 99; problem.portPenalty![end] = 3
      class Reference extends DistanceAwareTinyHyperGraphSolver {
        result?: Candidate
        override onPathFound(candidate: Candidate): void {
          if (candidate.portId === this.state.goalPortId) { this.result = candidate; this.solved = true }
          else super.onPathFound(candidate)
        }
        override onOutOfCandidates(): void { this.solved = true }
      }
      const reference = new Reference(topology, problem, { VERBOSE: false, STATIC_REACHABILITY_PRECHECK: false, TRACE_DENSITY_COST_FACTOR: seed % 3 === 0 ? 0.2 : 0, minViaPadDiameter: 0.2 + seed * 0.01 })
      reference.setup()
      if (seed % 2 === 0) {
        reference.state.currentRouteNetId = 99
        for (let region = 0; region < regions; region++) {
          const incident = regionIncidentPorts[region]
          reference.appendSegmentToRegionCache(region, incident[0], incident[Math.floor(incident.length / 2)])
        }
      }
      reference.solve()
      const free = [...workers]
      for (const threads of [1, 4]) {
        const pool = new WasmRoutePool(reference, { persistentWorkerCount: threads,
          executeAsync(_Task, input: WasmRouteInput): Promise<unknown> {
            const worker = free.pop()!
            return new Promise((resolve, reject) => {
              worker.onmessage = (event: MessageEvent): void => {
                free.push(worker)
                if (event.data.error) reject(new Error(event.data.error))
                else resolve(event.data.output)
              }
              worker.onerror = reject; worker.postMessage(input)
            })
          },
        })
        try {
          await pool.start()
          const result = await pool.search(0, 100000)
          expect(result.status === "found").toBe(reference.result !== undefined)
          if (reference.result) {
            expect(result.candidate!.g).toBeCloseTo(reference.result.g, 8)
            const path = (candidate: Candidate | undefined): Array<[number, number]> => {
              const nodes: Array<[number, number]> = []
              while (candidate) { nodes.unshift([candidate.portId, candidate.nextRegionId]); candidate = candidate.prevCandidate }
              return nodes
            }
            expect(path(result.candidate)).toEqual(path(reference.result))
            expect(result.iterations).toBe(reference.iterations)
          }
        } finally { await pool.dispose() }
      }
    }
  } finally { for (const worker of workers) worker.terminate() }
})
