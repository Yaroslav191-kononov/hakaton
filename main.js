const { app, BrowserWindow, ipcMain,dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const X2JS = require('x2js');
// Утилиты
const x2js = new X2JS();

// Функция генерации VM-шаблона из схем
async function generateVMFromSchemas(jsonSchema, xsdSchema, params = {}) {
    const defaultParams = {
        prefix: "soc:",
        handleNullValues: "omit",
        dateFormat: "yyyy-MM-dd",
        transformFieldNames: "pascalCase",
        generateConditionals: true,
        listElementName: "Child",
        parseJsonStrings: true
    };

    const merged = { ...defaultParams, ...params };
    const { prefix, handleNullValues, transformFieldNames, generateConditionals, listElementName } = merged;

    const { XMLParser } = require('fast-xml-parser');

    let xsdJson;
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '$',
            allowBooleanAttributes: true,
            parseAttributeValue: false,
            ignoreDeclaration: false,
            trimValues: false,
            parseTagValue: true,

        });
        xsdJson = parser.parse(xsdSchema);

    } catch (err) {
        throw new Error('Не удалось распарсить XSD как XML: ' + err.message);
    }
    function findNodeByLocalName(obj, localName, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 20) return null;
        for (const key of Object.keys(obj)) {
            const keyLower = String(key).toLowerCase();
            if (keyLower === localName || keyLower === localName.toLowerCase() || keyLower.endsWith(':' + localName.toLowerCase()) || keyLower.includes(':' + localName.toLowerCase())) {
                return obj[key];
            }
        }
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val && typeof val === 'object') {
                const found = findNodeByLocalName(val, localName, depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    const xsdRoot = findNodeByLocalName(xsdJson, 'schema');
    if (!xsdRoot) {
        console.error('fast-xml-parser top-level keys:', Object.keys(xsdJson || {}));
        throw new Error('Некорректная XSD: не найден корневой элемент <schema>. Проверьте содержимое и префиксы.');
    }

    function collectElementsFrom(node) {
        const res = [];
        if (!node || typeof node !== 'object') return res;
        for (const key of Object.keys(node)) {
            const kLower = key.toLowerCase();
            if (kLower === 'element' || kLower.endsWith(':element') || kLower.includes(':element')) {
                const v = node[key];
                if (Array.isArray(v)) res.push(...v);
                else res.push(v);
            }
        }

        if (res.length === 0) {
            for (const key of Object.keys(node)) {
                const v = node[key];
                if (v && typeof v === 'object') {
                    const deeper = collectElementsFrom(v);
                    if (deeper.length) res.push(...deeper);
                }
            }
        }
        return res;
    }

    const topElements = collectElementsFrom(xsdRoot);
    if (!topElements || topElements.length === 0) {
        console.error('Не найден top-level element в xsdRoot. xsdRoot keys:', Object.keys(xsdRoot || {}));
        throw new Error('Некорректная XSD: не найден top-level element.');
    }

    let targetElement = topElements.find(el => el.$ && !el.$.substitutionGroup) || topElements[0];
    if (!targetElement) {
        throw new Error('Не удалось определить корневой xs:element.');
    }

    const typeDefinitions = {};
    function collectComplexTypes(node) {
        if (!node || typeof node !== 'object') return;
        for (const key of Object.keys(node)) {
            const kLower = key.toLowerCase();
            if (kLower === 'complextype' || kLower.endsWith(':complextype') || kLower.includes(':complextype')) {
                const v = node[key];
                if (Array.isArray(v)) {
                    v.forEach(ct => { if (ct && ct.$ && ct.$.name) typeDefinitions[ct.$.name] = ct; });
                } else if (v && v.$ && v.$.name) {
                    typeDefinitions[v.$.name] = v;
                }
            }
        }
        for (const key of Object.keys(node)) {
            const val = node[key];
            if (val && typeof val === 'object') collectComplexTypes(val);
        }
    }
    collectComplexTypes(xsdRoot);

    function resolveComplexTypeForElement(element) {
        if (!element) return null;
        const attrs = element.$ || {};

        if (attrs.type) {
            const typeName = String(attrs.type).split(':').pop();
            if (typeDefinitions[typeName]) return typeDefinitions[typeName];
        }
        for (const key of Object.keys(element)) {
            const kLower = key.toLowerCase();
            if (kLower === 'complextype' || kLower.endsWith(':complextype') || kLower.includes(':complextype') || kLower === 'complexType'.toLowerCase()) {
                return element[key];
            }
            if ((kLower === 'sequence' || kLower.endsWith(':sequence') || kLower.includes(':sequence')) && element['$'] === undefined) {
                return element;
            }
        }
        return null;
    }

    function getTypeOfField(complexType, fieldName) {
        if (!complexType) return null;

        const containers = [];

        for (const key of Object.keys(complexType)) {
            const kLower = key.toLowerCase();
            if (kLower === 'xs:sequence' || kLower === 'sequence' || kLower.endsWith(':sequence') || kLower.includes(':sequence')) {
                containers.push(complexType[key]);
            } else if (kLower === 'xs:choice' || kLower === 'choice' || kLower.endsWith(':choice') || kLower.includes(':choice')) {
                containers.push(complexType[key]);
            } else if (kLower === 'xs:all' || kLower === 'all' || kLower.endsWith(':all') || kLower.includes(':all')) {
                containers.push(complexType[key]);
            }
        }

        const findIn = (container) => {
            if (!container || typeof container !== 'object') return null;
            for (const key of Object.keys(container)) {
                const kl = key.toLowerCase();
                if (kl === 'element' || kl.endsWith(':element') || kl.includes(':element')) {
                    const elems = container[key];
                    if (!elems) continue;
                    if (Array.isArray(elems)) {
                        const found = elems.find(e => {
                            if (!e || !e.$) return false;
                            return e.$.name === fieldName || (e.$.ref && e.$.ref.endsWith(':' + fieldName));
                        });
                        if (found) return found.$;
                    } else if (elems.$) {
                        const e = elems;
                        if (e.$.name === fieldName || (e.$.ref && e.$.ref.endsWith(':' + fieldName))) return e.$;
                    }
                }
            }
            return null;
        };

        for (const cont of containers) {
            const res = findIn(cont);
            if (res) return res;
        }

        const direct = findIn(complexType);
        if (direct) return direct;

        return null;
    }


    const toPascalCase = (str) => (str && str.length ? str.charAt(0).toUpperCase() + str.slice(1) : str);
    const toCamelCase = (str) => (str && str.length ? str.charAt(0).toLowerCase() + str.slice(1) : str);
    const identityTransform = (name) => name;  // Добавлена функция identityTransform
    const transformName = (name) => {
        if (transformFieldNames === "pascalCase") return toPascalCase(name);
        if (transformFieldNames === "camelCase") return toCamelCase(name);
        return identityTransform(name); 
    };

    const vmLines = [];

    async function generateField(parentVar, schema, complexType, indent = "") {
        let props = null;
        // Обработка $ref на корневом уровне схемы
        if (schema.$ref) {
            const refName = String(schema.$ref).split('/').pop();
            const definition = jsonSchema.definitions && jsonSchema.definitions[refName];

            if (definition) {
                schema = definition;
                console.log("Schema after $ref resolution:", schema);
            } else {
                console.warn(`Определение не найдено для $ref: ${schema.$ref}`);
                return;
            }
        }
        if (Array.isArray(schema)) {
            console.log("Schema is an array of components");
            props = {};
            schema.forEach(component => {
                if (component && typeof component === 'object') {

                    Object.assign(props, component);
                }
            });
            console.log("Props (from array of components):", props);

        } else if (schema.screens) {

            props = schema.screens;
            console.log("Props (from schema.properties):", props); 
        }
        else if (schema && schema.type === 'object' && !schema.properties && jsonSchema.definitions) {

            const keys = Object.keys(jsonSchema.definitions);
            if (keys.length > 0) {
                // Берем первое определение как корневое, если не указано иного
                const firstDefinitionKey = keys[0];
                const firstDefinition = jsonSchema.definitions[firstDefinitionKey];
                if (firstDefinition && firstDefinition.properties) {
                    props = firstDefinition.properties;
                    console.log("Props (from first definition):", props); // ADDED LOG
                }
            }
        }
        console.log("Props value", props)
        if (!props) {
            console.warn(`Свойства не найдены для схемы ${schema}`);
            return;
        }
        Object.keys(props).forEach(key => {
            const prop = props[key];
            const xmlFieldInfo = getTypeOfField(complexType, key);
            const isRequired = xmlFieldInfo && xmlFieldInfo.$ && xmlFieldInfo.$.minOccurs !== "0";
            const maxOccurs = xmlFieldInfo && xmlFieldInfo.$ && xmlFieldInfo.$.maxOccurs;
            const isList = maxOccurs === "unbounded" || (maxOccurs && !isNaN(parseInt(maxOccurs)) && parseInt(maxOccurs) > 1);
            let typeName = xmlFieldInfo && xmlFieldInfo.$ && xmlFieldInfo.$.type ? String(xmlFieldInfo.$.type).split(":").pop() : null;
            const vmName = transformName(key);
            const valueExpr = `$!{esc.xml($${parentVar}.${key})}`;

            const wrapInIf = generateConditionals && handleNullValues === "omit" && !isRequired;

            if (wrapInIf) {
                vmLines.push(`${indent}#if($!{${parentVar}.${key}})`);
                indent += "  "; 
            }
            if (isList) {
                vmLines.push(`${indent}<${prefix}${vmName}>`);
                vmLines.push(`${indent}  #foreach($item in $!{${parentVar}.${key}})`); 
                if (prop.type === "object") {
                    const innerType = typeDefinitions[typeName]; 

                    vmLines.push(`${indent}    <${listElementName}>`);
                    generateField("item", prop, innerType, indent + "    ");
                    vmLines.push(`${indent}    </${listElementName}>`);
                } else {
                    vmLines.push(`${indent}    <${listElementName}>${`$!{esc.xml($item)}`}</${listElementName}>`); // Генерируем простой элемент списка
                }

                vmLines.push(`${indent}  #end`);
                vmLines.push(`${indent}</${prefix}${vmName}>`);
            }
            // Если поле является объектом
            else if (prop.type === "object") {
                let innerType = null;
                if (typeName && typeDefinitions[typeName]) innerType = typeDefinitions[typeName];
                // Если тип не найден по имени, ищем по ссылке $ref
                if (!innerType && prop.$ref) {
                    const refName = String(prop.$ref).split('/').pop();
                    if (typeDefinitions[refName]) innerType = typeDefinitions[refName];
                }

                vmLines.push(`${indent}<${prefix}${vmName}>`);
                generateField(`${parentVar}.${key}`, prop, innerType, indent + "  "); // Рекурсивно генерируем поля для объекта
                vmLines.push(`${indent}</${prefix}${vmName}>`);
            }
            // Если поле является простым типом
            else {
                vmLines.push(`${indent}<${prefix}${vmName}>${valueExpr}</${prefix}${vmName}>`); // Генерируем простой элемент
            }

            // Если поле было обернуто в условие #if
            if (wrapInIf) {
                indent = indent.slice(0, -2); // Уменьшаем отступ
                vmLines.push(`${indent}#end`);
            }
        });
    }



    // Начало XML
    vmLines.push('<?xml version="1.0" encoding="UTF-8"?>');
    vmLines.push(`<Data xmlns:${prefix.replace(':', '')}="${prefix.replace(':', '').slice(0, -1)}">`);
    const rootComplexType = resolveComplexTypeForElement(targetElement);
    generateField("root", jsonSchema, rootComplexType);

    vmLines.push('</Data>');
    console.log(vmLines);
    return vmLines.join('\n');
}

// Electron
function createWindow() {
    const win = new BrowserWindow({
        width: 2000,
        height: 2000,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
        },
    });
    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('create-vm-template', async (event, _, data, params) => {
    try {
        const { projectName,jsonSchema, xsdSchema } = data;
        const vmCode = generateVMFromSchemas(jsonSchema, xsdSchema, params);
        const templatePath = path.join(__dirname, "template.vm");
        const tm=await fs.promises.readFile(templatePath,'utf-8');
        let date=new Date();
        console.log(date.getFullYear()+"-"+date.getMonth()+"-"+date.getDate());
        fs.writeFileSync("projects/"+projectName+"_"+date.getFullYear()+"-"+date.getMonth()+"-"+date.getDate(), tm, { flag: 'a' })
        return tm;
        return vmCode;
    } catch (err) {
        console.error('Ошибка генерации VM-шаблона:', err);
        throw new Error(`Генерация не удалась: ${err.message}`);
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
ipcMain.handle('getProject', async (event, content) => {
    let arr=[];
    fs.readdirSync("projects/").forEach(filename => {
        const filePath = path.join("projects/", filename);
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            arr.push({ name: filename, content: fileContent });
        } catch (error) {
            console.error(`Ошибка при чтении файла ${filename}:`, error);
            arr.push({name: filename, error: `Ошибка чтения: ${error.message}`});
        }
    });
    return arr;
});