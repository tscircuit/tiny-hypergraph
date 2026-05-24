import { readFile } from "node:fs/promises"
import { expect, test } from "bun:test"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

type Srj18Pipeline7Manifest = {
  sampleCount: number
  cases: Array<{
    sampleName: string
    extractionStatus: "success" | "failed"
  }>
}

type Srj18Pipeline7Case = {
  solverInput?: {
    serializedHyperGraph: Parameters<typeof loadSerializedHyperGraph>[0]
  }
}

const DATASET_DIR = new URL("../../datasets/srj18-pipeline7/", import.meta.url)

const readJson = async <T>(path: URL): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T

test("loadSerializedHyperGraph loads every srj18 pipeline7 dataset sample", async () => {
  const manifest = await readJson<Srj18Pipeline7Manifest>(
    new URL("manifest.json", DATASET_DIR),
  )
  const loadErrors: string[] = []

  expect(manifest.sampleCount).toBe(16)

  for (const { sampleName, extractionStatus } of manifest.cases) {
    expect(extractionStatus).toBe("success")

    const benchmarkCase = await readJson<Srj18Pipeline7Case>(
      new URL(`${sampleName}.tiny-hypergraph.json`, DATASET_DIR),
    )
    const serializedHyperGraph = benchmarkCase.solverInput?.serializedHyperGraph

    if (!serializedHyperGraph) {
      loadErrors.push(`${sampleName}: missing serialized hypergraph`)
      continue
    }

    try {
      loadSerializedHyperGraph(serializedHyperGraph)
    } catch (error) {
      loadErrors.push(`${sampleName}: ${String(error)}`)
    }
  }

  expect(loadErrors).toEqual([])
})
