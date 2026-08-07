import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const androidDir = fileURLToPath(new URL('../android/', import.meta.url))
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
const args = process.argv.slice(2)

const result = spawn(wrapper, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

result.on('close', (code) => {
  process.exit(code ?? 1)
})