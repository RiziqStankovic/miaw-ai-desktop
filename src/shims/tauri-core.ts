type ChannelMarker = {
  __channelId: string;
};

declare global {
  interface Window {
    __thukiElectron: {
      invoke: <T>(cmd: string, args?: unknown) => Promise<T>;
      subscribeChannel: (
        id: string,
        callback: (payload: unknown) => void,
      ) => () => void;
      listen: <T>(
        eventName: string,
        callback: (event: { payload: T }) => void,
      ) => Promise<() => void>;
      window: {
        hide: () => Promise<void>;
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<void>;
        setSize: (size: { width: number; height: number }) => Promise<void>;
        startDragging: () => Promise<void>;
      };
    };
  }
}

function serialize(value: unknown): unknown {
  if (value instanceof Channel) {
    return { __channelId: value.id } satisfies ChannelMarker;
  }

  if (Array.isArray(value)) {
    return value.map(serialize);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        serialize(nested),
      ]),
    );
  }

  return value;
}

export class Channel<T> {
  readonly id = crypto.randomUUID();
  #unsubscribe: (() => void) | null;
  #onmessage: ((message: T) => void) | null = null;

  constructor() {
    this.#unsubscribe = window.__thukiElectron.subscribeChannel(
      this.id,
      (payload) => {
        this.#onmessage?.(payload as T);
      },
    );
  }

  set onmessage(handler: ((message: T) => void) | null) {
    this.#onmessage = handler;
  }

  get onmessage() {
    return this.#onmessage;
  }

  dispose() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  return window.__thukiElectron.invoke<T>(cmd, serialize(args));
}

export function convertFileSrc(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/');
  return encodeURI(`file:///${normalized}`);
}
