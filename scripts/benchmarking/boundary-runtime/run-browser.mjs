import { mkdirSync, appendFileSync } from "node:fs"
const root = process.argv[2]
if (!root)
  throw Error(
    "Usage: CHROMIUM_PATH=... bun run-browser.mjs EXPERIMENT_DIR [--full]",
  )
const smoke = process.argv.includes("--smoke")
const lazyFull = process.argv.includes("--full-lazy")
const full = process.argv.includes("--full") || lazyFull,
  chrome = process.env.CHROMIUM_PATH
if (!chrome) throw Error("Set CHROMIUM_PATH to a headless Chromium executable")
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const name =
        new URL(req.url).pathname === "/"
          ? "index.html"
          : new URL(req.url).pathname.slice(1)
      return new Response(Bun.file(`${root}/${name}`))
    },
  }),
  profile = `${root}/chrome-profile-${Date.now()}`
mkdirSync(profile)
const child = Bun.spawn(
  [
    chrome,
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--enable-precise-memory-info",
    "--js-flags=--expose-gc",
    `http://localhost:${server.port}/${full ? "full.html" : ""}`,
  ],
  {
    stdout: Bun.file(`${root}/chrome.log`),
    stderr: Bun.file(`${root}/chrome-error.log`),
  },
)
let ws
try {
  let port = ""
  for (let i = 0; i < 200; i++) {
    if (await Bun.file(`${profile}/DevToolsActivePort`).exists()) {
      port = (await Bun.file(`${profile}/DevToolsActivePort`).text()).split(`
`)[0]
      break
    }
    await Bun.sleep(50)
  }
  if (!port) throw Error("Chromium did not expose debugger")
  const version = await (
    await fetch(`http://localhost:${port}/json/version`)
  ).json()
  let pages = []
  for (let i = 0; i < 200; i++) {
    pages = await (await fetch(`http://localhost:${port}/json/list`)).json()
    if (pages.some((p) => p.type === "page")) break
    await Bun.sleep(50)
  }
  const target = pages.find((p) => p.type === "page")
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let next = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id) {
      const h = pending.get(m.id)
      pending.delete(m.id)
      m.error ? h.reject(m.error) : h.resolve(m.result)
    }
  }
  const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++next
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      }),
    evaluate = async (expression) => {
      const r = await call("Runtime.evaluate", {
        expression,
        awaitPromise: !0,
        returnByValue: !0,
      })
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
      return r.result.value
    }
  let ready = false
  for (let attempt = 0; attempt < 200 && !ready; attempt++) {
    try {
      ready = await evaluate(
        "window.ready ? window.ready.then(()=>true) : false",
      )
    } catch (error) {
      if (!JSON.stringify(error).includes("Execution context was destroyed"))
        throw error
    }
    if (!ready) await Bun.sleep(50)
  }
  if (!ready) throw new Error("Browser bundle did not become ready")

  const meta = {
      kind: "metadata",
      smoke,
      version,
      platform: await evaluate("navigator.userAgent"),
      date: new Date().toISOString(),
      warmupRounds: full ? void 0 : smoke ? 0 : 2,
      measuredRounds: full ? void 0 : smoke ? 1 : 5,
      warmupCases: full ? (lazyFull ? 1 : 2) : void 0,
      measuredRunsPerVariant: full ? 1 : void 0,
      order: lazyFull
        ? "separate lazy-only session; warmup sample1, measured1,3,5; compare hashes to prior full baseline; hashing/DRC excluded"
        : full
          ? "warmup sample1 baseline/boundary; measured samples1,3,5, baseline first except3; fresh solver; GC before solve; hashing and DRC excluded"
          : "rotate modes each round; sample order1..5; fresh solver; GC before and after solve; hashing excluded",
      memory: full
        ? "usedJSHeapSize before/after solve; not peak/RSS"
        : "usedJSHeapSize before solve, immediately after solve, after GC retaining solver; not peak/RSS",
    },
    out = `${root}/${lazyFull ? "chromium-full-lazy-results" : full ? "chromium-full-results" : "chromium-results"}.jsonl`
  await Bun.write(
    out,
    JSON.stringify(meta) +
      `
`,
  )
  console.log(JSON.stringify(meta))
  if (full) {
    for (const mode of lazyFull ? ["lazy"] : ["baseline", "boundary"]) {
      const r = await evaluate(`window.runFull(${JSON.stringify(mode)},1)`)
      appendFileSync(
        out,
        JSON.stringify({ ...r, warmup: !0 }) +
          `
`,
      )
      console.log(JSON.stringify({ ...r, warmup: !0 }))
    }
    const hashes = new Map()
    if (lazyFull) {
      const prior = (
        await Bun.file(`${root}/chromium-full-results.jsonl`).text()
      )
        .trim()
        .split("\n")
        .map(JSON.parse)
      for (const row of prior)
        if (row.mode === "baseline" && !row.warmup && row.solved)
          hashes.set(row.sample, row.hash)
    }
    for (const sample of [1, 3, 5])
      for (const mode of lazyFull
        ? ["lazy"]
        : sample === 3
          ? ["boundary", "baseline"]
          : ["baseline", "boundary"]) {
        const r = await evaluate(
          `window.runFull(${JSON.stringify(mode)},${sample})`,
        )
        if (r.solved && hashes.has(sample) && hashes.get(sample) !== r.hash)
          throw Error(`Full output mismatch ${sample}`)
        if (r.solved) hashes.set(sample, r.hash)
        appendFileSync(
          out,
          JSON.stringify({ ...r, warmup: !1 }) +
            `
`,
        )
        console.log(JSON.stringify({ ...r, warmup: !1 }))
      }
  } else {
    const modes = [
        "pinned-baseline",
        "pinned-lazy",
        "pinned-boundary",
        "current-baseline",
        "current-boundary",
      ],
      expected = new Map()
    for (let round = smoke ? 0 : -2; round < (smoke ? 1 : 5); round++) {
      const offset = (round + 2) % modes.length,
        order = [...modes.slice(offset), ...modes.slice(0, offset)]
      for (let sample = 1; sample <= (smoke ? 1 : 5); sample++)
        for (const mode of order) {
          const r = await evaluate(
            `window.runCase(${JSON.stringify(mode)},${sample})`,
          )
          if (expected.has(sample) && expected.get(sample) !== r.hash)
            throw Error(`Hash mismatch ${mode}/${sample}`)
          expected.set(sample, r.hash)
          appendFileSync(
            out,
            JSON.stringify({ ...r, round, warmup: round < 0 }) +
              `
`,
          )
        }
      console.log(
        `Completed ${round < 0 ? "warmup" : "measured"} round ${round}; hashes identical`,
      )
    }
  }
  await Bun.write(
    `${root}/summary-ready`,
    `done
`,
  )
} finally {
  ws?.close()
  child.kill()
  await child.exited
  server.stop(!0)
}
