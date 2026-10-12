import type { enDiff } from '../en/diff'

export const esDiff: Record<keyof typeof enDiff, string> = {
  'diff.loading': 'cargando…',
  'diff.idle': 'elegí un archivo',
  'diff.binary': 'archivo binario · sin vista de diff',
  'diff.deleted': 'eliminado',
  'diff.truncated': 'diff recortado (límite de contenido)',
  'diff.loadError': 'error al cargar el diff',
  'diff.railEmpty': 'sin cambios',
  'diff.hudMode': '{branch} · diff',
  'diff.hudCounts': '{files} · +{added} −{removed} contra base',
  'diff.files.one': '{count} archivo',
  'diff.files.other': '{count} archivos',
  'diff.originBorn': 'naciendo',
  'diff.originUncommitted': 'sin commitear',
  'diff.unstage': 'quitar del stage',
  'diff.stageRest': 'stagear el resto',
  'diff.stage': 'stagear',
  'diff.baseInvalid': 'base inválida',
  'diff.unbornHead': 'rama sin commits',
  'diff.noMergeBase': 'sin ancestro común con la base',
  'diff.noBaseRef': 'no se pudo determinar contra qué rama comparar'
}
