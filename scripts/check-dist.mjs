// Smoke-test the built package: every public export is present with the
// right type, the declarations exist, and no @internal symbol leaked into
// them. Run after `pnpm build`.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const failures = []

const expected = {
  assertSafeUrl: "function",
  createAddressPolicy: "function",
  createSafeFetch: "function",
  isBlockedAddress: "function",
  resolveSafeUrl: "function",
  safeFetch: "function",
  SafeFetchError: "function",
  SafeFetchErrorCode: "object",
  UnsafeUrlError: "function",
  UnsafeUrlReason: "object",
}

const api = await import(pathToFileURL(join(root, "dist/index.js")).href)

for (const [name, type] of Object.entries(expected)) {
  if (typeof api[name] !== type) {
    failures.push(`export ${name} is ${typeof api[name]}, expected ${type}`)
  }
}

for (const name of Object.keys(api)) {
  if (!(name in expected)) failures.push(`unexpected export ${name}`)
}

const typesDir = join(root, "dist/types")

if (!existsSync(join(typesDir, "index.d.ts"))) {
  failures.push("dist/types/index.d.ts is missing")
}

/** Every file below `dir`, recursively. */
function filesUnder(dir) {
  if (!existsSync(dir)) return []

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name))
      : [join(dir, entry.name)],
  )
}

// Names declared directly after a JSDoc block that carries @internal.
const internal = new Set()
const declaration =
  /\/\*\*(?:(?!\*\/)[\s\S])*@internal(?:(?!\*\/)[\s\S])*\*\/\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g

for (const file of filesUnder(join(root, "src"))) {
  for (const match of readFileSync(file, "utf8").matchAll(declaration)) {
    internal.add(match[1])
  }
}

if (internal.size === 0) failures.push("found no @internal symbols to check")

for (const file of filesUnder(typesDir).filter((f) => f.endsWith(".d.ts"))) {
  const text = readFileSync(file, "utf8")

  for (const name of internal) {
    if (new RegExp(`\\b${name.replace("$", "\\$")}\\b`).test(text)) {
      failures.push(`${file.slice(root.length + 1)} mentions @internal ${name}`)
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`check-dist: ${failure}`)
  process.exit(1)
}

console.log(
  `check-dist: ${Object.keys(expected).length} exports, ${internal.size} internal symbols absent from declarations`,
)
