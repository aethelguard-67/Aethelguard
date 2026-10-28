import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { zipSync } from "fflate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const extensionDirectory = join(process.cwd(), "chrome-extension")

async function collectExtensionFiles(directory: string): Promise<Record<string, Uint8Array>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: Record<string, Uint8Array> = {}

  for (const entry of entries) {
    const filePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      Object.assign(files, await collectExtensionFiles(filePath))
    } else if (entry.isFile()) {
      const archivePath = relative(extensionDirectory, filePath).split(sep).join("/")
      files[archivePath] = await readFile(filePath)
    } else {
      throw new Error(`Unsupported file in Chrome extension directory: ${filePath}`)
    }
  }

  return files
}

export async function GET() {
  const files = await collectExtensionFiles(extensionDirectory)
  const archive = zipSync(files)

  return new Response(archive, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="aethelguard-chrome-extension.zip"',
      "Cache-Control": "no-store",
    },
  })
}
