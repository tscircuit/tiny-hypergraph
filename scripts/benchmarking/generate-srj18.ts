import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  AutoroutingPipelineSolver7_MultiGraph as Pipeline7,
  type SimpleRouteJson,
} from "@tscircuit/capacity-autorouter"
import { dataset as srj18Dataset } from "dataset-srj18"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

type Srj18Dataset = Record<string, SimpleRouteJson>

type Pipeline7RuntimeShape = {
  portPointPathingSolver?: {
    tinyPipelineSolver?: {
      inputProblem?: {
        serializedHyperGraph?: SerializedHyperGraph
      }
    }
  }
}

const DEFAULT_MAX_PIPELINE_STEPS = 1_000_000

export const getSrj18DatasetDir = (cwd = process.cwd()) =>
  path.join(cwd, "generated-datasets", "srj18")

const getSrj18SampleEntries = () =>
  Object.entries(srj18Dataset as Srj18Dataset)
    .filter(([sampleName]) => /^sample\d+$/.test(sampleName))
    .sort(([leftSampleName], [rightSampleName]) =>
      leftSampleName.localeCompare(rightSampleName),
    )

export const getSrj18SampleNames = () =>
  getSrj18SampleEntries().map(([sampleName]) => sampleName)

const directoryExists = async (dir: string) => {
  try {
    return (await stat(dir)).isDirectory()
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return false
    }
    throw error
  }
}

const fileExists = async (filePath: string) => {
  try {
    return (await stat(filePath)).isFile()
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return false
    }
    throw error
  }
}

const assertSerializedHyperGraph = (
  value: unknown,
  sampleName: string,
): SerializedHyperGraph => {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as SerializedHyperGraph).regions) &&
    Array.isArray((value as SerializedHyperGraph).ports) &&
    Array.isArray((value as SerializedHyperGraph).connections)
  ) {
    return value as SerializedHyperGraph
  }

  throw new Error(
    `Pipeline7 did not expose a serialized tiny-hypergraph input for ${sampleName}`,
  )
}

const getTinyHyperGraphInputFromPipeline7 = (
  sampleName: string,
  simpleRouteJson: SimpleRouteJson,
  maxPipelineSteps: number,
) => {
  const solver = new Pipeline7(structuredClone(simpleRouteJson), {
    cacheProvider: null,
    effort: 1,
  })
  const introspectableSolver = solver as unknown as Pipeline7RuntimeShape
  let stepCount = 0

  while (solver.getCurrentPhase() !== "portPointPathingSolver") {
    if (solver.failed) {
      throw new Error(
        `Pipeline7 failed before portPointPathingSolver for ${sampleName}: ${solver.error ?? "unknown error"}`,
      )
    }
    if (solver.solved) {
      throw new Error(
        `Pipeline7 solved before reaching portPointPathingSolver for ${sampleName}`,
      )
    }
    if (stepCount >= maxPipelineSteps) {
      throw new Error(
        `Pipeline7 exceeded ${maxPipelineSteps} steps before portPointPathingSolver for ${sampleName}`,
      )
    }

    solver.step()
    stepCount += 1
  }

  while (
    !introspectableSolver.portPointPathingSolver?.tinyPipelineSolver
      ?.inputProblem?.serializedHyperGraph
  ) {
    if (solver.failed) {
      throw new Error(
        `Pipeline7 failed while creating tiny-hypergraph input for ${sampleName}: ${solver.error ?? "unknown error"}`,
      )
    }
    if (stepCount >= maxPipelineSteps) {
      throw new Error(
        `Pipeline7 exceeded ${maxPipelineSteps} steps while creating tiny-hypergraph input for ${sampleName}`,
      )
    }

    solver.step()
    stepCount += 1
  }

  const serializedHyperGraph =
    introspectableSolver.portPointPathingSolver.tinyPipelineSolver.inputProblem
      .serializedHyperGraph

  return {
    serializedHyperGraph: assertSerializedHyperGraph(
      serializedHyperGraph,
      sampleName,
    ),
    stepCount,
  }
}

export const generateSrj18Dataset = async ({
  cwd = process.cwd(),
  force = false,
  maxPipelineSteps = DEFAULT_MAX_PIPELINE_STEPS,
  sampleNames,
}: {
  cwd?: string
  force?: boolean
  maxPipelineSteps?: number
  sampleNames?: string[]
} = {}) => {
  const outputDir = getSrj18DatasetDir(cwd)
  const requestedSampleNames = new Set(sampleNames ?? getSrj18SampleNames())
  const sampleEntries = getSrj18SampleEntries().filter(([sampleName]) =>
    requestedSampleNames.has(sampleName),
  )

  const unknownSampleNames = [...requestedSampleNames].filter(
    (sampleName) =>
      !sampleEntries.some(
        ([candidateSampleName]) => candidateSampleName === sampleName,
      ),
  )
  if (unknownSampleNames.length > 0) {
    throw new Error(`Unknown srj18 sample(s): ${unknownSampleNames.join(", ")}`)
  }

  const missingSampleEntries = []
  for (const sampleEntry of sampleEntries) {
    const [sampleName] = sampleEntry
    const outputPath = path.join(outputDir, `${sampleName}.hg.json`)
    if (force || !(await fileExists(outputPath))) {
      missingSampleEntries.push(sampleEntry)
    }
  }

  if (missingSampleEntries.length === 0) {
    return { outputDir, generated: false, sampleCount: sampleEntries.length }
  }

  if (force && sampleNames === undefined) {
    await rm(outputDir, { recursive: true, force: true })
  }
  await mkdir(outputDir, { recursive: true })

  for (const [sampleName, simpleRouteJson] of missingSampleEntries) {
    const startedAt = performance.now()
    const { serializedHyperGraph, stepCount } =
      getTinyHyperGraphInputFromPipeline7(
        sampleName,
        simpleRouteJson,
        maxPipelineSteps,
      )
    const outputPath = path.join(outputDir, `${sampleName}.hg.json`)
    const tempPath = `${outputPath}.tmp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`
    await writeFile(tempPath, `${JSON.stringify(serializedHyperGraph)}\n`)
    await rename(tempPath, outputPath)
    const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(2)
    console.log(
      `generated ${sampleName}.hg.json regions=${serializedHyperGraph.regions.length} ports=${serializedHyperGraph.ports.length} connections=${serializedHyperGraph.connections?.length ?? 0} pipelineSteps=${stepCount} duration=${durationSeconds}s`,
    )
  }

  return {
    outputDir,
    generated: true,
    sampleCount: missingSampleEntries.length,
  }
}

export const ensureSrj18DatasetGenerated = async (
  cwd = process.cwd(),
  sampleNames?: string[],
) => {
  const outputDir = getSrj18DatasetDir(cwd)
  const requiredSampleNames = sampleNames ?? getSrj18SampleNames()
  const missingSampleNames = []

  for (const sampleName of requiredSampleNames) {
    const outputPath = path.join(outputDir, `${sampleName}.hg.json`)
    if (!(await fileExists(outputPath))) {
      missingSampleNames.push(sampleName)
    }
  }

  if (missingSampleNames.length === 0) {
    return {
      outputDir,
      generated: false,
      sampleCount: requiredSampleNames.length,
    }
  }

  if (!(await directoryExists(outputDir))) {
    console.log(`missing generated dataset at ${outputDir}`)
  }
  console.log(
    `generating dataset=srj18 with Pipeline7 samples=${missingSampleNames.join(",")}`,
  )
  return generateSrj18Dataset({ cwd, sampleNames: missingSampleNames })
}

if (import.meta.main) {
  const force = process.argv.includes("--force")
  const sampleIndex = process.argv.findIndex((arg) => arg === "--sample")
  const sampleNames =
    sampleIndex === -1
      ? undefined
      : [process.argv[sampleIndex + 1]].filter(Boolean)
  await generateSrj18Dataset({ force, sampleNames })
}
