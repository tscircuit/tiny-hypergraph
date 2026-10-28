import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

test("benchmark skips legacy local SRJ18 datasets without a manifest", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tiny-hypergraph-benchmark-"))
  try {
    const legacyDir = path.join(cwd, "generated-datasets", "srj18")
    await mkdir(legacyDir, { recursive: true })
    await writeFile(path.join(legacyDir, "sample001.hg.json"), "{}")

    const result =
      await Bun.$`bash ${fileURLToPath(new URL("../benchmark.sh", import.meta.url))} --limit 2`
        .cwd(cwd)
        .quiet()
        .nothrow()

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(
      await readFile(path.join(cwd, "benchmark-result.json"), "utf8"),
    )
    expect(report.datasetName).toBe("srj18")
    expect(report.sampleCount).toBe(2)
    expect(report.successCount).toBe(2)
    expect(report.samples[0].sampleName).toBe("sample001")
    const peakMemoryMeasurements = report.samples
      .map(
        ({ peakMemoryBytes }: { peakMemoryBytes: number }) => peakMemoryBytes,
      )
      .sort((left: number, right: number) => left - right)
    expect(peakMemoryMeasurements[0]).toBeGreaterThan(0)
    expect(report.summary.p50RssBytes).toBe(peakMemoryMeasurements[0])
    expect(report.summary.p80RssBytes).toBe(peakMemoryMeasurements[1])
    expect(report.summary.p90RssBytes).toBe(peakMemoryMeasurements[1])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}, 30_000)
