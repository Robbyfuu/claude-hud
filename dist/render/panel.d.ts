import type { HudConfig } from '../config.js';
import type { AgentEntry, RenderContext } from '../types.js';
export declare function selectPanelAgents(agents: AgentEntry[], config: Pick<HudConfig, 'panel'> | undefined, now: number): {
    shown: AgentEntry[];
    hiddenRunning: number;
};
export declare function renderPanel(ctx: RenderContext, terminalWidth: number | null): string[];
//# sourceMappingURL=panel.d.ts.map