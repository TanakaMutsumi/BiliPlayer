'use strict';
/* 主窗口 preload：仅暴露网易云网页登录所需的最小能力 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appAPI', {
  openNEWebLogin: () => ipcRenderer.invoke('open-ne-web-login'),
  onNELoginDone: cb => {
    ipcRenderer.on('ne-login-done', (e, r) => { try { cb(r); } catch (err) {} });
  }
});
