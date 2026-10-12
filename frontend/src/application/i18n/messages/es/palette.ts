import type { enPalette } from '../en/palette'

export const esPalette: Record<keyof typeof enPalette, string> = {
  'palette.focus': 'foco',
  'palette.fitAll': 'general · ver todo',
  'palette.openTerminal': 'abrir terminal',
  'palette.openSpawn': 'crear worktree',
  'palette.projects': 'proyectos',
  'palette.addRepo': 'agregar repo',
  'palette.fanOut': 'fan-out',
  'palette.openSystem': 'sistema en vivo',
  'palette.openDiff': 'diff',
  'palette.openCompare': 'comparar la camada',
  'palette.deleteWorktree': 'eliminar worktree',
  'palette.openFile': 'abrir archivo',
  'palette.queryPlaceholder': 'escribí un comando…',
  'palette.footer': '↑↓ navegar · ⏎ ejecutar · esc cerrar',
  'palette.switchLanguage': 'Language: English',
  // Why: both names stay searchable whichever language the label is in.
  'palette.switchLanguage.keywords': 'language idioma english español espanol'
}
