import { expect, test } from "bun:test"
import {
  ParallelRouteSearchPool,
  type ParallelSearchExecutor,
} from "../lib/parallel/ParallelRouteSearchPool"
import { createCompletionFixture } from "./fixtures/createCompletionFixture"
import { createRouteSearchExecutor } from "./fixtures/createRouteSearchExecutor"

test("a real worker startup failure propagates and releases the group", async () => {
  const solver = createCompletionFixture()
  solver.setup()
  const executor = createRouteSearchExecutor(4)
  const broken: ParallelSearchExecutor = {
    persistentWorkerCount: 4,
    executeAsync: (Task, input) =>
      executor.executeAsync(Task, {
        ...input,
        topology: { ...input.topology, regionCount: -1 },
      }),
  }
  const pool = new ParallelRouteSearchPool(solver, broken)
  try {
    await expect(pool.start()).rejects.toThrow()
    await expect(pool.dispose()).rejects.toThrow()
  } finally {
    executor.dispose()
  }
})
