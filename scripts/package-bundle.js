const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const ROOT = path.resolve(__dirname, "..")
const PUBLIC_DIR = path.join(ROOT, "public")
const TEMP_DIR = path.join(ROOT, ".bundle-tmp")
const TEMP_PUBLIC_DIR = path.join(TEMP_DIR, "public")
const OUTPUT_ZIP = path.join(ROOT, "bundle.zip")

const REQUIRED_PUBLIC_FILES = ["index.html", "index.js", "styles.css"]

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${path.relative(ROOT, filePath)}`)
  }
}

function resetTempDir() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true })
  fs.mkdirSync(TEMP_PUBLIC_DIR, { recursive: true })
}

function copyRequiredFiles() {
  const webflowConfig = path.join(ROOT, "webflow.json")
  ensureFileExists(webflowConfig)
  fs.copyFileSync(webflowConfig, path.join(TEMP_DIR, "webflow.json"))

  for (const filename of REQUIRED_PUBLIC_FILES) {
    const src = path.join(PUBLIC_DIR, filename)
    ensureFileExists(src)
    fs.copyFileSync(src, path.join(TEMP_PUBLIC_DIR, filename))
  }
}

function createZip() {
  fs.rmSync(OUTPUT_ZIP, { force: true })
  const result = spawnSync("zip", ["-r", "bundle.zip", "webflow.json", "public"], {
    cwd: TEMP_DIR,
    stdio: "inherit",
  })

  if (result.status !== 0) {
    throw new Error("zip command failed while creating bundle.zip")
  }

  fs.renameSync(path.join(TEMP_DIR, "bundle.zip"), OUTPUT_ZIP)
}

function main() {
  resetTempDir()
  copyRequiredFiles()
  createZip()
  fs.rmSync(TEMP_DIR, { recursive: true, force: true })
  console.log("Created bundle.zip with webflow.json + public/")
}

main()
