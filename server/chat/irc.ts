import type { ChatEmote, ChatLine } from '../types.js';

export interface IrcMessage {
  tags: Record<string, string>;
  prefix: string | null;
  command: string;
  params: string[]; // trailing param (after " :") is last
}

export function unescapeTag(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) =>
    c === 's' ? ' ' : c === 'n' ? '\n' : c === 'r' ? '\r' : c === ':' ? ';' : c);
}

export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line.trim();
  if (!rest) return null;
  const tags: Record<string, string> = {};
  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    for (const part of rest.slice(1, sp).split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) tags[part] = '';
      else tags[part.slice(0, eq)] = unescapeTag(part.slice(eq + 1));
    }
    rest = rest.slice(sp + 1);
  }
  let prefix: string | null = null;
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    if (sp === -1) return null;
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  let trailing: string | null = null;
  if (rest.startsWith(':')) { trailing = rest.slice(1); rest = ''; }
  else {
    const ti = rest.indexOf(' :');
    if (ti !== -1) { trailing = rest.slice(ti + 2); rest = rest.slice(0, ti); }
  }
  const params = rest.split(' ').filter(Boolean);
  const command = params.shift() ?? '';
  if (!command) return null;
  if (trailing !== null) params.push(trailing);
  return { tags, prefix, command, params };
}

// tag format: "425618:0-2,8-10/25:4-6" — indices are unicode code points into the text
export function parseEmotes(tag: string): ChatEmote[] {
  if (!tag) return [];
  const out: ChatEmote[] = [];
  for (const grp of tag.split('/')) {
    const colon = grp.indexOf(':');
    if (colon === -1) continue;
    const id = grp.slice(0, colon);
    for (const r of grp.slice(colon + 1).split(',')) {
      const [s, e] = r.split('-').map(Number);
      if (id && Number.isFinite(s) && Number.isFinite(e)) out.push({ id, s, e });
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

export function parseBadges(tag: string): string[] {
  return tag ? tag.split(',').filter(Boolean) : [];
}

export function toChatLine(m: IrcMessage, t: number): ChatLine | null {
  if (m.command === 'PRIVMSG') {
    const text = m.params[1] ?? '';
    const user = m.prefix?.split('!')[0] ?? 'unknown';
    return {
      t, type: 'msg', user,
      display: m.tags['display-name'] || user,
      color: m.tags['color'] || undefined,
      badges: parseBadges(m.tags['badges'] ?? ''),
      text,
      emotes: parseEmotes(m.tags['emotes'] ?? ''),
    };
  }
  if (m.command === 'USERNOTICE') {
    const sys = m.tags['system-msg'];
    if (!sys) return null;
    const userText = m.params[1];
    return { t, type: 'system', text: userText ? `${sys} — ${userText}` : sys };
  }
  return null;
}
