import { useEffect } from 'react'
import { allAgents, findAgent, installedBin, setInstalledBins, type AgentDef } from '../lib/agents'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/** bins found on PATH; null until the first check */
const installed = createStore<{ bins: string[] | null }>({ bins: null })

export async function refreshInstalledAgents(): Promise<void> {
  const bins = allAgents(workspace.get().customAgents).flatMap((a) => [a.bin, ...(a.aliases ?? [])])
  const found = await window.api.agents.installed(bins)
  setInstalledBins(found)
  installed.set({ bins: found })
}

export interface AgentEntry extends AgentDef {
  /** undefined while detection is pending */
  installed?: boolean
}

export function useAgents(): AgentEntry[] {
  const custom = useStore(workspace, (w) => w.customAgents)
  const bins = useStore(installed, (s) => s.bins)
  useEffect(() => {
    void refreshInstalledAgents()
  }, [custom])
  return allAgents(custom).map((a) => ({ ...a, installed: bins ? !!installedBin(a) : undefined }))
}

export const getAgent = (id: string | undefined): AgentDef => findAgent(id, workspace.get().customAgents)
