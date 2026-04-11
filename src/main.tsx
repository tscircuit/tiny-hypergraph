import { type ComponentType, startTransition, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import TailwindDecorator from "../cosmos.decorator"

type FixtureQuery = {
  path?: string
}

type PageModule = {
  default: ComponentType
}

const pageModules = import.meta.glob<PageModule>("../pages/*.page.tsx")

const pagePaths = Object.keys(pageModules)
  .map((modulePath) => modulePath.replace(/^\.\.\//, ""))
  .sort()

const pageLoadersByPath = Object.fromEntries(
  Object.entries(pageModules).map(([modulePath, loadPage]) => [
    modulePath.replace(/^\.\.\//, ""),
    loadPage,
  ]),
) as Record<string, () => Promise<PageModule>>

const DEFAULT_PAGE_PATH =
  pagePaths.find((pagePath) => pagePath === "pages/dataset-hg07.page.tsx") ??
  pagePaths[0] ??
  null

const parseFixturePath = (fixtureParam: string) => {
  try {
    const parsedFixture = JSON.parse(fixtureParam) as FixtureQuery | string

    if (typeof parsedFixture === "string") {
      return parsedFixture
    }

    if (typeof parsedFixture.path === "string") {
      return parsedFixture.path
    }
  } catch {
    if (fixtureParam.endsWith(".tsx")) {
      return fixtureParam
    }
  }

  return null
}

const getRequestedPagePath = () => {
  const url = new URL(window.location.href)
  const fixtureParam = url.searchParams.get("fixture")

  if (fixtureParam) {
    return parseFixturePath(fixtureParam)
  }

  return url.searchParams.get("page")
}

const getDisplayName = (pagePath: string) =>
  pagePath
    .replace(/^pages\//, "")
    .replace(/\.page\.tsx$/, "")
    .replace(/-/g, " ")

const setRequestedPagePathInUrl = (pagePath: string) => {
  const url = new URL(window.location.href)
  url.searchParams.set("fixture", JSON.stringify({ path: pagePath }))
  window.history.pushState(window.history.state, "", url)
}

const PagePicker = ({
  activePagePath,
  onSelectPage,
}: {
  activePagePath: string | null
  onSelectPage: (pagePath: string) => void
}) => (
  <label
    style={{
      position: "fixed",
      top: 12,
      right: 12,
      zIndex: 10,
      display: "flex",
      gap: 8,
      alignItems: "center",
      padding: "8px 10px",
      borderRadius: 10,
      background: "rgba(255,255,255,0.92)",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
      backdropFilter: "blur(8px)",
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      fontSize: 12,
    }}
  >
    <span>Page</span>
    <select
      onChange={(event) => {
        onSelectPage(event.currentTarget.value)
      }}
      value={activePagePath ?? ""}
    >
      {pagePaths.map((pagePath) => (
        <option key={pagePath} value={pagePath}>
          {getDisplayName(pagePath)}
        </option>
      ))}
    </select>
  </label>
)

const EmptyState = ({
  errorMessage,
  onSelectPage,
}: {
  errorMessage?: string
  onSelectPage: (pagePath: string) => void
}) => (
  <div
    style={{
      minHeight: "100vh",
      padding: 24,
      background:
        "linear-gradient(180deg, rgb(248, 250, 252), rgb(226, 232, 240))",
      color: "rgb(15, 23, 42)",
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    }}
  >
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>tiny-hypergraph</h1>
      <p style={{ margin: "0 0 20px", lineHeight: 1.5 }}>
        Choose a page fixture to render. The deployed site also supports the
        README query format:{" "}
        <code>
          ?fixture={"{"}"path":"pages/..."{"}"}
        </code>
      </p>
      {errorMessage ? (
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            borderRadius: 10,
            background: "rgb(254, 242, 242)",
            color: "rgb(153, 27, 27)",
          }}
        >
          {errorMessage}
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gap: 12,
        }}
      >
        {pagePaths.map((pagePath) => (
          <button
            key={pagePath}
            onClick={() => {
              onSelectPage(pagePath)
            }}
            style={{
              textAlign: "left",
              padding: 14,
              borderRadius: 12,
              border: "1px solid rgb(203, 213, 225)",
              background: "white",
              cursor: "pointer",
            }}
            type="button"
          >
            {getDisplayName(pagePath)}
          </button>
        ))}
      </div>
    </div>
  </div>
)

const App = () => {
  const [requestedPagePath, setRequestedPagePath] = useState<string | null>(
    getRequestedPagePath,
  )
  const [PageComponent, setPageComponent] = useState<ComponentType | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const activePagePath = requestedPagePath ?? DEFAULT_PAGE_PATH

  useEffect(() => {
    const syncPagePathFromUrl = () => {
      startTransition(() => {
        setRequestedPagePath(getRequestedPagePath())
      })
    }

    window.addEventListener("popstate", syncPagePathFromUrl)
    return () => {
      window.removeEventListener("popstate", syncPagePathFromUrl)
    }
  }, [])

  useEffect(() => {
    if (!activePagePath) {
      setPageComponent(null)
      setErrorMessage("No page fixtures were found.")
      document.title = "tiny-hypergraph"
      return
    }

    const loadPage = pageLoadersByPath[activePagePath]
    if (!loadPage) {
      setPageComponent(null)
      setErrorMessage(`Unknown fixture path: ${activePagePath}`)
      document.title = "tiny-hypergraph"
      return
    }

    let isCancelled = false

    setErrorMessage(null)
    setPageComponent(null)

    void loadPage()
      .then((pageModule) => {
        if (isCancelled) {
          return
        }

        document.title = `${getDisplayName(activePagePath)} · tiny-hypergraph`
        setPageComponent(() => pageModule.default)
      })
      .catch((error) => {
        if (isCancelled) {
          return
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : `Failed to load ${activePagePath}`,
        )
      })

    return () => {
      isCancelled = true
    }
  }, [activePagePath])

  const navigateToPage = (pagePath: string) => {
    setRequestedPagePathInUrl(pagePath)
    startTransition(() => {
      setRequestedPagePath(pagePath)
    })
  }

  if (!PageComponent) {
    return (
      <EmptyState
        errorMessage={errorMessage ?? undefined}
        onSelectPage={navigateToPage}
      />
    )
  }

  return (
    <>
      <PagePicker
        activePagePath={activePagePath}
        onSelectPage={navigateToPage}
      />
      <TailwindDecorator>
        <PageComponent />
      </TailwindDecorator>
    </>
  )
}

const container = document.getElementById("root")

if (!container) {
  throw new Error("Root container not found")
}

createRoot(container).render(<App />)
