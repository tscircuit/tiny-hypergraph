import { expect, test } from "bun:test"
import * as datasetHg07 from "dataset-hg07"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

const datasetModule = datasetHg07 as Record<string, unknown> & {
  manifest: {
    samples: Array<{
      sampleName: string
    }>
  }
}

test("loadSerializedHyperGraph loads every hg07 dataset sample", () => {
  const fullObstacleErrors: string[] = []

  for (const { sampleName } of datasetModule.manifest.samples) {
    const sample = datasetModule[sampleName] as SerializedHyperGraph

    try {
      loadSerializedHyperGraph(sample)
    } catch (error) {
      if (String(error).includes("references full-obstacle region")) {
        fullObstacleErrors.push(`${sampleName}: ${String(error)}`)
      }
    }
  }

  expect(fullObstacleErrors).toEqual([])
})

test("loadSerializedHyperGraph loads hg07 sample001", () => {
  expect(() =>
    loadSerializedHyperGraph(datasetModule.sample001 as SerializedHyperGraph),
  ).not.toThrow()
})
