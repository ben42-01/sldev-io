import type { ClaudeAsset } from '@shared/types'

export interface AssetGroup {
  /** stable key for remembering whether the group is open */
  key: string
  label: string
  /** where the files live, shown as a hint */
  location: string
  assets: ClaudeAsset[]
}

/** Groups with more items than this start collapsed. */
export const COLLAPSE_OVER = 8

const ORDER: Record<ClaudeAsset['source'], number> = { project: 0, user: 1, plugin: 2, synced: 3 }

function describe(a: ClaudeAsset): Omit<AssetGroup, 'assets'> {
  switch (a.source) {
    case 'project':
      return { key: 'project', label: 'This project', location: '.claude/' }
    case 'user':
      return { key: 'user', label: 'User', location: '~/.claude/' }
    case 'synced':
      return { key: 'synced', label: 'Synced from claude.ai', location: '~/.claude/skills/synced/' }
    case 'plugin':
      return { key: `plugin:${a.plugin ?? ''}`, label: `Plugin: ${a.plugin ?? 'unknown'}`, location: '~/.claude/plugins/' }
  }
}

/** Group skills, commands or agents by where they were found: project, user, each plugin, synced. */
export function groupAssets(assets: ClaudeAsset[]): AssetGroup[] {
  const map = new Map<string, AssetGroup>()
  for (const a of assets) {
    const d = describe(a)
    const g = map.get(d.key) ?? { ...d, assets: [] }
    g.assets.push(a)
    map.set(d.key, g)
  }
  return [...map.values()]
    .map((g) => ({ ...g, assets: [...g.assets].sort((x, y) => x.name.localeCompare(y.name)) }))
    .sort((x, y) => ORDER[x.assets[0].source] - ORDER[y.assets[0].source] || x.label.localeCompare(y.label))
}

/** An explicit choice wins; otherwise small groups and this project's own start open. */
export function isGroupOpen(g: AssetGroup, choice: boolean | undefined, filtering: boolean): boolean {
  if (filtering) return true
  return choice ?? (g.key === 'project' || g.assets.length <= COLLAPSE_OVER)
}
