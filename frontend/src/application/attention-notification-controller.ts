import { redactSecrets } from '../domain/secret-redaction'
import type {
  AttentionNotification,
  AttentionNotificationPort
} from './ports/attention-notification-port'

const MAX_SEEN_KEYS = 256

// Why: notification text is engine-sourced and can echo commands carrying capability tokens.
const redacted = (n: AttentionNotification): AttentionNotification => ({
  ...n,
  title: redactSecrets(n.title),
  body: redactSecrets(n.body)
})

export type AttentionNotificationController = {
  /** Binds (or rebinds after a reconnect) the stream; the previous subscription is closed. */
  bind(port: AttentionNotificationPort): void
  unbind(): void
}

export function createAttentionNotificationController(deps: {
  show: (notification: AttentionNotification) => void
}): AttentionNotificationController {
  const seen = new Set<string>()
  let subscription: { close(): void } | null = null
  let generation = 0
  let watermark: number | null = null
  let epoch: string | null = null

  function remember(
    notification: AttentionNotification,
    notificationEpoch: string | null
  ): boolean {
    if (notificationEpoch !== epoch && notificationEpoch !== null) {
      // Why: the host's counter restarts per process, so an old watermark would cut new events.
      epoch = notificationEpoch
      watermark = null
    }
    if (notification.seq !== null) {
      watermark = Math.max(watermark ?? 0, notification.seq)
    }
    if (!notification.notificationId) return true
    if (seen.has(notification.notificationId)) return false
    seen.add(notification.notificationId)
    if (seen.size > MAX_SEEN_KEYS) seen.delete(seen.values().next().value as string)
    return true
  }

  async function catchUp(
    port: AttentionNotificationPort,
    ownGeneration: number,
    silent: boolean
  ): Promise<void> {
    try {
      const missed = await port.getMissedSince(watermark ?? 0, epoch)
      if (ownGeneration !== generation) return
      for (const notification of missed.notifications) {
        if (remember(notification, missed.epoch) && !silent) deps.show(redacted(notification))
      }
    } catch {
      // Why: catch-up is best effort; the live stream still delivers from here on.
    }
  }

  return {
    bind(port) {
      subscription?.close()
      const ownGeneration = ++generation
      // Why: no watermark yet means first connect — mark history seen instead of toasting it.
      const baseline = watermark === null
      subscription = port.subscribe({
        onFrame(frame) {
          if (ownGeneration !== generation) return
          if (frame.type === 'ready') {
            void catchUp(port, ownGeneration, baseline && epoch === null)
            if (frame.epoch !== null && epoch === null) epoch = frame.epoch
            return
          }
          if (remember(frame.notification, frame.epoch)) deps.show(redacted(frame.notification))
        },
        onUnsupported() {},
        onClosed() {}
      })
    },
    unbind() {
      generation += 1
      subscription?.close()
      subscription = null
    }
  }
}
