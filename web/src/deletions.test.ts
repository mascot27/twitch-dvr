import { expect, test } from 'vitest';
import { buildDeletionIndex, classifyDeletion } from './deletions';
import type { ChatLine } from './api';

const msg = (over: Partial<ChatLine>): ChatLine => ({ t: 1000, type: 'msg', user: 'bob', text: 'hi', ...over });

test('classifies a message whose id was deleted', () => {
  const idx = buildDeletionIndex([{ t: 5000, kind: 'message', user: 'bob', targetId: 'm1' }]);
  expect(classifyDeletion(msg({ id: 'm1' }), idx)).toEqual({ deleted: true, reason: 'message removed by a moderator' });
  expect(classifyDeletion(msg({ id: 'm2' }), idx).deleted).toBe(false);
});

test('classifies a user\'s messages at or before a timeout, with duration in the reason', () => {
  const idx = buildDeletionIndex([{ t: 2000, kind: 'user', user: 'bob', durationS: 600 }]);
  expect(classifyDeletion(msg({ t: 1000 }), idx)).toEqual({ deleted: true, reason: 'user timed out (600s)' });
  expect(classifyDeletion(msg({ t: 2000 }), idx).deleted).toBe(true);   // exactly at the clear
  expect(classifyDeletion(msg({ t: 3000 }), idx).deleted).toBe(false);  // after the clear
  expect(classifyDeletion(msg({ user: 'alice', t: 1000 }), idx).deleted).toBe(false); // other user
});

test('permanent ban (no duration) reads as banned', () => {
  const idx = buildDeletionIndex([{ t: 2000, kind: 'user', user: 'bob' }]);
  expect(classifyDeletion(msg({ t: 1000 }), idx)).toEqual({ deleted: true, reason: 'user banned' });
});

test('a line with no id is not matched by id', () => {
  const idx = buildDeletionIndex([{ t: 5000, kind: 'message', user: 'bob', targetId: 'm1' }]);
  expect(classifyDeletion(msg({}), idx).deleted).toBe(false);
});
