import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { TinyHyperGraphMultiSectionUnravelSolver } from "lib/index"
import { DatasetHg07SamplePage } from "./components/DatasetHg07SamplePage"

export default function DatasetHg07UnravelPage() {
  return (
    <DatasetHg07SamplePage
      modeLabel="multi-section unravel solver"
      createSolver={(serializedHyperGraph) => {
        const { topology, problem, solution } =
          loadSerializedHyperGraph(serializedHyperGraph)

        return new TinyHyperGraphMultiSectionUnravelSolver(
          topology,
          problem,
          solution,
        )
      }}
    />
  )
}
