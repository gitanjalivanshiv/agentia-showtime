import fs from 'node:fs'
import path from 'node:path'

import {unzipSync} from 'fflate'

import type {Copado} from '../agentia/copado.js'
import {showDir} from '../script/files.js'
import type {DemoScript} from '../script/schema.js'
import {parseOutput, type RecordedStep} from './parse.js'
import {generateRobot} from './robot.js'

export interface Recording {
  story: string
  buildId?: number
  steps: Array<RecordedStep & {frame?: string}>
  failed: string[]
}

export interface RecordOptions {
  root: string
  script: DemoScript
  copado: Copado
  crtProjectId: number
  crtJobId: number
  loginUrl: string
}

/** Robot file for this story, before upload. Written so a human can read exactly what will run. */
export function writeRobotFile(root: string, script: DemoScript, loginUrl: string): string {
  const file = path.join(showDir(root, script.story.name), 'session.robot')
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, generateRobot(script, {loginUrl}))
  return file
}

/**
 * Upload, run, download, unpack. Frames land in `frames/NN-<step-id>.png`. The caller holds the org lock
 * (a CRT upload is a write, per the playground rules).
 */
export async function recordShow(o: RecordOptions): Promise<Recording> {
  const dir = showDir(o.root, o.script.story.name)
  const robot = writeRobotFile(o.root, o.script, o.loginUrl)
  const archive = path.join(dir, 'artifacts.zip')

  await o.copado.uploadRobot(o.crtProjectId, o.crtJobId, robot, 'showtime-session.robot')
  const buildId = await o.copado.runBuild(o.crtProjectId, o.crtJobId, archive)
  if (!fs.existsSync(archive))
    throw new Error('The run finished without an artifact archive. Check the build in Robotic Testing.')

  const files = unzipSync(new Uint8Array(fs.readFileSync(archive)))
  const outputXml = files['output.xml']
  if (!outputXml) throw new Error('output.xml is missing from the run artifacts.')
  const steps = parseOutput(Buffer.from(outputXml).toString('utf8'))

  const framesDir = path.join(dir, 'frames')
  fs.rmSync(framesDir, {recursive: true, force: true})
  fs.mkdirSync(framesDir, {recursive: true})
  const recorded: Recording['steps'] = steps.map((s, i) => {
    const bytes = s.screenshot ? files[s.screenshot] : undefined
    if (!bytes) return {...s}
    const frame = `${String(i + 1).padStart(2, '0')}-${s.id}.png`
    fs.writeFileSync(path.join(framesDir, frame), bytes)
    return {...s, frame: path.join('frames', frame)}
  })
  const expected = o.script.steps.map((s) => s.id)
  const failed = expected.filter((id) => {
    const r = recorded.find((s) => s.id === id)
    return !r || !r.ok || !r.frame
  })
  const recording: Recording = {story: o.script.story.name, buildId, steps: recorded, failed}
  fs.writeFileSync(path.join(dir, 'recording.json'), `${JSON.stringify(recording, null, 2)}\n`)
  return recording
}
