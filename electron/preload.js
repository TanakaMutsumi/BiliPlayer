'use strict';
/* 主窗口 preload：仅暴露网易云网页登录所需的最小能力 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appAPI', {
  openNEWebLogin: () => ipcRenderer.invoke('open-ne-web-login'),
  onNELoginDone: cb => {
    ipcRenderer.on('ne-login-done', (e, r) => { try { cb(r); } catch (err) {} });
  },
  /* QQ音乐一键网页登录 */
  openQQWebLogin: () => ipcRenderer.invoke('open-qq-web-login'),
  /* 退出QQ音乐：清Jar里qq.com Cookie */
  qqJarClear: () => ipcRenderer.invoke('qq-jar-clear'),
  onQQLoginDone: cb => {
    ipcRenderer.on('qq-login-done', (e, r) => { try { cb(r); } catch (err) {} });
  },
  /* 桌面组件窗口（迷你播放器/桌面歌词）被关闭时通知主窗口，同步开关状态 */
  onWidgetWindowClosed: cb => {
    ipcRenderer.on('widget-window-closed', (e, key) => { try { cb(key); } catch (err) {} });
  }
});
