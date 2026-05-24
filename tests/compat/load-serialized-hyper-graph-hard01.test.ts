import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import * as hard01 from "../../datasets/hard01"

const datasetModule = hard01 as Record<string, unknown> & {
  manifest: {
    samples: Array<{
      sampleName: string
    }>
  }
}

test("loadSerializedHyperGraph loads every hard01 dataset sample", () => {
  for (const { sampleName } of datasetModule.manifest.samples) {
    expect(() =>
      loadSerializedHyperGraph(
        datasetModule[sampleName] as SerializedHyperGraph,
      ),
    ).not.toThrow()
  }
})
