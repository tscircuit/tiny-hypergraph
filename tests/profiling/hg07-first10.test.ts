import { expect, test } from "bun:test"

test("hg07 first10 profiling script runs successfully", () => {
  const result = Bun.spawnSync(
    ["bun", "run", "scripts/profiling/hg07-first10.ts"],
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
  expect(stdout).toContain("hg-07 first 10 solve profile")
  expect(stdout).toContain("samples=10 failed=0")
})
