import { expect, test } from "bun:test"
import {
  DistanceAwareTinyHyperGraphSolver,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
  type Candidate,
} from "../lib/index"
import { WasmRoutePool } from "../lib/parallel/WasmRoutePool"
import type { WasmRouteInput } from "../lib/parallel/WasmRouteTask"

test("parallel hard connectivity preserves exact exhaustion and budget counts with blocked ports and single-layer crossings", async () => {
  const side = 100,
    R = side * side + 1,
    regions: number[][] = Array.from({ length: R }, () => []),
    incident: number[][] = [],
    xs: number[] = [],
    ys: number[] = []
  const add = (x: number, y: number, rs: number[]): void => {
    const port = xs.length
    xs.push(x)
    ys.push(y)
    incident.push(rs)
    for (const r of rs) regions[r]!.push(port)
  }
  add(0, 0, [0])
  add(side * 2, side * 2, [R - 1])
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const r = y * side + x
      if (x + 1 < side) add(x + 1, y + 0.5, [r, r + 1])
      if (y + 1 < side) add(x + 0.5, y + 1, [r, r + side])
    }
  const P = xs.length
  const topology: TinyHyperGraphTopology = {
    portCount: P,
    regionCount: R,
    regionIncidentPorts: regions,
    incidentPortRegion: incident,
    portX: Float64Array.from(xs),
    portY: Float64Array.from(ys),
    portZ: new Int32Array(P),
    portAngleForRegion1: new Int32Array(P),
    portAngleForRegion2: new Int32Array(P),
    regionWidth: new Float64Array(R).fill(1),
    regionHeight: new Float64Array(R).fill(1),
    regionCenterX: Float64Array.from({ length: R }, (_, r) => (r % side) + 0.5),
    regionCenterY: Float64Array.from(
      { length: R },
      (_, r) => Math.floor(r / side) + 0.5,
    ),
    regionAvailableZMask: Int32Array.from({ length: R }, (_, r) =>
      r % 17 === 0 ? 1 : 3,
    ),
  }
  for (let p = 0; p < P; p++)
    incident[p]!.forEach((r, slot) => {
      const angle = Math.round(
        ((Math.atan2(
          ys[p]! - topology.regionCenterY[r]!,
          xs[p]! - topology.regionCenterX[r]!,
        ) *
          18000) /
          Math.PI +
          36000) %
          36000,
      )
      ;(slot ? topology.portAngleForRegion2! : topology.portAngleForRegion1)[
        p
      ] = angle
    })
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: Int32Array.of(0),
    routeEndPort: Int32Array.of(1),
    routeNet: Int32Array.of(7),
    regionNetId: new Int32Array(R).fill(-1),
    portSectionMask: new Int8Array(P).fill(1),
    portPenalty: Float64Array.from({ length: P }, (_, p) =>
      p > 1 && p % 19 === 0 ? Infinity : 0,
    ),
  }
  class Reference extends DistanceAwareTinyHyperGraphSolver {
    result?: Candidate
    override onOutOfCandidates(): void {
      this.solved = true
    }
    override onPathFound(candidate: Candidate): void {
      if (candidate.portId === this.state.goalPortId) {
        this.result = candidate
        this.solved = true
      } else super.onPathFound(candidate)
    }
  }
  const create = (budget: number): Reference => {
    const solver = new Reference(topology, problem, {
      MAX_ITERATIONS: budget,
      STATIC_REACHABILITY_PRECHECK: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      TRACE_DENSITY_COST_FACTOR: 0.05,
      VERBOSE: false,
    })
    solver.state.currentRouteNetId = 99
    for (let r = 0; r < R; r += 17)
      if (regions[r]!.length >= 4)
        for (let n = 0; n < 20; n++)
          solver.appendSegmentToRegionCache(r, regions[r]![0]!, regions[r]![2]!)
    solver.state.currentRouteNetId = undefined
    return solver
  }
  const workers = [0, 1, 2].map(
      () =>
        new Worker(new URL("./fixtures/wasmRoute.worker.ts", import.meta.url)),
    ),
    free = [...workers]
  try {
    for (const connected of [false, true]) {
      if (connected) {
        regions[R - 1]!.length = 0
        regions[R - 2]!.push(1)
        incident[1] = [R - 2]
        problem.portPenalty![1] = 10000
      }
      for (const budget of [5000, 1000000]) {
        const reference = create(budget)
        reference.solve()
        for (const threads of [1, 4]) {
          const input = create(budget)
          const pool = new WasmRoutePool(input, {
            persistentWorkerCount: threads,
            executeAsync(_Task, data: WasmRouteInput): Promise<unknown> {
              const worker = free.pop()!
              return new Promise((resolve, reject) => {
                worker.onmessage = (event: MessageEvent): void => {
                  free.push(worker)
                  event.data.error
                    ? reject(new Error(event.data.error))
                    : resolve(event.data.output)
                }
                worker.onerror = reject
                worker.postMessage(data)
              })
            },
          })
          try {
            await pool.start()
            const result = await pool.search(0, budget)
            expect(result.status).toBe(
              reference.failed
                ? "budget"
                : reference.result
                  ? "found"
                  : "exhausted",
            )
            expect(result.iterations).toBe(reference.iterations)
            expect(
              pool.parallelConnectivitySavedExpansions,
            ).toBeLessThanOrEqual(result.iterations)
            if (reference.result) {
              expect(result.candidate!.g).toBe(reference.result.g)
              const path = (candidate: Candidate | undefined): number[] => {
                const ports: number[] = []
                for (; candidate; candidate = candidate.prevCandidate)
                  ports.unshift(candidate.portId)
                return ports
              }
              expect(path(result.candidate)).toEqual(path(reference.result))
            }
            expect(pool.parallelConnectivityChecks).toBe(threads === 4 ? 1 : 0)
            if (threads === 4 && connected && budget === 1000000) {
              const again = await pool.search(0, budget)
              expect(again.iterations).toBe(reference.iterations)
              expect(pool.parallelConnectivityChecks).toBe(1)
              input.state.portAssignment[1] = 99
              const blocked = create(budget)
              blocked.state.portAssignment[1] = 99
              blocked.solve()
              expect((await pool.search(0, budget)).iterations).toBe(
                blocked.iterations,
              )
              expect(pool.parallelConnectivityChecks).toBe(1)
              expect((await pool.search(0, budget)).iterations).toBe(
                blocked.iterations,
              )
              expect(pool.parallelConnectivityChecks).toBe(2)
            }
          } finally {
            await pool.dispose()
          }
        }
      }
    }
  } finally {
    workers.forEach((worker) => worker.terminate())
  }
})
