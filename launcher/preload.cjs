const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  state: () => ipcRenderer.invoke('library:state'),
  chooseFolder: () => ipcRenderer.invoke('library:folder'),
  play: id => ipcRenderer.invoke('library:play', id),
});
