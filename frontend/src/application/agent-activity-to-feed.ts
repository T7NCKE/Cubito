import type { AgentActivityEvent, AgentActivityKind } from './ports/runtime-gateway'
import type { FeedRow } from '../domain/system-graph/types'
import { formatClockTime } from './clock-time'
import { t } from './i18n/translate'
import type { MessageKey } from './i18n/messages/en'

const KIND_VERB: Record<AgentActivityKind, MessageKey> = {
  read: 'activity.read',
  edit: 'activity.edit',
  create: 'activity.create',
  run: 'activity.run'
}

/** Maps one `agent.activity` event to a feed row. Pure — mirrors system-snapshot-to-graph.ts. */
export function agentActivityToFeedRow(event: AgentActivityEvent): FeedRow {
  return {
    id: `activity-${event.seq}`,
    time: formatClockTime(event.at),
    kind: event.kind,
    text: `${t(KIND_VERB[event.kind])} ${event.target}`
  }
}
