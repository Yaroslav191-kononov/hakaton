const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const xml2js = require('xml2js');
const path = require('path');
let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

app.on('ready', createWindow);

function loadForm() {
    return new Promise((resolve, reject) => {
        fs.readFile("service_form.json", 'utf-8', (err, data) => {
            if (err) return reject(err);
            try {
                const res = JSON.parse(data);
                resolve(res);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

function loadContent() {
    return new Promise((resolve, reject) => {
        fs.readFile("content.json", 'utf-8', (err, data) => {
            if (err) return reject(err);
            try {
                const res = JSON.parse(data);
                resolve(res);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

function loadName() {
    return new Promise((resolve, reject) => {
        fs.readFile("schema.xsd", 'utf-8', (err, data) => {
            if (err) return reject(err);

            const parser = new xml2js.Parser();
            parser.parseString(data, (parseErr, result) => {
                if (parseErr) return reject(parseErr);

                function extractNames(node) {
                    let names = [];
                    if (Array.isArray(node)) {
                        node.forEach(item => names = names.concat(extractNames(item)));
                        return names;
                    }
                    if (node && typeof node === 'object') {
                        if (node.$ && node.$.name) names.push(node.$.name);
                        Object.keys(node).forEach(key => {
                            if (key === '$') return;
                            names = names.concat(extractNames(node[key]));
                        });
                    }
                    return names;
                }

                const names = extractNames(result);
                resolve(names);
            });
        });
    });
}

ipcMain.on('generate-template', async (event,template) => {
    try {
        const [Form, Name, Content] = await Promise.all([loadForm(), loadName(), loadContent()]);
        const map = new Map(template.map(t => [t.name, t.value]));
        for (let i = 0; i < Content.content.length; i++) {
            const item = Content.content[i];
            if (item && typeof item === 'object') {
                const keys = Object.keys(item);
                if (keys.length === 1) {
                const key = keys[0];
                if (map.has(key)) {
                    item[key] = map.get(key);
                }
            }
        }
    }
    await fs.promises.writeFile('content.json', JSON.stringify({"content":Content.content}, null, 2), 'utf8');
        let result="";
        Content.content.forEach(elem=>{
            result+=`#set($${Object.keys(elem)[0]} = ${Object.values(elem)[0]})>
`;
        });
        result+=`
<${Name[0]}>
`;
        Form.fields.forEach(elem=>{
            result+=`   <${elem.label}>$${elem.id}</${elem.label}>
`;
        });
        result+=`</${Name[0]}>`;
        event.sender.send('template-generated', result);
    } catch (error) {
        console.error("Ошибка генерации шаблона:", error);
        event.sender.send('generation-error', { message: 'Ошибка при генерации шаблона', error: error.message });
    }
});
ipcMain.on('setInputs', async (event) => {
    const [Form, Name, Content] = await Promise.all([loadForm(), loadName(), loadContent()]);
    event.sender.send('getInputs', Form)
})