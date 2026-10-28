import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "lib/core"
import { DuplicateCongestedPortSolver } from "lib/DuplicateCongestedPortSolver"
import { createFixedCopperProblem, createFixedCopperTopology } from "../fixtures/fixed-copper/synthetic"

test("independent port duplication estimates retain fixed interior costs in their reused one-route problems", () => {
  const plain = new TinyHyperGraphSolver(createFixedCopperTopology(), createFixedCopperProblem())
  plain.solve()
  const graph = plain.getOutput()
  graph.regions[1].d = {...graph.regions[1].d, fixedCopperTraceWidth: 0.1, fixedCopperSegments: [
    {netId: null, x1: 0, y1: -1, x2: 0, y2: 1, z: 0, width: 0.1, clearance: 0.1},
  ]}
  const duplicate = new DuplicateCongestedPortSolver(graph)
  duplicate.solve()
  expect(duplicate.solved).toBe(true)
  expect(duplicate.failed).toBe(false)
  expect(duplicate.report.portUseCounts["port-2"]).toBe(1)
  expect(duplicate.report.portUseCounts["port-1"]).toBeUndefined()
  const output = duplicate.getOutput()
  expect(output.regions[1].d?.fixedCopperSegments).toEqual(graph.regions[1].d?.fixedCopperSegments)
})
