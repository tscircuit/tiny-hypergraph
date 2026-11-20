import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "../../lib/prepared/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("pad clearance passages admit only their owning net in every routing engine", (): void => {
  for (const Solver of [
    TinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments,
    PreparedPortPointRoutingSolver,
  ]) {
    const input = createPreparedRoutingFixture()
    input.topology.portAllowedNets = Array.from(
      { length: input.topology.portCount },
      () => undefined,
    )
    for (let base = 0; base < input.topology.portCount; base += 12) {
      for (const index of [2, 3, 6, 7])
        input.topology.portAllowedNets[base + index] = [base / 6]
    }
    const solver = new Solver(input.topology, input.problem, input.options)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    for (const [port, allowed] of input.topology.portAllowedNets.entries()) {
      if (allowed)
        expect([-1, ...allowed]).toContain(solver.state.portAssignment[port])
    }
    input.problem.routeNet.fill(0)
    input.topology.portAllowedNets = Array.from(
      { length: input.topology.portCount },
      () => [0],
    )
    const shared = new Solver(input.topology, input.problem, input.options)
    shared.solve()
    expect(shared.solved).toBeTrue()
  }
})
