import { expect, test } from "bun:test"

test("hg07 unravel benchmark script runs successfully", () => {
  const result = Bun.spawnSync(
    [
      "bun",
      "run",
      "scripts/benchmarking/hg07-unravel.ts",
      "--limit",
      "2",
      "--depth",
      "1",
      "--states",
      "4",
      "--beam",
      "1",
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
  expect(stdout).toContain("running hg-07 unravel benchmark")
  expect(stdout).toContain("Summary")
  expect(stdout).toContain("improvedVsBaselineCount")
})
