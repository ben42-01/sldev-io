import { resolveAfter } from '@shared/board'
import { checkSkillFile, draftKind, DRAFTS_DIR, parseMissionDraft, parseStoriesDraft } from '@shared/sldevSkills'
import { allAgents } from '../lib/agents'
import { toast } from '../components/Toast'
import { addItem, board, getItem, updateItem } from './board'
import { allKinds, getKind } from './missionKinds'
import { newSavedId, putSaved } from './savedMissions'
import { workspace } from './workspace'
import { getAgent } from './agents'

/**
 * The drafts inbox: agents running the sldev skills leave missions and stories in `.sldev/drafts/` of the
 * project. While the app is open it takes them in (the open project, on focus and every few seconds): a
 * mission becomes a saved mission, stories become Proposed cards. Nothing here launches anything, and the
 * file goes once it's in; one that can't be read is renamed to .bad and said so once.
 */

const LOOK_MS = 5000
let timer: ReturnType<typeof setInterval> | undefined
let busy = false

export function startDrafts(): void {
  clearInterval(timer)
  timer = setInterval(() => void takeDrafts(), LOOK_MS)
  window.addEventListener('focus', () => void takeDrafts())
  workspace.subscribe(() => {
    if (workspace.get().rootFolder !== lastRoot) void takeDrafts()
  })
  void takeDrafts()
}

let lastRoot: string | null = null

const agentName = (id: string | undefined): string => (id && allAgents(workspace.get().customAgents).some((a) => a.id === id) ? getAgent(id).name : 'An agent')

export async function takeDrafts(): Promise<void> {
  const root = workspace.get().rootFolder
  lastRoot = root
  if (!root || busy) return
  busy = true
  try {
    const files = await window.api.sldevSkills.drafts(root)
    // several drafts at once get one toast, or each would replace the last
    const said: string[] = []
    let failed = false
    for (const f of files) {
      const r = draftKind(f.name) === 'mission' ? takeMission(root, f.text) : takeStories(root, f.text)
      await window.api.sldevSkills.settle(root, f.name, 'said' in r)
      // the reason goes with it: the file is set aside and won't be read again
      if ('error' in r) failed = true
      said.push('said' in r ? r.said : `Couldn't read ${f.name} (${r.error}): kept as ${f.name}.bad in ${DRAFTS_DIR}`)
    }
    if (said.length) toast(said.join(' · '), failed ? ERROR_TOAST_MS : undefined)
  } catch {
    // the folder went away or isn't readable: try again on the next look
  } finally {
    busy = false
  }
}

type Taken = { said: string } | { error: string }

/** long enough to read why a draft was set aside */
const ERROR_TOAST_MS = 12_000

function takeMission(root: string, text: string): Taken {
  const { draft, error } = parseMissionDraft(text, allKinds().map((k) => k.id))
  if (!draft) return { error: error ?? 'not a mission draft' }
  const known = allAgents(workspace.get().customAgents).some((a) => a.id === draft.agent)
  const agent = known ? draft.agent! : workspace.get().defaultAgent
  const kind = getKind(draft.kind)
  const ro = getAgent(agent).readOnlyMode
  const now = Date.now()
  putSaved({
    id: newSavedId(),
    project: root,
    root,
    title: draft.title,
    brief: draft.brief,
    criteria: draft.criteria,
    kind: kind.id,
    options: { agent, ...(kind.readOnly && ro ? { permissionMode: ro } : {}) },
    worktree: !kind.readOnly && draft.worktree !== false,
    draftedBy: draft.by ?? 'agent',
    createdAt: now,
    updatedAt: now
  })
  return { said: `${agentName(draft.by)} drafted a mission: ${draft.title ?? draft.brief.split('\n')[0].slice(0, 50)}` }
}

function takeStories(root: string, text: string): Taken {
  const { stories, by } = parseStoriesDraft(text)
  if (!stories.length) {
    const c = checkSkillFile(`${DRAFTS_DIR}/stories.json`, text)
    return { error: c.ok ? 'no stories in it' : c.error }
  }
  const open = (title: string): boolean => board.get().items.some((i) => i.root === root && i.column !== 'done' && i.title.toLowerCase() === title.toLowerCase())
  const ids = stories.map((st) => (open(st.title) ? undefined : addItem(root, { title: st.title, body: st.details, labels: st.labels, priority: st.priority, column: 'proposed', by: by ?? 'agent' }).id))
  // `after` may name a story further down the file: resolve once they are all on the board
  stories.forEach((st, n) => {
    const me = ids[n] ? getItem(ids[n]!) : undefined
    if (me && st.after?.length) updateItem(me.id, { blockedBy: resolveAfter(st.after, board.get().items, root).filter((k) => k !== me.key) })
  })
  const added = ids.filter(Boolean).length
  return { said: added ? `${agentName(by)} wrote ${added} ${added === 1 ? 'story' : 'stories'}, in Proposed on the board` : 'Those stories are already on the board' }
}
