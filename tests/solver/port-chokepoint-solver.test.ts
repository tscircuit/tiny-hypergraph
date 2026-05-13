import "bun-match-svg"
import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  stackGraphicsVertically,
} from "graphics-debug"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import {
  ChokepointSolver,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSolver,
  expandPortChokepoints,
} from "lib/index"
import { portChokepointFixture } from "tests/fixtures/port-chokepoint.fixture"

test("chokepoint solver expands one-port cutsets and solves the repro", () => {
  const { topology, problem } = loadSerializedHyperGraph(portChokepointFixture)
  const baselineSolver = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 20_000,
    STATIC_REACHABILITY_PRECHECK: false,
  })
  const chokepointSolver = new ChokepointSolver({
    topology,
    problem,
    options: {
      STATIC_REACHABILITY_PRECHECK: false,
    },
  })

  baselineSolver.solve()
  chokepointSolver.solve()
  const preprocessed = chokepointSolver.getOutput()
  const preprocessedSolver = new TinyHyperGraphSolver(
    preprocessed.topology,
    preprocessed.problem,
    {
      MAX_ITERATIONS: 20_000,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  )
  preprocessedSolver.solve()

  expect(baselineSolver.solved).toBe(false)
  expect(baselineSolver.failed).toBe(true)
  expect(preprocessed.expansions).toHaveLength(2)
  expect(preprocessed.topology.portCount).toBe(topology.portCount + 2)
  expect(preprocessedSolver.solved).toBe(true)
  expect(preprocessedSolver.failed).toBe(false)
  expect(preprocessedSolver.getOutput().solvedRoutes).toHaveLength(2)
})

test("chokepoint solver visualization snapshot", () => {
  const { topology, problem } = loadSerializedHyperGraph(portChokepointFixture)
  const expanded = expandPortChokepoints({ topology, problem })
  const solver = new ChokepointSolver({
    topology,
    problem,
    options: {
      STATIC_REACHABILITY_PRECHECK: false,
    },
  })

  solver.step()
  const identifiedGraphics = solver.visualize()
  solver.step()
  const expandedGraphics = solver.visualize()

  const stagedSvg = getSvgFromGraphicsObject(
    stackGraphicsVertically([identifiedGraphics, expandedGraphics], {
      titles: ["identified chokepoints", "expanded chokepoints"],
    }),
  )
  expect(stagedSvg).toMatchSvgSnapshot(import.meta.path)

  expect(expanded.expansions).toHaveLength(2)
  expect(expanded.passCount).toBe(1)
  expect(solver.solved).toBe(true)
})

test("section pipeline can opt into chokepoint preprocessing before solveGraph", () => {
  const pipelineSolver = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: portChokepointFixture,
    chokepointSolverOptions: {
      STATIC_REACHABILITY_PRECHECK: false,
    },
    solveGraphOptions: {
      MAX_ITERATIONS: 20_000,
      STATIC_REACHABILITY_PRECHECK: false,
    },
  })

  while (!pipelineSolver.hasStageOutput("solveGraph")) {
    pipelineSolver.step()
  }

  const preprocessed = pipelineSolver.getStageOutput("preprocessChokepoints")
  const solveGraphSolver =
    pipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")

  expect(preprocessed.expansions).toHaveLength(2)
  expect(solveGraphSolver?.solved).toBe(true)
  expect(solveGraphSolver?.failed).toBe(false)
})

test("chokepoint preprocessing respects safety caps", () => {
  const { topology, problem } = loadSerializedHyperGraph(portChokepointFixture)

  expect(
    expandPortChokepoints({
      topology,
      problem,
      options: { MAX_CHOKEPOINT_EXPANSIONS: 1 },
    }).expansions,
  ).toHaveLength(0)
  expect(
    expandPortChokepoints({
      topology,
      problem,
      options: { MAX_CHOKEPOINT_SEARCH_PORTS: topology.portCount - 1 },
    }).expansions,
  ).toHaveLength(0)
})
