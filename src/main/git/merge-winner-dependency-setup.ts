import type { OrcaHooks } from '../../shared/orca-yaml-hook-types'
import type { Repo } from '../../shared/repo-types'
import { parseOrcaYaml, runHook } from '../hooks'
import { getEffectiveHooksFromConfig, getEffectiveSetupRunPolicy } from '../effective-hook-config'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import type { ParentWorkingTreeSyncResult } from '../../shared/merge-winner-atomic-commit'
import { gitExecFileAsync } from './runner'

/** The parent's setup hook was kicked off in the background; absent when it did not apply. */
export type ParentDependencySetupResult = { status: 'started' }

const DEPENDENCY_MANIFEST =
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/

/** True when the merge commit changed a package manifest or lockfile relative to the old parent tip. */
export async function mergeChangedDependencyManifests(
  parentPath: string,
  commitOid: string,
  options: GitRuntimeOptions = {}
): Promise<boolean> {
  const { stdout } = await gitExecFileAsync(
    ['diff', '--name-only', `${commitOid}^1`, commitOid, '--'],
    gitOptionsForWorktree(parentPath, options)
  )
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .some((file) => DEPENDENCY_MANIFEST.test(file))
}

type SetupRunner = (
  repo: Repo,
  cwd: string,
  options: GitRuntimeOptions
) => Promise<{ success: boolean; output: string }>

// Why: the runner gets the already-resolved script as a local-only setting so runHook never reads the winner-authored on-disk orca.yaml.
const defaultSetupRunner: SetupRunner = (repo, cwd, options) =>
  runHook('setup', cwd, repo, cwd, options)

/** Effective setup script from orca.yaml as of the old parent tip (pre-merge) plus local settings. */
async function resolvePreMergeSetupScript(
  repo: Repo,
  parentPath: string,
  commitOid: string,
  options: GitRuntimeOptions | undefined
): Promise<string | undefined> {
  let yamlHooks: OrcaHooks | null = null
  try {
    const { stdout } = await gitExecFileAsync(
      ['show', `${commitOid}^1:orca.yaml`],
      gitOptionsForWorktree(parentPath, options)
    )
    yamlHooks = parseOrcaYaml(stdout)
  } catch {
    // Why: no orca.yaml at the old tip (or unparsable) means only the local setting applies.
  }
  return getEffectiveHooksFromConfig(repo, yamlHooks)?.scripts.setup?.trim() || undefined
}

/**
 * After a synced winner merge, starts the repo's setup hook (pre-merge orca.yaml plus local settings) in the parent in the
 * background so installed dependencies match the merged manifests. Never throws, never awaits the
 * hook (it outlives the RPC timeout), and never runs unless dependency files changed, the working
 * tree really synced, and the repo opted into run-by-default setup.
 */
export async function startParentDependencySetupAfterMerge(args: {
  repo: Repo | undefined
  parentPath: string
  commitOid: string
  workingTree: ParentWorkingTreeSyncResult | undefined
  options?: GitRuntimeOptions
  runSetup?: SetupRunner
}): Promise<ParentDependencySetupResult | undefined> {
  const { repo, parentPath, commitOid, workingTree } = args
  if (!repo || workingTree?.status !== 'synced') {
    return undefined
  }
  try {
    if (getEffectiveSetupRunPolicy(repo) !== 'run-by-default') {
      return undefined
    }
    if (!(await mergeChangedDependencyManifests(parentPath, commitOid, args.options))) {
      return undefined
    }
    const script = await resolvePreMergeSetupScript(repo, parentPath, commitOid, args.options)
    if (!script) {
      return undefined
    }
    const pinnedRepo: Repo = {
      ...repo,
      hookSettings: {
        mode: 'auto',
        ...repo.hookSettings,
        commandSourcePolicy: 'local-only',
        scripts: { archive: '', ...repo.hookSettings?.scripts, setup: script }
      }
    }
    void (args.runSetup ?? defaultSetupRunner)(pinnedRepo, parentPath, args.options ?? {})
      .then((result) => {
        if (!result.success) {
          console.error(`[hooks] parent dependency setup failed in ${parentPath}:`, result.output)
        }
      })
      .catch((error: unknown) => {
        console.error(`[hooks] parent dependency setup failed in ${parentPath}:`, error)
      })
    return { status: 'started' }
  } catch (error) {
    console.error(`[hooks] parent dependency setup skipped in ${parentPath}:`, error)
    return undefined
  }
}
