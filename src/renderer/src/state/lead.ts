import { installedBin, stageMode } from '@shared/agents'
import { DEFAULT_LEAD, canDelegate, resolveRole, routeAgent, waitText, workerBrief, workerDone, type WorkerView } from '@shared/lead'
import { renderKind } from '@shared/missionKinds'
import { applyProfile, promptWithRole } from '@shared/profiles'
import type { AgentOptions, Mission } from '@shared/types'
import { activatePanel, activePanelId, closePanel } from '../dock/dockApi'
import { allAgents } from '../lib/agents'
import { getAgent, refreshInstalledAgents } from './agents'
import { evals } from './evals'
import { getKind } from './missionKinds'
import { followUpMission, getMission, missions, startMission, update } from './missions'
import { profilesFor } from './profiles'
import { workspace } from './workspace'

/**
 * The window's side of the Lead tools. Main forwards a Lead mission's sldev_delegate, wait, followup
 * and integrate calls here (they start and watch missions, which live in the window) and waits for
 * the answer. Workers run in print mode, unattended, each in a worktree branched from the Lead's.
 */

type Answer = { text?: string; error?: string }

window.api.lead.onRequest((r) => {
  void answer(r.mission, r.tool, r.args)
    .catch((e: Error): Answer => ({ error: e.message.split('\n')[0] }))
    .then((a) => window.api.lead.reply(r.id, a))
})

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

async function answer(leadId: string, tool: string, args: Record<string, unknown>): Promise<Answer> {
  const lead = getMission(leadId)
  if (!lead) return { error: 'This Lead mission is gone.' }
  if (tool === 'sldev_delegate') return delegate(lead, args)
  if (tool === 'sldev_wait') return wait(lead, Array.isArray(args.ids) ? args.ids.map(str).filter(Boolean) : [], Math.min(45, Math.max(1, Number(args.seconds) || 45)))
  if (tool === 'sldev_followup') return followup(lead, str(args.id), str(args.message))
  if (tool === 'sldev_integrate') return integrate(lead, Array.isArray(args.ids) ? args.ids.map(str).filter(Boolean) : [], str(args.check))
  return { error: `Unknown tool ${tool}` }
}

/** A Lead's workers, oldest first, including the follow-ups it sent them on (the newest stands for the task). */
export function workersOf(leadId: string): Mission[] {
  return missions.get().list.filter((m) => m.delegate?.lead === leadId).sort((a, b) => a.createdAt - b.createdAt)
}

/** The worker a Lead knows by id: a follow-up keeps answering to the id of the task it continues. */
function current(leadId: string, id: string): Mission | undefined {
  const all = workersOf(leadId)
  let m = all.find((x) => x.id === id)
  while (m) {
    const next = all.find((x) => x.parent?.id === m!.id && x.parent.kind === 'follow-up')
    if (!next) return m
    m = next
  }
  return undefined
}

/** the tasks: workers that aren't follow-ups of another worker */
const tasksOf = (leadId: string): Mission[] => workersOf(leadId).filter((m) => !(m.parent?.kind === 'follow-up' && m.parent.id && getMission(m.parent.id)?.delegate?.lead === leadId))

async function view(task: Mission, leadId: string): Promise<WorkerView> {
  const m = current(leadId, task.id) ?? task
  // follow-ups work in the task's worktree: the diff is always against where the task branched
  const diff = workerDone(m) && task.worktree ? await window.api.git.diffStat(m.cwd, task.worktree.base).then((d) => ({ files: d.files, lines: d.insertions + d.deletions })).catch(() => undefined) : undefined
  return { id: task.id, title: task.title, agent: getAgent(m.options.agent).name, role: task.delegate?.role, status: m.status, branch: (m.worktree ?? task.worktree)?.branch, report: m.report, diff, reported: m.delegate?.reported, merged: task.delegate?.merged }
}

async function delegate(lead: Mission, args: Record<string, unknown>): Promise<Answer> {
  const title = str(args.title).trim().slice(0, 80)
  const brief = str(args.brief).trim()
  if (!title || !brief) return { error: 'Give the task a title and a brief.' }
  if (!lead.worktree) return { error: 'This Lead has no worktree to branch workers from. Start the Lead in a git repository.' }
  const limits = lead.lead ?? DEFAULT_LEAD
  const views = await Promise.all(tasksOf(lead.id).map((t) => view(t, lead.id)))
  const no = canDelegate(limits, views)
  if (no) return { error: no }

  await refreshInstalledAgents().catch(() => undefined)
  const agents = allAgents(workspace.get().customAgents)
  const installed = agents.filter((a) => installedBin(a)).map((a) => a.id)
  const asked = str(args.agent).trim().toLowerCase()
  const named = asked && asked !== 'auto' ? agents.find((a) => a.id === asked || a.name.toLowerCase() === asked) : undefined
  if (asked && asked !== 'auto' && !named) return { error: `No agent called "${asked}". Use auto, or one of: ${installed.join(', ')}.` }
  // a role is a profile: its role text, and its agent and model when it sets them (the Lead's own pick of agent wins)
  const roleAsked = str(args.role).trim()
  const role = roleAsked ? resolveRole(roleAsked, await profilesFor(lead.root), agents.map((a) => a.id)) : undefined
  if (role && 'error' in role) return { error: role.error }
  const profile = role?.profile
  const route = named
    ? { agent: named.id, model: undefined, why: 'chosen by the Lead' }
    : role?.agent
      ? { agent: role.agent, model: undefined, why: `the ${profile!.name} role's agent` }
      : routeAgent(evals.get().runs.filter((r) => r.root === lead.root).flatMap((r) => r.attempts), installed, workspace.get().defaultAgent)
  const agent = getAgent(route.agent)
  const kind = getKind(['build', 'investigate', 'research', 'review'].includes(str(args.kind)) ? str(args.kind) : 'build')
  // the profile's model only fits the agent it was written for (or any agent, when it names none)
  const fromProfile: AgentOptions = profile && (!profile.agent || profile.agent === agent.id) ? applyProfile({ agent: agent.id }, profile) : { agent: agent.id }
  // the Lead's own work so far is in its branch: commit it, so workers start from it
  await window.api.git.commitAll(lead.cwd, 'lead: integrated so far').catch(() => undefined)
  const wbrief = workerBrief({ goal: lead.brief ?? lead.title, task: brief, criteria: str(args.criteria) })
  const prompt = renderKind(kind, { title, brief: wbrief })
  const front = activePanelId()
  const m = await startMission({
    // the role travels in the prompt, for every agent: the profile may not be one the open project lists
    prompt: profile ? promptWithRole(profile.role, prompt) : prompt,
    brief: wbrief,
    criteria: str(args.criteria) || undefined,
    title,
    root: lead.root,
    // nobody approves tool calls in print mode: the factory's unattended mode, or the kind's read-only one (never the profile's)
    options: {
      agent: agent.id,
      model: fromProfile.model ?? route.model,
      effort: fromProfile.effort,
      print: true,
      permissionMode: kind.readOnly ? agent.readOnlyMode : stageMode(agent, workspace.get().factoryModes)
    },
    worktree: true,
    base: lead.worktree.branch,
    kind: { id: kind.id, name: kind.name, readOnly: kind.readOnly }
  }).finally(() => front && activatePanel(front))
  update(m.id, { delegate: { lead: lead.id, why: route.why, role: profile?.name } })
  const model = m.options.model
  return { text: `Started ${m.id}: ${agent.name}${model ? ` (${model})` : ''}${profile ? ` as ${profile.name}` : ''}, ${route.why}, on branch ${m.worktree?.branch ?? 'in place'}. Collect it with sldev_wait.` }
}

/** Resolves once one of the watched workers finishes, or after `seconds`. */
function untilOneFinishes(ids: string[], leadId: string, seconds: number): Promise<void> {
  return new Promise((done) => {
    const check = (): boolean => ids.some((id) => {
      const m = current(leadId, id)
      return !m || workerDone(m)
    })
    if (check()) return done()
    const stop = missions.subscribe(() => check() && (stop(), clearTimeout(t), done()))
    const t = setTimeout(() => (stop(), done()), seconds * 1000)
  })
}

async function wait(lead: Mission, ids: string[], seconds: number): Promise<Answer> {
  const tasks = tasksOf(lead.id)
  if (ids.some((id) => !tasks.some((t) => t.id === id))) return { error: `Not your worker: ${ids.filter((id) => !tasks.some((t) => t.id === id)).join(', ')}` }
  const watched = ids.length ? ids : tasks.filter((t) => !current(lead.id, t.id)?.delegate?.reported).map((t) => t.id)
  if (!watched.length) return { text: tasks.length ? 'Every worker has reported. Integrate their work, or delegate more.' : 'No workers yet. Start one with sldev_delegate.' }
  await untilOneFinishes(watched, lead.id, seconds)
  const finished: WorkerView[] = []
  const running: WorkerView[] = []
  for (const id of watched) {
    const task = tasks.find((t) => t.id === id)!
    const m = current(lead.id, id) ?? task
    if (workerDone(m)) {
      // its work is committed on its branch, ready to merge
      if (m.worktree || task.worktree) await window.api.git.commitAll(m.cwd, `${m.title}`).catch(() => undefined)
      finished.push(await view(task, lead.id))
      update(m.id, { delegate: { ...(m.delegate ?? { lead: lead.id }), reported: true } })
      const panel = missions.get().panels[m.id]
      if (m.status === 'ended' && panel) closePanel(panel)
    } else running.push(await view(task, lead.id))
  }
  return { text: waitText(finished, running) }
}

async function followup(lead: Mission, id: string, message: string): Promise<Answer> {
  const task = tasksOf(lead.id).find((t) => t.id === id)
  if (!task) return { error: `Not your worker: ${id}` }
  if (!message.trim()) return { error: 'Say what to change.' }
  const m = current(lead.id, id)!
  if (!workerDone(m)) return { error: `${id} is still working. Wait for it first.` }
  const front = activePanelId()
  const next = await followUpMission(m.id, message).finally(() => front && activatePanel(front))
  if (!next) return { error: 'Could not start the follow-up.' }
  // same folder and branch, and the first pass's options (print mode, unattended)
  const agent = getAgent(next.options.agent)
  update(next.id, { delegate: { lead: lead.id } })
  return { text: `${id} is back on it (${agent.name}). Wait for it with sldev_wait.` }
}

async function integrate(lead: Mission, ids: string[], check: string): Promise<Answer> {
  if (!lead.worktree) return { error: 'This Lead has no branch to merge into.' }
  const tasks = tasksOf(lead.id)
  const lines: string[] = []
  await window.api.git.commitAll(lead.cwd, 'lead: before integrating').catch(() => undefined)
  for (const id of ids) {
    const task = tasks.find((t) => t.id === id)
    if (!task) return { error: `Not your worker: ${id}` }
    const m = current(lead.id, id)!
    if (!workerDone(m)) return { error: `${id} is still working.` }
    if (task.delegate?.merged) {
      lines.push(`${id}: already merged`)
      continue
    }
    const branch = (m.worktree ?? task.worktree)?.branch
    if (!branch) return { error: `${id} has no branch.` }
    await window.api.git.commitAll(m.cwd, m.title).catch(() => undefined)
    try {
      await window.api.git.merge(lead.cwd, branch)
    } catch (e) {
      return { text: [...lines, `${id}: merge conflict merging ${branch}: ${(e as Error).message.split('\n')[0]}`, 'Resolve the conflicts in your folder, commit, then call sldev_integrate again with the rest.'].join('\n') }
    }
    update(task.id, { delegate: { ...(task.delegate ?? { lead: lead.id }), merged: true } })
    lines.push(`${id}: merged ${branch}`)
  }
  if (check.trim()) {
    const r = await window.api.evals.check(lead.cwd, check, 10 * 60_000)
    const tail = r.output.trim().split('\n').slice(-15).join('\n')
    lines.push(r.code === 0 ? `${check}: passed` : `${check}: FAILED (exit ${r.code ?? 'signal'})\n${tail}`)
  }
  return { text: lines.join('\n') || 'Nothing to merge.' }
}
