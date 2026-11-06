import type { AgentDef } from '@shared/agents'
import { ASK_GENERIC, askLine } from '@shared/attention'
import { limitLine, TAIL_ROWS } from '@shared/failover'
import { clipReport } from '@shared/missionPrompt'
import { screenReport } from '@shared/screenReport'
import type { HookEvent, McpEvent, Mission } from '@shared/types'

/**
 * A pane's status, the same way the app tracks a mission (src/renderer/src/state/missions.ts): Claude
 * reports through its hooks; every other agent is watched from its screen: output means working, 5 s of
 * quiet means ready, and a bell, OSC 9/777 or its approval prompt (`asks`) means it needs you. An agent
 * that reports through the sldev tools is no longer guessed from.
 */

export interface Screen {
  /** the last `rows` lines of the scrollback, from line `from` on */
  tail: (rows: number, from?: number) => string
  cursor: () => { line: number; alt: boolean }
}

export interface TrackerDeps {
  agent: AgentDef
  get: () => Mission
  update: (patch: Partial<Mission>) => void
  notify: (title: string, body: string) => void
  /** the agent stopped at its usage limit (once per pane) */
  limited: (line: string) => void
  screen: Screen
}

export const IDLE_MS = 5000
const LIMIT_QUIET_MS = 3000
const ASK_CHECK_MS = 1000
const ASK_SETTLE_MS = 400
const ECHO_MS = 250

const live = (m: Mission): boolean => m.status === 'starting' || m.status === 'working' || m.status === 'waiting' || m.status === 'needs-input'

export class Tracker {
  private idle: NodeJS.Timeout | undefined
  private limitTimer: NodeJS.Timeout | undefined
  private askTimer: NodeJS.Timeout | undefined
  private bellTimer: NodeJS.Timeout | undefined
  private askChecked = 0
  private asking = false
  private askNotified: string | undefined
  /** where the user last typed: a prompt above it was answered */
  private answeredAt = 0
  private lastInput = 0
  private reporting = false

  constructor(private d: TrackerDeps) {}

  dispose(): void {
    clearTimeout(this.idle)
    clearTimeout(this.limitTimer)
    clearTimeout(this.askTimer)
    clearTimeout(this.bellTimer)
  }

  output(): void {
    const m = this.d.get()
    if (!live(m)) return
    // the terminal echoing what the user typed isn't the agent working
    if (Date.now() - this.lastInput < ECHO_MS) return
    clearTimeout(this.limitTimer)
    this.limitTimer = setTimeout(() => this.checkLimit(), LIMIT_QUIET_MS)
    if (this.d.agent.hooks) return
    this.watchAsk()
    if (!this.reporting) this.activity()
  }

  /** a bell, or an OSC 9 / 777 desktop notification */
  attention(text?: string): void {
    const m = this.d.get()
    this.checkLimit(text)
    if (this.d.agent.hooks || !live(m) || this.reporting) return
    // a bell often rings with the question on screen: that line says more than "needs your attention"
    if (!text && this.checkAsk()) return
    if (!text) {
      // Windows' ConPTY passes the bell on before it paints the question next to it: look again once it settles
      clearTimeout(this.bellTimer)
      this.bellTimer = setTimeout(() => {
        if (live(this.d.get()) && !this.checkAsk()) this.flag()
      }, ASK_SETTLE_MS)
      return
    }
    this.flag(text)
  }

  private flag(text?: string): void {
    const m = this.d.get()
    clearTimeout(this.idle)
    const message = text || `${this.d.agent.name} needs your attention`
    this.d.update({ status: 'needs-input', notification: message })
    this.d.notify(`${m.title} needs you`, message)
  }

  input(): void {
    this.lastInput = Date.now()
    const m = this.d.get()
    if (this.d.agent.hooks || !live(m)) return
    const cur = this.d.screen.cursor()
    if (!cur.alt) this.answeredAt = cur.line + 1
    if (this.asking) {
      this.asking = false
      if (m.status === 'needs-input') this.d.update({ status: 'working', notification: undefined, activityAt: Date.now() })
    }
  }

  hook(e: HookEvent): void {
    const m = this.d.get()
    const base: Partial<Mission> = { ...(e.sessionId ? { sessionId: e.sessionId } : {}), ...(e.transcriptPath ? { transcriptPath: e.transcriptPath } : {}) }
    switch (e.type) {
      case 'session-start':
        return this.d.update({ ...base, status: m.status === 'starting' && m.prompt ? 'working' : 'waiting' })
      case 'prompt':
        return this.d.update({ ...base, status: 'working', notification: undefined, limited: undefined, activity: e.text ? `Prompt: ${e.text}` : m.activity, activityAt: Date.now() })
      case 'tool':
        return this.d.update({ ...base, status: 'working', notification: undefined, activity: e.text, activityAt: Date.now() })
      case 'notification': {
        const idle = /waiting for your input/i.test(e.text ?? '')
        this.d.update({ ...base, status: idle ? 'waiting' : 'needs-input', notification: idle ? undefined : e.text })
        if (!idle) this.d.notify(`${m.title} needs you`, e.text ?? '')
        return this.checkLimit(e.text)
      }
      case 'stop':
        this.d.update({ ...base, status: 'waiting', lastMessage: e.text?.slice(0, 600) ?? m.lastMessage, report: e.text ?? m.report, ...(e.text ? { reportFrom: undefined } : {}), notification: undefined })
        this.d.notify(`${m.title} finished`, e.text ?? `${this.d.agent.name} is waiting for your next message`)
        return this.checkLimit(e.text)
      case 'session-end':
        return this.d.update({ ...base, status: 'ended' })
    }
  }

  mcp(e: McpEvent): void {
    const m = this.d.get()
    const name = this.d.agent.name
    if (e.type === 'status') {
      this.reporting = true
      clearTimeout(this.idle)
      if (e.state === 'working') this.d.update({ status: 'working', notification: undefined, activity: e.text ?? m.activity })
      else if (e.state === 'needs_input') {
        this.d.update({ status: 'needs-input', notification: e.text ?? `${name} needs you` })
        this.d.notify(`${m.title} needs you`, e.text ?? `${name} needs you`)
      } else {
        this.captureScreen()
        this.d.update({ status: 'waiting', notification: undefined, lastMessage: e.text?.slice(0, 600) ?? m.lastMessage })
        this.d.notify(`${m.title} finished`, e.text ?? `${name} says it's done`)
      }
    } else if ((e.type === 'done' || e.type === 'output') && e.text) {
      this.d.update({ lastMessage: e.text.slice(0, 600), ...(e.type === 'done' ? { report: clipReport(e.text), reportFrom: undefined } : {}) })
    }
  }

  exit(code: number): void {
    this.dispose()
    this.checkLimit()
    this.captureScreen(true)
    const m = this.d.get()
    if (live(m)) this.d.update({ status: code === 0 || m.status === 'waiting' ? 'ended' : 'failed' })
  }

  private activity(): void {
    const m = this.d.get()
    clearTimeout(this.idle)
    if (m.status !== 'working' && m.status !== 'needs-input') this.d.update({ status: 'working', notification: undefined, activityAt: Date.now() })
    else if (Date.now() - (m.activityAt ?? 0) > 3000) this.d.update({ activityAt: Date.now() })
    this.idle = setTimeout(() => {
      const cur = this.d.get()
      if (cur.status !== 'working' || this.checkAsk()) return
      this.captureScreen()
      this.d.update({ status: 'waiting' })
      // updatedAt is when it started working: only ping after a real stretch of work, not a redraw
      if (Date.now() - cur.updatedAt > 2 * IDLE_MS) this.d.notify(`${cur.title} is waiting`, `${this.d.agent.name} went quiet; it's probably your turn`)
    }, IDLE_MS)
  }

  private watchAsk(): void {
    if (Date.now() - this.askChecked >= ASK_CHECK_MS) this.checkAsk()
    clearTimeout(this.askTimer)
    this.askTimer = setTimeout(() => this.checkAsk(), ASK_SETTLE_MS)
  }

  private checkAsk(): boolean {
    const m = this.d.get()
    if (!live(m) || this.d.agent.hooks) return false
    this.askChecked = Date.now()
    const cur = this.d.screen.cursor()
    const line = askLine(this.d.screen.tail(TAIL_ROWS, cur.alt ? 0 : this.answeredAt), this.d.agent.asks ?? ASK_GENERIC, m.prompt)
    if (line) {
      clearTimeout(this.idle)
      if (this.asking && m.status === 'needs-input') return true
      this.asking = true
      this.d.update({ status: 'needs-input', notification: line })
      if (m.status !== 'needs-input' && this.askNotified !== line) this.d.notify(`${m.title} needs you`, line)
      this.askNotified = line
      return true
    }
    this.askNotified = undefined
    if (this.asking) {
      this.asking = false
      if (m.status === 'needs-input') this.d.update({ status: 'working', notification: undefined, activityAt: Date.now() })
    }
    return false
  }

  private checkLimit(extra?: string): void {
    const m = this.d.get()
    if (m.limited || m.continuedBy) return
    const hit = limitLine(`${this.d.screen.tail(TAIL_ROWS)}\n${extra ?? ''}`, this.d.agent.usageLimit)
    if (!hit) return
    this.d.update({ limited: { at: Date.now(), text: hit }, notification: `${this.d.agent.name} hit its usage limit`, ...(live(m) ? { status: 'needs-input' as const } : {}) })
    this.d.limited(hit)
  }

  /** agents that don't report back get their screen as the report; a real report always wins */
  private captureScreen(onExit = false): void {
    const m = this.d.get()
    if (this.d.agent.hooks) return
    if (m.report && (m.reportFrom !== 'terminal' || onExit)) return
    const report = screenReport(this.d.screen.tail(TAIL_ROWS), m.prompt)
    if (report && report !== m.report) this.d.update({ report, reportFrom: 'terminal' })
  }
}
