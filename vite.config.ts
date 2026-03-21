import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: {
    alias: {
      lib: fileURLToPath(new URL("./lib", import.meta.url)),
    },
  },
})
