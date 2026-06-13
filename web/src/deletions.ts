import type { ChatLine, DeletionRecord } from './api';

export interface DeletionIndex {
  deletedIds: Set<string>;
  userClears: { user: string; t: number; durationS?: number }[];
}

export function buildDeletionIndex(records: DeletionRecord[]): DeletionIndex {
  const deletedIds = new Set<string>();
  const userClears: DeletionIndex['userClears'] = [];
  for (const r of records) {
    if (r.kind === 'message' && r.targetId) deletedIds.add(r.targetId);
    else if (r.kind === 'user') userClears.push({ user: r.user, t: r.t, durationS: r.durationS });
  }
  return { deletedIds, userClears };
}

export function classifyDeletion(line: ChatLine, index: DeletionIndex): { deleted: boolean; reason: string } {
  if (line.id && index.deletedIds.has(line.id)) {
    return { deleted: true, reason: 'message removed by a moderator' };
  }
  if (line.user) {
    for (const c of index.userClears) {
      if (c.user === line.user && c.t >= line.t) {
        return { deleted: true, reason: c.durationS ? `user timed out (${c.durationS}s)` : 'user banned' };
      }
    }
  }
  return { deleted: false, reason: '' };
}
