const { ipcRenderer } = require('electron');
// Кнопки
const generateTemplateBtn = document.getElementById('generateTemplateBtn');
// Text Area
const templateCodeTextarea = document.getElementById('templateCode');
// 
const ContainerInput = document.getElementById('ContainerInput');
ipcRenderer.send('setInputs');
ipcRenderer.on('getInputs', (event, template) => {
    template.fields.forEach((elem,key)=>{
        let lable=document.createElement("lable");
        lable.setAttribute("for",elem.label);
        lable.textContent=elem.label;
        let input=document.createElement("input");
        input.id=elem.label;
        input.name=elem.id;
        ContainerInput.appendChild(lable);
        ContainerInput.appendChild(input);
    });
});

generateTemplateBtn.addEventListener('click', () => {
    let check=true;
     ContainerInput.querySelectorAll("input").forEach((elem)=>{
        if(!elem.value){
            check =false;
        }
    });
    if(check) {
        let arr=Array.from(ContainerInput.querySelectorAll("input")).map(elem=>{
            return {value:elem.value,
                name:elem.name
            }
        });
        ipcRenderer.send('generate-template',arr);
    }
    else{
        console.log("f");
    }
});

ipcRenderer.on('template-generated', (event, template) => {
    console.log('Template generated:', template);
    templateCodeTextarea.value = template;
});

ipcRenderer.on('file-load-error', (event, error) => {
    alert(`Ошибка загрузки файла: ${error.message}`);
});

ipcRenderer.on('generation-error', (event, error) => {
    alert(`Ошибка генерации шаблона: ${error.message}`);
});