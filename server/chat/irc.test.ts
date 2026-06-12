import { expect, test } from 'vitest';
import { parseBadges, parseEmotes, parseIrcLine, toChatLine, unescapeTag } from './irc.js';

const PRIVMSG = '@badge-info=subscriber/14;badges=subscriber/12,vip/1;color=#FF4500;display-name=SomeFan;emotes=425618:0-2,8-10;id=abc;tmi-sent-ts=1718200000000 :somefan!somefan@somefan.tmi.twitch.tv PRIVMSG #streamerone :LUL hi LUL';

test('parseIrcLine splits tags, prefix, command, params, trailing', () => {
  const m = parseIrcLine(PRIVMSG)!;
  expect(m.command).toBe('PRIVMSG');
  expect(m.params[0]).toBe('#streamerone');
  expect(m.params[1]).toBe('LUL hi LUL');
  expect(m.prefix).toBe('somefan!somefan@somefan.tmi.twitch.tv');
  expect(m.tags['display-name']).toBe('SomeFan');
  expect(m.tags['color']).toBe('#FF4500');
});

test('parseIrcLine handles PING and empty lines', () => {
  const ping = parseIrcLine('PING :tmi.twitch.tv')!;
  expect(ping.command).toBe('PING');
  expect(ping.params).toEqual(['tmi.twitch.tv']);
  expect(parseIrcLine('')).toBeNull();
});

test('unescapeTag handles IRCv3 escapes', () => {
  expect(unescapeTag('hello\\sworld')).toBe('hello world');
  expect(unescapeTag('semi\\:colon')).toBe('semi;colon');
  expect(unescapeTag('back\\\\slash')).toBe('back\\slash');
  expect(unescapeTag('line\\nbreak')).toBe('line\nbreak');
});

test('parseEmotes parses id:ranges groups sorted by start', () => {
  expect(parseEmotes('425618:8-10,0-2/25:4-6')).toEqual([
    { id: '425618', s: 0, e: 2 },
    { id: '25', s: 4, e: 6 },
    { id: '425618', s: 8, e: 10 },
  ]);
  expect(parseEmotes('')).toEqual([]);
});

test('parseBadges splits badge list', () => {
  expect(parseBadges('subscriber/12,vip/1')).toEqual(['subscriber/12', 'vip/1']);
  expect(parseBadges('')).toEqual([]);
});

test('toChatLine maps PRIVMSG to msg line', () => {
  const line = toChatLine(parseIrcLine(PRIVMSG)!, 12345)!;
  expect(line).toEqual({
    t: 12345, type: 'msg', user: 'somefan', display: 'SomeFan', color: '#FF4500',
    badges: ['subscriber/12', 'vip/1'], text: 'LUL hi LUL',
    emotes: [{ id: '425618', s: 0, e: 2 }, { id: '425618', s: 8, e: 10 }],
  });
});

test('toChatLine maps USERNOTICE system-msg, with and without user text', () => {
  const raw = '@system-msg=SomeFan\\ssubscribed\\sfor\\s12\\smonths;display-name=SomeFan :tmi.twitch.tv USERNOTICE #streamerone :great stream!';
  expect(toChatLine(parseIrcLine(raw)!, 99)).toEqual({ t: 99, type: 'system', text: 'SomeFan subscribed for 12 months — great stream!' });
  const noText = '@system-msg=Raiders! :tmi.twitch.tv USERNOTICE #streamerone';
  expect(toChatLine(parseIrcLine(noText)!, 5)).toEqual({ t: 5, type: 'system', text: 'Raiders!' });
});

test('toChatLine ignores other commands', () => {
  expect(toChatLine(parseIrcLine('PING :x')!, 1)).toBeNull();
});
