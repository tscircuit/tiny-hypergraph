import { expect, test } from "bun:test"
import {
  readTransitionScore,
  type SharedTransitionScores,
} from "../lib/parallel/SharedTransitionScores"

test("four actual workers publish exact shared scores under contention", async () => {
  const cells = 1024
  const data: SharedTransitionScores = {
    offsets: new Int32Array(0),
    positions: new Int32Array(0),
    heads: new Int32Array(new SharedArrayBuffer(cells * 4)).fill(-1),
    versions: new Int32Array(new SharedArrayBuffer(cells * 128)),
    values: new Float64Array(new SharedArrayBuffer(cells * 256)),
    owners: new Int8Array(new SharedArrayBuffer(cells * 32)),
    next: new Int32Array(new SharedArrayBuffer(4)),
  }
  const workers = Array.from(
    { length: 4 },
    () =>
      new Worker(
        new URL("./fixtures/sharedScores.worker.ts", import.meta.url).href,
      ),
  )
  try {
    await Promise.all(
      workers.map(
        (worker, index) =>
          new Promise<void>((resolve, reject) => {
            worker.onerror = reject
            worker.onmessage = (event): void => {
              if (event.data.error) reject(new Error(event.data.error))
              else resolve()
            }
            worker.postMessage({ data, worker: index })
          }),
      ),
    )
    for (let cell = 0; cell < cells; cell++) {
      const record = Atomics.load(data.heads, cell)
      expect(record).toBeGreaterThanOrEqual(0)
      const version = data.versions[record]!
      expect(readTransitionScore(data, cell, version)).toBe(
        version + cell / 8192,
      )
    }
  } finally {
    for (const worker of workers) worker.terminate()
  }
})
