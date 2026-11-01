import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

/** Server-owned artifact writes: reject links, replace atomically, never follow a target. */
export function safeWriteArtifact(path: string, content: string): void {
  const absolute = resolve(path)
  for (let current = absolute; ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()
        && !(process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && realpathSync(current) === `/private${current}`)) throw new Error('symlink_path_refused')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (dirname(current) === current) break
  }
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = `${absolute}.${randomBytes(12).toString('hex')}.tmp`
  try {
    writeFileSync(temp, content, { flag: 'wx', mode: 0o600 })
    try { if (lstatSync(absolute).isSymbolicLink()) throw new Error('symlink_path_refused') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    renameSync(temp, absolute)
  } finally { try { unlinkSync(temp) } catch { /* already renamed */ } }
}

export function readOptionalArtifact(path: string): string | null {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error('symlink_path_refused')
    return readFileSync(path, 'utf8')
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
