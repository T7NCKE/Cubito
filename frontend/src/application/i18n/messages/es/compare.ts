import type { enCompare } from '../en/compare'

export const esCompare: Record<keyof typeof enCompare, string> = {
  'compare.hudMode': 'comparar la camada',
  'compare.noLitter': 'todavía no hay nada para comparar: lanzá un fan-out primero',
  'compare.noWinner': 'sin elegir',
  'compare.hudWinner': '{children} · ganador: {winner}',
  'compare.children.one': '{count} hijo',
  'compare.children.other': '{count} hijos',
  'compare.merge': 'mergear ganador',
  'compare.mergeConfirm': 'confirmar merge',
  'compare.merging': 'mergeando…',
  'compare.mergeUnsupported': 'no soportado',
  'compare.conflict': 'Conflicto — sin cambios aplicados:',
  'compare.syncParent': 'sincronizar el padre',
  'compare.mergedClean':
    'Mergeado al padre ({oid}), pero sus archivos no se sincronizaron. En el worktree padre corré `git read-tree -u -m {oid}^1 HEAD` (conserva tus ediciones locales) o `git reset --hard` (las descarta).',
  'compare.mergedSynced': 'Mergeado al padre ({oid}) — padre sincronizado.',
  'compare.mergedUnsynced':
    'Mergeado al padre ({oid}), pero sus archivos no se actualizaron: el padre muestra el merge invertido hasta que lo termines o lo deshagas.',
  'compare.unsyncedRecovery':
    'En el worktree padre: deshacelo con `git reset --soft {previous}`, o mové los archivos que bloquean y terminalo con `git read-tree -u -m {previous} HEAD`.',
  'compare.parentSkipped': 'padre no sincronizado: tiene cambios sin commitear.',
  'compare.blocked.untracked-overwrite':
    'El padre tiene archivos que el ganador sobrescribiría — no se mergeó nada. Movelos o borralos y volvé a mergear:',
  'compare.blocked.dirty-parent':
    'El padre tiene cambios sin commitear en archivos que el ganador modifica — no se mergeó nada. Commitealos o guardalos con stash y volvé a mergear:',
  'compare.blocked.sync-refused': 'No se puede actualizar el worktree padre — no se mergeó nada.',
  'compare.blocked.sync-failed':
    'Falló la actualización del worktree padre, así que el merge se deshizo — no se mergeó nada.',
  'compare.alreadyMerged': 'El padre ya contiene este ganador ({oid}) — no hay nada que mergear.',
  'compare.reinstalling': 'reinstalando dependencias del padre en segundo plano (setup).',
  'compare.winner': 'ganador',
  'compare.pickWinner': 'elegir ganador',
  'compare.railStats': '{files} · +{added} −{removed}',
  'compare.railFiles.one': '{count} archivo',
  'compare.railFiles.other': '{count} archivos',
  'compare.railEmpty': 'sin hijos'
}
