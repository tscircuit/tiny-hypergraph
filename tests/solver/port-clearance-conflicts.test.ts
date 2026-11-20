import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "../../lib/core"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "../../lib/prepared/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("ordinary and prepared routing keep incompatible boundary slots on one net", (): void => {
  for (const Solver of [
    TinyHyperGraphSolver,
    SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments,
    PreparedPortPointRoutingSolver,
  ]) {
    const input = createPreparedRoutingFixture()
    input.topology.portClearanceConflicts = Array.from(
      { length: input.topology.portCount },
      () => [],
    )
    for (let base = 0; base < input.topology.portCount; base += 12) {
      for (const [a, b] of [
        [2, 4],
        [3, 5],
        [6, 8],
        [7, 9],
      ]) {
        input.topology.portClearanceConflicts[base + a] = [base + b]
        input.topology.portClearanceConflicts[base + b] = [base + a]
      }
    }
    const solver = new Solver(input.topology, input.problem, input.options)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    for (const [
      port,
      conflicts,
    ] of input.topology.portClearanceConflicts.entries()) {
      const net = solver.state.portAssignment[port]
      if (net === -1) continue
      for (const other of conflicts)
        expect([-1, net]).toContain(solver.state.portAssignment[other])
    }
    // Sharing physical copper remains legal for branches of one net.
    input.problem.routeNet.fill(0)
    const shared = new Solver(input.topology, input.problem, input.options)
    shared.solve()
    expect(shared.solved).toBeTrue()
  }
})
