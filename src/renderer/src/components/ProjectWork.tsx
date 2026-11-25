import { useMemo } from 'react'
import { isBusy, projectWork, workLabel, type ProjectWork } from '@shared/projects'
import { missionSignal } from '@shared/status'
import { missions } from '../state/missions'
import { factory } from '../state/factory'
import { useStore } from '../state/store'
import { StatusDot } from './StatusDot'

/** What every project has going (missions an agent works on, factory runs), for the project menu and Mission Control. */
export function useProjectWork(): Map<string, ProjectWork> {
  const list = useStore(missions, (s) => s.list)
  const runs = useStore(factory, (s) => s.runs)
  // eval attempts, a Lead's workers and helper agents aren't work of their own
  return useMemo(() => projectWork(list.filter((m) => !m.eval && !m.delegate && !m.explains), runs), [list, runs])
}

/** The dot for a project's work: needs you wins over working over ready. */
export function WorkDot({ work }: { work: ProjectWork | undefined }): React.JSX.Element | null {
  if (!isBusy(work)) return null
  const status = work!.needs ? 'needs-input' : work!.working ? 'working' : 'waiting'
  return <StatusDot signal={missionSignal(status)} small title={workLabel(work)} />
}
