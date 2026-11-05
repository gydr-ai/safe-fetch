// Build the published package: one minified ESM bundle (esbuild) plus type
// declarations (tsc). Plain Node, no dependencies beyond the two tools.
import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)

// 1. Start from an empty dist/.
rmSync(resolve(root, "dist"), { recursive: true, force: true })

// 2. JavaScript: one minified bundle with a source map. Any warning fails
//    the build, so nothing questionable ships silently.
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  keepNames: true,
  sourcemap: true,
  sourcesContent: true,
  legalComments: "none",
  packages: "external",
  outfile: "dist/index.js",
  metafile: true,
  logLevel: "warning",
})

if (result.warnings.length > 0) {
  console.error(`esbuild reported ${result.warnings.length} warning(s)`)
  process.exit(1)
}

// 3. Types: declarations only, with @internal symbols stripped.
const tsc = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  { cwd: root, stdio: "inherit" },
)

if (tsc.status !== 0) process.exit(tsc.status ?? 1)

const bytes = result.metafile.outputs["dist/index.js"]?.bytes ?? 0

console.log(`dist/index.js ${bytes} bytes`)
