import { expect, test } from "bun:test"
import { sample005 } from "dataset-hg07"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { FullConnectionRerouteSolver } from "../lib/full-connection-reroute-solver"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

test("reroute budgets and pipeline timeout retain the complete, isolated incumbent", () => {
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: sample005,
  })
  while (
    !pipeline.getSolver<FullConnectionRerouteSolver>("rerouteFullConnections")
  )
    pipeline.step()
  const reroute = pipeline.getSolver<FullConnectionRerouteSolver>(
    "rerouteFullConnections",
  )!
  const originalSolver = reroute.getSolvedSolver()
  const originalSegments = structuredClone(originalSolver.state.regionSegments)
  const originalCaches = structuredClone(
    originalSolver.state.regionIntersectionCaches,
  )
  const original = pipeline.getOutput()!
  while (reroute.getOutput() === original && !pipeline.solved) pipeline.step()
  expect(reroute.getOutput()).not.toBe(original)
  expect(originalSolver.state.regionSegments).toEqual(originalSegments)
  expect(originalSolver.state.regionIntersectionCaches).toEqual(originalCaches)
  pipeline.tryFinalAcceptance()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.getOutput()).toBe(reroute.getOutput())
  expect(pipeline.getSolvedSolver()).toBe(reroute.getSolvedSolver())

  const loaded = loadSerializedHyperGraph(original)
  const limited = new FullConnectionRerouteSolver(
    loaded.topology,
    loaded.problem,
    loaded.solution,
    {},
    { maxTotalIterations: 1 },
    original,
  )
  limited.solve()
  expect(limited.iterations).toBe(1)
  expect(limited.failed).toBe(false)
  expect(limited.solved).toBe(true)
  expect(limited.getOutput()).toBe(original)
  expect(limited.getSolvedSolver().state.regionSegments).toEqual(
    originalSegments,
  )
})
