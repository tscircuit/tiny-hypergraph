import { Debugger } from "./components/Debugger"

export default () => {
  return (
    <div>
      <div>{/*TODO allow user to select a sample number*/}</div>
      <Debugger key={selectedSampleIndex} serializedHyperGraph={sampleXXX} />
    </div>
  )
}
