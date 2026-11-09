import { Sparkles } from 'lucide-react'
import { updateSettings } from '../state/workspace'

/** One line for empty states: any agent can draft this kind of work with an sldev skill. Opens the Skills tab, where they are added. */
export function SkillsHint({ skill, what }: { skill: string; what: string }): React.JSX.Element {
  return (
    <span className="skills-hint">
      Or ask your agent to draft {what}: <code>/{skill}</code>.{' '}
      <button className="link-btn" onClick={() => updateSettings({ rightPanelTab: 'skills', rightPanelVisible: true })}>
        <Sparkles size={11} aria-hidden /> sldev skills
      </button>
    </span>
  )
}
