import { expect, test } from "bun:test"

test("section solver hotspot profiling script runs successfully", () => {
  const result = Bun.spawnSync(
    [
      "bun",
      "run",
      "scripts/profiling/section-solver-hotspots.ts",
      "--source",
      "hg07",
      "--sample",
      "sample032",
      "--mode",
      "fixed-candidate",
      "--repeat",
      "1",
      "--max-hot-regions",
      "2",
    ],
    {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const stdout = new TextDecoder().decode(result.stdout)
  const stderr = new TextDecoder().decode(result.stderr)

  expect(result.exitCode).toBe(0)
  expect(stderr).toBe("")
  expect(stdout).toContain("section solver hotspot profile")
  expect(stdout).toContain("\"mode\": \"fixed-candidate\"")
})
