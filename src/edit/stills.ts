import fs from 'node:fs'
import path from 'node:path'

import {H, W} from './templates.js'

export interface Still {
  file: string
  html: string
  /** Keep the alpha channel (overlay layers). */
  transparent?: boolean
}

/** Renders each HTML page to a 1920×1080 PNG with headless Chromium. Playwright is used for this and nothing else. */
export async function renderStills(stills: Still[]): Promise<void> {
  const {chromium} = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({viewport: {width: W, height: H}, deviceScaleFactor: 1})
    for (const s of stills) {
      fs.mkdirSync(path.dirname(s.file), {recursive: true})
      await page.setContent(s.html, {waitUntil: 'load'})
      await page.screenshot({path: s.file, omitBackground: Boolean(s.transparent), type: 'png'})
    }
  } finally {
    await browser.close()
  }
}
