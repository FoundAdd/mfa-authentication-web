import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const androidDir = fileURLToPath(new URL('../android/', import.meta.url))
const isWindows = process.platform === 'win32'
const wrapperName = isWindows ? 'gradlew.bat' : 'gradlew'
const wrapperPath = path.join(androidDir, wrapperName)
const args = process.argv.slice(2)

if (!existsSync(wrapperPath)) {
  console.error(`Android Gradle wrapper not found: ${wrapperPath}`)
  process.exit(1)
}

const command = isWindows ? wrapperPath : 'sh'
const commandArgs = isWindows ? args : [wrapperPath, ...args]

const result = spawn(command, commandArgs, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows,
})

result.on('error', (error) => {
  console.error(`Failed to start Android Gradle wrapper: ${error.message}`)
  process.exit(1)
})

result.on('close', (code) => {
  process.exit(code ?? 1)
})
