# Miaw Windows Recreate from Thuki-macos

Electron-based Windows-first app for `Miaw` that reuses the current React UI and preserves the internal Tauri-compatible command surface where possible.

<img width="772" height="384" alt="image" src="https://github.com/user-attachments/assets/88f4f4ba-db1a-4095-8194-57be2dcf145f" />




## What is implemented

- Reused `src/` UI from the original app
- Electron shell with tray icon and global shortcut `Ctrl+Shift+Space`
- Tauri client shims for:
  - `@tauri-apps/api/core`
  - `@tauri-apps/api/event`
  - `@tauri-apps/api/window`
  - `@tauri-apps/api/dpi`
- Command surface for:
  - chat streaming: `ask_ollama`, `cancel_generation`, `reset_conversation`
  - history: `save_conversation`, `persist_message`, `list_conversations`, `load_conversation`, `delete_conversation`, `generate_title`
  - images: `save_image_command`, `remove_image_command`, `cleanup_orphaned_images_command`
  - screenshot: `capture_screenshot_command`, `capture_full_screen_command`
  - window/events: `notify_frontend_ready`, `notify_overlay_hidden`, `set_window_frame`
  - misc: `open_url`, `get_model_config`
- Config via `.env`

## Current behavior

- Model provider defaults to a LiteLLM-compatible OpenAI endpoint
- Search is stubbed to `SandboxUnavailable` so the existing UI renders the setup card
- macOS-only permission/onboarding commands return safe Windows defaults
- Drag-to-move is not fully native yet; window movement is still a follow-up task

## Environment

Copy `.env.example` to `.env` and adjust as needed.

Common values:

```env
THUKI_PROVIDER=litellm
THUKI_API_BASE_URL=http://127.0.0.1:4000
THUKI_API_KEY=
THUKI_SUPPORTED_AI_MODELS=gemma-3-4b-it
```

## Run Dev

```bash
npm install
npm run dev
```

If you prefer Bun:

```bash
bun install
bun run dev
```

## Run Production Local

Build the frontend first, then start Electron without the Vite dev server:

```bash
npm run build
npm run start
```


<img width="680" height="505" alt="image" src="https://github.com/user-attachments/assets/929a93ee-f30f-4346-8688-6b7193387529" />

## Build EXE

Recommended output options:

- Portable EXE:

```bash
npm run dist:portable
```

- Windows installer:

```bash
npm run dist:win
```

Both production build commands regenerate `icons/miaw.ico` from `public/miaw-logo.png`
before packaging, so the EXE and installer branding stays in sync with the Miaw logo.

Build artifacts will be written to `release/`.
