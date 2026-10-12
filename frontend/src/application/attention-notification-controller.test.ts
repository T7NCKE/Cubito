import { describe, expect, it, vi } from 'vitest'
import { createAttentionNotificationController } from './attention-notification-controller'
import type {
  AttentionNotification,
  AttentionNotificationHandlers,
  AttentionNotificationPort,
  MissedAttentionNotifications
} from './ports/attention-notification-port'

const note = (id: string, seq: number | null, extra: Partial<AttentionNotification> = {}) => ({
  notificationId: id,
  seq,
  title: `t-${id}`,
  body: 'b',
  worktreeId: 'r::/p',
  agentState: 'blocked' as const,
  ...extra
})

function createFakePort(missed: MissedAttentionNotifications = { notifications: [], epoch: 'e1' }) {
  let handlers: AttentionNotificationHandlers | null = null
  const close = vi.fn()
  const getMissedSince = vi.fn(async () => missed)
  const port: AttentionNotificationPort = {
    subscribe(h) {
      handlers = h
      return { close }
    },
    getMissedSince
  }
  return {
    port,
    close,
    getMissedSince,
    ready: (epoch: string | null = 'e1') => handlers!.onFrame({ type: 'ready', epoch }),
    push: (n: AttentionNotification, epoch: string | null = 'e1') =>
      handlers!.onFrame({ type: 'notification', notification: n, epoch }),
    unsupported: () => handlers!.onUnsupported()
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('attention notification controller', () => {
  it('redacts secrets from title and body before showing', async () => {
    const show = vi.fn()
    const controller = createAttentionNotificationController({ show })
    const fake = createFakePort()
    controller.bind(fake.port)
    fake.ready()
    await flush()
    fake.push(note('s1', 1, { title: 'run dcap_0123456789abcdef', body: 'GITHUB_TOKEN=ghp_x1 go' }))
    const shown = show.mock.calls[0]![0] as AttentionNotification
    expect(shown.title).not.toContain('dcap_0123')
    expect(shown.body).not.toContain('ghp_x1')
  })

  it('shows live notifications once, deduped by id', async () => {
    const show = vi.fn()
    const fake = createFakePort()
    const controller = createAttentionNotificationController({ show })
    controller.bind(fake.port)
    fake.ready()
    await flush()
    fake.push(note('a', 1))
    fake.push(note('a', 1))
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('baselines silently on first ready: pre-existing notifications are not shown', async () => {
    const show = vi.fn()
    const fake = createFakePort({ notifications: [note('old', 5)], epoch: 'e1' })
    createAttentionNotificationController({ show }).bind(fake.port)
    fake.ready()
    await flush()
    expect(fake.getMissedSince).toHaveBeenCalledWith(0, null)
    expect(show).not.toHaveBeenCalled()
  })

  it('on reconnect, shows what was missed past the watermark and no more', async () => {
    const show = vi.fn()
    const first = createFakePort()
    const controller = createAttentionNotificationController({ show })
    controller.bind(first.port)
    first.ready()
    await flush()
    first.push(note('a', 3))

    const second = createFakePort({
      notifications: [note('a', 3), note('b', 4), note('c', 5)],
      epoch: 'e1'
    })
    controller.bind(second.port)
    second.ready()
    await flush()
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.getMissedSince).toHaveBeenCalledWith(3, 'e1')
    expect(show.mock.calls.map((c) => c[0].notificationId)).toEqual(['a', 'b', 'c'])
  })

  it('degrades silently when the host has no notifications.subscribe', async () => {
    const show = vi.fn()
    const fake = createFakePort()
    createAttentionNotificationController({ show }).bind(fake.port)
    fake.unsupported()
    await flush()
    expect(show).not.toHaveBeenCalled()
  })

  it('survives a getMissedSince failure without throwing', async () => {
    const show = vi.fn()
    const fake = createFakePort()
    fake.getMissedSince.mockRejectedValueOnce(new Error('boom'))
    createAttentionNotificationController({ show }).bind(fake.port)
    fake.ready()
    await flush()
    fake.push(note('x', 1))
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('unbind closes the subscription', () => {
    const fake = createFakePort()
    const controller = createAttentionNotificationController({ show: vi.fn() })
    controller.bind(fake.port)
    controller.unbind()
    expect(fake.close).toHaveBeenCalledTimes(1)
  })
})
