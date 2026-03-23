import { TinyHyperGraphSectionOptimizationPipelineSolver } from "lib/section-optimization-pipeline"
import { DatasetHg07Page } from "./components/DatasetHg07Page"

export default function DatasetHg07PipelinePage() {
  return (
    <DatasetHg07Page
      createSolver={({ topology, problem }) =>
        new TinyHyperGraphSectionOptimizationPipelineSolver({
          topology,
          problem,
        })
      }
    />
  )
}
