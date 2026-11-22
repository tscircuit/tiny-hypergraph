import "bun-match-svg"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { TinyHyperGraphSolver } from "lib/core"
import { IndexedCandidateHeap } from "lib/indexed-candidate-heap"
import { DenseRoutingWorkspace } from "lib/prepared/DenseRoutingWorkspace"
import { PreparedRoutingGeometry } from "lib/prepared/PreparedRoutingGeometry"
import { getPreloadedSingleLayerCrossing } from "../fixtures/getPreloadedSingleLayerCrossing"

test("checks the final segment across the captured single-layer cell", () => {
  for (const mode of ["core", "frontier", "dense", "greedy"]) {
    const { topology, problem } = getPreloadedSingleLayerCrossing()
    const fixed = problem.initialAssignments![0]
    const queryPorts = topology.regionIncidentPorts[fixed.regionId].filter(
      (port) => port !== fixed.fromPortId && port !== fixed.toPortId,
    )
    const [start, goal] = queryPorts
    problem.routeStartPort[0] = start
    problem.routeEndPort[0] = goal
    const options = { OWNED_REGIONAL_HOP_FRONTIER: mode === "frontier" }
    const parent = new TinyHyperGraphSolver(topology, problem, options)
    const solver =
      mode === "greedy"
        ? parent["createGreedyFinalRouteSolver"](options, 0)
        : parent

    // Expand the real entry-to-exit hop directly to isolate goal acceptance.
    solver.state.currentRouteId = 0
    solver.state.currentRouteNetId = problem.routeNet[0]
    solver.state.goalPortId = goal
    solver.state.unroutedRoutes = []
    solver.state.candidateQueue = new IndexedCandidateHeap(topology.regionCount)
    solver.state.candidateQueue.queue({
      portId: start,
      nextRegionId: fixed.regionId,
      hopId: solver.getHopId(start, fixed.regionId),
      g: 0,
      h: 0,
      f: 0,
    })
    if (mode === "dense") {
      const workspace = new DenseRoutingWorkspace(
        new PreparedRoutingGeometry(topology),
      )
      expect(workspace.step(solver)).toBe(true)
    } else {
      solver._step()
    }

    expect(solver.state.regionSegments[fixed.regionId]).toHaveLength(2)
    expect(
      solver.state.regionIntersectionCaches[fixed.regionId]
        .existingSameLayerIntersections,
    ).toBe(1)
    if (mode === "core") {
      expect(
        getSvgFromGraphicsObject(solver.preview(), {
          backgroundColor: "white",
        }),
      ).toMatchSvgSnapshot(import.meta.path)
    }
  }
})
