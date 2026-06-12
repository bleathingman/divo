const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('peekBridge', {
  close:   () => ipcRenderer.send('peek-close'),
  promote: (url) => ipcRenderer.send('peek-promote', url),
})
