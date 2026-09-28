import { execFileSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"

const [packageArg, consumerArg, outputArg, inputsArg] = process.argv.slice(2)
if (!packageArg || !consumerArg || !outputArg) {
  throw new Error(
    "Usage: bun prepare.mjs PACKAGE_REPO AUTOROUTER_REPO OUTPUT_DIR [CAPTURED_INPUTS_DIR]",
  )
}
const packageRoot = resolve(packageArg)
const consumerRoot = resolve(consumerArg)
const output = resolve(outputArg)
mkdirSync(output, { recursive: true })
const git = (...args) => execFileSync("git", args, { cwd: packageRoot })
const packageJson = JSON.parse(
  readFileSync(`${consumerRoot}/package.json`, "utf8"),
)
const pin = (
  packageJson.dependencies?.["tiny-hypergraph"] ??
  packageJson.devDependencies?.["tiny-hypergraph"] ??
  ""
)
  .split("#")
  .at(-1)
if (!/^[0-9a-f]{40}$/.test(pin))
  throw new Error("Expected an exact tiny-hypergraph consumer pin")
const main = git("rev-parse", "origin/main").toString().trim()
const head = git("rev-parse", "HEAD").toString().trim()
for (const [name, ref] of [
  ["pinned-baseline", pin],
  ["pinned-boundary", pin],
  ["current-baseline", main],
  ["current-boundary", head],
]) {
  mkdirSync(`${output}/${name}`, { recursive: true })
  execFileSync("tar", ["-x", "-C", `${output}/${name}`], {
    input: git("archive", ref, "lib"),
  })
}
// Only the focused candidate method's source file changes in the consumer pin.
writeFileSync(
  `${output}/pinned-boundary/lib/DuplicateCongestedPortSolver.ts`,
  git("show", `${head}:lib/DuplicateCongestedPortSolver.ts`),
)
try {
  symlinkSync(`${consumerRoot}/node_modules`, `${output}/node_modules`)
} catch (error) {
  if (error.code !== "EEXIST") throw error
}
for (const name of [
  "entry.js",
  "run-browser.mjs",
  "run-bun.mjs",
  "capture-inputs.mjs",
])
  cpSync(`${import.meta.dir}/${name}`, `${output}/${name}`)
const full = readFileSync(
  `${import.meta.dir}/full-entry.template.js`,
  "utf8",
).replace(/(["'])@consumer\/([^"']+)\1/g, (_, _quote, suffix) =>
  JSON.stringify(`${consumerRoot}/${suffix}`),
)
writeFileSync(`${output}/full-entry.js`, full)
writeFileSync(
  `${output}/index.html`,
  '<!doctype html><script type="module" src="/bundle.js"></script>',
)
writeFileSync(
  `${output}/full.html`,
  '<!doctype html><script type="module" src="/full-bundle.js"></script>',
)
if (inputsArg) {
  for (const sample of [1, 2, 3, 4, 5])
    cpSync(
      `${resolve(inputsArg)}/sample-${sample}.json`,
      `${output}/sample-${sample}.json`,
    )
  for (const sample of [1, 3, 5])
    cpSync(
      `${resolve(inputsArg)}/scenario-${sample}.json`,
      `${output}/scenario-${sample}.json`,
    )
}
for (const [entry, outfile] of [
  ["entry.js", "bundle.js"],
  ["full-entry.js", "full-bundle.js"],
]) {
  const build = await Bun.build({
    entrypoints: [`${output}/${entry}`],
    target: "browser",
  })
  if (!build.success)
    throw new AggregateError(build.logs, "Browser build failed")
  await Bun.write(`${output}/${outfile}`, build.outputs[0])
}
writeFileSync(
  `${output}/revisions.json`,
  JSON.stringify(
    {
      packageMain: main,
      candidate: head,
      consumerPin: pin,
      consumerHead: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: consumerRoot,
      })
        .toString()
        .trim(),
    },
    null,
    2,
  ) + "\n",
)
console.log(
  `Prepared ${output}; capture inputs if not supplied, then run browser and Bun serially.`,
)
