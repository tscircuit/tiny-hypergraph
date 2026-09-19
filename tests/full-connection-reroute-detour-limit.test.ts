import { expect, test } from "bun:test"
import { sample005 } from "dataset-hg07"
import { TinyHyperGraphSectionPipelineSolver } from "../lib/section-solver/TinyHyperGraphSectionPipelineSolver"

test("a connection detour limit cannot spend improvements from the whole graph", () => {
  const pipelines = [undefined, 2].map((maxRouteSegmentRatio) => {
    const pipeline = new TinyHyperGraphSectionPipelineSolver({
      serializedHyperGraph: sample005,
      fullConnectionRerouteOptions: { maxRouteSegmentRatio },
    })
    pipeline.solve()
    expect(pipeline.solved).toBe(true)
    return pipeline
  })
  expect(pipelines[0]!.getOutput()).not.toEqual(
    pipelines[0]!.getStageOutput("optimizeSection"),
  )
  // The original route has one segment. Adding five segments is a small
  // increase for the whole graph but a sixfold detour for that connection.
  expect(pipelines[1]!.getOutput()).toEqual(
    pipelines[1]!.getStageOutput("optimizeSection"),
  )
})
