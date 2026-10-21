import { expect, test } from "bun:test"
import {
  IndexedCandidateHeap,
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "lib/index"
import {
  afterColor,
  beforeColor,
  expectPerformanceSvg,
  performanceCanvas,
  visualMetric,
  visualPanel,
  visualText,
} from "./fixtures/performanceVisual"

const createSolver = (): TinyHyperGraphSolver => {
  const portCount = 42
  const topology: TinyHyperGraphTopology = {
    portCount,
    regionCount: 4,
    regionIncidentPorts: [
      Array.from({ length: 41 }, (_, index) => index),
      Array.from({ length: 41 }, (_, index) => index + 1),
      [0],
      [41],
    ],
    incidentPortRegion: Array.from({ length: portCount }, (_, index) =>
      index === 0 ? [0, 2] : index === 41 ? [1, 3] : [0, 1],
    ),
    regionWidth: new Float64Array(4).fill(100),
    regionHeight: new Float64Array(4).fill(100),
    regionCenterX: new Float64Array(4),
    regionCenterY: new Float64Array(4),
    portAngleForRegion1: Int32Array.from(
      { length: portCount },
      (_, i) => i * 100,
    ),
    portAngleForRegion2: Int32Array.from(
      { length: portCount },
      (_, i) => i * 100,
    ),
    portX: Float64Array.from({ length: portCount }, (_, i) => i),
    portY: new Float64Array(portCount),
    portZ: new Int32Array(portCount),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: Int32Array.from([0]),
    routeEndPort: Int32Array.from([41]),
    routeNet: Int32Array.from([7]),
    regionNetId: new Int32Array(4).fill(-1),
    portSectionMask: new Int8Array(portCount).fill(1),
  }
  const solver = new TinyHyperGraphSolver(topology, problem, {
    OWNED_REGIONAL_HOP_FRONTIER: true,
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  solver._setup()
  solver.state.candidateQueue = new IndexedCandidateHeap(topology.regionCount)
  solver.state.portAssignment[41] = 9
  return solver
}

test("owned metadata skips repeated static checks and resets at explicit search boundaries", async (): Promise<void> => {
  const workSnapshots = []
  for (const boundary of ["none", "clear", "best-cost-reset", "neighbors"]) {
    const cached = createSolver()
    const original = createSolver()
    // Re-preparing every occurrence restores the original owned frontier's
    // static checks while leaving closure, scoring, and queue behavior intact.
    const originalFrontier = original["getRegionalHopFrontier"].bind(original)
    original["getRegionalHopFrontier"] = (...args) => {
      const frontier = originalFrontier(...args)
      frontier?.prepared.fill(0)
      return frontier
    }
    const keyCalls = [0, 0]
    const portCalls = [new Int32Array(42), new Int32Array(42)]
    let comparedSteps = 0
    for (const [index, solver] of [cached, original].entries()) {
      const getHopId = solver.getHopId.bind(solver)
      solver.getHopId = (portId, nextRegionId): number => {
        keyCalls[index]!++
        portCalls[index]![portId]!++
        return getHopId(portId, nextRegionId)
      }
    }
    for (let iteration = 0; iteration < 50; iteration++) {
      if (iteration === 12 && boundary !== "none") {
        for (const solver of [cached, original]) {
          if (boundary === "clear") solver.state.candidateQueue.clear()
          if (boundary === "best-cost-reset") {
            solver.resetCandidateBestCosts()
            solver.problem.portSectionMask[3] = 0
            solver.state.portAssignment[4] = 9
          }
          if (boundary === "neighbors") {
            solver.topology.regionIncidentPorts[1] = [1, 2, 3, 41, 4, 5, 6]
          }
        }
      }
      cached._step()
      original._step()
      expect(cached.state).toEqual(original.state)
      expect(cached.solved).toBe(original.solved)
      expect(cached.failed).toBe(original.failed)
      expect(cached.stats).toEqual(original.stats)
      comparedSteps++
    }
    expect(keyCalls[0]).toBeLessThan(keyCalls[1]!)
    workSnapshots.push({
      invalidationBoundary: boundary,
      stepsWithEqualStateAndStats: comparedSteps,
      beforeRepeatedMetadata: { hopIdEvaluations: keyCalls[1] },
      afterOwnedMetadataCache: { hopIdEvaluations: keyCalls[0] },
      repeatedHopIdEvaluationsAvoided: keyCalls[1]! - keyCalls[0]!,
    })
    if (boundary === "none") {
      const graphics = performanceCanvas(
        "Reuse fixed metadata while the search keeps the same decisions",
        "42-port graph shown schematically. Each number records a real getHopId call; state and stats match after every step.",
      )
      for (const [left, calls, title, color] of [
        [24, portCalls[1]!, "Before: recompute each occurrence", beforeColor],
        [
          624,
          portCalls[0]!,
          "After: prepare once, reuse within the epoch",
          afterColor,
        ],
      ] as const) {
        visualPanel(
          graphics,
          left,
          title,
          "Each circle is a port; its label is the observed call count.",
          color,
        )
        expect(calls.reduce((sum, count) => sum + count, 0)).toBe(
          left === 24 ? keyCalls[1]! : keyCalls[0]!,
        )
        for (const [portId, count] of calls.entries()) {
          const x = left + 48 + (portId % 7) * 74
          const y = 201 + Math.floor(portId / 7) * 48
          const alpha = Math.min(0.75, 0.08 + count / 55)
          graphics.circles.push({
            center: { x, y },
            radius: 14,
            fill:
              left === 24
                ? `rgba(180,83,9,${alpha})`
                : `rgba(4,120,87,${alpha})`,
            stroke: portId === 41 ? "#dc2626" : color,
          })
          visualText(graphics, x - 8, y, String(portId), 12)
          visualText(graphics, x - 23, y + 23, `${count} calls`, 11, color)
        }
        visualText(
          graphics,
          left + 20,
          492,
          "Red outline: goal port belongs to another net in this fixture.",
          13,
          "#64748b",
        )
      }
      visualMetric(
        graphics,
        "Hop-ID evaluations over the same search steps",
        keyCalls[1]!,
        keyCalls[0]!,
        `${comparedSteps} paired steps: identical routing state, queue behavior and statistics. Live costs are still evaluated.`,
      )
      await expectPerformanceSvg(graphics, import.meta.path)
    }
  }
  expect(workSnapshots).toMatchSnapshot(
    "owned metadata removes repeated work and refreshes at search boundaries",
  )
})
