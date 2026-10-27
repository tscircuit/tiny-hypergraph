import {
  publishTransitionScore,
  readTransitionScore,
  type SharedTransitionScores,
} from "../../lib/parallel/SharedTransitionScores"

self.onmessage = (
  event: MessageEvent<{ data: SharedTransitionScores; worker: number }>,
): void => {
  try {
    const { data, worker } = event.data
    for (let pass = 0; pass < 20; pass++) {
      const version = 2 + ((pass + worker) % 8) * 2
      for (let i = 0; i < data.heads.length; i++) {
        const cell = (i * 17 + worker) % data.heads.length
        const cost = version + cell / 8192
        publishTransitionScore(data, cell, version, cost, worker)
        const value = readTransitionScore(data, cell, version)
        if (!Number.isNaN(value) && value !== cost)
          throw new Error(
            "Shared transition score was torn or mismatched its version",
          )
      }
    }
    self.postMessage({ done: true })
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
