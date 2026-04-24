import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '../../types/history';
import type { LauncherApp, LauncherFile } from '../launcher';
import { buildLauncherSections } from '../launcher';

const conversations: ConversationSummary[] = [
  {
    id: 'conv-1',
    title: 'Search chrome troubleshooting',
    model: 'gemma4:e2b',
    updated_at: 1_710_000_000_000,
    message_count: 8,
  },
];

const apps: LauncherApp[] = [
  {
    id: 'chrome',
    title: 'Google Chrome',
    subtitle: 'Application',
    path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Google Chrome.lnk',
  },
];

const files: LauncherFile[] = [
  {
    id: 'notes',
    title: 'Chrome Notes.txt',
    subtitle: 'Downloads',
    path: 'C:\\Users\\User\\Downloads\\Chrome Notes.txt',
    isDirectory: false,
  },
];

describe('buildLauncherSections', () => {
  it('returns no launcher sections when query is empty', () => {
    const sections = buildLauncherSections('', [], [], []);
    expect(sections).toHaveLength(0);
  });

  it('builds ask, command, conversation, and web sections for typed query', () => {
    const sections = buildLauncherSections(
      'screen',
      conversations,
      apps,
      files,
      1_710_000_060_000,
    );
    expect(sections[0].items[0]).toMatchObject({
      kind: 'ask',
      title: 'Ask Miaw',
      subtitle: 'screen',
    });
    expect(sections.some((section) => section.title === 'Commands')).toBe(true);
    expect(sections.some((section) => section.title === 'Recent chats')).toBe(true);
    expect(sections.some((section) => section.title === 'Applications')).toBe(
      true,
    );
    expect(
      sections.some((section) => section.title === 'Files and folders'),
    ).toBe(true);
    expect(sections.at(-1)?.items[0]).toMatchObject({
      kind: 'web',
      hint: 'Open',
    });
  });

  it('adds a calculator result for safe math expressions', () => {
    const sections = buildLauncherSections('5+5', [], [], [], 1_710_000_060_000);
    expect(sections[0].items[0]).toMatchObject({
      kind: 'calculation',
      title: '10',
      subtitle: 'Copy this number to the clipboard',
      hint: 'Copy',
    });
    expect(sections[0].items[1]).toMatchObject({
      kind: 'ask',
      subtitle: '5+5',
    });
  });

  it('does not show Ask Miaw for slash-prefixed launcher-style app queries', () => {
    const sections = buildLauncherSections('/chrome', [], apps, [], 1_710_000_060_000);
    const allItems = sections.flatMap((section) => section.items);
    expect(allItems.some((item) => item.kind === 'ask')).toBe(false);
    expect(allItems.some((item) => item.kind === 'app')).toBe(true);
  });

  it('hides the commands section for slash-prefixed launcher-style app queries', () => {
    const sections = buildLauncherSections('/chrome', [], apps, [], 1_710_000_060_000);
    expect(sections.some((section) => section.title === 'Commands')).toBe(false);
    expect(sections[0]?.title).toBe('Applications');
  });

  it('treats plain domains as URLs for the web fallback', () => {
    const sections = buildLauncherSections('example.com/docs', [], [], [], []);
    expect(sections.at(-1)?.items[0].value).toBe('https://example.com/docs');
  });
});
