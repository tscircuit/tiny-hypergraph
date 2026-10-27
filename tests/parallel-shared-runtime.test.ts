import { expect, test } from "bun:test"
import { solveWithWasmRoutes } from "../lib/parallel/solveWithWasmRoutes"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"
import type { WasmRouteInput, WasmRouteTask } from "../lib/parallel/WasmRouteTask"

test("concurrent solves reserve the shared worker pool for one port phase at a time", async () => {
  const workers = [0, 1, 2].map(() => new Worker(new URL("./fixtures/wasmRoute.worker.ts", import.meta.url))), free = [...workers]
  let submitted = 0
  const executor = { persistentWorkerCount: 4, executeAsync(_Task: typeof WasmRouteTask, input: WasmRouteInput): Promise<unknown> {
    const worker = free.pop()
    if (!worker) throw new Error("Persistent workers were overcommitted")
    submitted++
    return new Promise((resolve, reject) => { worker.onmessage = (event: MessageEvent): void => { free.push(worker); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.output) }; worker.onerror = reject; worker.postMessage(input) })
  } }
  try {
    const reference = createCompletionFixture(); reference.MAX_ITERATIONS = 1; reference.solve()
    const solvers = [createCompletionFixture(), createCompletionFixture()]
    solvers.forEach((solver) => { solver.MAX_ITERATIONS = 1 })
    await Promise.all(solvers.map((solver) => solveWithWasmRoutes(solver, executor)))
    expect(submitted).toBe(6)
    for (const solver of solvers) { expect(solver.solved).toBe(true); expect(solver.state.regionSegments).toEqual(reference.state.regionSegments); expect(solver.iterations).toBe(reference.iterations) }
  } finally { workers.forEach((worker) => worker.terminate()) }
})
