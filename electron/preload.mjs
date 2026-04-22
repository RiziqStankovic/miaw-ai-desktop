import { contextBridge, ipcRenderer } from 'electron';

const channelListeners = new Map();
const eventListeners = new Map();

ipcRenderer.on('thuki:channel', (_event, message) => {
  const listener = channelListeners.get(message.id);
  if (listener) {
    listener(message.payload);
  }
});

ipcRenderer.on('thuki:event', (_event, message) => {
  const listeners = eventListeners.get(message.event);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener({ payload: message.payload });
  }
});

contextBridge.exposeInMainWorld('__thukiElectron', {
  invoke: (cmd, args) => ipcRenderer.invoke('thuki:invoke', { cmd, args }),
  listen: async (eventName, callback) => {
    if (!eventListeners.has(eventName)) {
      eventListeners.set(eventName, new Set());
    }

    const listeners = eventListeners.get(eventName);
    listeners.add(callback);

    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        eventListeners.delete(eventName);
      }
    };
  },
  subscribeChannel: (id, callback) => {
    channelListeners.set(id, callback);
    return () => {
      channelListeners.delete(id);
    };
  },
  window: {
    hide: () => ipcRenderer.invoke('thuki:invoke', { cmd: '__window.hide', args: {} }),
    minimize: () =>
      ipcRenderer.invoke('thuki:invoke', { cmd: '__window.minimize', args: {} }),
    toggleMaximize: () =>
      ipcRenderer.invoke('thuki:invoke', {
        cmd: '__window.toggleMaximize',
        args: {}
      }),
    setSize: (size) =>
      ipcRenderer.invoke('thuki:invoke', {
        cmd: '__window.setSize',
        args: { width: size.width, height: size.height }
      }),
    startDragging: () => Promise.resolve()
  }
});
