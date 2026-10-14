import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
const root = fileURLToPath(new URL('../', import.meta.url))
await writeFile(
  `${root}cordis.local.yml`,
  `- insert:\n    - id: pathfinder-ucd\n      name: ${JSON.stringify(`${root}dist/host.js`)}\n      config:\n        timeoutMs: 30000\n`,
)
console.log(`CourseScope overlay created: ${root}cordis.local.yml`)
