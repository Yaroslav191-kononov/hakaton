const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Velocity = require('velocityjs');

let template = null;

// Функция загрузки шаблона
async function loadTemplate() {
    try {
        const templatePath = path.join(__dirname, 'template.vm');
        template = await fs.promises.readFile(templatePath, 'utf8');
        return template;
    } catch (error) {
        console.error("Ошибка при чтении файла шаблона:", error);
        return null;
    }
}

async function createWindow() {
    try {
        // Загружаем шаблон
        await loadTemplate();

        if (!template) {
            // Обрабатываем ошибку загрузки шаблона. Например, показываем сообщение об ошибке.
            console.error("Не удалось загрузить шаблон. Приложение не будет работать корректно.");
            // Вмеcто закрытия, можно отобразить сообщение об ошибке в главном окне.
            return;
        }
        const win = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });

       await  win.loadFile('index.html')// added await
        console.log("index.html загружен успешно");

    } catch (error) {
        console.error('Failed to create window:', error);
        // Handle the error appropriately, e.g., show an error message
    }
}

app.whenReady().then(async () => {
    await createWindow();
   }
);

app.on('activate',  function () {
     if (BrowserWindow.getAllWindows().length === 0)  createWindow();
 });

ipcMain.handle('create-vm-template', async (event, template, data, params) => {
    try {
        if (!template) {
            console.error("Template is null or empty");
            return { success: false, error: "Template is null or empty" };
        }

        const context = {
            ...params
        }
        const vmCode = Velocity.render(template, context);
        return { success: true, vmCode };
    } catch (error) {
        console.error(error);
        return { success: false, error: error.message };
    }
});



ipcMain.handle('load-template', async () => {
        try {
            const templatePath = path.join(__dirname, 'template.vm');
            const template = await fs.promises.readFile(templatePath, 'utf8');
            return template;
        } catch (error) {
            console.error("Ошибка при чтении файла шаблона:", error);
            return null;
        }
  });
