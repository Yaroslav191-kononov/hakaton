const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Velocity = require('velocityjs');

let templateGlobal = null;

async function loadTemplateFromDisk() {
  try {
    const templatePath = path.join(__dirname, 'template.vm');
    const tpl = await fs.promises.readFile(templatePath, 'utf8');
    templateGlobal = tpl;
    return tpl;
  } catch (err) {
    console.warn('Не удалось прочитать template.vm:', err.message);
    templateGlobal = null;
    return null;
  }
}


async function createWindow() {
  try {
    await loadTemplateFromDisk();


const win = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js')
  }
});

await win.loadFile('index.html');
console.log('index.html загружен успешно');

} catch (err) {
    console.error('Failed to create window:', err);
  }
}


app.whenReady().then(createWindow);


app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});


function createDateTool() {
  return {
    toDate(format, str) {
      if (!str) return null;
      try {
        if (/^\d{2}.\d{2}.\d{4}$/.test(str)) {
          const [d, m, y] = str.split('.');
          return new Date(Number(y), Number(m) - 1, Number(d));
        }
        if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
          return new Date(str);
        }
        const dt = new Date(str);
        return isNaN(dt) ? null : dt;
      } catch (e) {
        return null;
      }
    },
    format(fmt, date) {
      if (!date) return '';
      const d = (date instanceof Date) ? date : new Date(date);
      if (isNaN(d)) return '';
      const yyyy = d.getFullYear();
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const HH = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return fmt.replace('yyyy', yyyy).replace('MM', MM).replace('dd', dd)
                .replace('HH', HH).replace('mm', mm).replace('ss', ss);
    }
  };
}


function isEmptyHelper(obj) {
  if (obj === null || obj === undefined) return true;
  if (typeof obj === 'string') return obj.trim().length === 0;
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  return false;
}


function attachIsEmpty(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);


try {
    if (!Object.prototype.hasOwnProperty.call(obj, 'isEmpty')) {
      Object.defineProperty(obj, 'isEmpty', {
        value: function() { return isEmptyHelper(this); },
        enumerable: false,
        configurable: true,
        writable: false
      });
    }
  } catch (e) {

  }


for (const k of Object.keys(obj)) {
    try {
      if (typeof obj[k] === 'object') attachIsEmpty(obj[k], seen);
    } catch (e) {}
  }
}


ipcMain.handle('create-vm-template', async (event, templateParam = null, data = {}, params = {}) => {
  try {
    let templateToUse = templateParam || templateGlobal;
    if (!templateToUse) {
      templateToUse = await loadTemplateFromDisk();
    }
    if (!templateToUse) {
      return { success: false, error: 'Template is empty or not found' };
    }


const context = Object.assign({}, data);

context.params = params || {};

context.dateTool = createDateTool();
context.isEmpty = isEmptyHelper;

try { attachIsEmpty(context); } catch (e) {  }

const vmCode = Velocity.render(templateToUse, context);
return { success: true, vmCode };

} catch (error) {
    console.error('Error creating VM template:', error);
    return { success: false, error: error.message || String(error) };
  }
});


ipcMain.handle('load-template', async () => {
  try {
    if (!templateGlobal) {
      await loadTemplateFromDisk();
    }
    return templateGlobal;
  } catch (error) {
    console.error('Ошибка при чтении файла шаблона:', error);
    return null;
  }
});


ipcMain.handle('save-file', async (event, content) => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Сохранить VM-шаблон',
      defaultPath: 'template.vm',
      filters: [{ name: 'VM Template', extensions: ['vm', 'txt'] }]
    });


if (canceled) return { canceled: true };

await fs.promises.writeFile(filePath, content, 'utf8');
return { success: true, filePath };

} catch (err) {
    console.error('Error saving file:', err);
    return { success: false, error: err.message || String(err) };
  }
});