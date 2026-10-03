import type { HudConfig } from './config.js';
import type { AgentEntry } from './types.js';

const MAX_COMPLETED_SHOWN = 2;

/** Pure: picks the agents the panel shows. Computed once per render in index.ts. */
export function selectPanelAgents(
  agents: AgentEntry[],
  config: Pick<HudConfig, 'panel'> | undefined,
  now: number,
): { shown: AgentEntry[]; hiddenRunning: number } {
  const maxAgents = config?.panel?.maxAgents ?? 5;
  const retentionMs = (config?.panel?.completedRetentionSeconds ?? 120) * 1000;

  const running = agents.filter((agent) => agent.status === 'running');
  const runningShown = running.slice(-maxAgents);
  const completedSlots = Math.min(MAX_COMPLETED_SHOWN, maxAgents - runningShown.length);
  const completed = completedSlots > 0
    ? agents
      .filter((agent) => {
        const end = agent.endTime?.getTime();
        return agent.status === 'completed' && end !== undefined && now - end <= retentionMs;
      })
      .slice(-completedSlots)
    : [];

  return { shown: [...runningShown, ...completed], hiddenRunning: running.length - runningShown.length };
}
