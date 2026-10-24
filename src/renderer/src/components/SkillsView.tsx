import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ClaudeAsset, McpServer } from '@shared/types'
import { Copy, ExternalLink, FolderOpen, Plus, RefreshCw, Rocket, SendHorizontal } from 'lucide-react'
import { activeTerminalId, openTerminal } from '../dock/dockApi'
import { openInEditor } from '../lib/actions'
import { writeToTerminal, focusTerminal } from '../lib/terminals'
import { skillPrompt } from '../lib/agents'
import { getAgent, useAgents } from '../state/agents'
import { startMission } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { ViewShell } from './RuntimesView'

type Tab = 'skill' | 'command' | 'agent' | 'mcp'
const TABS: Array<[Tab, string]> = [['skill', 'Skills'], ['command', 'Commands'], ['agent', 'Agents'], ['mcp', 'MCP']]

export function SkillsView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [tab, setTab] = useState<Tab>('skill')
  const [assets, setAssets] = useState<ClaudeAsset[] | null>(null)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState<ClaudeAsset | null>(null)

  const load = useCallback(() => {
    setAssets(null)
    void window.api.claude.assets(root).then(setAssets)
  }, [root])
  useEffect(load, [load])

  const shown = useMemo(() => {
    const f = filter.toLowerCase()
    return (assets ?? []).filter((a) => a.kind === tab && (!f || `${a.name} ${a.description} ${a.plugin ?? ''}`.toLowerCase().includes(f)))
  }, [assets, tab, filter])

  return (
    <ViewShell
      title="Skills"
      actions={
        <>
          <button className="icon-btn" title="New skill" onClick={() => (setTab('skill'), setCreating(true))}>
            <Plus size={14} />
          </button>
          <button className="icon-btn" title="Rescan" onClick={load}>
            <RefreshCw size={14} />
          </button>
        </>
      }
    >
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
            {id !== 'mcp' && assets && <span className="count">{assets.filter((a) => a.kind === id).length}</span>}
          </button>
        ))}
      </div>
      {tab === 'mcp' ? (
        <McpTab />
      ) : (
        <>
          {creating && <NewSkillForm onDone={(created) => (setCreating(false), created && load())} />}
          {running && <RunAssetForm asset={running} onDone={() => setRunning(null)} />}
          <div className="view-filter">
            <input placeholder={`Filter ${tab}s`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="view-scroll">
            {assets === null && <div className="muted-note">Scanning…</div>}
            {shown.map((a) => (
              <AssetRow key={a.path} asset={a} onRun={() => setRunning(a)} />
            ))}
            {assets && !shown.length && <div className="muted-note">{filter ? 'Nothing matches.' : `No ${tab}s found in ~/.claude, this project or installed plugins.`}</div>}
          </div>
        </>
      )}
    </ViewShell>
  )
}

function sendToTerminal(text: string): boolean {
  const id = activeTerminalId()
  if (!id) return false
  writeToTerminal(id, text)
  focusTerminal(id)
  return true
}

// Skills are plain SKILL.md folders any agent can follow; commands and subagents only exist in Claude Code.
const runLabel = (a: ClaudeAsset): string => (a.kind === 'skill' ? 'Run skill in a new session' : 'Run in new Claude Code session')

function AssetRow({ asset: a, onRun }: { asset: ClaudeAsset; onRun: () => void }): React.JSX.Element {
  const menu = (): MenuItem[] => [
    ...(a.kind !== 'agent' ? [{ label: `${runLabel(a)}…`, icon: <Rocket size={13} />, run: onRun }] : []),
    { label: `Type ${a.invocation} into active terminal`, icon: <SendHorizontal size={13} />, run: () => void sendToTerminal(a.invocation + ' ') },
    { type: 'separator' },
    { label: 'Edit', icon: <ExternalLink size={13} />, run: () => void openInEditor(a.path) },
    { label: 'Reveal in file manager', icon: <FolderOpen size={13} />, run: () => void window.api.shell.reveal(a.path) },
    { label: 'Copy invocation', icon: <Copy size={13} />, run: () => void navigator.clipboard.writeText(a.invocation) }
  ]
  return (
    <div className="rt-row asset-row" onDoubleClick={() => (a.kind === 'agent' ? openInEditor(a.path) : onRun())} onContextMenu={(e) => showContextMenu(e, menu())} title={a.description}>
      <div className="rt-main">
        <div className="rt-name">
          {a.name} <span className={`src-badge ${a.source}`}>{a.plugin ?? a.source}</span>
        </div>
        <div className="asset-desc">{a.description}</div>
      </div>
      <div className="row-actions">
        <button className="icon-btn" title="Edit" onClick={() => void openInEditor(a.path)}>
          <ExternalLink size={13} />
        </button>
        {a.kind !== 'agent' && (
          <button className="icon-btn go" title={runLabel(a)} onClick={onRun}>
            <Rocket size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function RunAssetForm({ asset, onDone }: { asset: ClaudeAsset; onDone: () => void }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [args, setArgs] = useState('')
  const [worktree, setWorktree] = useState(false)
  const agents = useAgents()
  const defaultAgent = useStore(workspace, (w) => w.defaultAgent)
  const choices = asset.kind === 'skill' ? agents : agents.filter((a) => a.claudeSkills)
  const [agentId, setAgentId] = useState(choices.some((a) => a.id === defaultAgent) ? defaultAgent : (choices[0]?.id ?? 'claude'))
  const agent = getAgent(agentId)
  const prompt = skillPrompt(agent, asset, args)
  const run = (): void => {
    if (!root) return
    void startMission({ prompt, title: `${asset.name}${args ? `: ${args.slice(0, 40)}` : ''}`, root, options: { agent: agent.id }, worktree })
    onDone()
  }
  return (
    <form className="form inline-form" onSubmit={(e) => (e.preventDefault(), run())}>
      <label className="field">
        <span>Agent</span>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={choices.length < 2}>
          {choices.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.installed === false ? ' (not installed)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="mono small skill-prompt" title="Prompt sent to the agent">{prompt}</div>
      <label className="field">
        <span>Arguments / extra instructions</span>
        <input autoFocus value={args} onChange={(e) => setArgs(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onDone()} />
      </label>
      <label className="check">
        <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
        <span>In a new git worktree</span>
      </label>
      {!root && <div className="form-error">Open a folder first.</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!root}><Rocket size={13} /> Run</button>
      </div>
    </form>
  )
}

function NewSkillForm({ onDone }: { onDone: (created: boolean) => void }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [scope, setScope] = useState<'user' | 'project'>(root ? 'project' : 'user')
  const [error, setError] = useState('')
  const submit = async (): Promise<void> => {
    try {
      const file = await window.api.claude.createSkill(scope, root, name.trim(), description, body)
      void openInEditor(file)
      onDone(true)
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    }
  }
  return (
    <form className="form inline-form" onSubmit={(e) => (e.preventDefault(), void submit())}>
      <label className="field">
        <span>Name</span>
        <input autoFocus className="mono" value={name} placeholder="release-notes" onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
      </label>
      <label className="field">
        <span>Description (when should Claude use it?)</span>
        <textarea rows={2} value={description} placeholder="Write release notes from the commits since the last tag. Use when asked for a changelog or release notes." onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span>Instructions</span>
        <textarea rows={5} value={body} placeholder={'# Release notes\n\n1. Run git log since the last tag…'} onChange={(e) => setBody(e.target.value)} />
      </label>
      <label className="field">
        <span>Save to</span>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'user' | 'project')}>
          {root && <option value="project">This project (.claude/skills)</option>}
          <option value="user">All projects (~/.claude/skills)</option>
        </select>
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!name || !description.trim()}>Create</button>
      </div>
    </form>
  )
}

function McpTab(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [data, setData] = useState<{ servers: McpServer[]; raw: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(() => {
    setLoading(true)
    void window.api.fs.home().then((home) => window.api.claude.mcpList(root ?? home)).then((d) => (setData(d), setLoading(false)))
  }, [root])
  useEffect(load, [load])
  return (
    <div className="view-scroll">
      <div className="view-footer row">
        <button className="btn sm" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /> {loading ? 'Checking servers…' : 'Refresh'}</button>
        <button className="btn sm" onClick={() => openTerminal({ cwd: root ?? undefined, title: 'claude mcp', initialInput: 'claude mcp add ' })}><Plus size={13} /> Add server</button>
      </div>
      {data?.servers.map((s) => (
        <div key={s.name} className="rt-row" onContextMenu={(e) => showContextMenu(e, [
          { label: 'Show details', run: () => openTerminal({ cwd: root ?? undefined, title: `mcp ${s.name}`, command: `claude mcp get ${JSON.stringify(s.name)}` }) },
          { label: 'Remove…', run: () => openTerminal({ cwd: root ?? undefined, title: 'claude mcp', initialInput: `claude mcp remove ${JSON.stringify(s.name)}` }) }
        ])}>
          <span className={`status-dot ${/✓|connected/i.test(s.status) ? 'running' : /✗|fail|error/i.test(s.status) ? 'failed' : 'idle'}`} />
          <div className="rt-main">
            <div className="rt-name">{s.name}</div>
            <div className="rt-cmd">{s.detail}</div>
            <div className="rt-meta">{s.status}</div>
          </div>
        </div>
      ))}
      {data && !data.servers.length && <pre className="muted-note pre">{data.raw || 'No MCP servers configured.'}</pre>}
    </div>
  )
}
