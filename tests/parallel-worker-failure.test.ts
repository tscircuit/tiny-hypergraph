import { expect, test } from "bun:test"
import { DistributedSearchPool } from "../lib/parallel/DistributedSearchPool"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"
import { createDistributedSearchExecutor } from "./fixtures/createDistributedSearchExecutor"

test("a real worker failure stops the entire barrier group and propagates", async () => {
  const solver = createCompletionFixture()
  solver.setup()
  const executor = createDistributedSearchExecutor(4)
  const pool = new DistributedSearchPool(solver, executor)
  try {
    await pool.start()
    // A query outside the immutable problem must fail in a worker and wake
    // owners that are already waiting at their first barrier.
    await expect(
      pool.search(solver.problem.routeCount + 1, 100),
    ).rejects.toThrow()
    await expect(pool.dispose()).rejects.toThrow()
  } finally {
    executor.dispose()
  }
})
