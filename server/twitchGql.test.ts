import { expect, test } from 'vitest';
import { buildStatusBody, extractUser, parseLoginFromInput, parseStatusResponse } from './twitchGql.js';

test('parseLoginFromInput handles URLs and bare names', () => {
  expect(parseLoginFromInput('https://www.twitch.tv/streamertwo')).toBe('streamertwo');
  expect(parseLoginFromInput('twitch.tv/Streamerone/videos')).toBe('streamerone');
  expect(parseLoginFromInput('  SomeName ')).toBe('somename');
  expect(parseLoginFromInput('https://twitch.tv/')).toBeNull();
  expect(parseLoginFromInput('bad name!')).toBeNull();
  expect(parseLoginFromInput('')).toBeNull();
});

test('buildStatusBody builds one operation per login', () => {
  const body = buildStatusBody(['a', 'b']);
  expect(body).toHaveLength(2);
  expect(body[0].variables).toEqual({ login: 'a' });
  expect(typeof body[0].query).toBe('string');
});

test('parseStatusResponse maps live, offline and missing users', () => {
  const json = [
    { data: { user: {
      login: 'a', displayName: 'A', profileImageURL: 'http://img/a',
      stream: { id: '1', title: 'Hi', viewersCount: 42, createdAt: '2026-06-12T19:00:00Z', game: { displayName: 'IRL' } },
    } } },
    { data: { user: { login: 'b', displayName: 'B', profileImageURL: 'http://img/b', stream: null } } },
    { data: { user: null } },
  ];
  const out = parseStatusResponse(['a', 'b', 'gone'], json);
  expect(out[0]).toEqual({
    login: 'a', displayName: 'A', avatarUrl: 'http://img/a', live: true,
    title: 'Hi', game: 'IRL', viewers: 42, startedAt: '2026-06-12T19:00:00Z',
  });
  expect(out[1].live).toBe(false);
  expect(out[1].title).toBeNull();
  expect(out[2]).toEqual({
    login: 'gone', displayName: 'gone', avatarUrl: '', live: false,
    title: null, game: null, viewers: null, startedAt: null,
  });
});

test('parseStatusResponse tolerates malformed payloads', () => {
  const out = parseStatusResponse(['a'], 'garbage');
  expect(out[0].live).toBe(false);
});

test('parseLoginFromInput rejects reserved twitch.tv paths but allows them as bare names', () => {
  expect(parseLoginFromInput('https://twitch.tv/videos/2161234567')).toBeNull();
  expect(parseLoginFromInput('twitch.tv/directory/category/just-chatting')).toBeNull();
  expect(parseLoginFromInput('videos')).toBe('videos'); // bare name: user's explicit intent
});

test('extractUser returns user, null for missing, and throws on gql errors', () => {
  expect(extractUser([{ data: { user: { login: 'a' } } }], 0)).toEqual({ login: 'a' });
  expect(extractUser([{ data: { user: null } }], 0)).toBeNull();
  expect(extractUser('garbage', 0)).toBeNull();
  expect(() => extractUser([{ errors: [{ message: 'rate limited' }] }], 0)).toThrow(/gql error/);
});

test('parseStatusResponse propagates per-entry gql errors instead of mapping to offline', () => {
  expect(() => parseStatusResponse(['a'], [{ errors: [{ message: 'integrity' }] }])).toThrow(/gql error/);
});
