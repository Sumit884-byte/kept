import { copyFile } from 'node:fs/promises'

const files = [
  'copy.js',
  'brief.js',
  'projectKinds.js',
  'rolePick.js',
  'display.js',
  'resumeOutline.js',
]

await Promise.all(files.map((name) => copyFile(`src/${name}`, `src/public/${name}`)))
