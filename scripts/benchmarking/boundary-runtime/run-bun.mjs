import { appendFileSync } from "node:fs"
import { heapStats } from "bun:jsc"
const smoke = process.argv.includes("--smoke")
const root = process.argv[2]
if (!root) throw Error("Usage: bun run-bun.mjs EXPERIMENT_DIR")
globalThis.window = globalThis
globalThis.gc = () => Bun.gc(!0)
globalThis.fetch = async (path) => new Response(Bun.file(`${root}${path}`))
Object.defineProperty(performance, "memory", {
  get: () => ({ usedJSHeapSize: heapStats().heapSize }),
})
await import(`${root}/entry.js`)
await globalThis.ready
const modes = [
    "pinned-baseline",
    "pinned-lazy",
    "pinned-boundary",
    "current-baseline",
    "current-boundary",
  ],
  out = `${root}/bun-results.jsonl`
await Bun.write(
  out,
  JSON.stringify({
    kind: "metadata",
    smoke,
    engine: "Bun " + Bun.version,
    warmupRounds: smoke ? 0 : 2,
    measuredRounds: smoke ? 1 : 5,
    order: "same rotating mode order and inputs as Chromium",
    memory:
      "bun:jsc heapStats().heapSize at same three points; not peak/RSS; not comparable absolute units to Chromium heap",
  }) +
    `
`,
)
const expected = new Map()
for (let round = smoke ? 0 : -2; round < (smoke ? 1 : 5); round++) {
  const offset = (round + 2) % modes.length,
    order = [...modes.slice(offset), ...modes.slice(0, offset)]
  for (let sample = 1; sample <= (smoke ? 1 : 5); sample++)
    for (const mode of order) {
      const r = await globalThis.runCase(mode, sample)
      if (expected.has(sample) && expected.get(sample) !== r.hash)
        throw Error(`Hash mismatch ${mode}/${sample}`)
      expected.set(sample, r.hash)
      appendFileSync(
        out,
        JSON.stringify({ ...r, round, warmup: round < 0 }) +
          `
`,
      )
    }
  console.log(`Completed round ${round}; hashes identical`)
}
