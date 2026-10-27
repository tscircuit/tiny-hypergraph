import { expect, test } from "bun:test"
import { solveWithWasmRoutes } from "../lib/core-parallel"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"
import type { WasmRouteInput } from "../lib/parallel/WasmRouteTask"

test("native route workers retain exact completion output and iteration budgets", async () => {
  const workers = [0, 1, 2, 3].map(
    () =>
      new Worker(new URL("./fixtures/wasmRoute.worker.ts", import.meta.url)),
  )
  const free = [...workers]
  let submitted = 0
  try {
    const baseline = createCompletionFixture(),
      parallel = createCompletionFixture()
    baseline.MAX_ITERATIONS = parallel.MAX_ITERATIONS = 1
    baseline.solve()
    await solveWithWasmRoutes(parallel, {
      persistentWorkerCount: 4,
      executeAsync(_Task, input: WasmRouteInput): Promise<unknown> {
        submitted++
        const worker = free.pop()!
        return new Promise((resolve, reject) => {
          worker.onmessage = (event: MessageEvent): void => {
            free.push(worker)
            if (event.data.error) reject(new Error(event.data.error))
            else resolve(event.data.output)
          }
          worker.onerror = reject
          worker.postMessage(input)
        })
      },
    })
    expect(submitted).toBeGreaterThan(0)
    expect(parallel.solved).toBe(baseline.solved)
    expect(parallel.failed).toBe(baseline.failed)
    expect(parallel.iterations).toBe(baseline.iterations)
    expect(parallel.state.regionIntersectionCaches).toEqual(
      baseline.state.regionIntersectionCaches,
    )
    expect(parallel.state.regionSegments).toEqual(baseline.state.regionSegments)
    expect(parallel.state.portAssignment).toEqual(baseline.state.portAssignment)
  } finally {
    for (const worker of workers) worker.terminate()
  }
})
