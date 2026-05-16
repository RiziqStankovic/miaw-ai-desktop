import type { LauncherApp, LauncherFile } from './launcher';

const LEADING_FILLER_WORDS = new Set([
  'assistant',
  'bisa',
  'bro',
  'coba',
  'dong',
  'hey',
  'hi',
  'halo',
  'kak',
  'mas',
  'mba',
  'miaw',
  'mohon',
  'please',
  'pls',
  'sir',
  'sister',
  'tolong',
  'woi',
  'ya',
  'yah',
]);

const ACTION_WORDS = new Set([
  'buka',
  'bukain',
  'bukakan',
  'execute',
  'jalankan',
  'launch',
  'open',
  'run',
  'start',
]);

const TRAILING_FILLER_WORDS = new Set([
  'aja',
  'deh',
  'doang',
  'dong',
  'dulu',
  'now',
  'please',
  'pls',
  'saja',
  'sekarang',
  'ya',
  'yah',
]);

const APP_ALIASES = new Map<string, string[]>([
  ['chrome', ['google chrome']],
  ['cmd', ['command prompt', 'windows terminal']],
  ['code', ['visual studio code', 'vscode']],
  ['cursor', ['cursor']],
  ['edge', ['microsoft edge']],
  ['excel', ['microsoft excel']],
  ['explorer', ['file explorer', 'windows explorer']],
  ['ig', ['instagram']],
  ['notepad', ['notepad']],
  ['openvpn', ['openvpn']],
  ['outlook', ['microsoft outlook']],
  ['paint', ['paint']],
  ['photos', ['photos']],
  ['pp', ['powerpoint', 'microsoft powerpoint']],
  ['ppt', ['powerpoint', 'microsoft powerpoint']],
  ['powerpoint', ['microsoft powerpoint']],
  ['ps', ['powershell', 'windows powershell']],
  ['telegram', ['telegram']],
  ['terminal', ['windows terminal', 'command prompt']],
  ['tg', ['telegram']],
  ['vpn', ['openvpn', 'proton vpn', 'nordvpn']],
  ['vs code', ['visual studio code', 'vscode']],
  ['vscode', ['visual studio code', 'code']],
  ['wa', ['whatsapp']],
  ['webex', ['webex']],
  ['whatsapp', ['whatsapp']],
  ['winrar', ['winrar']],
  ['word', ['microsoft word']],
  ['zoom', ['zoom']],
]);

const AFFIRMATIVE_WORDS = new Set([
  'buka',
  'gas',
  'iya',
  'iyah',
  'lanjut',
  'ok',
  'oke',
  'open',
  'yes',
  'ya',
  'yoi',
]);

const NEGATIVE_WORDS = new Set([
  'batal',
  'engga',
  'g',
  'ga',
  'gak',
  'jangan',
  'ngga',
  'nggak',
  'no',
  'skip',
]);

export interface LaunchIntent {
  readonly kind: 'lookup' | 'url';
  readonly target: string;
  readonly url?: string;
}

export interface ResolvedLaunchCandidate {
  readonly kind: 'app' | 'file';
  readonly title: string;
  readonly subtitle: string;
  readonly path: string;
  readonly isDirectory?: boolean;
  readonly score: number;
}

export interface LaunchResolution {
  readonly status: 'auto' | 'confirm' | 'none';
  readonly candidate?: ResolvedLaunchCandidate;
  readonly message?: string;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}.:/\\ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWords(value: string): string[] {
  return normalizeText(value).split(' ').filter(Boolean);
}

function trimIntentTarget(words: string[]): string {
  const next = [...words];
  while (next.length > 0 && TRAILING_FILLER_WORDS.has(next.at(-1) ?? '')) {
    next.pop();
  }
  return next.join(' ').trim();
}

function isLikelyUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(trimmed);
}

function toUrl(text: string): string {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function titleWordScore(queryWords: string[], titleWords: string[]): number {
  if (queryWords.length === 0 || titleWords.length === 0) return 0;

  let score = 0;
  let matched = 0;
  for (const queryWord of queryWords) {
    if (titleWords.includes(queryWord)) {
      matched += 1;
      score += 24;
      continue;
    }
    if (titleWords.some((titleWord) => titleWord.startsWith(queryWord))) {
      matched += 1;
      score += 16;
      continue;
    }
    if (titleWords.some((titleWord) => titleWord.includes(queryWord))) {
      matched += 1;
      score += 10;
    }
  }

  if (matched === queryWords.length) {
    score += 14;
  }

  return score;
}

function looksLikeFileQuery(target: string): boolean {
  return (
    /[\\/]/.test(target) ||
    /\.[a-z0-9]{2,6}$/i.test(target) ||
    /\bfolder\b|\bdirectory\b|\bfile\b|\bdokumen\b|\bpdf\b|\btxt\b|\bdocx?\b|\bxlsx?\b|\bpptx?\b/i.test(
      target,
    )
  );
}

function shouldPrioritizeApps(target: string): boolean {
  return !looksLikeFileQuery(target);
}

function scoreCandidate(
  target: string,
  candidate: LauncherApp | LauncherFile,
  kind: 'app' | 'file',
): number {
  const normalizedTarget = normalizeText(target);
  const normalizedTitle = normalizeText(candidate.title);
  const normalizedPath = normalizeText(candidate.path);
  const queryWords = normalizeWords(target);
  const titleWords = normalizeWords(candidate.title);
  const fileNameWords = normalizeWords(candidate.path.split(/[\\/]/).at(-1) ?? '');

  let score = kind === 'app' ? 6 : 0;

  if (normalizedTitle === normalizedTarget) score += 110;
  if (normalizedPath === normalizedTarget) score += 120;
  if (fileNameWords.join(' ') === normalizedTarget) score += 100;
  if (normalizedTitle.startsWith(normalizedTarget)) score += 46;
  if (normalizedTitle.includes(normalizedTarget)) score += 30;
  if (normalizedPath.includes(normalizedTarget)) score += 20;
  if (queryWords.length === 1 && titleWords.includes(queryWords[0])) {
    score += kind === 'app' ? 58 : 10;
  }
  if (queryWords.length === 1 && fileNameWords.includes(queryWords[0])) {
    score += kind === 'app' ? 18 : 8;
  }

  score += titleWordScore(queryWords, titleWords);
  score += titleWordScore(queryWords, fileNameWords);

  if (looksLikeFileQuery(target)) {
    score += kind === 'file' ? 16 : -6;
  } else if (kind === 'file' && fileNameWords.length > queryWords.length) {
    score -= queryWords.length === 1 ? 28 : 10;
  }

  return score;
}

export function detectLaunchIntent(query: string): LaunchIntent | null {
  const trimmed = query.trim();
  if (!trimmed || trimmed.startsWith('/')) {
    return null;
  }

  const rawWords = trimmed
    .replace(/[!?]+$/g, '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (rawWords.length < 2) {
    return null;
  }

  const words = rawWords.map((word) =>
    word
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.:/\\-]+$/gu, ''),
  );

  let index = 0;
  while (index < words.length && LEADING_FILLER_WORDS.has(words[index])) {
    index += 1;
  }

  const action = words[index];
  if (!action || !ACTION_WORDS.has(action)) {
    return null;
  }

  const target = trimIntentTarget(rawWords.slice(index + 1));
  if (!target) {
    return null;
  }

  if (isLikelyUrl(target)) {
    return {
      kind: 'url',
      target,
      url: toUrl(target),
    };
  }

  return {
    kind: 'lookup',
    target,
  };
}

export function buildLaunchSearchQueries(target: string): string[] {
  const normalized = normalizeText(target);
  const queries = new Set<string>([target.trim()]);
  const aliasMatches = APP_ALIASES.get(normalized) ?? [];
  for (const alias of aliasMatches) {
    queries.add(alias);
  }
  return [...queries].filter(Boolean);
}

export function isLaunchConfirmation(value: string): boolean {
  return AFFIRMATIVE_WORDS.has(normalizeText(value));
}

export function isLaunchRejection(value: string): boolean {
  return NEGATIVE_WORDS.has(normalizeText(value));
}

export function resolveLaunchTarget(
  target: string,
  apps: readonly LauncherApp[],
  files: readonly LauncherFile[],
): LaunchResolution {
  const prioritizeApps = shouldPrioritizeApps(target);
  const rankedApps = apps
    .map((app) => ({
      item: {
        kind: 'app' as const,
        title: app.title,
        subtitle: app.subtitle,
        path: app.path,
        score: scoreCandidate(target, app, 'app'),
      },
      score: scoreCandidate(target, app, 'app'),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const rankedFiles = files
    .map((file) => ({
      item: {
        kind: 'file' as const,
        title: file.title,
        subtitle: file.subtitle,
        path: file.path,
        isDirectory: file.isDirectory,
        score: scoreCandidate(target, file, 'file'),
      },
      score: scoreCandidate(target, file, 'file'),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const ranked = prioritizeApps
    ? [...rankedApps, ...rankedFiles]
    : [...rankedFiles, ...rankedApps].sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) {
    return {
      status: 'none',
      message: `No matching app or file found for "${target}".`,
    };
  }

  const runnerUp =
    prioritizeApps && best.item.kind === 'app' ? rankedApps[1] : ranked[1];
  const bestIsApp = best.item.kind === 'app';
  const fileLikeTarget = looksLikeFileQuery(target);
  const autoThreshold = bestIsApp && !fileLikeTarget ? 78 : 92;
  const confirmThreshold = bestIsApp && !fileLikeTarget ? 40 : 54;
  const gap = runnerUp ? best.score - runnerUp.score : best.score;

  if (best.score >= autoThreshold && gap >= 10) {
    return {
      status: 'auto',
      candidate: best.item,
    };
  }

  if (best.score >= confirmThreshold) {
    return {
      status: 'confirm',
      candidate: best.item,
      message: `Open ${best.item.title}?`,
    };
  }

  return {
    status: 'none',
    message: `I found results for "${target}", but none looked reliable enough to open automatically.`,
  };
}
