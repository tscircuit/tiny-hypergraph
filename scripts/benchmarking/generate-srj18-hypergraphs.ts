import { AutoroutingPipelineSolver7_MultiGraph } from "srj18-autorouter"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Match tscircuit/tscircuit-autorouter's dataset pin, rather than the older
// completed-only Pipeline 7 archive used by benchmark.sh.
const datasetCommit = "100e8957ce789b5b288e14c476dc83f4efc5214b"
const datasetDir = dirname(fileURLToPath(import.meta.resolve("dataset-srj18")))
const out = resolve(process.argv[2] ?? "work/srj18")
const effort = 0.1
mkdirSync(out, { recursive: true })
for (let i = 1; i <= 16; i++) {
  const sample = `sample${String(i).padStart(3, "0")}`
  const raw = readFileSync(
    resolve(datasetDir, "samples", `${sample}.json`),
    "utf8",
  )
  const solver = new AutoroutingPipelineSolver7_MultiGraph(JSON.parse(raw), {
    effort,
    cacheProvider: null,
  })
  solver.solveUntilPhase("portPointPathingSolver")
  if (solver.failed) throw new Error(`${sample}: ${solver.error}`)
  while (!solver.portPointPathingSolver && !solver.failed && !solver.solved)
    solver.step()
  if (solver.failed) throw new Error(`${sample}: ${solver.error}`)
  // The published autorouter retains its TS-private pipeline input at runtime.
  // Read the actual stage input without running downstream high-density routing.
  const pipeline = (solver.portPointPathingSolver as any)?.tinyPipelineSolver
  const graph = pipeline?.inputProblem?.serializedHyperGraph
  if (!graph) throw new Error(`${sample}: no tiny-hypergraph stage input`)
  const graphJson = JSON.stringify(graph, (_, v) =>
    v === Infinity ? "Infinity" : v,
  )
  writeFileSync(resolve(out, `${sample}.hg.json`), graphJson)
  writeFileSync(
    resolve(out, `${sample}.source.json`),
    JSON.stringify(
      {
        sample,
        datasetCommit,
        autorouterVersion: "0.0.979",
        pipeline: "AutoroutingPipelineSolver7_MultiGraph",
        effort,
        srjSha256: createHash("sha256").update(raw).digest("hex"),
        graphSha256: createHash("sha256").update(graphJson).digest("hex"),
        regions: graph.regions.length,
        ports: graph.ports.length,
        connections: graph.connections.length,
      },
      null,
      2,
    ),
  )
  console.log(
    `${sample}: ${graph.regions.length} regions, ${graph.ports.length} ports, ${graph.connections.length} connections`,
  )
}
