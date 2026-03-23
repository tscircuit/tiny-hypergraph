import { expect, test } from "bun:test"

test("hg07 profiling script runs successfully with the default sample count", () => {
  const result = Bun.spawnSync(["bun", "run", "scripts/profiling/hg07.ts"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = new TextDecoder().decode(result.stdout)
  const stderr = new TextDecoder().decode(result.stderr)

  expect(result.exitCode).toBe(0)
  expect(stderr).toBe("")
  expect(stdout).toContain("hg-07 solve profile")
  expect(stdout).toContain("requestedSamples=10")
  expect(stdout).toContain("includedSamples=10")
  expect(stdout).toContain("skippedSamples=0")
  expect(stdout).toContain("avgNonZeroRegionCost")
  expect(stdout).toContain('"averageAvgNonZeroRegionCost"')
})

test("hg07 profiling script accepts --sample-count and skips invalid samples", () => {
  const result = Bun.spawnSync(
    ["bun", "run", "scripts/profiling/hg07.ts", "--sample-count", "50"],
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
  expect(stdout).toContain("requestedSamples=50")
  expect(stdout).toMatch(/includedSamples=\d+/)
  expect(stdout).toMatch(/skippedSamples=\d+/)
  expect(stdout).toContain('"averageAvgNonZeroRegionCost"')
})

test("hg07 profiling script accepts --congestion-falloff", () => {
  const result = Bun.spawnSync(
    [
      "bun",
      "run",
      "scripts/profiling/hg07.ts",
      "--sample-count",
      "10",
      "--congestion-falloff",
      "0.5",
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
  expect(stdout).toContain("congestionFalloff=0.5")
  expect(stdout).toContain('"averageAvgNonZeroRegionCost"')
})
