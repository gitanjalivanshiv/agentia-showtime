import {execa} from 'execa'

/**
 * One-time login link for the UAT org from the Salesforce CLI (`sf org open --url-only`).
 * The link carries a session, so treat it like a password: it goes to the robot as a CRT variable and
 * nowhere else. Errors never include it. The user authorizes the org once with `sf org login web`.
 */
export async function getFrontdoorUrl(alias: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const r = await execa(env.SHOWTIME_SF_BIN ?? 'sf', ['org', 'open', '-o', alias, '--url-only', '--json'], {
    reject: false,
    timeout: 60_000,
    env: {NO_COLOR: '1', FORCE_COLOR: '0'},
  })
  let url: string | undefined
  try {
    const text = typeof r.stdout === 'string' ? r.stdout : ''
    url = (JSON.parse(text.slice(text.indexOf('{'))) as {result?: {url?: string}}).result?.url
  } catch {
    // fall through to the error below
  }
  if (!url || !/^https:\/\//.test(url)) {
    throw new Error(
      `Could not get a login link for the Salesforce org "${alias}". Authorize it once with: sf org login web --alias ${alias} --instance-url <org URL>`,
    )
  }
  return url
}

/** Doctor helper: is the alias authorized and connected? Never touches the access token. */
export async function checkSfOrg(
  alias: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ok: boolean; detail: string}> {
  const r = await execa(env.SHOWTIME_SF_BIN ?? 'sf', ['org', 'display', '-o', alias, '--json'], {
    reject: false,
    timeout: 60_000,
    env: {NO_COLOR: '1', FORCE_COLOR: '0'},
  })
  try {
    const text = typeof r.stdout === 'string' ? r.stdout : ''
    const d = JSON.parse(text.slice(text.indexOf('{'))) as {
      result?: {connectedStatus?: string}
      message?: string
    }
    if (d.result?.connectedStatus === 'Connected')
      return {ok: true, detail: `"${alias}" is authorized and connected`}
    return {ok: false, detail: d.result?.connectedStatus ?? 'not authorized'}
  } catch {
    return {ok: false, detail: 'Salesforce CLI (`sf`) is missing or the org is not authorized'}
  }
}
