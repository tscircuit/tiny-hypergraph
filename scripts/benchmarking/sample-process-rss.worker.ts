import { parentPort } from "node:worker_threads"

const memorySamplerPort = parentPort

if (!memorySamplerPort) {
  throw new Error("Memory sampler must run in a worker thread")
}

const rssMeasurements = [process.memoryUsage().rss]
const sampleInterval = setInterval(() => {
  rssMeasurements.push(process.memoryUsage().rss)
}, 100)

memorySamplerPort.once("message", (message) => {
  if (message !== "stop") {
    throw new Error(`Unexpected memory sampler message: ${String(message)}`)
  }

  clearInterval(sampleInterval)
  rssMeasurements.push(process.memoryUsage().rss)
  memorySamplerPort.postMessage(rssMeasurements)
})
