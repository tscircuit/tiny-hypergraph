import { ParallelRouteSearchTask } from "../../lib/core-parallel"
self.onmessage = (event: MessageEvent): void => {
  try {
    const task = new ParallelRouteSearchTask(event.data)
    task.solve()
    self.postMessage({ output: task.getOutput() })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
