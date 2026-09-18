import "bun-match-svg"
import { expect, test } from "bun:test"
import { manifest, sample005 } from "dataset-hg07"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  loadSerializedHyperGraph,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
} from "lib/index"

test("circuit005 solved hypergraph matches the benchmark pipeline", () => {
  // The graph dataset maps circuit005 to sample005; retain the source identity.
  expect(
    manifest.samples.find((sample) => sample.sampleName === "sample005")
      ?.circuitKey,
  ).toBe("circuit005")
  const pipeline = new TinyHyperGraphSectionPipelineSolver({
    serializedHyperGraph: structuredClone(sample005),
    fullConnectionReroute: {},
  })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)

  const output = pipeline.getOutput()!
  expect(output.solvedRoutes).toHaveLength(sample005.connections!.length)
  const { topology, problem, solution } = loadSerializedHyperGraph(output)
  const replay = new TinyHyperGraphSectionSolver(topology, problem, solution)
  const { maxRegionCost, totalRegionCost } = replay.baselineSummary
  const graphSvg = getSvgFromGraphicsObject(replay.baselineSolver.visualize(), {
    svgWidth: 1200,
    svgHeight: 650,
  })
  const svg = `<svg width="1200" height="750" viewBox="0 0 1200 750" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="750" fill="white"/>
    <text x="36" y="38" font-family="sans-serif" font-size="24" fill="#111827">Circuit 005 — solved hypergraph</text>
    <text x="36" y="70" font-family="sans-serif" font-size="16" fill="#4b5563">${output.solvedRoutes!.length}/${sample005.connections!.length} connections · Max region cost: ${maxRegionCost.toFixed(6)} · Total region cost: ${totalRegionCost.toFixed(6)}</text>
    ${graphSvg.replace("<svg ", '<svg y="90" ')}
  </svg>`
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
