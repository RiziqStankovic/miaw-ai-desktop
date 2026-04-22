export function getCurrentWindow() {
  return {
    hide: () => window.__thukiElectron.window.hide(),
    minimize: () => window.__thukiElectron.window.minimize(),
    toggleMaximize: () => window.__thukiElectron.window.toggleMaximize(),
    setSize: (size: { width: number; height: number }) =>
      window.__thukiElectron.window.setSize(size),
    startDragging: () => window.__thukiElectron.window.startDragging(),
  };
}
