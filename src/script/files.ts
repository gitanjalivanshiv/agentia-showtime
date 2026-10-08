import fs from 'node:fs'
import path from 'node:path'

import {stringify} from 'yaml'

import {CONFIG_DIR} from '../config.js'
import type {DemoScript} from './schema.js'

export const showDir = (root: string, storyName: string) => path.join(root, CONFIG_DIR, 'shows', storyName)
export const scriptPath = (root: string, storyName: string) =>
  path.join(showDir(root, storyName), 'script.yaml')

const HEADER = `# Showtime demo script. Edit freely: the recorder and narrator read exactly this file.
# actions: navigate | click | type | verify | wait. Targets are visible labels, never selectors.
`

export function toYaml(script: DemoScript): string {
  return HEADER + stringify(script, {lineWidth: 100})
}

export function writeScript(root: string, script: DemoScript): string {
  const file = scriptPath(root, script.story.name)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, toYaml(script))
  return file
}
