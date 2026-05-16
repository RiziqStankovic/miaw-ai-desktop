import { motion, AnimatePresence } from 'framer-motion';
import type React from 'react';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { useOllama } from './hooks/useOllama';
import type { Message } from './hooks/useOllama';
import { useConversationHistory } from './hooks/useConversationHistory';
import { ConversationView } from './view/ConversationView';
import { AskBarView, MAX_IMAGES } from './view/AskBarView';
import { OnboardingView } from './view/onboarding/index';
import type { OnboardingStage } from './view/onboarding/index';
import { HistoryPanel } from './components/HistoryPanel';
import { ImagePreviewModal } from './components/ImagePreviewModal';
import {
  SettingsPanel,
  type ProviderSettings,
} from './components/SettingsPanel';
import type { AttachedImage } from './types/image';
import { MAX_IMAGE_SIZE_BYTES } from './types/image';
import { quote } from './config';
import {
  COMMANDS,
  SCREEN_CAPTURE_PLACEHOLDER,
  buildPrompt,
} from './config/commands';
import {
  buildLauncherSections,
  type LauncherApp,
  type LauncherFile,
  type LauncherItem,
  type LauncherItemAction,
  type LauncherSection,
} from './config/launcher';
import {
  buildLaunchSearchQueries,
  detectLaunchIntent,
  isLaunchConfirmation,
  isLaunchRejection,
  resolveLaunchTarget,
  type ResolvedLaunchCandidate,
} from './config/launchIntent';
import type { ConversationSummary } from './types/history';
import './App.css';

/** Fallback model name used before runtime provider settings resolve at startup. */
const DEFAULT_MODEL_FALLBACK = 'gemma4:e2b';

const OVERLAY_VISIBILITY_EVENT = 'thuki://visibility';
const ONBOARDING_EVENT = 'thuki://onboarding';

/**
 * Authoritative deadline from the start of the hide transition to the native
 * window hide call. Accounts for WKWebView `requestAnimationFrame` throttling
 * in non-key windows, which stalls spring animations indefinitely and makes
 * `AnimatePresence.onExitComplete` unreliable when the panel is unfocused.
 */
  const HIDE_COMMIT_DELAY_MS = 350;
  const MIN_RESIZABLE_WINDOW_WIDTH = 420;
  const MAX_RESIZABLE_WINDOW_WIDTH = 960;

/** Must match `OVERLAY_LOGICAL_WIDTH` in `src-tauri/src/lib.rs`. */
const OVERLAY_WIDTH = 600;
/** Total transparent padding around the morphing container: pt-2(8) + pb-6(24) + motion py-2(16). */
const CONTAINER_VERTICAL_PADDING = 48;
/** Max morphing-container height in chat mode (matches `max-h-[600px]`) + vertical padding. */
const MAX_CHAT_WINDOW_HEIGHT = 600 + CONTAINER_VERTICAL_PADDING;

/** Must match `OVERLAY_LOGICAL_HEIGHT_COLLAPSED` in `src-tauri/src/lib.rs`. */
const COLLAPSED_WINDOW_HEIGHT = 80;

/**
 * Parses a message to detect all valid slash commands present as whole words.
 * Derives detectable commands from the COMMANDS registry so adding a command
 * to the registry is sufficient (no hardcoded trigger strings here).
 * Also returns the message with command triggers stripped for the LLM.
 */
export function parseCommands(text: string): {
  found: Set<string>;
  strippedMessage: string;
} {
  const words = text.trim().split(/\s+/);
  const triggerSet = new Set(COMMANDS.map((c) => c.trigger));
  const found = new Set<string>();
  const remaining: string[] = [];
  for (const word of words) {
    if (triggerSet.has(word)) {
      found.add(word);
    } else {
      remaining.push(word);
    }
  }
  return { found, strippedMessage: remaining.join(' ') };
}

type OverlayVisibilityPayload =
  | {
      state: 'show';
      selected_text: string | null;
      window_x: number | null;
      window_y: number | null;
      screen_bottom_y: number | null;
      force_new_session?: boolean;
    }
  | { state: 'hide-request' };
type OverlayState = 'visible' | 'hidden' | 'hiding';
type LaunchPromptState = {
  candidate?: ResolvedLaunchCandidate;
  message: string;
  originQuery: string;
};

/**
 * Main application orchestrator for Thuki.
 *
 * Implements an adaptive morphing UI container. It starts as a minimal spotlight-style
 * input bar (`AskBarView`), then smoothly transforms into a full chat window
 * (`ConversationView`) when the user sends their first message.
 *
 * This wrapper is strictly responsible for layout morphing, global hotkeys,
 * and window visibility state, delegating UI rendering logic to the view components.
 */
function App() {
  const [query, setQuery] = useState('');
  const [overlayState, setOverlayState] = useState<OverlayState>('visible');
  /** Non-null when the backend signals onboarding is needed; holds the current stage. */
  const [onboardingStage, setOnboardingStage] =
    useState<OnboardingStage | null>(null);

  /**
   * Whether the ask-bar history panel is currently open.
   * Distinct from the chat-mode history dropdown (controlled by the same toggle
   * but rendered differently based on `isChatMode`).
   */
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  /**
   * True when the user clicked + while an unsaved conversation is active.
   * Causes the history dropdown to show a SwitchConfirmation prompt instead
   * of the conversation list.
   */
  const [pendingNewConversation, setPendingNewConversation] = useState(false);

  /**
   * Direct reference to the morphing container DOM node, stored alongside the
   * ResizeObserver so the dropdown sync effect can mutate `style.minHeight`
   * without going through React state (direct DOM mutation + CSS transition).
   */
  const morphingContainerNodeRef = useRef<HTMLDivElement | null>(null);

  const {
    conversationId,
    isSaved,
    save,
    unsave,
    persistTurn,
    loadConversation,
    deleteConversation,
    listConversations,
    reset: resetHistory,
  } = useConversationHistory();

  /**
   * Persist a completed user/assistant turn to SQLite if the conversation
   * has been saved. Passed as `onTurnComplete` to `useOllama`.
   */
  const handleTurnComplete = useCallback(
    async (
      userMsg: Parameters<typeof persistTurn>[0],
      assistantMsg: Parameters<typeof persistTurn>[1],
    ) => {
      await persistTurn(userMsg, assistantMsg);
    },
    [persistTurn],
  );

  const {
    messages,
    ask,
    askSearch,
    cancel,
    isGenerating,
    searchStage,
    reset,
    loadMessages,
  } = useOllama(handleTurnComplete);

  /**
   * Sticky flag: once the user invokes `/search`, subsequent submits in the
   * same conversation route through the search pipeline automatically until
   * the pipeline delivers a final answer (or the conversation is reset/loaded
   * /closed). The backend LLM classifies each turn and decides whether to
   * clarify, answer from context, or perform a fresh web search.
   */
  const [searchActive, setSearchActive] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInputAtEnd = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, []);

  /** Images attached to the current (unsent) message. Blob URLs render
   *  immediately; file paths are set asynchronously after Rust processing. */
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  /** URL of the image currently open in the preview modal (blob or asset URL). */
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  /**
   * Drag state passed to AskBarView for visual ring feedback.
   * "normal" = under capacity (violet ring); "max" = at capacity (red ring + label).
   * null = no active drag.
   */
  const [isDragOver, setIsDragOver] = useState<'normal' | 'max' | null>(null);

  /** When the user submits while images are still processing, the submit
   *  intent is stored here. The effect below watches `attachedImages` and
   *  fires the actual `ask()` once every image has a resolved `filePath`.
   *  Also stores `promptOverride` when the deferred submit originates from
   *  a utility command, and `context` for any quoted selected text. */
  const pendingSubmitRef = useRef<{
    query: string;
    context: string | undefined;
    think: boolean;
    promptOverride?: string;
  } | null>(null);
  /** True while waiting for images to finish processing before a deferred
   *  submit. Drives the "waiting" UI state in the ask bar. */
  const [isSubmitPending, setIsSubmitPending] = useState(false);
  /** Error message from a failed /screen capture. Shown inline above the ask
   *  bar so the user knows capture failed rather than seeing no response. */
  const [captureError, setCaptureError] = useState<string | null>(null);
  /**
   * Set to true when a /screen capture is dispatched, false when it resolves
   * or when the user cancels. Lets the async tail in handleScreenSubmit
   * detect a mid-flight cancellation and skip the ask() call.
   */
  const screenCapturePendingRef = useRef(false);
  /**
   * Prevents the generic blur auto-hide from closing the floating chat while
   * the native screenshot flow temporarily hides or defocuses the window.
   */
  const suppressBlurHideRef = useRef(false);
  const manualResizeActiveRef = useRef(false);
  const resizeStateRef = useRef<{
    edge: 'left' | 'right';
    lastClientX: number;
  } | null>(null);
  /**
   * Stores the input state (query + context) captured just before a /screen
   * submit clears them. Used by handleCancel to restore the ask bar if the
   * user aborts the in-flight capture.
   */
  const screenCaptureInputSnapshotRef = useRef<{
    query: string;
    context: string | undefined;
  } | null>(null);
  /** User message shown in the chat while waiting for images to finish
   *  processing. Cleared when `ask()` fires and adds the real message. */
  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(
    null,
  );

  /**
   * Session counter - incremented on each overlay open. Used in the motion
   * key to force AnimatePresence to fully unmount the stale tree before
   * mounting a fresh one, preventing a flash of the previous conversation.
   */
  const [sessionId, setSessionId] = useState(0);
  const [selectedContext, setSelectedContext] = useState<string | null>(null);
  const [modelConfig, setModelConfig] = useState<{
    active: string;
    all: string[];
  } | null>(null);
  const [providerSettings, setProviderSettings] =
    useState<ProviderSettings | null>(null);
  const [launcherConversations, setLauncherConversations] = useState<
    ConversationSummary[]
  >([]);
  const [launcherApps, setLauncherApps] = useState<LauncherApp[]>([]);
  const [launcherFiles, setLauncherFiles] = useState<LauncherFile[]>([]);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [launchPrompt, setLaunchPrompt] = useState<LaunchPromptState | null>(
    null,
  );

  /**
   * True when the window is near the screen bottom and should grow upward.
   * Flips the outer container to `justify-end` so content pins to the bottom.
   */
  const [growsUpward, setGrowsUpward] = useState(false);

  /**
   * Determines whether the UI has entered "chat mode" - i.e., the morphing
   * chat window state with message bubbles. Transitions from input-bar mode
   * to chat-window mode are animated via Framer Motion `layout` prop.
   */
  const isChatMode = messages.length > 0 || isGenerating || isSubmitPending;
  const previousIsChatModeRef = useRef(isChatMode);
  const isChatModeRef = useRef(isChatMode);
  isChatModeRef.current = isChatMode;

  /**
   * The bookmark save button is active once the AI has produced at least one
   * complete response. We check for an assistant message rather than any message
   * so the button never appears during the very first user-only half-turn.
   */
  const canSave = !isGenerating && messages.some((m) => m.role === 'assistant');
  const shouldRenderOverlay = overlayState === 'visible';
  const isIdleAskBar =
    !isChatMode &&
    query.trim().length === 0 &&
    attachedImages.length === 0 &&
    !isHistoryOpen &&
    !isSettingsOpen;

  /**
   * Reference stored for ResizeObserver cleanup.
   */
  const observerRef = useRef<ResizeObserver | null>(null);

  /**
   * Mirror of `growsUpward` as a ref so the ResizeObserver closure can read
   * it without being recreated on each state change.
   */
  const growsUpwardRef = useRef(false);

  /**
   * Stores the window's fixed bottom Y and X for upward-growth sessions.
   * The bottom stays pinned while the top edge moves up as content grows.
   */
  const windowPosRef = useRef({ x: 0, bottomY: 0 });

  /**
   * Mirror of `isGenerating` as a ref so the ResizeObserver closure can
   * check streaming state without being recreated on each render.
   */
  const isGeneratingRef = useRef(false);
  isGeneratingRef.current = isGenerating;

  /**
   * High-water mark for window height during streaming. While the LLM is
   * generating, the window only grows (never shrinks) to prevent jitter
   * from Streamdown's block-element reflows. Reset when generation ends
   * or a new session starts.
   */
  const maxHeightRef = useRef(0);
  const hasActiveSession =
    messages.length > 0 ||
    pendingUserMessage !== null ||
    isGenerating ||
    isSubmitPending ||
    query.trim().length > 0 ||
    attachedImages.length > 0;
  const sessionStateRef = useRef({
    hasActiveSession: false,
  });
  sessionStateRef.current.hasActiveSession = hasActiveSession;

  const syncWindowHeightToContainer = useCallback((container: HTMLDivElement) => {
    const rect = container.getBoundingClientRect();
    let targetHeight = Math.ceil(rect.height) + CONTAINER_VERTICAL_PADDING;

    if (isGeneratingRef.current) {
      if (targetHeight > maxHeightRef.current) {
        maxHeightRef.current = targetHeight;
      } else {
        targetHeight = maxHeightRef.current;
      }
    }

    if (growsUpwardRef.current) {
      const { x, bottomY } = windowPosRef.current;
      const newY = Math.max(0, bottomY - targetHeight);
      void invoke('set_window_frame', {
        x,
        y: newY,
        width: OVERLAY_WIDTH,
        height: targetHeight,
      });
      return;
    }

    void getCurrentWindow().setSize(new LogicalSize(OVERLAY_WIDTH, targetHeight));
  }, []);

  /**
   * Callback ref to reliably attach the ResizeObserver when the conditionally
   * rendered Framer Motion container actually mounts in the DOM. This fixes
   * the bug where a standard useEffect would run before the DOM node was ready,
   * leaving the native window stuck at 600x700.
   *
   * When `growsUpwardRef` is true (window near screen bottom), the observer
   * also repositions the window upward to keep its bottom pinned as the
   * conversation grows.
   */
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    morphingContainerNodeRef.current = node;

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

      if (node) {
        const observer = new ResizeObserver(
          /* v8 ignore start -- ResizeObserver callback requires a native browser resize event */
          (entries) => {
            requestAnimationFrame(() => {
              if (manualResizeActiveRef.current) {
                return;
              }

              for (const entry of entries) {
                syncWindowHeightToContainer(entry.target as HTMLDivElement);
              }
            });
          },
          /* v8 ignore stop */
        );

      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  /**
   * Reset the high-water mark when streaming finishes so the window can
   * shrink back to its natural content height on the next resize event.
   */
  useEffect(() => {
    if (!isGenerating) {
      maxHeightRef.current = 0;
    }
  }, [isGenerating]);

  /**
   * Replays the entrance sequence by transitioning the overlay to the visible state.
   * Clears conversation state for a fresh session each time the overlay appears.
   */
  const replayEntranceAnimation = useCallback(
    (
      context: string | null,
      windowX: number | null,
      windowY: number | null,
      screenBottomY: number | null,
      forceNewSession = false,
    ) => {
      const shouldPreserveSession =
        !forceNewSession && context === null && isChatModeRef.current;
      const shouldGrowUp =
        windowY !== null &&
        screenBottomY !== null &&
        windowY + MAX_CHAT_WINDOW_HEIGHT > screenBottomY;
      growsUpwardRef.current = shouldGrowUp;
      setGrowsUpward(shouldGrowUp);
      maxHeightRef.current = 0;
      if (shouldGrowUp && windowX !== null && windowY !== null) {
        windowPosRef.current = {
          x: windowX,
          bottomY: windowY + COLLAPSED_WINDOW_HEIGHT,
        };
      }
      setSelectedContext(context);
      setIsHistoryOpen(false);
      setIsSettingsOpen(false);
      setCaptureError(null);
      setLaunchPrompt(null);
      if (!shouldPreserveSession) {
        setSessionId((id) => id + 1);
        setQuery('');
        setAttachedImages((prev) => {
          for (const img of prev) URL.revokeObjectURL(img.blobUrl);
          return [];
        });
        pendingSubmitRef.current = null;
        screenCapturePendingRef.current = false;
        screenCaptureInputSnapshotRef.current = null;
        setIsSubmitPending(false);
        setPendingUserMessage(null);
        setSearchActive(false);
        reset();
        resetHistory();
      }
      setOverlayState('visible');
    },
    [reset, resetHistory],
  );

  /**
   * Moves the overlay into an exit phase. The actual Tauri window hide call is
   * deferred until Framer Motion finishes the exit transition.
   */
  const requestHideOverlay = useCallback(() => {
    const shouldPreserveChatSession = isChatModeRef.current;
    growsUpwardRef.current = false;
    setGrowsUpward(false);
    setLaunchPrompt(null);
    setSelectedContext(null);
    setIsHistoryOpen(false);
    setIsSettingsOpen(false);
    setPreviewImageUrl(null);

    if (!shouldPreserveChatSession) {
      void cancel();
      screenCapturePendingRef.current = false;
      screenCaptureInputSnapshotRef.current = null;
      setSearchActive(false);
      setQuery('');
      setAttachedImages((prev) => {
        for (const img of prev) URL.revokeObjectURL(img.blobUrl);
        return [];
      });
    }

    setOverlayState((currentState) => {
      if (currentState === 'hidden' || currentState === 'hiding') {
        return currentState;
      }
      return 'hiding';
    });
  }, [cancel]);

  /** Ref attached to the chat-mode history dropdown for click-outside detection. */
  const historyDropdownRef = useRef<HTMLDivElement>(null);
  /** Ref attached to the chat-mode settings dropdown for click-outside detection. */
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  /** Toggles the history panel open/closed. */
  const handleHistoryToggle = useCallback(() => {
    setIsSettingsOpen(false);
    setIsHistoryOpen((prev) => !prev);
  }, [syncWindowHeightToContainer]);

  /** Toggles the runtime settings panel open/closed. */
  const handleSettingsToggle = useCallback(() => {
    setIsHistoryOpen(false);
    setPendingNewConversation(false);
    setIsSettingsOpen((prev) => !prev);
  }, []);

  /**
   * Close the chat-mode history dropdown when the user clicks outside it.
   * Clicks on the toggle button itself are excluded so the button's own
   * onClick handler (handleHistoryToggle) can manage the toggle normally.
   */
  useEffect(() => {
    if (!(isChatMode && isHistoryOpen)) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (
        historyDropdownRef.current?.contains(target) ||
        target.closest?.('[data-history-toggle]')
      ) {
        return;
      }
      setIsHistoryOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isChatMode, isHistoryOpen]);

  /**
   * Close the chat-mode settings dropdown when the user clicks outside it.
   */
  useEffect(() => {
    if (!(isChatMode && isSettingsOpen)) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (
        settingsDropdownRef.current?.contains(target) ||
        target.closest?.('[data-settings-toggle]')
      ) {
        return;
      }
      setIsSettingsOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isChatMode, isSettingsOpen]);

  // Clear any pending new-conversation confirmation whenever the panel closes.
  // Uses a ref-based approach to avoid the @eslint-react/set-state-in-effect
  // warning from calling setState synchronously inside an effect body.
  const prevHistoryOpenRef = useRef(isHistoryOpen);
  const prevHeightRef = useRef<number>(COLLAPSED_WINDOW_HEIGHT);
  if (prevHistoryOpenRef.current && !isHistoryOpen) {
    setPendingNewConversation(false);
  }
  prevHistoryOpenRef.current = isHistoryOpen;

  /**
   * When a submit flips the UI from ask-bar mode into chat mode while the
   * window is pinned near the bottom edge, animate the container from its
   * current height to the fixed full chat height. This is intentionally scoped
   * to the upward-growth path so the downward path remains unchanged.
   */
  useLayoutEffect(() => {
    /* v8 ignore start -- ResizeObserver + DOM mutations require a real browser */
    const container = morphingContainerNodeRef.current;
    const wasChatMode = previousIsChatModeRef.current;
    previousIsChatModeRef.current = isChatMode;

    if (!container) return;
    if (!growsUpward || isHistoryOpen || !isChatMode || wasChatMode) {
      return;
    }

    const startHeight =
      container.offsetHeight > 0
        ? container.offsetHeight
        : prevHeightRef.current;
    container.style.transition = 'none';
    container.style.minHeight = '';
    container.style.height = `${startHeight}px`;
    void container.offsetHeight;

    const frameId = requestAnimationFrame(() => {
      // 0.4s and slightly softer cubic bezier specifically for upward morph
      container.style.transition = 'height 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
      container.style.height = '600px';
    });

    return () => cancelAnimationFrame(frameId);
    /* v8 ignore stop */
  }, [growsUpward, isChatMode, isHistoryOpen]);

  /**
   * Observes the dropdown's height while it's open and mutates the morphing
   * container's `min-height` style directly (bypassing React state) so the
   * native window grows exactly as tall as the dropdown needs. A CSS transition
   * on the container drives the smooth resize; the existing ResizeObserver fires
   * per-frame and calls `setSize()` as the transition runs.
   *
   * Direct DOM mutation avoids the React state → Framer Motion → ResizeObserver
   * indirect chain that broke timing. ResizeObserver tracks async conversation
   * list load so `min-height` stays accurate as content populates.
   */
  useLayoutEffect(() => {
    /* v8 ignore start -- ResizeObserver + DOM mutations require a real browser */
    const container = morphingContainerNodeRef.current;
    if (!container) return;

    // Track the height when we are NOT in chat mode natively.
    if (!isChatMode) {
      const h = container.offsetHeight;
      // offsetHeight might read 0 if hidden, so default to collapsed
      prevHeightRef.current = h > 0 ? h : COLLAPSED_WINDOW_HEIGHT;
      container.style.transition =
        'min-height 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      container.style.height = '';
      container.style.minHeight = '';
      return;
    }

    if (!isHistoryOpen && !isSettingsOpen) {
      container.style.transition =
        'min-height 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      container.style.minHeight = '';
      return;
    }

    const dropdown = isHistoryOpen
      ? historyDropdownRef.current
      : settingsDropdownRef.current;
    if (!dropdown) return;

    container.style.transition =
      'min-height 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    container.style.height = ''; // Let history panel dictate it via minHeight

    const sync = () => {
      container.style.minHeight = `${dropdown.offsetTop + dropdown.offsetHeight + 8}px`;
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(dropdown);
    return () => ro.disconnect();
    /* v8 ignore stop */
  }, [isChatMode, isHistoryOpen, isSettingsOpen]);

  /**
   * Toggles the save state of the current conversation.
   * - Not saved → saves to SQLite (bookmark fills).
   * - Already saved → deletes from SQLite, marks unsaved (bookmark empties);
   *   messages remain in the UI so the session can be re-saved if desired.
   */
  const handleSave = useCallback(async () => {
    try {
      if (isSaved) {
        await unsave();
      } else {
        await save(messages, modelConfig?.active ?? DEFAULT_MODEL_FALLBACK);
      }
    } catch {
      // State stays unchanged on failure; feedback is implicit in the icon.
    }
  }, [isSaved, unsave, save, messages, modelConfig]);

  /**
   * Loads a conversation from history, replacing the current session.
   *
   * Closes the history panel regardless of success or failure: on success the
   * loaded messages replace the current session; on failure the current session
   * is preserved and the panel is dismissed so the user is not left in a
   * half-open state.
   */
  const handleLoadConversation = useCallback(
    async (id: string) => {
      try {
        const loaded = await loadConversation(id);
        loadMessages(loaded);
        setSearchActive(false);
      } catch {
        // Load failed - current session is preserved intact.
      } finally {
        setIsHistoryOpen(false);
      }
    },
    [loadConversation, loadMessages],
  );

  /**
   * Saves the current unsaved session then loads the requested conversation.
   *
   * If save fails the operation is aborted - we do not load the target
   * conversation because the current session has not been persisted yet.
   * If save succeeds but load fails the panel is still dismissed; the
   * current session has been saved so no data is lost.
   */
  const handleSaveAndLoad = useCallback(
    async (id: string) => {
      try {
        await save(messages, modelConfig?.active ?? DEFAULT_MODEL_FALLBACK);
      } catch {
        // Save failed - abort to avoid leaving the current session unprotected.
        return;
      }
      try {
        const loaded = await loadConversation(id);
        loadMessages(loaded);
        setSearchActive(false);
      } catch {
        // Load failed - save already committed; dismiss panel, keep current view.
      } finally {
        setIsHistoryOpen(false);
      }
    },
    [save, messages, loadConversation, loadMessages, modelConfig],
  );

  /**
   * Deletes a conversation from the history panel.
   *
   * When the deleted conversation is the currently active one, only the
   * persistence state (`resetHistory`) is cleared - messages remain visible
   * so the user can continue chatting or re-save. The error is intentionally
   * re-thrown so `HistoryPanel` can roll back its optimistic removal.
   */
  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      if (id === conversationId) {
        resetHistory();
      }
    },
    [deleteConversation, conversationId, resetHistory],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 120);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (
      isHistoryOpen ||
      isSettingsOpen ||
      isGenerating ||
      isSubmitPending
    ) {
      setLauncherConversations([]);
      setLauncherApps([]);
      setLauncherFiles([]);
      return;
    }

    const trimmed = debouncedQuery.trim();
    const launcherSearchQuery =
      trimmed.startsWith('/') && !trimmed.includes(' ')
        ? trimmed.slice(1)
        : trimmed;
    if (!launcherSearchQuery) {
      setLauncherConversations([]);
      setLauncherApps([]);
      setLauncherFiles([]);
      return;
    }

    let isCancelled = false;
    void listConversations(launcherSearchQuery)
      .then((rows) => {
        if (!isCancelled) {
          setLauncherConversations(rows.slice(0, 5));
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setLauncherConversations([]);
        }
      });
    void invoke<LauncherApp[]>('search_launcher_apps', {
      query: launcherSearchQuery,
      limit: 5,
    })
      .then((rows) => {
        if (!isCancelled) {
          setLauncherApps(rows);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setLauncherApps([]);
        }
      });
    void invoke<LauncherFile[]>('search_launcher_files', {
      query: launcherSearchQuery,
      limit: 5,
    })
      .then((rows) => {
        if (!isCancelled) {
          setLauncherFiles(rows);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setLauncherFiles([]);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    isHistoryOpen,
    isSettingsOpen,
    isGenerating,
    isSubmitPending,
    listConversations,
    debouncedQuery,
  ]);

  /**
   * Shared reset sequence for all "start a new conversation" paths.
   */
  const resetForNewConversation = useCallback(() => {
    reset();
    resetHistory();
    setIsHistoryOpen(false);
    setQuery('');
    setAttachedImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.blobUrl);
      return [];
    });
    pendingSubmitRef.current = null;
    screenCapturePendingRef.current = false;
    screenCaptureInputSnapshotRef.current = null;
    setIsSubmitPending(false);
    setPendingUserMessage(null);
    setSearchActive(false);
  }, [reset, resetHistory]);

  /**
   * Starts a fresh conversation from within conversation view.
   * If the current conversation has unsaved messages, opens the history
   * dropdown and surfaces a SwitchConfirmation prompt instead of resetting
   * immediately.
   */
  const handleNewConversation = useCallback(() => {
    if (!isSaved && messages.length > 0) {
      setPendingNewConversation(true);
      setIsHistoryOpen(true);
      return;
    }
    resetForNewConversation();
  }, [isSaved, messages.length, resetForNewConversation]);

  /** Saves the current conversation then starts a fresh one. */
  const handleSaveAndNew = useCallback(async () => {
    try {
      await save(messages, modelConfig?.active ?? DEFAULT_MODEL_FALLBACK);
    } catch {
      return;
    }
    resetForNewConversation();
  }, [save, messages, resetForNewConversation, modelConfig]);

  /** Discards the current conversation and starts a fresh one. */
  const handleJustNew = useCallback(() => {
    resetForNewConversation();
  }, [resetForNewConversation]);

  /**
   * Handles newly attached image files. Creates blob URLs immediately for
   * instant thumbnail rendering, then processes each file in the background
   * via base64-encoded IPC to the Rust backend.
   */
  const handleImagesAttached = useCallback((files: File[]) => {
    const newImages: AttachedImage[] = files.map((file) => ({
      id: crypto.randomUUID(),
      blobUrl: URL.createObjectURL(file),
      filePath: null,
    }));

    setAttachedImages((prev) => [...prev, ...newImages]);

    // Defer backend processing to the next frame so React can render the
    // blob URL thumbnails immediately - keeps the UI responsive while
    // FileReader + IPC serialisation happen in subsequent event-loop ticks.
    requestAnimationFrame(() => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const imageId = newImages[i].id;

        const reader = new FileReader();
        reader.onload = () => {
          // Extract pure base64 from the data URL (strip "data:image/png;base64,").
          const base64 = (reader.result as string).split(',')[1];
          invoke<string>('save_image_command', { imageDataBase64: base64 })
            .then((filePath) => {
              setAttachedImages((prev) =>
                prev.map((img) =>
                  img.id === imageId ? { ...img, filePath } : img,
                ),
              );
            })
            .catch(() => {
              setAttachedImages((prev) => {
                for (const img of prev) {
                  if (img.id === imageId) URL.revokeObjectURL(img.blobUrl);
                }
                return prev.filter((img) => img.id !== imageId);
              });
            });
        };
        reader.readAsDataURL(file);
      }
    });
  }, []);

  /**
   * Root-level drag handlers. Attached to the `h-screen w-screen` root div so
   * file drops anywhere in the window are intercepted, including the
   * ConversationView area, which has no drop handlers of its own. Without this,
   * the WebView navigates to display the dropped image full-screen when the user
   * drops a second image after the first conversation turn.
   *
   * `dragover` must always call `e.preventDefault()` to signal the browser that
   * this element accepts drops; without it the `drop` event never fires.
   */
  const handleRootDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (isGenerating || isSubmitPending) return;
      setIsDragOver(attachedImages.length >= MAX_IMAGES ? 'max' : 'normal');
    },
    [isGenerating, isSubmitPending, attachedImages.length],
  );

  const handleRootDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when the cursor truly exits the window. `dragleave` fires
    // when moving between child elements too; checking `relatedTarget` lets us
    // ignore those internal transitions.
    /* v8 ignore start -- dragleave relatedTarget cannot be set in jsdom; the false branch (cursor on child element) requires a real browser drag sequence */
    if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) {
      setIsDragOver(null);
    }
    /* v8 ignore stop */
  }, []);

  const handleRootDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(null);
      if (isGenerating || isSubmitPending) return;
      const files = e.dataTransfer?.files;
      if (!files) return;
      const remaining = MAX_IMAGES - attachedImages.length;
      if (remaining <= 0) return;
      const accepted: File[] = [];
      for (let i = 0; i < files.length && accepted.length < remaining; i++) {
        if (
          files[i].type.startsWith('image/') &&
          files[i].size <= MAX_IMAGE_SIZE_BYTES
        ) {
          accepted.push(files[i]);
        }
      }
      if (accepted.length > 0) handleImagesAttached(accepted);
    },
    [
      isGenerating,
      isSubmitPending,
      attachedImages.length,
      handleImagesAttached,
    ],
  );

  /**
   * Invokes the screenshot command, which hides the window, lets the user
   * select an area with Snipping Tool, then returns the captured image
   * as a base64 PNG string (or null if the user cancelled).
   * On success, converts the base64 to a File and feeds it into the existing
   * handleImagesAttached pipeline - identical to a paste or drag-drop.
   */
  const handleScreenshot = useCallback(async () => {
    /* v8 ignore start -- defensive guard: button is always disabled at max images, so this branch is unreachable through normal UI interaction */
    if (attachedImages.length >= MAX_IMAGES) return;
    /* v8 ignore stop */
    suppressBlurHideRef.current = true;
    try {
      const base64 = await invoke<string | null>('capture_screenshot_command');
      if (!base64) return;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], 'screenshot.png', { type: 'image/png' });
      handleImagesAttached([file]);
    } finally {
      requestAnimationFrame(() => {
        suppressBlurHideRef.current = false;
        inputRef.current?.focus();
      });
    }
  }, [attachedImages, handleImagesAttached]);

  const captureScreenToSavedPath = useCallback(async () => {
    return invoke<string>('capture_full_screen_command');
  }, []);

  /** Removes an attached image from state, revokes the blob URL, and
   *  deletes the staged file from disk if processing completed. */
  const handleImageRemove = useCallback((id: string) => {
    setAttachedImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) {
        URL.revokeObjectURL(img.blobUrl);
        if (img.filePath) {
          void invoke('remove_image_command', { path: img.filePath });
        }
      }
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  /** Opens the preview modal for an attached image (identified by ID).
   *  The ID always comes from the thumbnail component which only renders
   *  items present in attachedImages, so the find always succeeds. */
  const handleAskBarImagePreview = useCallback(
    (id: string) => {
      setPreviewImageUrl(attachedImages.find((i) => i.id === id)!.blobUrl);
    },
    [attachedImages],
  );

  /** Opens the preview modal for a chat history image (identified by file path). */
  const handleChatImagePreview = useCallback((path: string) => {
    setPreviewImageUrl(path.startsWith('blob:') ? path : convertFileSrc(path));
  }, []);

  /** Fires the actual ask() call and cleans up attached images + input. */
  const executeSubmit = useCallback(
    (submitQuery: string, context: string | undefined, think?: boolean) => {
      const readyPaths = attachedImages
        .filter((img) => img.filePath !== null)
        .map((img) => img.filePath as string);
      const images = readyPaths.length > 0 ? readyPaths : undefined;
      ask(submitQuery, context, images, think);
      setSelectedContext(null);
      setQuery('');
      for (const img of attachedImages) {
        URL.revokeObjectURL(img.blobUrl);
      }
      setAttachedImages([]);
      inputRef.current!.style.height = 'auto';
    },
    [ask, attachedImages, setSelectedContext],
  );

  /**
   * Async handler for the `/screen` command path. Invokes
   * `capture_full_screen_command`, which hides the window, captures the
   * primary screen, and returns a normal file path for the chat pipeline.
   * On success, merges the screenshot path with any manually attached
   * images and calls ask(). On error, restores the query so no input is lost.
   */
  const handleScreenSubmit = useCallback(
    async (fullQuery: string, think?: boolean) => {
      // eslint-disable-next-line no-control-regex
      const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
      const sanitized = selectedContext
        ?.replace(CONTROL_CHARS, '')
        .slice(0, quote.maxContextLength);
      const context = sanitized?.trim() ? sanitized : undefined;

      // Snapshot display paths for the pending bubble: use resolved file paths
      // for already-processed images, blob URLs for still-processing ones.
      const existingDisplayPaths = attachedImages.map(
        (img) => img.filePath ?? img.blobUrl,
      );

      // Store the original input so handleCancel can restore it if the user
      // aborts the capture before it resolves.
      screenCaptureInputSnapshotRef.current = {
        query: fullQuery,
        context,
      };

      // Immediately show the user's message in chat with a loading placeholder
      // for the screenshot. This prevents double-submit spam and gives instant
      // feedback that the capture is in progress.
      screenCapturePendingRef.current = true;
      setIsSubmitPending(true);
      setPendingUserMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: fullQuery,
        quotedText: context,
        imagePaths: [...existingDisplayPaths, SCREEN_CAPTURE_PLACEHOLDER],
      });
      setQuery('');
      setSelectedContext(null);
      /* v8 ignore start -- inputRef always set when overlay is visible */
      if (inputRef.current) inputRef.current.style.height = 'auto';
      /* v8 ignore stop */

      let screenshotPath: string;
      try {
        suppressBlurHideRef.current = true;
        screenshotPath = await captureScreenToSavedPath();
      } catch (e) {
        screenCapturePendingRef.current = false;
        screenCaptureInputSnapshotRef.current = null;
        // Capture failed: restore input state so the user can retry or edit.
        setIsSubmitPending(false);
        setPendingUserMessage(null);
        setQuery(fullQuery);
        setSelectedContext(context ?? null);
        // Surface the Rust error directly: the backend already provides
        // descriptive messages (permission prompts, null-image diagnostics, etc.).
        // Tauri v2 rejects with the Err(String) value as a plain string.
        setCaptureError(
          typeof e === 'string'
            ? e
            : e instanceof Error
              ? e.message
              : String(e),
        );
        requestAnimationFrame(() => {
          suppressBlurHideRef.current = false;
        });
        return;
      }

      // Check for mid-flight cancellation before touching any state.
      // handleCancel sets screenCapturePendingRef.current = false as a signal.
      const wasCancelled = !screenCapturePendingRef.current;
      screenCapturePendingRef.current = false;
      screenCaptureInputSnapshotRef.current = null;
      if (wasCancelled) {
        suppressBlurHideRef.current = false;
        return;
      }

      // Capture succeeded: finalize the submit.
      setCaptureError(null);
      setIsSubmitPending(false);
      setPendingUserMessage(null);

      const readyPaths = attachedImages
        .filter((img) => img.filePath !== null)
        .map((img) => img.filePath as string);
      readyPaths.push(screenshotPath);

      ask(fullQuery, context, readyPaths, think);
      for (const img of attachedImages) {
        URL.revokeObjectURL(img.blobUrl);
      }
      setAttachedImages([]);
      requestAnimationFrame(() => {
        suppressBlurHideRef.current = false;
      });
    },
    [
      selectedContext,
      attachedImages,
      ask,
      setSelectedContext,
      setCaptureError,
      captureScreenToSavedPath,
    ],
  );

  const clearLaunchDraft = useCallback(() => {
    setLaunchPrompt(null);
    setQuery('');
    setSelectedContext(null);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, []);

  const executeLaunchCandidate = useCallback(
    async (candidate: ResolvedLaunchCandidate) => {
      clearLaunchDraft();
      await invoke('open_path', { path: candidate.path });
      requestHideOverlay();
    },
    [clearLaunchDraft, requestHideOverlay],
  );

  const executeLaunchUrl = useCallback(
    async (url: string) => {
      clearLaunchDraft();
      await invoke('open_url', { url });
      requestHideOverlay();
    },
    [clearLaunchDraft, requestHideOverlay],
  );

  const resolveLaunchLookup = useCallback(async (target: string) => {
    const searchQueries = buildLaunchSearchQueries(target);
    const [appResults, fileResults] = await Promise.all([
      Promise.all(
        searchQueries.map((searchQuery) =>
          invoke<LauncherApp[]>('search_launcher_apps', {
            query: searchQuery,
            limit: 5,
          }),
        ),
      ),
      Promise.all(
        searchQueries.map((searchQuery) =>
          invoke<LauncherFile[]>('search_launcher_files', {
            query: searchQuery,
            limit: 5,
          }),
        ),
      ),
    ]);

    const apps = [...new Map(
      appResults
        .flat()
        .map((item) => [item.path.toLowerCase(), item] as const),
    ).values()];
    const files = [...new Map(
      fileResults
        .flat()
        .map((item) => [item.path.toLowerCase(), item] as const),
    ).values()];

    return resolveLaunchTarget(target, apps, files);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (
      (query.trim().length === 0 && attachedImages.length === 0) ||
      isGenerating
    )
      return;

    // Clear any stale capture error from a previous attempt.
    setCaptureError(null);

    // Parse all valid commands from anywhere in the message.
    let trimmedQuery = query.trim();
    if (launchPrompt) {
      if (launchPrompt.candidate) {
        if (
          trimmedQuery === launchPrompt.originQuery ||
          isLaunchConfirmation(trimmedQuery)
        ) {
          await executeLaunchCandidate(launchPrompt.candidate);
          return;
        }
        if (isLaunchRejection(trimmedQuery)) {
          setLaunchPrompt(null);
          setQuery(launchPrompt.originQuery);
          return;
        }
      } else if (trimmedQuery === launchPrompt.originQuery) {
        return;
      }

      setLaunchPrompt(null);
    }

    if (/^\/search(?:\s|$)/i.test(trimmedQuery)) {
      trimmedQuery = trimmedQuery.replace(/^\/search\b\s*/i, '').trim();
      if (!trimmedQuery && attachedImages.length === 0) {
        return;
      }
    }
    const { found, strippedMessage } = parseCommands(trimmedQuery);
    const hasScreen = found.has('/screen');
    const hasThink = found.has('/think');
    const hasSearch = found.has('/search');

    const launchIntent =
      attachedImages.length === 0 &&
      !selectedContext?.trim() &&
      found.size === 0 &&
      !searchActive
        ? detectLaunchIntent(trimmedQuery)
        : null;

    if (launchIntent?.kind === 'url' && launchIntent.url) {
      await executeLaunchUrl(launchIntent.url);
      return;
    }

    if (launchIntent?.kind === 'lookup') {
      const resolution = await resolveLaunchLookup(launchIntent.target);
      if (resolution.status === 'auto' && resolution.candidate) {
        await executeLaunchCandidate(resolution.candidate);
        return;
      }
      if (resolution.status === 'confirm' && resolution.candidate) {
        setLaunchPrompt({
          candidate: resolution.candidate,
          message: resolution.message ?? `Open ${resolution.candidate.title}?`,
          originQuery: trimmedQuery,
        });
        return;
      }
      if (resolution.message) {
        setLaunchPrompt({
          message: resolution.message,
          originQuery: trimmedQuery,
        });
        return;
      }
    }

    // `/search` entry point AND sticky follow-ups. Once a search turn is in
    // flight, subsequent submits without an explicit slash command continue
    // to route through the backend search pipeline so the LLM can clarify,
    // re-answer from context, or fire a fresh SearXNG query as needed.
    // An explicit `/screen` command takes precedence over search continuation
    // so users can always attach a screenshot mid-conversation.
    if (hasSearch || (searchActive && !hasScreen && found.size === 0)) {
      const searchQuery = strippedMessage.trim();
      if (!searchQuery) return;
      // Sanitize externally-sourced context before moving it into the user
      // bubble so host-app control characters cannot leak into the UI.
      // eslint-disable-next-line no-control-regex
      const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
      const sanitized = selectedContext
        ?.replace(CONTROL_CHARS, '')
        .slice(0, quote.maxContextLength);
      const context = sanitized?.trim() ? sanitized : undefined;
      // Pass the full typed query (with `/search`) as bubble display content so
      // the user sees exactly what they typed; the backend receives only the
      // stripped query without the trigger prefix.
      const searchDisplay = hasSearch ? trimmedQuery : undefined;
      setQuery('');
      setSelectedContext(null);
      /* v8 ignore next */
      inputRef.current!.style.height = 'auto';
      setSearchActive(true);
      void askSearch(searchQuery, searchDisplay, context).then(({ final }) => {
        if (final) setSearchActive(false);
      });
      return;
    }

    // Check for utility commands with prompt templates.
    const utilityTrigger = Array.from(found).find((t) => {
      const cmd = COMMANDS.find((c) => c.trigger === t);
      return !!cmd?.promptTemplate;
    });

    // Nothing to send if the message is only commands with no content or images.
    // Exception: a utility command or /think with pre-filled selected context is
    // valid even if no additional text was typed after the trigger.
    if (
      !strippedMessage &&
      attachedImages.length === 0 &&
      !hasScreen &&
      !((utilityTrigger || hasThink) && selectedContext?.trim())
    )
      return;

    if (hasScreen) {
      // Fire-and-forget: the async path handles cleanup and ask() invocation.
      void handleScreenSubmit(trimmedQuery, hasThink);
      return;
    }

    if (utilityTrigger) {
      // Sanitize selectedContext before passing to buildPrompt so that control
      // characters from a hostile host-app selection cannot reach the model prompt.
      // eslint-disable-next-line no-control-regex
      const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
      const sanitized = selectedContext
        ?.replace(CONTROL_CHARS, '')
        .slice(0, quote.maxContextLength);
      const context = sanitized?.trim() ? sanitized : undefined;

      const composedPrompt = buildPrompt(
        utilityTrigger,
        strippedMessage,
        context,
      );
      if (!composedPrompt) return; // No input text available.

      // Show the full original query (including command trigger) in the chat
      // bubble, matching the behaviour of /screen and the normal submit path.
      const displayText = trimmedQuery;

      const hasPendingImages = attachedImages.some(
        (img) => img.filePath === null,
      );
      if (!hasPendingImages) {
        const readyPaths = attachedImages
          .filter((img) => img.filePath !== null)
          .map((img) => img.filePath as string);
        const images = readyPaths.length > 0 ? readyPaths : undefined;
        ask(
          displayText,
          context,
          images,
          hasThink || undefined,
          composedPrompt,
        );
        setSelectedContext(null);
        setQuery('');
        for (const img of attachedImages) {
          URL.revokeObjectURL(img.blobUrl);
        }
        setAttachedImages([]);
        /* v8 ignore next */
        inputRef.current!.style.height = 'auto';
        return;
      }

      // Images still processing: store intent for deferred submit.
      pendingSubmitRef.current = {
        query: displayText,
        context,
        think: hasThink,
        promptOverride: composedPrompt,
      };
      setIsSubmitPending(true);
      setPendingUserMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: displayText,
        quotedText: context,
        imagePaths: attachedImages.map((img) => img.filePath ?? img.blobUrl),
      });
      setQuery('');
      setSelectedContext(null);
      /* v8 ignore next */
      inputRef.current!.style.height = 'auto';
      return;
    }

    // Sanitize externally-sourced context: strip control characters and enforce
    // a length cap to limit prompt-injection surface from host-app selections.
    // eslint-disable-next-line no-control-regex
    const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
    const sanitized = selectedContext
      ?.replace(CONTROL_CHARS, '')
      .slice(0, quote.maxContextLength);
    const context = sanitized?.trim() ? sanitized : undefined;

    // If all images are ready (or there are none), submit immediately.
    const hasPendingImages = attachedImages.some(
      (img) => img.filePath === null,
    );
    if (!hasPendingImages) {
      executeSubmit(trimmedQuery, context, hasThink || undefined);
      return;
    }

    // Images are still processing - store the intent and wait. The effect
    // below will fire the actual ask() once every image has resolved.
    pendingSubmitRef.current = {
      query: trimmedQuery,
      context,
      think: hasThink,
    };
    setIsSubmitPending(true);

    // Show the user's message immediately in the chat view. Use file paths
    // for already-processed images (no loading spinner) and blob URLs only
    // for images still being processed (ChatBubble shows a spinner for blob: URLs).
    setPendingUserMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedQuery,
      quotedText: context,
      imagePaths: attachedImages.map((img) => img.filePath ?? img.blobUrl),
    });

    setQuery('');
    setSelectedContext(null);
    inputRef.current!.style.height = 'auto';
  }, [
    query,
    isGenerating,
    executeSubmit,
    handleScreenSubmit,
    selectedContext,
    setSelectedContext,
    attachedImages,
    setCaptureError,
    ask,
    askSearch,
    searchActive,
    launchPrompt,
    executeLaunchCandidate,
    executeLaunchUrl,
    resolveLaunchLookup,
  ]);

  const launcherSections = useMemo<LauncherSection[]>(
    () =>
      buildLauncherSections(
        query,
        query.trim() ? launcherConversations : [],
        query.trim() ? launcherApps : [],
        query.trim() ? launcherFiles : [],
      ),
    [launcherApps, launcherConversations, launcherFiles, query],
  );

  const handleLauncherSelect = useCallback(
    async (item: LauncherItem) => {
      switch (item.kind) {
        case 'calculation':
          if (item.value) {
            await navigator.clipboard.writeText(item.value);
          }
          return;
        case 'ask':
          handleSubmit();
          return;
        case 'command': {
          const trigger = item.value ?? item.title;
          const remainder = query.trim();
          const nextQuery =
            remainder && !remainder.startsWith('/')
              ? `${trigger} ${remainder}`
              : `${trigger} `;
          setQuery(nextQuery);
          requestAnimationFrame(() => inputRef.current?.focus());
          return;
        }
        case 'conversation':
          if (item.value) {
            void handleLoadConversation(item.value);
          }
          return;
        case 'app':
        case 'file':
          if (item.value) {
            clearLaunchDraft();
            await invoke('open_path', { path: item.value });
            requestHideOverlay();
          }
          return;
        case 'web':
          if (item.value) {
            clearLaunchDraft();
            await invoke('open_url', { url: item.value });
            requestHideOverlay();
          }
      }
    },
    [clearLaunchDraft, handleLoadConversation, handleSubmit, query, requestHideOverlay],
  );

  const handleLauncherAction = useCallback(
    async (item: LauncherItem, action: LauncherItemAction) => {
      if (!item.value) return;

      if (action === 'copy_path') {
        await navigator.clipboard.writeText(item.value);
        return;
      }

        if (action === 'reveal') {
          await invoke('open_containing_folder', {
            path: item.value,
            isDirectory: item.isDirectory ?? false,
          });
          requestHideOverlay();
          return;
        }

        if (action === 'open_console') {
          await invoke('open_in_terminal', {
            path: item.value,
            kind: item.kind,
            isDirectory: item.isDirectory ?? false,
          });
          requestHideOverlay();
          return;
        }

        if (action === 'insert') {
          setQuery(`${item.value} `);
        }
    },
    [requestHideOverlay],
  );

  // When a pending submit exists and all images finish processing, fire it.
  // Reads `attachedImages` directly (not via `executeSubmit` closure) to
  // guarantee the effect always sees the freshest file paths.
  /* eslint-disable @eslint-react/set-state-in-effect -- intentional: effect
     reacts to image processing completion and must synchronously transition
     state (pending → submitted) in the same tick to avoid stale renders. */
  useEffect(() => {
    if (!pendingSubmitRef.current) return;
    if (attachedImages.length === 0) {
      // All images failed - restore the user's query so their text isn't lost.
      const { query: savedQuery, context: savedContext } =
        pendingSubmitRef.current;
      pendingSubmitRef.current = null;
      setIsSubmitPending(false);
      setPendingUserMessage(null);
      setQuery(savedQuery);
      setSelectedContext(savedContext ?? null);
      return;
    }
    // Wait until every image has finished backend processing.
    const allReady = attachedImages.every((img) => img.filePath !== null);
    if (!allReady) return;

    const {
      query: pendingQuery,
      context,
      think,
      promptOverride,
    } = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    setIsSubmitPending(false);
    // Clear the preview message - ask() will add the real one with file paths.
    setPendingUserMessage(null);

    const images = attachedImages.map((img) => img.filePath as string);
    void ask(pendingQuery, context, images, think || undefined, promptOverride);
    // Note: the display content in the pending bubble (set in handleSubmit)
    // already includes command triggers for visibility in the chat.
    setSelectedContext(null);
    for (const img of attachedImages) {
      URL.revokeObjectURL(img.blobUrl);
    }
    setAttachedImages([]);
  }, [attachedImages, ask, setSelectedContext]);
  /* eslint-enable @eslint-react/set-state-in-effect */

  /**
   * Unified cancel handler: reverts a pending submit (undo-send), clears an
   * in-flight /screen capture, or cancels an active Ollama generation.
   *
   * Three cases:
   * 1. Image-processing pending (`pendingSubmitRef.current` is set): restore
   *    query and attached images so the user can re-submit or edit.
   * 2. Screen-capture in-flight (`isSubmitPending` true but ref is null):
   *    clear pending state. The async capture may still complete on the Rust
   *    side, but `isSubmitPending` being false when the result arrives will
   *    cause `handleScreenSubmit` to attempt ask() on stale state. To prevent
   *    that, we track the abandonment via a flag so the async tail is a no-op.
   * 3. Ollama generation active: delegate to the streaming cancel.
   */
  const handleCancel = useCallback(() => {
    if (isSubmitPending && pendingSubmitRef.current) {
      // Case 1: image-processing pending. Restore input state.
      setQuery(pendingSubmitRef.current.query);
      setSelectedContext(pendingSubmitRef.current.context ?? null);
      pendingSubmitRef.current = null;
      setIsSubmitPending(false);
      setPendingUserMessage(null);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (isSubmitPending) {
      // Case 2: /screen capture in flight. Signal cancellation via ref so the
      // async tail in handleScreenSubmit skips ask() when capture resolves.
      // Restore the ask bar to what it looked like before the capture started.
      screenCapturePendingRef.current = false;
      const snapshot = screenCaptureInputSnapshotRef.current;
      screenCaptureInputSnapshotRef.current = null;
      setIsSubmitPending(false);
      setPendingUserMessage(null);
      /* v8 ignore start -- snapshot is always set when isSubmitPending is true via /screen */
      if (snapshot) {
        setQuery(snapshot.query);
        setSelectedContext(snapshot.context ?? null);
      }
      /* v8 ignore stop */
      suppressBlurHideRef.current = false;
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    void cancel();
    setSearchActive(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isSubmitPending, cancel, setSearchActive, setSelectedContext]);

  /** Fetches runtime provider settings from the backend once at mount. */
  useEffect(() => {
    void invoke<ProviderSettings>('get_provider_settings').then((settings) => {
      setProviderSettings(settings);
      setModelConfig(settings.models);
    });
  }, []);

  /**
   * Synchronizes the React animation state with Tauri-driven overlay visibility
   * requests emitted from the Rust backend.
   */
  useEffect(() => {
    let unlistenVisibility: (() => void) | undefined;
    let unlistenOnboarding: (() => void) | undefined;

    const attachListeners = async () => {
      unlistenVisibility = await listen<OverlayVisibilityPayload>(
        OVERLAY_VISIBILITY_EVENT,
        ({ payload }) => {
          if (payload.state === 'show') {
            replayEntranceAnimation(
              payload.selected_text ?? null,
              payload.window_x ?? null,
              payload.window_y ?? null,
              payload.screen_bottom_y ?? null,
              payload.force_new_session ?? false,
            );
            return;
          }
          requestHideOverlay();
        },
      );
      unlistenOnboarding = await listen<{ stage: OnboardingStage }>(
        ONBOARDING_EVENT,
        ({ payload }) => {
          setOnboardingStage(payload.stage);
        },
      );
      // Both listeners registered - safe to let Rust decide what to show on launch.
      await invoke('notify_frontend_ready');
    };

    void attachListeners();
    return () => {
      unlistenVisibility?.();
      unlistenOnboarding?.();
    };
  }, [replayEntranceAnimation, requestHideOverlay]);

  /**
   * Combined close handler shared by the keyboard shortcut (Esc/Cmd+W)
   * and the traffic light close/minimize buttons. Notifies the Rust
   * backend and triggers the frontend exit animation sequence.
   */
  const handleCloseOverlay = useCallback(() => {
    void invoke('notify_overlay_hidden');
    requestHideOverlay();
  }, [requestHideOverlay]);

  const handleMinimizeWindow = useCallback(() => {
    void getCurrentWindow().minimize();
  }, []);

  const handleToggleMaximizeWindow = useCallback(() => {
    void getCurrentWindow().toggleMaximize();
  }, []);

  function stopHorizontalResize() {
    resizeStateRef.current = null;
    manualResizeActiveRef.current = false;
    document.body.style.cursor = '';
    document.documentElement.style.cursor = '';
    document.documentElement.classList.remove('window-manual-resize');
    window.removeEventListener('mousemove', handleHorizontalResizeMove);
    window.removeEventListener('mouseup', stopHorizontalResize);

    const container = morphingContainerNodeRef.current;
    if (container) {
      requestAnimationFrame(() => {
        syncWindowHeightToContainer(container);
      });
    }
  }

  function handleHorizontalResizeMove(event: MouseEvent) {
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }

    const deltaX = event.clientX - resizeState.lastClientX;
    if (deltaX === 0) {
      return;
    }

    resizeState.lastClientX = event.clientX;
    void invoke('__window.resizeHorizontal', {
      edge: resizeState.edge,
      deltaX,
      minWidth: MIN_RESIZABLE_WINDOW_WIDTH,
      maxWidth: MAX_RESIZABLE_WINDOW_WIDTH,
    });
  }

  const startHorizontalResize = useCallback(
    (edge: 'left' | 'right') => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      manualResizeActiveRef.current = true;
      resizeStateRef.current = {
        edge,
        lastClientX: event.clientX,
      };
      document.body.style.cursor = 'ew-resize';
      document.documentElement.style.cursor = 'ew-resize';
      document.documentElement.classList.add('window-manual-resize');
      window.addEventListener('mousemove', handleHorizontalResizeMove);
      window.addEventListener('mouseup', stopHorizontalResize);
    },
    [handleHorizontalResizeMove, stopHorizontalResize],
  );

  useEffect(
    () => () => {
      stopHorizontalResize();
    },
    [stopHorizontalResize],
  );

  /** Hide window on Escape or Cmd+W (macOS) / Ctrl+W. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (((e.metaKey || e.ctrlKey) && e.key === 'w') || e.key === 'Escape') {
        e.preventDefault();
        handleCloseOverlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCloseOverlay]);

  /** Programmatic focus when the overlay becomes visible. */
  useEffect(() => {
    if (overlayState === 'visible') {
      const raf = requestAnimationFrame(() => focusInputAtEnd());
      return () => cancelAnimationFrame(raf);
    }
  }, [overlayState, focusInputAtEnd]);

  /** After a turn finishes, return focus to the input so the user can keep typing. */
  useEffect(() => {
    if (overlayState !== 'visible' || isGenerating || isSubmitPending) return;

    const raf = requestAnimationFrame(() => focusInputAtEnd());
    return () => cancelAnimationFrame(raf);
  }, [
    overlayState,
    isGenerating,
    isSubmitPending,
    messages.length,
    focusInputAtEnd,
  ]);

  /** Auto-hide the floating chat whenever the window loses focus. */
  useEffect(() => {
    if (overlayState !== 'visible') return;

    const handleWindowBlur = () => {
      if (suppressBlurHideRef.current) {
        return;
      }
      handleCloseOverlay();
    };

    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, [overlayState, handleCloseOverlay]);

  /**
   * Commits the native window hide after a fixed deadline from the start of
   * the exit transition.
   */
  useEffect(() => {
    if (overlayState !== 'hiding') return;

    const timer = setTimeout(() => {
      void getCurrentWindow().hide();
      void invoke('notify_overlay_hidden');
      setOverlayState('hidden');
    }, HIDE_COMMIT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [overlayState]);

  useEffect(
    () => () => {
      stopHorizontalResize();
    },
    [stopHorizontalResize],
  );

  /**
   * Handles mousedown on any surface of the application window.
   *
   * For non-interactive targets (transparent padding, container chrome, etc.):
   * - Calls `preventDefault()` to suppress the browser's default behaviour of
   *   blurring the active element, keeping textarea focus intact.
   * - Initiates a native platform drag via `startDragging()`.
   *
   * For interactive targets (textarea, buttons, links): returns early so
   * standard DOM behaviour (focus, click, selection) proceeds normally.
   */
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    const el = e.target as HTMLElement | null;

    // Electron frameless windows use CSS drag regions. If the pointer is
    // already inside such a region, let the native drag mechanism handle it.
    if (el?.closest('[data-window-drag-region]')) {
      return;
    }

    // 1. Allow native text selection in explicitly selectable regions.
    // If the click occurs inside a chat bubble (which has .select-text),
    // we return early so the user can highlight and copy the text.
    if (el?.closest('.select-text')) {
      return;
    }

    // 2. Allow interaction with standard interactive elements.
    const INTERACTIVE_TAGS = new Set([
      'TEXTAREA',
      'INPUT',
      'BUTTON',
      'A',
      'SELECT',
      'PATH',
      'SVG',
    ]);
    let current = el;
    while (current) {
      if (INTERACTIVE_TAGS.has(current.tagName.toUpperCase())) return;
      current = current.parentElement;
    }

    // Suppress the default mousedown side-effect (focus transfer / blur)
    // so the textarea retains keyboard input during window repositioning.
    e.preventDefault();
    void getCurrentWindow().startDragging();

    // After the user repositions the window, drop the upward-grow mode so
    // subsequent conversation growth tracks the new position downward.
    window.addEventListener(
      'mouseup',
      () => {
        growsUpwardRef.current = false;
        setGrowsUpward(false);
      },
      { once: true },
    );
  }, []);

  if (onboardingStage !== null) {
    return (
      <OnboardingView
        stage={onboardingStage}
        onComplete={() => setOnboardingStage(null)}
      />
    );
  }

  return (
    // Minimal padding (pt-2 pb-6) provides just enough physical clearance for the
    // tightened drop shadow to render without clipping at the native window edge.
      <div
        onMouseDown={handleDragStart}
      onDragOver={handleRootDragOver}
      onDragLeave={handleRootDragLeave}
      onDrop={handleRootDrop}
      className={`flex flex-col items-center ${growsUpward ? 'justify-end' : 'justify-start'} h-screen w-screen px-3 pt-2 pb-6 bg-transparent overflow-visible`}
    >
      <AnimatePresence mode="wait">
        {shouldRenderOverlay ? (
            <motion.div
              key={`overlay-${sessionId}`}
              initial={{ opacity: 0, y: -20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="window-shell w-full max-w-[960px] px-4 py-2 overflow-visible"
            >
              {/* Relative wrapper - serves as the positioning context for the
                  chat-mode history dropdown so it can sit outside the morphing
                  container's overflow-hidden boundary without being clipped. */}
              <div className="relative">
                <div
                  className="window-resize-handle window-resize-handle-left"
                  data-resize-handle="left"
                  onMouseDown={startHorizontalResize('left')}
                />
                <div
                  className="window-resize-handle window-resize-handle-right"
                  data-resize-handle="right"
                  onMouseDown={startHorizontalResize('right')}
                />
                {/* Morphing Container - flex column ensures the input bar
                  always sticks to the bottom without spring animation lag.
                  A CSS `transition: min-height` drives smooth window growth
                  when the chat-mode history dropdown is open; the existing
                  ResizeObserver fires per-frame and calls setSize() so the
                  native window tracks the animation. The dropdown is a sibling
                  (not a child) so overflow-hidden never clips it. */}
              <div
                ref={setContainerRef}
                style={{
                  transition:
                    'height 0.25s cubic-bezier(0.16, 1, 0.3, 1), min-height 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                className={`morphing-container ${
                  isIdleAskBar ? 'morphing-container-idle' : ''
                } relative flex flex-col bg-surface-base backdrop-blur-2xl border border-surface-border max-h-[600px] overflow-hidden ${
                  isChatMode
                    ? `rounded-lg shadow-chat`
                    : 'rounded-2xl shadow-bar'
                }`}
              >
                {/* Chat Messages Area - morphs in when in chat mode */}
                <AnimatePresence>
                  {isChatMode ? (
                    <ConversationView
                      messages={
                        pendingUserMessage
                          ? [...messages, pendingUserMessage]
                          : messages
                      }
                      isGenerating={isGenerating || isSubmitPending}
                      onClose={handleCloseOverlay}
                      onMinimize={handleMinimizeWindow}
                      onToggleMaximize={handleToggleMaximizeWindow}
                      onSave={handleSave}
                      isSaved={isSaved}
                      canSave={canSave}
                      onNewConversation={handleNewConversation}
                      onSettingsOpen={handleSettingsToggle}
                      onHistoryOpen={handleHistoryToggle}
                      onImagePreview={handleChatImagePreview}
                      searchStage={searchStage}
                    />
                  ) : null}
                </AnimatePresence>

                {/* Ask-bar mode history panel - inline below the input bar.
                    The !isChatMode gate lives OUTSIDE AnimatePresence so that when
                    a conversation is loaded (isChatMode → true) the panel unmounts
                    instantly - no exit animation runs alongside ConversationView
                    mounting. Without this, AnimatePresence would hold the panel in
                    the DOM during its exit while ConversationView is also present,
                    causing two rapid ResizeObserver → setSize() calls (jitter).
                    AnimatePresence is still used for the manual toggle (isHistoryOpen)
                    so the drawer height-animates smoothly open and closed. */}
                {!isChatMode && (
                  <AnimatePresence>
                    {isHistoryOpen ? (
                      <motion.div
                        key="ask-bar-history"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          height: {
                            duration: 0.3,
                            ease: [0.33, 1, 0.68, 1],
                          },
                          opacity: { duration: 0.2, delay: 0.08 },
                        }}
                        style={{ overflow: 'hidden' }}
                        className="border-t border-surface-border"
                      >
                        <HistoryPanel
                          listConversations={listConversations}
                          onLoadConversation={handleLoadConversation}
                          onSaveAndLoad={handleSaveAndLoad}
                          onDeleteConversation={handleDeleteConversation}
                          hasCurrentMessages={false}
                          showNewConversation={false}
                          currentConversationId={conversationId}
                        />
                      </motion.div>
                    ) : isSettingsOpen ? (
                      <motion.div
                        key="ask-bar-settings"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          height: {
                            duration: 0.3,
                            ease: [0.33, 1, 0.68, 1],
                          },
                          opacity: { duration: 0.2, delay: 0.08 },
                        }}
                        style={{ overflow: 'hidden' }}
                        className="ask-bar-settings border-t border-surface-border p-3"
                      >
                        <SettingsPanel
                          settings={providerSettings}
                          onSaved={(settings) => {
                            setProviderSettings(settings);
                            setModelConfig(settings.models);
                          }}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                )}

                {/* Capture error banner: shown when /screen capture fails so
                    the user knows why the message was not sent. */}
                {captureError && (
                  <div className="px-4 py-2 border-t border-red-900/30">
                    <p className="text-red-400 text-xs leading-relaxed">
                      {captureError}
                    </p>
                  </div>
                )}

                {launchPrompt && (
                  <div className="flex items-center justify-between gap-3 border-t border-primary/15 bg-primary/6 px-4 py-2">
                    <p className="text-xs leading-relaxed text-text-primary">
                      {launchPrompt.message}
                    </p>
                    <div className="flex items-center gap-2">
                      {launchPrompt.candidate ? (
                        <button
                          type="button"
                          onClick={() =>
                            void executeLaunchCandidate(launchPrompt.candidate!)
                          }
                          className="window-no-drag rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-neutral transition-opacity hover:opacity-90"
                        >
                          Open
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setLaunchPrompt(null)}
                        className="window-no-drag rounded-lg border border-surface-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-white/6 hover:text-text-primary"
                      >
                        {launchPrompt.candidate ? 'Cancel' : 'Close'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Input Bar - always pinned to the bottom */}
                <AskBarView
                  query={query}
                  setQuery={setQuery}
                  isChatMode={isChatMode}
                  isGenerating={isGenerating}
                  isSubmitPending={isSubmitPending}
                  onSubmit={handleSubmit}
                  onCancel={handleCancel}
                  inputRef={inputRef}
                  selectedText={selectedContext ?? undefined}
                  onHistoryOpen={handleHistoryToggle}
                  onSettingsOpen={handleSettingsToggle}
                  attachedImages={isSubmitPending ? [] : attachedImages}
                  onImagesAttached={handleImagesAttached}
                  onImageRemove={handleImageRemove}
                  onImagePreview={handleAskBarImagePreview}
                  onScreenshot={handleScreenshot}
                  launcherSections={
                    !isHistoryOpen && !isSettingsOpen ? launcherSections : []
                  }
                  onLauncherSelect={handleLauncherSelect}
                  onLauncherAction={handleLauncherAction}
                  isDragOver={isDragOver ?? undefined}
                />
              </div>

              {/* Chat-mode history dropdown - sibling of the morphing container so
                  it is never clipped by its overflow-hidden. Positioned absolutely
                  within this relative wrapper (same coordinate space as the
                  container). The container's minHeight animation grows the native
                  window tall enough to reveal the full dropdown. */}
              <AnimatePresence>
                {isChatMode && isHistoryOpen ? (
                  <motion.div
                    ref={historyDropdownRef}
                    key="chat-history"
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="history-dropdown absolute right-3 top-10 z-50 flex w-56 flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-base shadow-chat"
                  >
                    <HistoryPanel
                      listConversations={listConversations}
                      onLoadConversation={handleLoadConversation}
                      onSaveAndLoad={handleSaveAndLoad}
                      onDeleteConversation={handleDeleteConversation}
                      hasCurrentMessages={messages.length > 0 && !isSaved}
                      currentConversationId={conversationId}
                      showNewConversation={false}
                      pendingNewConversation={pendingNewConversation}
                      onSaveAndNew={handleSaveAndNew}
                      onJustNew={handleJustNew}
                      onCancelNew={() => setIsHistoryOpen(false)}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence>
                {isChatMode && isSettingsOpen ? (
                  <motion.div
                    ref={settingsDropdownRef}
                    key="chat-settings"
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="settings-dropdown absolute right-3 top-10 z-50 w-[min(28rem,calc(100%-1.5rem))]"
                  >
                    <SettingsPanel
                      settings={providerSettings}
                      onSaved={(settings) => {
                        setProviderSettings(settings);
                        setModelConfig(settings.models);
                      }}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <ImagePreviewModal
        imageUrl={previewImageUrl}
        onClose={() => setPreviewImageUrl(null)}
      />
    </div>
  );
}

export default App;
