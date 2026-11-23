const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widgetAPI', {
  resize: (w, h) => ipcRenderer.send('widget-resize', w, h),
  setTall: (tall) => ipcRenderer.send('widget-set-tall', tall),
  /* 让主进程测量页面内容的真实尺寸，把窗口调成和内容一样大 */
  fit: () => ipcRenderer.send('widget-fit'),
  /* 桌面歌词：on=true 整窗穿透；rects=热区列表时由主进程轮询鼠标决定命中 */
  setClickthrough: (on, rects) => ipcRenderer.send('desk-clickthrough', on, rects)
});
