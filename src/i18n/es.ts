import type { Messages } from "./types.js";
import { panelEs } from "./panel.js";

export const es: Messages = {
  // Labels
  "label.context": "Contexto",
  "label.usage": "Uso",
  "label.weekly": "Semanal",
  "label.approxRam": "RAM aprox.",
  "label.promptCache": "Caché",
  "label.cacheHitRate": "Aciertos de caché",
  "label.rules": "reglas",
  "label.hooks": "hooks",
  "label.cost": "Costo",
  "label.today": "Hoy",
  "label.week": "Semana",
  "label.tokens": "Tokens",
  "label.sessionStarted": "Inicio",
  "label.lastReply": "Última respuesta",
  "label.advisor": "Asesor",
  "label.compactions": "Compactaciones",

  // Status
  "status.limitReached": "Límite alcanzado",
  "status.allTodosComplete": "Todas las tareas completas",
  "status.expired": "expirado",

  // Format
  "format.resets": "se reinicia",
  "format.resetsIn": "se reinicia en",
  "format.absoluteTime": "a las {time}",
  "format.untilTime": "hasta las {time}",
  "format.in": "entrada",
  "format.cache": "caché",
  "format.out": "salida",
  "format.tok": "tok",
  "format.tokPerSec": "tok/s",
  "format.justNow": "recién",
  "format.relativeTime": "hace {value}",
  "format.elapsed": "{value}% transcurrido",

  // Init
  "init.initializing": "[claude-hud] Inicializando...",
  "init.macosNote":
    "[claude-hud] Nota: en macOS puede que tengas que reiniciar Claude Code para que aparezca el HUD.",
  ...panelEs,
};
