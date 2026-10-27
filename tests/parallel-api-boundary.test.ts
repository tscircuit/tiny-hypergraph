import { expect, test } from "bun:test"

test("only the explicit parallel entry includes worker code and both entries use TypeScript", async () => {
  const [serial, parallel] = await Promise.all(
    ["../lib/index.ts", "../lib/core-parallel.ts"].map((entrypoint) =>
      Bun.build({
        entrypoints: [new URL(entrypoint, import.meta.url).pathname],
        target: "browser",
        format: "esm",
      }),
    ),
  )
  expect(serial.success).toBe(true)
  expect(parallel.success).toBe(true)
  const serialSource = await serial.outputs[0]!.text()
  const parallelSource = await parallel.outputs[0]!.text()
  expect(serialSource).not.toContain("AGFzbQE")
  expect(serialSource).not.toContain("RegionCostTask")
  expect(parallelSource).not.toContain("AGFzbQE")
  expect(parallelSource).not.toContain("WebAssembly")
  expect(parallelSource).toContain("RegionCostTask")
})
