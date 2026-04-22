import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { desktopCapturer, shell } from 'electron';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlWasmRoot = path.resolve(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist');

const DEFAULT_MODEL_NAME = 'gemma-3-4b-it';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4000';
const DEFAULT_SYSTEM_PROMPT =
  'You are Miaw, a capable local AI secretary. Be direct, clear, and useful.';
const LOCK_WINDOW_POSITION =
  process.env.THUKI_LOCK_WINDOW_POSITION?.trim() !== 'false';
const PRESERVE_USER_WINDOW_WIDTH =
  process.env.THUKI_PRESERVE_USER_WINDOW_WIDTH?.trim() !== 'false';

function nowMillis() {
  return Date.now();
}

function parseModelConfig() {
  const raw = process.env.THUKI_SUPPORTED_AI_MODELS?.trim();
  const all = raw
    ? raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [DEFAULT_MODEL_NAME];

  return {
    active: all[0] ?? DEFAULT_MODEL_NAME,
    all
  };
}

function providerConfig() {
  return {
    provider: process.env.THUKI_PROVIDER?.trim() || 'litellm',
    baseUrl: process.env.THUKI_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
    apiKey: process.env.THUKI_API_KEY?.trim() || null,
    systemPrompt:
      process.env.THUKI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
    models: parseModelConfig()
  };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

async function initializeDatabase(userDataPath) {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(sqlWasmRoot, file)
  });

  await ensureDir(userDataPath);
  const dbPath = path.join(userDataPath, 'miaw.db');
  const existing = await readIfExists(dbPath);
  const db = new SQL.Database(existing ? new Uint8Array(existing) : undefined);

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      meta TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      quoted_text TEXT,
      image_paths TEXT,
      thinking_content TEXT,
      search_sources TEXT,
      search_warnings TEXT,
      search_metadata TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  async function persist() {
    await fs.writeFile(dbPath, Buffer.from(db.export()));
  }

  return { db, persist };
}

function randomId() {
  return crypto.randomUUID();
}

function channelId(value) {
  return value && typeof value === 'object' && '__channelId' in value
    ? value.__channelId
    : null;
}

async function encodeImagesAsDataUrls(paths) {
  const encoded = [];
  for (const imagePath of paths ?? []) {
    const bytes = await fs.readFile(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
    encoded.push(`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`);
  }
  return encoded;
}

function classifyHttpError(status) {
  if (status === 404) {
    return {
      kind: 'ModelNotFound',
      message: 'Model not found\nCheck your configured model name and pull/sync it first.'
    };
  }

  return {
    kind: 'Other',
    message: `Something went wrong\nHTTP ${status}`
  };
}

function classifyStreamError(error) {
  const message = String(error?.message ?? error);
  if (
    message.includes('ECONNREFUSED') ||
    message.includes('fetch failed') ||
    message.includes('Failed to fetch')
  ) {
    return {
      kind: 'NotRunning',
      message: "LiteLLM isn't running\nStart the model gateway and try again."
    };
  }

  return {
    kind: 'Other',
    message: 'Something went wrong\nCould not reach the model gateway.'
  };
}

function buildOpenAIMessage(message) {
  const images = message.images ?? [];
  if (images.length === 0) {
    return {
      role: message.role,
      content: message.content
    };
  }

  return {
    role: message.role,
    content: [
      { type: 'text', text: message.content },
      ...images.map((dataUrl) => ({
        type: 'image_url',
        image_url: { url: dataUrl }
      }))
    ]
  };
}

async function streamChat({
  config,
  messages,
  think,
  emit,
  signal
}) {
  const payload = {
    model: config.models.active,
    stream: true,
    messages: [
      {
        role: 'system',
        content: config.systemPrompt
      },
      ...messages.map(buildOpenAIMessage)
    ]
  };

  if (think) {
    payload.reasoning = { effort: 'medium' };
  }

  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const normalizedBaseUrl = config.baseUrl.replace(/\/$/, '');
  const chatEndpoint = /\/v\d+$/.test(normalizedBaseUrl)
    ? `${normalizedBaseUrl}/chat/completions`
    : `${normalizedBaseUrl}/v1/chat/completions`;

  const response = await fetch(chatEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    emit({ type: 'Error', data: classifyHttpError(response.status) });
    return '';
  }

  if (!response.body) {
    emit({
      type: 'Error',
      data: { kind: 'Other', message: 'Something went wrong\nEmpty stream body.' }
    });
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') {
        continue;
      }

      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      const delta = json?.choices?.[0]?.delta ?? {};
      const token = delta.content ?? '';
      const thinking = delta.reasoning_content ?? delta.reasoning ?? '';

      if (thinking) {
        emit({ type: 'ThinkingToken', data: thinking });
      }

      if (token) {
        accumulated += token;
        emit({ type: 'Token', data: token });
      }
    }
  }

  emit({ type: 'Done' });
  return accumulated;
}

async function capturePrimaryScreenPng() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 }
  });

  const source = sources[0];
  if (!source) {
    throw new Error('No screen source available.');
  }

  return source.thumbnail.toPNG();
}

async function createImageStore(userDataPath) {
  const imagesDir = path.join(userDataPath, 'images');
  await ensureDir(imagesDir);

  return {
    imagesDir,
    async saveImageBuffer(buffer, extension = '.png') {
      const target = path.join(imagesDir, `${randomId()}${extension}`);
      await fs.writeFile(target, buffer);
      return target;
    },
    async removeImage(filePath) {
      try {
        await fs.unlink(filePath);
      } catch {
        // Best effort.
      }
    },
    async cleanupOrphans(referencedPaths) {
      const entries = await fs.readdir(imagesDir, { withFileTypes: true });
      let removed = 0;
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const filePath = path.join(imagesDir, entry.name);
        if (!referencedPaths.includes(filePath)) {
          await this.removeImage(filePath);
          removed += 1;
        }
      }
      return removed;
    }
  };
}

export async function initializeBackend({ app }) {
  const userDataPath = app.getPath('userData');
  const database = await initializeDatabase(userDataPath);
  const images = await createImageStore(userDataPath);

  return {
    config: providerConfig(),
    database,
    images,
    inMemoryConversation: [],
    activeGeneration: null,
    launchShown: false
  };
}

function emitWindowEvent(window, eventName, payload) {
  window?.webContents.send('thuki:event', {
    event: eventName,
    payload
  });
}

function emitChannel(window, id, payload) {
  if (!id) {
    return;
  }

  window?.webContents.send('thuki:channel', {
    id,
    payload
  });
}

function listConversationRows(db) {
  const result = db.exec(`
    SELECT
      c.id,
      c.title,
      c.model,
      c.updated_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
    ORDER BY c.updated_at DESC
  `);

  const rows = result[0]?.values ?? [];
  return rows.map(([id, title, model, updatedAt, messageCount]) => ({
    id,
    title,
    model,
    updated_at: Number(updatedAt),
    message_count: Number(messageCount)
  }));
}

export function createCommandHandlers({ app, backend, getWindow }) {
  const { db, persist } = backend.database;

  async function persistDb() {
    await persist();
  }

  function setConfig(key, value) {
    db.run(
      `INSERT INTO app_config (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  }

  function getConfig(key) {
    const stmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
    stmt.bind([key]);
    const hasRow = stmt.step();
    const value = hasRow ? stmt.getAsObject().value : null;
    stmt.free();
    return value;
  }

  return {
    '__window.hide': async () => {
      getWindow()?.hide();
    },
    '__window.minimize': async () => {
      getWindow()?.minimize();
    },
    '__window.toggleMaximize': async () => {
      const win = getWindow();
      if (!win) {
        return;
      }

      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    },
    '__window.setSize': async ({ width, height }) => {
      const win = getWindow();
      if (!win) {
        return;
      }

      const bounds = win.getBounds();
      win.setBounds({
        ...bounds,
        width: PRESERVE_USER_WINDOW_WIDTH ? bounds.width : Math.ceil(width),
        height: Math.ceil(height)
      });
    },
    get_model_config: async () => backend.config.models,
    notify_frontend_ready: async () => {
      if (backend.launchShown) {
        return;
      }

      backend.launchShown = true;
      emitWindowEvent(getWindow(), 'thuki://visibility', {
        state: 'show',
        selected_text: null,
        window_x: null,
        window_y: null,
        screen_bottom_y: null
      });
    },
    notify_overlay_hidden: async () => {},
    set_window_frame: async ({ x, y, width, height }) => {
      const win = getWindow();
      if (!win) {
        return;
      }

      const bounds = win.getBounds();
      win.setBounds({
        x: LOCK_WINDOW_POSITION ? bounds.x : Math.round(x),
        y: LOCK_WINDOW_POSITION ? bounds.y : Math.round(y),
        width: PRESERVE_USER_WINDOW_WIDTH ? bounds.width : Math.ceil(width),
        height: Math.ceil(height)
      });
    },
    finish_onboarding: async () => {
      setConfig('onboarding_stage', 'complete');
      await persistDb();
    },
    check_accessibility_permission: async () => true,
    open_accessibility_settings: async () => {},
    check_screen_recording_permission: async () => true,
    open_screen_recording_settings: async () => {},
    request_screen_recording_access: async () => {},
    check_screen_recording_tcc_granted: async () => true,
    quit_and_relaunch: async () => {
      app.relaunch();
      app.exit(0);
    },
    open_url: async ({ url }) => {
      if (!/^https?:\/\//.test(url)) {
        throw new Error('Only http/https URLs are supported');
      }
      await shell.openExternal(url);
    },
    reset_conversation: async () => {
      backend.inMemoryConversation = [];
    },
    cancel_generation: async () => {
      backend.activeGeneration?.abort();
      backend.activeGeneration = null;
    },
    ask_ollama: async ({ message, quotedText, imagePaths, think, onEvent }) => {
      const channel = channelId(onEvent);
      const window = getWindow();
      const controller = new AbortController();
      backend.activeGeneration = controller;

      const content =
        quotedText && String(quotedText).trim()
          ? `[Highlighted Text]\n"${quotedText}"\n\n[Request]\n${message}`
          : message;

      const images = await encodeImagesAsDataUrls(imagePaths);
      const userMessage = {
        role: 'user',
        content,
        images
      };

      const messages = [...backend.inMemoryConversation, userMessage];

      try {
        const accumulated = await streamChat({
          config: backend.config,
          messages,
          think,
          signal: controller.signal,
          emit: (payload) => emitChannel(window, channel, payload)
        });

        if (accumulated) {
          backend.inMemoryConversation.push(userMessage);
          backend.inMemoryConversation.push({
            role: 'assistant',
            content: accumulated,
            images: []
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          emitChannel(window, channel, { type: 'Cancelled' });
          return;
        }

        emitChannel(window, channel, {
          type: 'Error',
          data: classifyStreamError(error)
        });
      } finally {
        if (backend.activeGeneration === controller) {
          backend.activeGeneration = null;
        }
      }
    },
    save_conversation: async ({ messages, model }) => {
      const now = nowMillis();
      const conversationId = randomId();
      const firstUser = messages.find((message) => message.role === 'user');
      const placeholderTitle = firstUser?.content?.trim()?.slice(0, 50) || null;

      db.run(
        `INSERT INTO conversations (id, title, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [conversationId, placeholderTitle, model, now, now]
      );

      for (const message of messages) {
        db.run(
          `INSERT INTO messages (
            id, conversation_id, role, content, quoted_text, image_paths,
            thinking_content, search_sources, search_warnings, search_metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            randomId(),
            conversationId,
            message.role,
            message.content,
            message.quoted_text ?? null,
            message.image_paths ? JSON.stringify(message.image_paths) : null,
            message.thinking_content ?? null,
            message.search_sources ? JSON.stringify(message.search_sources) : null,
            message.search_warnings ?? null,
            message.search_metadata ?? null,
            now
          ]
        );
      }

      await persistDb();
      return { conversation_id: conversationId };
    },
    persist_message: async ({
      conversationId,
      role,
      content,
      quotedText,
      imagePaths,
      thinkingContent,
      searchSources,
      searchWarnings,
      searchMetadata
    }) => {
      const now = nowMillis();
      db.run(
        `INSERT INTO messages (
          id, conversation_id, role, content, quoted_text, image_paths,
          thinking_content, search_sources, search_warnings, search_metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomId(),
          conversationId,
          role,
          content,
          quotedText ?? null,
          imagePaths ? JSON.stringify(imagePaths) : null,
          thinkingContent ?? null,
          searchSources ? JSON.stringify(searchSources) : null,
          searchWarnings ?? null,
          searchMetadata ?? null,
          now
        ]
      );
      db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId]);
      await persistDb();
    },
    list_conversations: async ({ search }) => {
      const rows = listConversationRows(db);
      if (!search || !String(search).trim()) {
        return rows;
      }

      const term = String(search).toLowerCase();
      return rows.filter((row) => String(row.title ?? '').toLowerCase().includes(term));
    },
    load_conversation: async ({ conversationId }) => {
      const stmt = db.prepare(`
        SELECT id, role, content, quoted_text, image_paths, thinking_content,
               search_sources, search_warnings, search_metadata, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `);

      stmt.bind([conversationId]);
      const rows = [];
      backend.inMemoryConversation = [];

      while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
          id: String(row.id),
          role: String(row.role),
          content: String(row.content),
          quoted_text: row.quoted_text ? String(row.quoted_text) : null,
          image_paths: row.image_paths ? String(row.image_paths) : null,
          thinking_content: row.thinking_content ? String(row.thinking_content) : null,
          search_sources: row.search_sources ? String(row.search_sources) : null,
          search_warnings: row.search_warnings ? String(row.search_warnings) : null,
          search_metadata: row.search_metadata ? String(row.search_metadata) : null,
          created_at: Number(row.created_at)
        });

        backend.inMemoryConversation.push({
          role: String(row.role),
          content: String(row.content),
          images: []
        });
      }

      stmt.free();
      return rows;
    },
    delete_conversation: async ({ conversationId }) => {
      const stmt = db.prepare('SELECT image_paths FROM messages WHERE conversation_id = ?');
      stmt.bind([conversationId]);
      const imagePaths = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.image_paths) {
          const parsed = JSON.parse(String(row.image_paths));
          imagePaths.push(...parsed);
        }
      }
      stmt.free();

      db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
      db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);
      for (const imagePath of imagePaths) {
        await backend.images.removeImage(imagePath);
      }
      await persistDb();
    },
    generate_title: async ({ conversationId, messages }) => {
      const firstUser = messages.find((message) => message.role === 'user');
      if (!firstUser?.content) {
        return;
      }

      const title = String(firstUser.content).trim().slice(0, 60);
      db.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [
        title,
        nowMillis(),
        conversationId
      ]);
      await persistDb();
    },
    save_image_command: async ({ imageDataBase64 }) => {
      const buffer = Buffer.from(imageDataBase64, 'base64');
      return backend.images.saveImageBuffer(buffer, '.png');
    },
    remove_image_command: async ({ path: filePath }) => {
      await backend.images.removeImage(filePath);
    },
    cleanup_orphaned_images_command: async ({ referencedPaths }) => {
      return backend.images.cleanupOrphans(referencedPaths ?? []);
    },
    capture_screenshot_command: async () => {
      const png = await capturePrimaryScreenPng();
      return Buffer.from(png).toString('base64');
    },
    capture_full_screen_command: async () => {
      const png = await capturePrimaryScreenPng();
      return backend.images.saveImageBuffer(png, '.png');
    },
    search_pipeline: async ({ onEvent }) => {
      emitChannel(getWindow(), channelId(onEvent), { type: 'SandboxUnavailable' });
    }
  };
}
