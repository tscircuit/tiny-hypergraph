import type {
  RouteSearchInput,
  RouteSearchTask,
} from "../../lib/parallel/RouteSearchTask"

export function createRouteSearchExecutor(workerCount: 1 | 4) {
  const workers = Array.from(
    { length: workerCount },
    () => new Worker(new URL("./routeSearch.worker.ts", import.meta.url)),
  )
  const free = [...workers]
  let submitted = 0
  let maximumActive = 0
  return {
    persistentWorkerCount: workerCount,
    get submitted(): number {
      return submitted
    },
    get maximumActive(): number {
      return maximumActive
    },
    executeAsync(
      _Task: typeof RouteSearchTask,
      input: RouteSearchInput,
    ): Promise<unknown> {
      const worker = free.pop()
      if (!worker) throw new Error("Route workers overcommitted")
      submitted++
      maximumActive = Math.max(maximumActive, workers.length - free.length)
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
    dispose(): void {
      for (const worker of workers) worker.terminate()
    },
  }
}
