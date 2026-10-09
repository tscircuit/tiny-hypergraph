import { Debugger } from "./components/Debugger"
import { yPreExitFixture } from "../tests/fixtures/y-pre-exit.fixture"

export default function YPreExitPage() {
  return <Debugger serializedHyperGraph={yPreExitFixture} />
}
