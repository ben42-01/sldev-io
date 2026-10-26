/**
 * GET /api/stats: public download counts, straight from GitHub's per-asset download_count in the
 * downloads repo. Nothing is stored or logged here, so the site collects no data for it. GitHub
 * counts every fetch of an installer, which includes in-app updates (they download the same files).
 */
import { assetPlatform, fetchReleases, type Release } from './download.js'

/** The Intel and Apple Silicon builds count as one macOS. */
export type StatsPlatform = 'windows' | 'mac' | 'linux'

export interface DownloadStats {
  total: number
  platforms: Record<StatsPlatform, number>
  /** Published releases newest first, with their installer downloads. */
  releases: { version: string; publishedAt: string | null; downloads: number }[]
}

export function summarize(releases: Release[]): DownloadStats {
  const platforms: Record<StatsPlatform, number> = { windows: 0, mac: 0, linux: 0 }
  const out: DownloadStats['releases'] = []
  for (const r of releases) {
    if (r.draft) continue
    let downloads = 0
    for (const a of r.assets) {
      const p = assetPlatform(a.name)
      if (!p) continue
      platforms[p === 'mac-intel' ? 'mac' : p] += a.download_count
      downloads += a.download_count
    }
    out.push({ version: r.tag_name.replace(/^v/, ''), publishedAt: r.published_at, downloads })
  }
  const total = platforms.windows + platforms.mac + platforms.linux
  return { total, platforms, releases: out }
}

export async function GET(): Promise<Response> {
  try {
    const stats = summarize(await fetchReleases())
    return Response.json(stats, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400' }
    })
  } catch (err) {
    console.error('download stats failed:', err)
    return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'public, s-maxage=60' } })
  }
}
