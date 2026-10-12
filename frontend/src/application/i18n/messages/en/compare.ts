export const enCompare = {
  'compare.hudMode': 'compare the litter',
  'compare.noLitter': 'nothing to compare yet: launch a fan-out first',
  'compare.noWinner': 'none picked',
  'compare.hudWinner': '{children} · winner: {winner}',
  'compare.children.one': '{count} child',
  'compare.children.other': '{count} children',
  'compare.merge': 'merge winner',
  'compare.mergeConfirm': 'confirm merge',
  'compare.merging': 'merging…',
  'compare.mergeUnsupported': 'not supported',
  'compare.conflict': 'Conflict — no changes applied:',
  'compare.syncParent': 'sync the parent',
  'compare.mergedClean':
    'Merged into the parent ({oid}), but its files were not synced. In the parent worktree run `git read-tree -u -m {oid}^1 HEAD` (keeps your local edits) or `git reset --hard` (discards them).',
  'compare.mergedSynced': 'Merged into the parent ({oid}) — parent synced.',
  'compare.mergedUnsynced':
    'Merged into the parent ({oid}), but its files were not updated: the parent shows the merge reversed until you finish or undo it.',
  'compare.unsyncedRecovery':
    'In the parent worktree: undo with `git reset --soft {previous}`, or move the blocking files away and finish with `git read-tree -u -m {previous} HEAD`.',
  'compare.parentSkipped': 'parent not synced: it has uncommitted changes.',
  'compare.blocked.untracked-overwrite':
    'The parent has files the winner would overwrite — nothing was merged. Move or delete them, then merge again:',
  'compare.blocked.dirty-parent':
    'The parent has uncommitted changes in files the winner changes — nothing was merged. Commit or stash them, then merge again:',
  'compare.blocked.sync-refused': 'The parent worktree cannot be updated — nothing was merged.',
  'compare.blocked.sync-failed':
    'Updating the parent worktree failed, so the merge was undone — nothing was merged.',
  'compare.alreadyMerged': 'The parent already contains this winner ({oid}) — nothing to merge.',
  'compare.reinstalling': 'reinstalling the parent dependencies in the background (setup).',
  'compare.winner': 'winner',
  'compare.pickWinner': 'pick winner',
  'compare.railStats': '{files} · +{added} −{removed}',
  'compare.railFiles.one': '{count} file',
  'compare.railFiles.other': '{count} files',
  'compare.railEmpty': 'no children'
} as const
