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

test("loadSerializedHyperGraph loads hg07 except its known baseline endpoint failure", () => {
  let loaded = 0
  const knownFailures: string[] = []

  for (const { sampleName } of datasetModule.manifest.samples) {
    const sample = datasetModule[sampleName] as SerializedHyperGraph

    try {
      loadSerializedHyperGraph(sample)
      loaded++
    } catch (error) {
      // Present before incidence validation at both c60c552 and c1043b.
      // Do not hide other loader errors: they may be compatibility regressions.
      if (
        sampleName === "sample014" &&
        error instanceof Error &&
        error.message ===
          'Connection "source_trace_69" could not be mapped to route endpoints'
      ) {
        knownFailures.push(sampleName)
      } else {
        throw error
      }
    }
  }

  expect(loaded).toBe(104)
  expect(knownFailures).toEqual(["sample014"])
})

test("loadSerializedHyperGraph loads hg07 sample001", () => {
  expect(() =>
    loadSerializedHyperGraph(datasetModule.sample001 as SerializedHyperGraph),
  ).not.toThrow()
})
