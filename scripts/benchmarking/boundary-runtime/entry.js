import { DuplicateCongestedPortSolver as PinnedBase } from "./pinned-baseline/lib/DuplicateCongestedPortSolver"
import { TinyHyperGraphSolver as PinnedBaseCore } from "./pinned-baseline/lib/core"
import { DuplicateCongestedPortSolver as PinnedBoundary } from "./pinned-boundary/lib/DuplicateCongestedPortSolver"
import { TinyHyperGraphSolver as PinnedBoundaryCore } from "./pinned-boundary/lib/core"
import { DuplicateCongestedPortSolver as CurrentBase } from "./current-baseline/lib/DuplicateCongestedPortSolver"
import { TinyHyperGraphSolver as CurrentBaseCore } from "./current-baseline/lib/core"
import { DuplicateCongestedPortSolver as CurrentBoundary } from "./current-boundary/lib/DuplicateCongestedPortSolver"
import { TinyHyperGraphSolver as CurrentBoundaryCore } from "./current-boundary/lib/core"
const modes = {
  "pinned-baseline": [PinnedBase, !1],
  "pinned-lazy": [PinnedBase, !0],
  "pinned-boundary": [PinnedBoundary, !1],
  "current-baseline": [CurrentBase, !1],
  "current-boundary": [CurrentBoundary, !1],
}
let active
for (const Core of [
  PinnedBaseCore,
  PinnedBoundaryCore,
  CurrentBaseCore,
  CurrentBoundaryCore,
]) {
  const setup = Core.prototype.computeProblemSetup,
    h = Core.prototype.computeH
  Core.prototype.computeProblemSetup = function () {
    const r = setup.call(this)
    if (active) {
      active.solves++
      active.eagerEntries += r.portHCostToEndOfRoute?.length ?? 0
      active.eagerBytes += r.portHCostToEndOfRoute?.byteLength ?? 0
    }
    return r
  }
  Core.prototype.computeH = function (p) {
    if (active) active.hQueries++
    return h.call(this, p)
  }
}
const inputs = [],
  hash = async (value) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(value)),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  heap = () => performance.memory?.usedJSHeapSize ?? null
window.ready = Promise.all(
  [1, 2, 3, 4, 5].map(async (sample) => {
    const s = await (await fetch(`/sample-${sample}.json`)).text()
    inputs[sample] = JSON.parse(s, (_, v) =>
      v?.__nonfinite === "Infinity"
        ? 1 / 0
        : v?.__nonfinite === "-Infinity"
          ? -1 / 0
          : v?.__nonfinite === "NaN"
            ? NaN
            : v,
    )
  }),
).then(() => !0)
window.runCase = async (mode, sample) => {
  await window.ready
  const input = inputs[sample],
    [Solver, lazy] = modes[mode]
  window.lastSolver = null
  window.gc?.()
  const heapBefore = heap()
  active = { solves: 0, eagerEntries: 0, eagerBytes: 0, hQueries: 0 }
  const start = performance.now(),
    solver = new Solver(input.graph, {
      ...input.options,
      routeSolveOptions: {
        ...input.options.routeSolveOptions,
        USE_LAZY_ROUTE_HEURISTIC: lazy,
      },
    })
  solver.solve()
  const elapsedMs = performance.now() - start,
    heapAfter = heap()
  if (solver.failed || !solver.solved)
    throw Error(`${mode}/${sample}: ${solver.error}`)
  const counts = active
  active = void 0
  window.lastSolver = solver
  window.gc?.()
  const heapRetained = heap(),
    outputHash = await hash({
      graph: solver.getOutput(),
      report: solver.report,
    })
  return {
    mode,
    sample,
    elapsedMs,
    heapBefore,
    heapAfter,
    heapRetained,
    hash: outputHash,
    ...counts,
  }
}
