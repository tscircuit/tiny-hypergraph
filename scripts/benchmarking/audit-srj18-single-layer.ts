import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { TinyHyperGraphSolver } from "../../lib/core"
import { loadSerializedHyperGraph } from "../../lib/compat/loadSerializedHyperGraph"
const parse = (file: string) =>
  JSON.parse(readFileSync(file, "utf8"), (_, v) =>
    v === "Infinity" ? Infinity : v,
  )
const inputDir = resolve(process.argv[2] ?? "work/srj18")
const baseline = parse(process.argv[3] ?? "work/fixed-round-srj18-results.json")
const out = process.argv[4] ?? "work/srj18-single-layer-audit.json"
const serial = baseline.trials.find((trial: any) => trial.label === "serial-1m")
if (!serial) throw new Error("No serial baseline")
const report = {
  datasetCommit: baseline.datasetCommit,
  solver: "TinyHyperGraphSolver",
  budget: 1000000,
  methodology:
    "Audit the exact measured serial outputs against the model single-layer intersection constraint. This is not a final PCB DRC check.",
  samples: [] as Array<Record<string, unknown>>,
}
for (const sample of serial.samples) {
  const graph = parse(resolve(inputDir, `${sample.sample}.hg.json`))
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(topology, problem)
  solver.solve()
  const output = solver.solved && !solver.failed ? solver.getOutput() : null
  const outputHash = createHash("sha256")
    .update(JSON.stringify(output))
    .digest("hex")
  if (outputHash !== sample.outputHash)
    throw new Error(
      `${sample.sample}: output differs from measured serial baseline`,
    )
  let crossingRegions = 0,
    totalCrossings = 0
  for (let r = 0; r < topology.regionCount; r++)
    if (
      solver.isKnownSingleLayerRegion(r) &&
      solver.state.regionIntersectionCaches[r].existingSameLayerIntersections >
        0
    ) {
      crossingRegions++
      totalCrossings +=
        solver.state.regionIntersectionCaches[r].existingSameLayerIntersections
    }
  const row = {
    sample: sample.sample,
    solved: solver.solved,
    failed: solver.failed,
    crossingRegions,
    totalCrossings,
    outputHash,
    measuredOutputMatches: true,
  }
  report.samples.push(row)
  console.log(JSON.stringify(row))
}
writeFileSync(out, JSON.stringify(report, null, 2))
