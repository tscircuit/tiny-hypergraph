import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"
import { WasmRoutePool } from "../lib/parallel/WasmRoutePool"
import type { WasmRouteInput } from "../lib/parallel/WasmRouteTask"

test("prepared native reachability preserves disconnected counts, budgets, and exits unlocked by a second incoming port", async () => {
  class Observe extends SelectiveReripTinyHyperGraphSolver {
    labelBudget = 100
    protected override getRelaxedSearchExpansionLimit(): number { return this.labelBudget }
    search() { this.state.currentRouteId = 0; this.state.currentRouteNetId = 7; return this.findRelaxedBlockerPath() }
  }
  for (const threads of [1, 4]) for (const connected of [false, true]) {
    const solver = new Observe({ portCount: 4, regionCount: 3,
      regionIncidentPorts: [[0, 2, 3], [0, 1], [2, 3]], incidentPortRegion: [[0, 1], [1], [0, 2], [0, 2]],
      regionWidth: new Float64Array(3).fill(10), regionHeight: new Float64Array(3).fill(10),
      regionCenterX: new Float64Array(3), regionCenterY: new Float64Array(3),
      portX: Float64Array.from([0, -1, 1, 1]), portY: Float64Array.from([0, 0, 1, -1]), portZ: new Int32Array(4),
      portAngleForRegion1: Int32Array.from([0, 18000, 9000, 27000]), portAngleForRegion2: new Int32Array(4),
    }, { routeCount: 1, routeStartPort: Int32Array.of(0), routeEndPort: Int32Array.of(1), routeNet: Int32Array.of(7),
      regionNetId: new Int32Array(3).fill(-1), portSectionMask: Int8Array.from([1, 1, connected ? 1 : 0, connected ? 1 : 0]),
    }, { STATIC_REACHABILITY_PRECHECK: false, VERBOSE: false })
    const workers = Array.from({ length: threads - 1 }, () => new Worker(new URL("./fixtures/wasmRoute.worker.ts", import.meta.url)))
    const free = [...workers]
    const pool = new WasmRoutePool(solver, { persistentWorkerCount: threads,
      executeAsync(_Task, input: WasmRouteInput): Promise<unknown> {
        const worker = free.pop()!
        return new Promise((resolve, reject) => {
          worker.onmessage = (event: MessageEvent): void => { free.push(worker); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.output) }
          worker.onerror = reject; worker.postMessage(input)
        })
      },
    })
    try {
      await pool.start()
      expect(pool.geometryPairsByWorker.reduce((a, b) => a + b, 0)).toBe(0)
      for (const budget of [0, 1, 2, 3, 4, 5, 8, 100]) {
        solver.labelBudget = budget
        solver.useCompiledOwnerSearch = false; solver.parallelOwnerSearch = undefined
        const reference = solver.search()
        solver.useCompiledOwnerSearch = true; solver.parallelOwnerSearch = (options, geometry, forbidden) => pool.searchOwners(options, geometry, forbidden)
        expect(solver.search()).toEqual(reference)
      }
      expect(pool.geometryPairsByWorker.reduce((a, b) => a + b, 0)).toBe(5)
    } finally { await pool.dispose(); workers.forEach((worker) => worker.terminate()) }
  }
})
