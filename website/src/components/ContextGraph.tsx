/**
 * The project context as a flow: Markdown sources in the repo → the local index (full text + a graph of
 * notes and the files they're about) → every agent, and back through sldev_remember. Pulses run along
 * the edges; reduced-motion users get the still picture.
 */

const sources = [
  { file: 'memory.md', what: 'learnings, with their files' },
  { file: 'context/*.md', what: 'docs, one entry per section' },
  { file: 'pinned.md', what: 'files you pinned' },
  { file: 'skills/', what: 'project skills' }
]

const agents = ['Claude Code', 'Codex', 'Cursor Agent', 'Copilot', 'OpenCode', 'Gemini CLI']

// the "nervous system" inside the index: notes (circles) wired to files (squares)
const notes = [
  { x: 420, y: 160 },
  { x: 462, y: 214 },
  { x: 402, y: 262 },
  { x: 500, y: 300, stale: true },
  { x: 548, y: 186 }
]
const files = [
  { x: 476, y: 140, label: 'auth.ts' },
  { x: 522, y: 248, label: 'routes.ts' },
  { x: 396, y: 318, label: 'db.ts' },
  { x: 372, y: 196, label: 'ci.yml' }
]
const wires: Array<[number, number]> = [
  [0, 0], [0, 3], [1, 0], [1, 1], [2, 3], [2, 2], [3, 2], [3, 1], [4, 0], [4, 1]
]

export function ContextGraph({ compact = false }: { compact?: boolean }) {
  const srcY = (i: number) => 92 + i * 78
  const agentY = (i: number) => 74 + i * 54
  const indexBox = { x: 352, y: 88, w: 236, h: 266 }
  const hub = { x: indexBox.x + indexBox.w / 2, y: indexBox.y + indexBox.h / 2 }
  // round the bottom and up the left edge, into memory.md
  const back = `M 850 ${agentY(5) + 35} C 850 404, 10 404, 10 330 L 10 ${srcY(0) + 22} L 20 ${srcY(0) + 22}`
  return (
    <figure className={`ctx-graph${compact ? ' compact' : ''}`}>
      <svg viewBox="0 0 960 420" role="img" aria-label="Markdown files in the repo (memory, context docs, pinned files, skills) feed a local index of notes linked to the files they are about. Every agent gets the notes matching its task, looks up more with sldev_recall, and adds what it learns with sldev_remember.">
        <defs>
          <linearGradient id="ctx-brand" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand-blue)" />
            <stop offset="0.5" stopColor="var(--brand-green)" />
            <stop offset="1" stopColor="var(--brand-purple)" />
          </linearGradient>
        </defs>

        {/* column captions */}
        <text x={20} y={40} className="cap">IN YOUR REPO · MARKDOWN</text>
        <text x={indexBox.x} y={40} className="cap">ON YOUR MACHINE · LOCAL INDEX</text>
        <text x={940} y={40} className="cap" textAnchor="end">EVERY AGENT</text>

        {/* sources → index */}
        {sources.map((s, i) => {
          const d = `M 236 ${srcY(i) + 22} C 300 ${srcY(i) + 22}, 300 ${hub.y}, ${indexBox.x} ${hub.y}`
          return (
            <g key={s.file}>
              <path d={d} className="edge" />
              <path d={d} className="flow" style={{ animationDelay: `${i * 0.35}s` }} />
              <rect x={20.5} y={srcY(i) + 0.5} width={215} height={44} className="node" />
              <text x={34} y={srcY(i) + 19} className="file">.sldev/{s.file}</text>
              <text x={34} y={srcY(i) + 35} className="what">{s.what}</text>
            </g>
          )
        })}

        {/* the index */}
        <rect x={indexBox.x + 0.5} y={indexBox.y + 0.5} width={indexBox.w} height={indexBox.h} className="index" />
        <text x={indexBox.x + 14} y={indexBox.y + 22} className="file">SQLite index</text>
        <text x={indexBox.x + 14} y={indexBox.y + 37} className="what">full text + notes wired to files</text>
        {wires.map(([n, f], i) => (
          <line key={i} x1={notes[n].x} y1={notes[n].y} x2={files[f].x} y2={files[f].y} className={`wire${i % 3 === 0 ? ' live' : ''}`} style={{ animationDelay: `${(i % 5) * 0.4}s` }} />
        ))}
        {files.map((f) => (
          <g key={f.label}>
            <rect x={f.x - 5} y={f.y - 5} width={10} height={10} className="fnode" />
            <text x={f.x + 9} y={f.y + 4} className="flabel">{f.label}</text>
          </g>
        ))}
        {notes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={6} className={`nnode${n.stale ? ' stale' : ''}`} />
        ))}
        <text x={notes[3].x} y={notes[3].y + 24} className="stale-label" textAnchor="middle">changed since: check</text>

        {/* index → agents */}
        {agents.map((a, i) => {
          const d = `M ${indexBox.x + indexBox.w} ${hub.y} C 680 ${hub.y}, 680 ${agentY(i) + 17}, 760 ${agentY(i) + 17}`
          return (
            <g key={a}>
              <path d={d} className="edge" />
              <path d={d} className="flow out" style={{ animationDelay: `${0.8 + i * 0.25}s` }} />
              <rect x={760.5} y={agentY(i) + 0.5} width={179} height={34} className="node agent" />
              <text x={774} y={agentY(i) + 22} className="agent-name">{a}</text>
            </g>
          )
        })}
        <text x={672} y={hub.y - 64} className="label" textAnchor="middle">brief → matching notes</text>
        <text x={672} y={hub.y + 74} className="label" textAnchor="middle">sldev_recall</text>

        {/* agents → memory: what they learn comes back */}
        <path d={back} className="loop" />
        <path d={back} className="flow back" />
        <text x={480} y={404} className="label" textAnchor="middle">sldev_remember: what they learn, with the files it is about</text>
      </svg>
    </figure>
  )
}
