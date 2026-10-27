import { WasmRouteTask } from "../../lib/parallel/WasmRouteTask"
self.onmessage = (event: MessageEvent): void => {
  try { const task = new WasmRouteTask(event.data); task.solve(); self.postMessage({ output: task.getOutput() }) }
  catch (error) { self.postMessage({ error: String(error) }) }
}
