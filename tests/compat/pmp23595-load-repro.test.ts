import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"

type Pmp23595Repro = {
  serializedHyperGraph: SerializedHyperGraph
}

test("loads the complete PMP23595 hypergraph", () => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/pmp23595-congested-ports-repro.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as Pmp23595Repro

  const { topology, problem } = loadSerializedHyperGraph(
    fixture.serializedHyperGraph,
  )

  expect(topology.regionCount).toBe(29_691)
  expect(topology.portCount).toBe(136_543)
  expect(problem.routeCount).toBe(458)
})
