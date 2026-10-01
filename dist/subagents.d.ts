import type { AgentEntry, SubagentDetail } from './types.js';
export declare function getSubagentsDir(transcriptPath: string): string;
/**
 * Maps spawning tool_use ids to subagent transcript paths. Background teammates'
 * metas carry no toolUseId, so they are keyed by teammate name instead; when a
 * name was reused, the most recently spawned meta wins.
 */
export declare function readSubagentIndex(subagentsDir: string): Map<string, string>;
export declare function describeToolTarget(toolName: string, input?: Record<string, unknown>): string | undefined;
/** Parses one subagent transcript into the detail the panel shows. */
export declare function parseSubagentTranscript(filePath: string): SubagentDetail | null;
/** Skills preloaded by an agent definition's `skills:` frontmatter. */
export declare function readAgentDefinitionSkills(agentType: string, cwd?: string): string[];
/**
 * Reads detail for the given agents (usually just the ones the panel shows).
 * Returns a map keyed by the agent's spawning tool_use id.
 */
export declare function readSubagentDetails(transcriptPath: string, agents: AgentEntry[], cwd?: string): Map<string, SubagentDetail>;
//# sourceMappingURL=subagents.d.ts.map