import { RegionCostTask } from "../../lib/core-parallel"
self.onmessage = (event: MessageEvent): void => {
  try {
    const task = new RegionCostTask(event.data)
    task.solve()
    self.postMessage({ output: task.getOutput() })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
