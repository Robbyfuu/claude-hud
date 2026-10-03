// Fork-only: panel layout message keys and per-locale strings.
// Kept out of the upstream locale files so syncs do not conflict.

export type PanelMessageKey =
  | "panel.session"
  | "panel.usage"
  | "panel.environment"
  | "panel.activity"
  | "panel.context"
  | "panel.fiveHour"
  | "panel.weekly"
  | "panel.tasks"
  | "panel.tools"
  | "panel.rules"
  | "panel.hooks"
  | "panel.cache"
  | "panel.col.agent"
  | "panel.col.task"
  | "panel.col.skills"
  | "panel.col.progress"
  | "panel.col.now"
  | "panel.col.tokens"
  | "panel.col.time"
  | "panel.agentsRunning"
  | "panel.agentsDone"
  | "panel.agentsRunningOne"
  | "panel.agentsDoneOne"
  | "panel.moreAgents"
  | "panel.noPlan"
  | "panel.uses"
  | "panel.done"
  | "panel.thinking"
  | "panel.idle"
  | "panel.noActivity"
  | "panel.noGit"
  | "panel.compact"
  | "panel.tokens"
  | "panel.cacheShare"
  | "panel.adviceNow"
  | "panel.adviceColdCache"
  | "panel.adviceSoon";

export const panelEn: Record<PanelMessageKey, string> = {
  "panel.session": "session",
  "panel.usage": "usage",
  "panel.environment": "environment",
  "panel.activity": "activity",
  "panel.context": "context",
  "panel.fiveHour": "5 hours",
  "panel.weekly": "weekly",
  "panel.tasks": "tasks",
  "panel.tools": "tools",
  "panel.rules": "rules",
  "panel.hooks": "hooks",
  "panel.cache": "cache",
  "panel.col.agent": "AGENT",
  "panel.col.task": "TASK",
  "panel.col.skills": "SKILLS",
  "panel.col.progress": "PROGRESS",
  "panel.col.now": "NOW",
  "panel.col.tokens": "TOK",
  "panel.col.time": "TIME",
  "panel.agentsRunning": "{count} running",
  "panel.agentsDone": "{count} done",
  "panel.agentsRunningOne": "{count} running",
  "panel.agentsDoneOne": "{count} done",
  "panel.moreAgents": "+{count} more",
  "panel.noPlan": "no plan",
  "panel.uses": "{count} uses",
  "panel.done": "done",
  "panel.thinking": "thinking…",
  "panel.idle": "idle {duration}",
  "panel.noActivity": "no activity yet",
  "panel.noGit": "no git",
  "panel.compact": "/compact",
  "panel.tokens": "tok",
  "panel.cacheShare": "{percent}% cache",
  "panel.adviceNow": "new session",
  "panel.adviceColdCache": "cold cache, rewrites {tokens}",
  "panel.adviceSoon": "new session soon",
};

export const panelEs: Record<PanelMessageKey, string> = {
  "panel.session": "sesión",
  "panel.usage": "consumo",
  "panel.environment": "entorno",
  "panel.activity": "actividad",
  "panel.context": "contexto",
  "panel.fiveHour": "5 horas",
  "panel.weekly": "semanal",
  "panel.tasks": "tareas",
  "panel.tools": "herramientas",
  "panel.rules": "reglas",
  "panel.hooks": "hooks",
  "panel.cache": "caché",
  "panel.col.agent": "AGENTE",
  "panel.col.task": "TAREA",
  "panel.col.skills": "SKILLS",
  "panel.col.progress": "PROGRESO",
  "panel.col.now": "AHORA",
  "panel.col.tokens": "TOK",
  "panel.col.time": "TIEMPO",
  "panel.agentsRunning": "{count} activos",
  "panel.agentsDone": "{count} listos",
  "panel.agentsRunningOne": "{count} activo",
  "panel.agentsDoneOne": "{count} listo",
  "panel.moreAgents": "+{count} más",
  "panel.noPlan": "sin plan",
  "panel.uses": "{count} usos",
  "panel.done": "listo",
  "panel.thinking": "pensando…",
  "panel.idle": "inactivo {duration}",
  "panel.noActivity": "sin actividad aún",
  "panel.noGit": "sin git",
  "panel.compact": "/compact",
  "panel.tokens": "tok",
  "panel.cacheShare": "{percent}% caché",
  "panel.adviceNow": "nueva sesión",
  "panel.adviceColdCache": "caché fría, reescribe {tokens}",
  "panel.adviceSoon": "nueva sesión pronto",
};

export const panelZhHans: Record<PanelMessageKey, string> = {
  "panel.session": "会话",
  "panel.usage": "用量",
  "panel.environment": "环境",
  "panel.activity": "活动",
  "panel.context": "上下文",
  "panel.fiveHour": "5 小时",
  "panel.weekly": "本周",
  "panel.tasks": "任务",
  "panel.tools": "工具",
  "panel.rules": "规则",
  "panel.hooks": "钩子",
  "panel.cache": "缓存",
  "panel.col.agent": "代理",
  "panel.col.task": "任务",
  "panel.col.skills": "技能",
  "panel.col.progress": "进度",
  "panel.col.now": "当前",
  "panel.col.tokens": "词元",
  "panel.col.time": "时间",
  "panel.agentsRunning": "{count} 运行中",
  "panel.agentsDone": "{count} 已完成",
  "panel.agentsRunningOne": "{count} 运行中",
  "panel.agentsDoneOne": "{count} 已完成",
  "panel.moreAgents": "另有 {count} 个",
  "panel.noPlan": "无计划",
  "panel.uses": "{count} 次调用",
  "panel.done": "完成",
  "panel.thinking": "思考中…",
  "panel.idle": "空闲 {duration}",
  "panel.noActivity": "暂无活动",
  "panel.noGit": "无 git",
  "panel.compact": "/compact",
  "panel.tokens": "词元",
  "panel.cacheShare": "{percent}% 缓存",
  "panel.adviceNow": "新建会话",
  "panel.adviceColdCache": "缓存已冷，将重写 {tokens}",
  "panel.adviceSoon": "即将需要新建会话",
};

export const panelZhHant: Record<PanelMessageKey, string> = {
  "panel.session": "會話",
  "panel.usage": "用量",
  "panel.environment": "環境",
  "panel.activity": "活動",
  "panel.context": "上下文",
  "panel.fiveHour": "5 小時",
  "panel.weekly": "本週",
  "panel.tasks": "任務",
  "panel.tools": "工具",
  "panel.rules": "規則",
  "panel.hooks": "鉤子",
  "panel.cache": "快取",
  "panel.col.agent": "代理",
  "panel.col.task": "任務",
  "panel.col.skills": "技能",
  "panel.col.progress": "進度",
  "panel.col.now": "目前",
  "panel.col.tokens": "詞元",
  "panel.col.time": "時間",
  "panel.agentsRunning": "{count} 執行中",
  "panel.agentsDone": "{count} 已完成",
  "panel.agentsRunningOne": "{count} 執行中",
  "panel.agentsDoneOne": "{count} 已完成",
  "panel.moreAgents": "另有 {count} 個",
  "panel.noPlan": "無計劃",
  "panel.uses": "{count} 次呼叫",
  "panel.done": "完成",
  "panel.thinking": "思考中…",
  "panel.idle": "閒置 {duration}",
  "panel.noActivity": "暫無活動",
  "panel.noGit": "無 git",
  "panel.compact": "/compact",
  "panel.tokens": "詞元",
  "panel.cacheShare": "{percent}% 快取",
  "panel.adviceNow": "新建會話",
  "panel.adviceColdCache": "快取已冷，將重寫 {tokens}",
  "panel.adviceSoon": "即將需要新建會話",
};
