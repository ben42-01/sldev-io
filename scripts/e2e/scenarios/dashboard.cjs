// Usage dashboard: seeded missions with status history, a Claude transcript and a Codex session log
// (in a temp CODEX_HOME, never the real one) → tiles, timeline, tokens per agent.
const fs = require('fs')
const os = require('os')
const path = require('path')

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sldev-e2e-codex-'))
module.exports = async (h) => {
  const now = Date.now()
  const min = 60000
  const transcript = path.join(codexHome, 'claude-transcript.jsonl')
  const line = (id, i, o) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-6', usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 50000, cache_creation_input_tokens: 2000 } } })
  fs.writeFileSync(transcript, [line('a', 1200, 300), line('a', 1200, 800), line('b', 3000, 1500)].join('\n') + '\n')
  const d = new Date(now - 50 * min)
  const dir = path.join(codexHome, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'rollout-e2e.jsonl'),
    [
      JSON.stringify({ type: 'session_meta', payload: { cwd: h.fixture, timestamp: new Date(now - 50 * min + 2000).toISOString() } }),
      JSON.stringify({ type: 'turn_context', payload: { cwd: h.fixture, model: 'gpt-5-codex' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 90000, cached_input_tokens: 60000, output_tokens: 4000, reasoning_output_tokens: 1000 } } } })
    ].join('\n') + '\n'
  )
  const mission = (id, agent, title, history, extra = {}) => ({
    id, title, prompt: title, root: h.fixture, cwd: h.fixture, options: { agent }, status: history.at(-1).status,
    createdAt: history[0].at, updatedAt: history.at(-1).at, history, ...extra
  })
  const missions = [
    mission('m1', 'claude', 'Migrate auth to sessions', [
      { status: 'starting', at: now - 90 * min }, { status: 'working', at: now - 89 * min }, { status: 'needs-input', at: now - 60 * min },
      { status: 'working', at: now - 45 * min }, { status: 'waiting', at: now - 30 * min }, { status: 'ended', at: now - 20 * min }
    ], { transcriptPath: transcript }),
    mission('m2', 'codex', 'Fix flaky checkout test', [
      { status: 'starting', at: now - 50 * min }, { status: 'working', at: now - 49 * min }, { status: 'needs-input', at: now - 35 * min }, { status: 'working', at: now - 33 * min }, { status: 'ended', at: now - 15 * min }
    ]),
    mission('m3', 'gemini', 'Add rate limiting', [{ status: 'starting', at: now - 25 * min }, { status: 'working', at: now - 24 * min }, { status: 'ended', at: now - 5 * min }])
  ]
  await h.js(`window.api.store.set('missions', ${JSON.stringify({ missions })})`)
  await h.openFixture()
  await h.js(`window.dispatchEvent(new Event('focus'))`)
  h.key('P', ['control', 'shift'])
  await h.wait(300)
  await h.type('usage dashboard')
  await h.wait(200)
  await h.key('Enter')
  await h.wait(1500)

  const tiles = await h.js(`Object.fromEntries([...document.querySelectorAll('.dash-tile')].map(t => [t.querySelector('.dash-tile-label').textContent, t.querySelector('b').textContent + ' | ' + t.querySelector('.dash-tile-sub').textContent]))`)
  h.log(JSON.stringify(tiles))
  h.expect(tiles['Missions']?.startsWith('3 |'), 'three missions in range')
  h.expect(tiles['Waiting on you']?.startsWith('17m') && tiles['Waiting on you'].includes('median answer 9m'), 'waiting on you: 15m + 2m, median of the two answers')
  h.expect(await h.js(`document.querySelectorAll('.timeline .tl-row').length === 3`), 'one timeline row per mission')
  h.expect(await h.js(`document.querySelectorAll('.tl-seg.needs-input').length === 2 && document.querySelectorAll('.tl-seg.waiting').length === 1`), 'needs-you spans are hatched, ready spans thin')
  const tok = await h.js(`Object.fromEntries([...document.querySelectorAll('.token-row')].map(r => [r.querySelector('.token-name').textContent, r.querySelector('.token-value').textContent]))`)
  h.log(JSON.stringify(tok))
  h.expect(tok['Claude Code'] === '111k · ~$0.09', 'Claude tokens from the transcript, counted once per message (4200 in + 2300 out + 104000 cache), priced as Sonnet 4.6')
  h.expect(tok['Codex'].startsWith('95k · ~$0.'), 'Codex tokens from its session log (30k in + 5k out + 60k cache), priced as GPT-5-Codex')
  h.expect(tiles['Est. cost']?.startsWith('~$0.19 |') && tiles['Est. cost'].includes('API list prices'), `estimated cost tile (${tiles['Est. cost']})`)
  h.expect(tok['Gemini CLI'] === 'not reported', 'agents without local logs say so')
  await h.shot('0-dashboard')
  // hover a bar for its tooltip
  await h.js(`(() => { const r = document.querySelector('.tl-seg.needs-input').getBoundingClientRect(); document.querySelector('.tl-seg.needs-input').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + 2, clientY: r.y + 2 })) })()`)
  await h.wait(200)
  h.expect(await h.js(`document.querySelector('.tl-tip')?.textContent.includes('Needs you')`), 'hovering a bar explains it')
  await h.shot('1-tooltip')
}
module.exports.env = { CODEX_HOME: codexHome }
