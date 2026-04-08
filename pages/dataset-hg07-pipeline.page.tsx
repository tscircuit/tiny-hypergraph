import { TinyHyperGraphSectionPipelineSolver } from "lib/index"
import { DatasetHg07SamplePage } from "./components/DatasetHg07SamplePage"

export default function DatasetHg07PipelinePage() {
  return (
    <DatasetHg07SamplePage
      modeLabel="solve + section + unravel pipeline"
      createSolver={(serializedHyperGraph) =>
        new TinyHyperGraphSectionPipelineSolver({
          serializedHyperGraph,
        })
      }
    />
  )
}
