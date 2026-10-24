/**
 * GET /download/<platform> (rewritten to /api/download?os=<platform> in vercel.json): redirects
 * to the matching installer of the newest release in the public downloads repo, so nobody has to
 * pick a file from a GitHub release page. Betas are pre-releases, which GitHub's
 * /releases/latest skips, so this looks the release up itself. The CDN caches each redirect for
 * a few minutes, which keeps the unauthenticated GitHub API well under its rate limit.
 */

// same repo as DOWNLOADS_REPO in .github/workflows/release.yml
const REPO = 'ben42-01/downloads.sldev.io'
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

export type Platform = 'windows' | 'mac' | 'mac-intel' | 'linux'

const matchers: Record<Platform, (name: string) => boolean> = {
  windows: (n) => n.endsWith('.exe'),
  mac: (n) => n.endsWith('.dmg') && n.includes('arm64'),
  'mac-intel': (n) => n.endsWith('.dmg') && !n.includes('arm64'),
  linux: (n) => n.endsWith('.deb')
}

export function isPlatform(value: string | null): value is Platform {
  return value !== null && Object.hasOwn(matchers, value)
}

interface Release {
  draft: boolean
  assets: { name: string; browser_download_url: string }[]
}

/** The installer for `platform` in the newest release that has one (releases come newest first). */
export function pickAsset(releases: Release[], platform: Platform): string | null {
  for (const r of releases) {
    if (r.draft) continue
    const asset = r.assets.find((a) => matchers[platform](a.name.toLowerCase()))
    if (asset) return asset.browser_download_url
  }
  return null
}

function redirect(location: string, cacheSeconds: number): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=86400`
    }
  })
}

export async function GET(request: Request): Promise<Response> {
  const os = new URL(request.url).searchParams.get('os')
  if (!isPlatform(os)) return redirect('/download', 3600)
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'sldev-io-website' }
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const url = pickAsset((await res.json()) as Release[], os)
    if (url) return redirect(url, 300)
  } catch (err) {
    console.error('download lookup failed:', err)
  }
  // no matching installer or GitHub is down: the release page still has everything
  return redirect(RELEASES_PAGE, 60)
}
