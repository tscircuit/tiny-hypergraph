import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  type Candidate,
  type TinyHyperGraphSolverOptions,
} from "../lib/core"
import { loadSerializedHyperGraph } from "../lib/compat/loadSerializedHyperGraph"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "../lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolver } from "../lib/selective-rerip-tiny-hyper-graph-solver"

const runRecordedPrefix = (
  fixture: string,
  lookup: boolean,
): {
  solver: SelectiveReripTinyHyperGraphSolver
  events: Array<[string, Candidate | undefined]>
} => {
  const input = JSON.parse(readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"))
  const graph = input.serializedHyperGraph ?? convertPortPointPathingSolverInputToSerializedHyperGraph(input)
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const options: TinyHyperGraphSolverOptions = {
    USE_REGION_COST_LOOKUP: lookup,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    STATIC_REACHABILITY_PRECHECK: false,
    MAX_ITERATIONS: 20_000,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
  }
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem, options)
  solver.setup()
  const queue = solver.state.candidateQueue
  const originalQueue = queue.queue.bind(queue)
  const originalDequeue = queue.dequeue.bind(queue)
  const originalClear = queue.clear.bind(queue)
  const events: Array<[string, Candidate | undefined]> = []
  queue.queue = (candidate): void => {
    events.push(["queue", candidate])
    originalQueue(candidate)
  }
  queue.dequeue = (): Candidate | undefined => {
    const candidate = originalDequeue()
    events.push(["dequeue", candidate])
    return candidate
  }
  queue.clear = (): void => {
    events.push(["clear", undefined])
    originalClear()
  }
  for (let step = 0; step < 2_000 && !solver.solved && !solver.failed; step++) {
    solver.step()
  }
  Reflect.deleteProperty(queue, "queue")
  Reflect.deleteProperty(queue, "dequeue")
  Reflect.deleteProperty(queue, "clear")
  return { solver, events }
}

test("region-cost tables preserve eager queue events and complete prefix state", (): void => {
  for (const fixture of ["CM5IO_HyperGraph.json", "bugreport87-unused-port-repro.json"]) {
    const control = runRecordedPrefix(fixture, false)
    const candidate = runRecordedPrefix(fixture, true)
    expect(candidate.events).toEqual(control.events)
    expect(candidate.solver.state).toEqual(control.solver.state)
    expect(candidate.solver.iterations).toBe(control.solver.iterations)
    expect(candidate.solver.stats).toEqual(control.solver.stats)
    expect(candidate.solver.solved).toBe(control.solver.solved)
    expect(candidate.solver.failed).toBe(control.solver.failed)
  }
})
