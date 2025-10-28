const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveFile: (content) => ipcRenderer.invoke('save-file', content),
    createVMTemplate: (template, data, params) => ipcRenderer.invoke('create-vm-template', template, data, params),
    loadTemplate: () => ipcRenderer.invoke('load-template')
});
