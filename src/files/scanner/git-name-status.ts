import type { GitImageChangeType, GitImagePathChange } from './types'
import { isImageFile } from './image'

export function extractImageChangesFromNameStatusOutput(output: string): GitImagePathChange[] {
  const results: GitImagePathChange[] = []
  const seen = new Set<string>()

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const fields = line.split('\t')
    if (fields.length < 2) {
      continue
    }

    const status = fields[0]
    if (!status) {
      continue
    }

    const statusCode = status[0].toUpperCase()
    const changeType: GitImageChangeType = statusCode === 'R'
      ? 'R'
      : statusCode === 'D'
        ? 'D'
        : statusCode === 'A'
          ? 'A'
          : 'M'

    const filePath = changeType === 'R' ? fields[2] : fields[1]
    const previousPath = changeType === 'R' ? fields[1] : undefined
    const dedupeKey = `${changeType}:${filePath}`
    if (!filePath || !isImageFile(filePath) || seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    results.push({ path: filePath, changeType, previousPath })
  }

  return results
}

export function extractImagePathsFromNameStatusOutput(output: string): string[] {
  return extractImageChangesFromNameStatusOutput(output)
    .filter(change => change.changeType !== 'D')
    .map(change => change.path)
}
