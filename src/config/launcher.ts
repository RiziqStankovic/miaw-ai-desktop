import type { ConversationSummary } from '../types/history';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { COMMANDS } from './commands';

export interface LauncherApp {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly path: string;
}

export interface LauncherFile {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly path: string;
  readonly isDirectory: boolean;
}

export type LauncherItemKind =
  | 'calculation'
  | 'ask'
  | 'command'
  | 'conversation'
  | 'app'
  | 'file'
  | 'web';

export interface LauncherItem {
  readonly id: string;
  readonly kind: LauncherItemKind;
  readonly title: string;
  readonly subtitle: string;
  readonly value?: string;
  readonly hint?: string;
  readonly accent?: string;
  readonly isDirectory?: boolean;
}

export type LauncherItemAction =
  | 'open'
  | 'insert'
  | 'copy_path'
  | 'reveal'
  | 'open_console';

export interface LauncherSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly LauncherItem[];
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function launcherSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function isSlashLauncherQuery(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.startsWith('/') && !trimmed.includes(' ');
}

function webUrlForQuery(query: string): string {
  const trimmed = query.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function isSafeMathExpression(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (!/^[\d\s()+\-*/%.]+$/.test(trimmed)) return false;
  if (!/[+\-*/%()]/.test(trimmed)) return false;
  return true;
}

function evaluateMathExpression(query: string): string | null {
  const trimmed = query.trim();
  if (!isSafeMathExpression(trimmed)) return null;

  try {
    const normalized = trimmed.replace(/\s+/g, '');
    const value = Function(`"use strict"; return (${normalized});`)() as number;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
    return String(rounded);
  } catch {
    return null;
  }
}

export function buildLauncherSections(
  query: string,
  conversations: readonly ConversationSummary[],
  apps: readonly LauncherApp[],
  files: readonly LauncherFile[],
  nowMillis?: number,
): LauncherSection[] {
  const trimmed = query.trim();
  const effectiveQuery = launcherSearchQuery(trimmed);
  const calculationResult = evaluateMathExpression(trimmed);
  const slashLauncherQuery = isSlashLauncherQuery(trimmed);

  if (!trimmed) {
    return [];
  }

  const normalized = normalizeQuery(effectiveQuery);

  const commandItems = COMMANDS.filter((cmd) => {
    const haystack = `${cmd.trigger} ${cmd.label} ${cmd.description}`.toLowerCase();
    return haystack.includes(normalized);
  }).map((cmd) => ({
    id: `command:${cmd.trigger}`,
    kind: 'command' as const,
    title: cmd.label,
    subtitle: cmd.description,
    value: cmd.trigger,
    hint: 'Insert',
    accent: 'keyword',
  }));

  const conversationItems = conversations.map((conversation) => ({
    id: `conversation:${conversation.id}`,
    kind: 'conversation' as const,
    title: conversation.title?.trim() || 'Untitled chat',
    subtitle: `${conversation.message_count} messages · ${formatRelativeTime(
      conversation.updated_at,
      nowMillis,
    )}`,
    value: conversation.id,
    hint: 'Open',
    accent: conversation.model,
  }));

  const appItems = apps.map((app) => ({
    id: `app:${app.id}`,
    kind: 'app' as const,
    title: app.title,
    subtitle: app.subtitle,
    value: app.path,
    hint: 'Launch',
    accent: 'App',
  }));

  const fileItems = files.map((file) => ({
    id: `file:${file.id}`,
    kind: 'file' as const,
    title: file.title,
    subtitle: file.subtitle,
    value: file.path,
    hint: file.isDirectory ? 'Browse' : 'Open',
    accent: file.isDirectory ? 'Folder' : 'File',
    isDirectory: file.isDirectory,
  }));

  const sections: LauncherSection[] = [
    {
      id: 'primary',
      title: slashLauncherQuery ? 'Applications' : 'Best match',
      items: calculationResult
        ? [
            {
              id: 'calculation',
              kind: 'calculation',
              title: calculationResult,
              subtitle: 'Copy this number to the clipboard',
              value: calculationResult,
              hint: 'Copy',
              accent: 'Calc',
            },
            ...(slashLauncherQuery
              ? []
              : [
                  {
                    id: 'ask',
                    kind: 'ask' as const,
                    title: `Ask Miaw`,
                    subtitle: trimmed,
                    value: trimmed,
                    hint: 'Chat',
                    accent: 'AI',
                  },
                ]),
          ]
        : slashLauncherQuery
          ? []
          : [
              {
                id: 'ask',
                kind: 'ask',
                title: `Ask Miaw`,
                subtitle: trimmed,
                value: trimmed,
                hint: 'Chat',
                accent: 'AI',
              },
            ],
    },
  ];

  if (sections[0].items.length === 0) {
    sections.shift();
  }

  if (!slashLauncherQuery && commandItems.length > 0) {
    sections.push({
      id: 'commands',
      title: 'Commands',
      items: commandItems.slice(0, 5),
    });
  }

  if (conversationItems.length > 0) {
    sections.push({
      id: 'conversations',
      title: 'Recent chats',
      items: conversationItems.slice(0, 5),
    });
  }

  if (appItems.length > 0) {
    sections.push({
      id: 'apps',
      title: 'Applications',
      items: appItems.slice(0, 5),
    });
  }

  if (fileItems.length > 0) {
    sections.push({
      id: 'files',
      title: 'Files and folders',
      items: fileItems.slice(0, 5),
    });
  }

  sections.push({
    id: 'web',
    title: 'Web',
    items: [
      {
        id: 'web',
        kind: 'web',
        title: /^https?:\/\//i.test(trimmed) ? trimmed : `Search the web`,
        subtitle: trimmed,
        value: webUrlForQuery(trimmed),
        hint: 'Open',
        accent: 'Browser',
      },
    ],
  });

  return sections;
}
