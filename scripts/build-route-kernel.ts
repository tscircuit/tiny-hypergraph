import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { kernelFields } from "../lib/parallel/wasm/layout"

const root = resolve(import.meta.dir, "..")
const compiler = process.env.ZIG ?? "zig"
const temporary = await mkdtemp(join(tmpdir(), "tiny-hypergraph-kernels-"))
const sourceFields = (
  await Bun.file(resolve(root, "lib/parallel/wasm/kernel.cpp")).text()
)
  .match(/enum Field \{([^}]+)\}/)?.[1]
  .split(",")
  .map((field) => field.trim())
if (JSON.stringify(sourceFields) !== JSON.stringify(kernelFields))
  throw new Error("Route kernel field layout does not match TypeScript")

async function compile(
  name: string,
  source: string,
  exportName: string,
  exports: string[],
  shared = false,
  defines: string[] = [],
): Promise<void> {
  const output = resolve(temporary, `${name}.wasm`)
  const args = [
    compiler,
    "c++",
    "--target=wasm32-freestanding",
    "-std=c++17",
    "-O3",
    "-fno-exceptions",
    "-fno-rtti",
    "-fno-builtin",
    "-nostdlib",
    "-Wl,--no-entry",
    "-Wl,--import-memory",
    "-Wl,-z,stack-size=65536",
    ...defines,
  ]
  if (shared)
    args.push(
      "-matomics",
      "-msimd128",
      "-mbulk-memory",
      "-Wl,--shared-memory",
      "-Wl,--max-memory=1073741824",
    )
  args.push(
    ...exports.map((name) => `-Wl,--export=${name}`),
    resolve(root, `lib/parallel/wasm/${source}.cpp`),
    "-o",
    output,
  )
  const result = Bun.spawnSync(args, { stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0)
    throw new Error(`${name} compilation failed (${result.exitCode})`)
  const bytes = Buffer.from(await Bun.file(output).arrayBuffer())
  await Bun.write(
    resolve(root, `lib/parallel/wasm/${name}Bytes.ts`),
    `// Generated from ${source}.cpp; see scripts/build-route-kernel.ts.\nexport const ${exportName} = Uint8Array.from(\n  atob(\n    "${bytes.toString("base64")}",\n  ),\n  (character) => character.charCodeAt(0),\n)\n`,
  )
}

try {
  await compile(
    "kernel",
    "kernel",
    "routeKernelBytes",
    [
      "run",
      "single",
      "advance",
      "finishRoute",
      "requestConnectivity",
      "applyConnectivity",
      "prepare",
      "__heap_base",
      "__stack_pointer",
    ],
    true,
  )
  await compile("ownerKernel", "ownerKernel", "ownerKernelBytes", [
    "reset",
    "allocate",
    "search",
    "geometry",
  ])
  await compile(
    "ownerKernelShared",
    "ownerKernel",
    "ownerKernelSharedBytes",
    [
      "search",
      "prepareNativeGraph",
      "checkReachability",
      "__heap_base",
      "__stack_pointer",
    ],
    true,
    ["-DSHARED_OWNER_KERNEL"],
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}
