import { createRV1106Solver } from "../tests/fixtures/rv1106-full-board"
import { writeFileSync } from "node:fs"
import { getSvgFromGraphicsObject } from "graphics-debug"

const solver = createRV1106Solver()
const iterationBudget = Number(process.argv[2] ?? solver.MAX_ITERATIONS)
if (!Number.isSafeInteger(iterationBudget) || iterationBudget < 1) {
  throw new Error("Pass a positive integer iteration budget")
}
const started = performance.now()
const progressInterval = 50_000
while (
  !solver.solved &&
  !solver.failed &&
  solver.iterations < iterationBudget
) {
  solver.step()
  if (solver.iterations % progressInterval === 0) {
    console.error(
      JSON.stringify({
        iterations: solver.iterations,
        elapsedMs: performance.now() - started,
        selectiveRipCount: solver.getSelectiveReripStats().selectiveRipCount,
      }),
    )
  }
}
console.log(
  JSON.stringify(
    {
      elapsedMs: performance.now() - started,
      iterations: solver.iterations,
      maxIterations: solver.MAX_ITERATIONS,
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      selectiveRerip: solver.getSelectiveReripStats(),
    },
    null,
    2,
  ),
)
writeFileSync("rv1106-result.svg", getSvgFromGraphicsObject(solver.visualize()))
if (solver.failed) process.exitCode = 1
