// Exposes a small, explicit API to the page. No Node access in the renderer.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('nysera', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    testKey: (key) => ipcRenderer.invoke('settings:testKey', key)
  },
  chats: {
    load: () => ipcRenderer.invoke('chats:load'),
    save: (data) => ipcRenderer.invoke('chats:save', data)
  },
  chat: {
    send: (req) => ipcRenderer.invoke('chat:send', req),
    stop: (id) => ipcRenderer.invoke('chat:stop', id),
    onDelta: on('chat:delta')
  },
  run: {
    pickDir: () => ipcRenderer.invoke('dir:pick'),
    start: (opts) => ipcRenderer.invoke('run:start', opts),
    stop: () => ipcRenderer.invoke('run:stop'),
    chains: () => ipcRenderer.invoke('run:chains'),
    onEvent: on('run:event'),
    onLanes: on('run:lanes')
  },
  open: {
    external: (url) => ipcRenderer.invoke('open:external', url),
    path: (p) => ipcRenderer.invoke('open:path', p)
  }
});
