export function listen<T>(
  eventName: string,
  callback: (event: { payload: T }) => void,
) {
  return window.__thukiElectron.listen(eventName, callback);
}
