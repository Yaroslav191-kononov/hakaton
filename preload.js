const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  createVMTemplate: (tpl, data, params) => ipcRenderer.invoke('create-vm-template', tpl, data, params)
});
