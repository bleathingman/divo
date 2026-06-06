const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('profileBridge', {
  getData:  ()       => ipcRenderer.invoke('ps-get-data'),
  select:   (id)     => ipcRenderer.invoke('ps-select', id),
  create:   (d)      => ipcRenderer.invoke('ps-create', d),
  edit:     (id, d)  => ipcRenderer.invoke('ps-edit', id, d),
  del:      (id)     => ipcRenderer.invoke('ps-delete', id),
  close:    ()       => ipcRenderer.invoke('ps-close'),
})
