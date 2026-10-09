import type {DemoScript} from '../script/schema.js'

/**
 * HTML for the video cards, rendered to PNG by Playwright. One accent colour, readable system font,
 * no external assets, so the same inputs always give the same pixels.
 */

export const W = 1920
export const H = 1080
/** Where the recorded screen sits inside the 1920×1080 canvas. Keeps the recorded 1920×993 ratio. */
export const WINDOW = {x: 140, y: 64, w: 1640, h: 848}
export const ACCENT = '#818cf8'

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#f8fafc;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:radial-gradient(1200px 700px at 20% 0%,#1e293b 0%,#0b1220 70%)}
`

const page = (body: string, css = '', transparent = false) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${transparent ? 'html,body{background:transparent}' : 'body{background:#0b1220}'}${css}</style></head><body>${body}</body></html>`

/** Static background with the window the screenshot is placed in. */
export function backgroundHtml(): string {
  return page(
    `<div class="bg"></div><div class="win"></div>`,
    `.win{position:absolute;left:${WINDOW.x - 2}px;top:${WINDOW.y - 2}px;width:${WINDOW.w + 4}px;height:${WINDOW.h + 4}px;border-radius:10px;background:#0f172a;border:1px solid #334155;box-shadow:0 30px 80px rgba(0,0,0,.55)}`,
  )
}

/** Transparent layer on top of the zooming screenshot: step counter, caption, progress bar. */
export function overlayHtml(caption: string, index: number, total: number): string {
  const pct = Math.round((index / total) * 100)
  return page(
    `<div class="pill">Step ${index} of ${total}</div>
<div class="cap">${esc(caption)}</div>
<div class="bar"><i style="width:${pct}%"></i></div>`,
    `.pill{position:absolute;left:${WINDOW.x}px;top:18px;padding:6px 16px;border-radius:999px;background:rgba(129,140,248,.16);color:${ACCENT};font-size:22px;font-weight:600;letter-spacing:.02em}
.cap{position:absolute;left:${WINDOW.x}px;right:${W - WINDOW.x - WINDOW.w}px;top:932px;height:84px;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 40px;border-radius:14px;background:rgba(15,23,42,.92);border:1px solid #334155;font-size:40px;font-weight:600;line-height:1.15}
.bar{position:absolute;left:0;right:0;bottom:0;height:8px;background:#1e293b}
.bar i{display:block;height:100%;background:${ACCENT}}`,
    true,
  )
}

const CARD_CSS = `
.card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 160px}
.kicker{color:${ACCENT};font-size:30px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-bottom:34px}
h1{font-size:96px;line-height:1.05;font-weight:700;letter-spacing:-.02em;max-width:1500px}
.sub{margin-top:40px;font-size:34px;color:#94a3b8}
.rule{width:120px;height:6px;border-radius:3px;background:${ACCENT};margin-top:46px}
`

export function titleCardHtml(script: DemoScript): string {
  return page(
    `<div class="bg"></div><div class="card"><div class="kicker">Ready for your review</div><h1>${esc(script.feature)}</h1><div class="rule"></div><div class="sub">${esc(script.story.name)} · ${script.steps.length} steps · about a minute</div></div>`,
    CARD_CSS,
  )
}

export function endCardHtml(script: DemoScript): string {
  return page(
    `<div class="bg"></div><div class="card"><div class="kicker">Your turn</div><h1>Approve in Slack</h1><div class="rule"></div><div class="sub">Looks right? Approve it. Something missing? Request changes.<br>${esc(script.feature)}</div></div>`,
    CARD_CSS,
  )
}
