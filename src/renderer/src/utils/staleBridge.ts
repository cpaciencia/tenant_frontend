import { IpcChannels } from '../../../shared/ipc'

/**
 * Channels this renderer build expects that the running Main/preload doesn't
 * know. Non-empty means the app is running an old Main under a new UI (in dev:
 * `npm run dev` hot-reloads only the renderer) — features would silently fail,
 * so the app asks for a full restart instead.
 */
export function missingIpcChannels(): string[] {
  const known = (window.api as { ipcChannels?: string[] } | undefined)?.ipcChannels
  if (!window.api) return []
  if (!Array.isArray(known)) return Object.values(IpcChannels)
  return Object.values(IpcChannels).filter((c) => !known.includes(c))
}
