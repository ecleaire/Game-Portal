const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', {
  state: () => ipcRenderer.invoke('library:state'),
  chooseFolder: () => ipcRenderer.invoke('library:folder'),
  importGame: () => ipcRenderer.invoke('library:import'),
  play: id => ipcRenderer.invoke('library:play', id),
  remove: id => ipcRenderer.invoke('library:remove', id),
});
