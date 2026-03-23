import { expect, test } from "bun:test"

test("hg07 section optimization profiling script runs successfully", () => {
  const result = Bun.spawnSync(
    [
      "bun",
      "run",
      "scripts/profiling/hg07-section-optimization-profile.ts",
      "--sample-count=1",
      "--attempts-per-section=1",
      "--max-sections-to-try=1",
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
  expect(stdout).toContain("hg-07 section optimization profile")
  expect(stdout).toContain(
    "samples=1 loadFailures=0 initialFailures=0 sectionFailures=0",
  )
})
