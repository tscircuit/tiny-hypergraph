import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"
import { createFixedCopperProblem, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("absent and explicitly empty fixed geometry preserve outputs, steps, caches and work", () => {
  for (const Solver of [TinyHyperGraphSolver, PreparedPortPointRoutingSolver]) {
    const absent = new Solver(createFixedCopperTopology(), createFixedCopperProblem())
    const empty = new Solver(createFixedCopperTopology(), createFixedCopperProblem([]))
    absent.solve()
    empty.solve()
    expect(empty.getOutput()).toEqual(absent.getOutput())
    expect(empty.iterations).toBe(absent.iterations)
    expect(empty.stats).toEqual(absent.stats)
    expect(empty.state.regionIntersectionCaches).toEqual(absent.state.regionIntersectionCaches)
    expect(empty.state.ripCount).toBe(absent.state.ripCount)
  }
})
