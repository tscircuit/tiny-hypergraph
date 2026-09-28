import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "@consumer/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "@consumer/lib/testing/evaluate-relaxed-drc"
import { DuplicateCongestedPortSolver as Original } from "@consumer/node_modules/tiny-hypergraph/lib/DuplicateCongestedPortSolver"
import { DuplicateCongestedPortSolver as Candidate } from "./pinned-boundary/lib/DuplicateCongestedPortSolver"
let activeLazy = false
const originalSolve = Original.prototype.solve,
  originalDuplicate = Original.prototype.duplicateCongestedPorts
Original.prototype.solve = function () {
  this.options.routeSolveOptions = {
    ...this.options.routeSolveOptions,
    USE_LAZY_ROUTE_HEURISTIC: activeLazy,
  }
  return originalSolve.call(this)
}
const inputs = {}
const hash = async (v) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(v)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
window.ready = Promise.all(
  [1, 3, 5].map(
    async (s) =>
      (inputs[s] = await (await fetch(`/scenario-${s}.json`)).json()),
  ),
)
window.runFull = async (mode, sample) => {
  await window.ready
  activeLazy = mode === "lazy"
  Original.prototype.duplicateCongestedPorts =
    mode === "boundary"
      ? Candidate.prototype.duplicateCongestedPorts
      : originalDuplicate
  const input = structuredClone(inputs[sample])
  window.gc?.()
  const heapBefore = performance.memory?.usedJSHeapSize
  const start = performance.now()
  const solver = new Pipeline(input, { effort: 1 })
  while (!solver.solved && !solver.failed && performance.now() - start < 60000)
    solver.step()
  const elapsedMs = performance.now() - start,
    timedOut = !solver.solved && !solver.failed
  const heapAfter = performance.memory?.usedJSHeapSize
  const result = {
    mode,
    sample,
    elapsedMs,
    solved: solver.solved,
    failed: solver.failed,
    timedOut,
    error: solver.error,
    phase: solver.getCurrentPhase(),
    heapBefore,
    heapAfter,
  }
  if (solver.solved) {
    const traces = solver.getOutputSimplifiedPcbTraces()
    const drc = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs ?? input,
      routedTraces: traces,
    })
    result.hash = await hash(solver.getOutputSimpleRouteJson())
    result.drcErrors = drc.errors.length
    result.vias = traces.reduce(
      (n, t) => n + t.route.filter((p) => p.route_type === "via").length,
      0,
    )
    result.planarWireLength = traces.reduce(
      (sum, t) =>
        sum +
        t.route.reduce((n, p, i, a) => {
          const prev = a[i - 1]
          return prev && prev.route_type === "wire" && p.route_type === "wire"
            ? n + Math.hypot(p.x - prev.x, p.y - prev.y)
            : n
        }, 0),
      0,
    )
  }
  return result
}
