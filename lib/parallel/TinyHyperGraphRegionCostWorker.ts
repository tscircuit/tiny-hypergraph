import { RegionCostKernel } from "./RegionCostKernel"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { COST_SLOT_COUNT, COST_SLOT_STRIDE, type RegionCostWorkerInput } from "./regionCostTypes"

let workerEnabled = false
/** Call only in the worker entrypoint, before SolverRuntime.listen(). */
export const enableRegionCostWorker = (): void => { workerEnabled = true }

export class TinyHyperGraphRegionCostCapabilities {
  static readonly solverName = "TinyHyperGraphRegionCostCapabilities"
  solve(): void {}
  getOutput(): boolean { return workerEnabled }
}

export class TinyHyperGraphRegionCostWorker {
  static readonly solverName = "TinyHyperGraphRegionCostWorker"
  constructor(private input: RegionCostWorkerInput) {}
  solve(): void {
    if (!workerEnabled) throw new Error("Region cost service must run in a worker")
    const data = this.input
    const { control } = data
    const kernel = new RegionCostKernel()
    Atomics.add(control, 2, 1)
    while (Atomics.load(control, 0) === 0) {
      // Read before scanning so a job published during the scan cannot be lost.
      const wake = Atomics.load(control, 1)
      let foundWork = false
      for (let slot = 0; slot < COST_SLOT_COUNT; slot++) {
        const base = 4 + slot * COST_SLOT_STRIDE
        if (Atomics.compareExchange(control, base, 1, 2) !== 1) continue
        foundWork = true
        const region = control[base + 1]!
        const netId = control[base + 2]!
        const count = control[base + 3]!
        const version = control[base + 4]!
        const scores = kernel.compute(data, slot, region, count, netId)
        data.scores.set(scores, data.pairOffsets[region]!)
        // Publish only after the entire matrix has been copied. The host
        // observes this version before reading non-atomic Float64 values.
        Atomics.store(data.resultVersions, region, version)
        Atomics.add(control, 3, 1)
        Atomics.store(control, base, 0)
      }
      if (!foundWork) Atomics.wait(control, 1, wake, 100)
    }
  }
  getOutput(): boolean { return true }
}
SolverRuntime.registerSolver(TinyHyperGraphRegionCostCapabilities)
SolverRuntime.registerSolver(TinyHyperGraphRegionCostWorker)
