import {models,evaluateModel,validateValues} from './learning-models.mjs';
import {resultHTML,scenarioCSV,scenarioPayload} from './learning-view.mjs';

const releaseVersion=document.documentElement.dataset.releaseVersion;

for(const widget of document.querySelectorAll('[data-learning-model]')) {
  const id=widget.dataset.learningModel, model=models[id];
  if(!model) continue;
  const form=widget.querySelector('[data-learning-form]'), output=widget.querySelector('[data-learning-result]'), status=widget.querySelector('[data-learning-status]');
  status.id ||= `learning-status-${id}`;
  const exportButtons=[...widget.querySelectorAll('[data-learning-export]')];
  let lastValues=null, lastResult=null;
  const setExport=enabled=>exportButtons.forEach(button=>{button.disabled=!enabled;});
  const read=()=>Object.fromEntries(model.fields.map(f=>[f.name,form.elements.namedItem(f.name).value]));
  const clearErrors=()=>model.fields.forEach(f=>{
    const input=form.elements.namedItem(f.name);
    input.removeAttribute('aria-invalid');input.removeAttribute('aria-errormessage');
    const description=(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(value=>value&&value!==status.id).join(' ');
    if(description)input.setAttribute('aria-describedby',description);else input.removeAttribute('aria-describedby');
  });
  function calculate({initial=false}={}) {
    clearErrors();
    try {
      const values=validateValues(id,read()), result=evaluateModel(id,values);
      output.innerHTML=resultHTML(result,id);
      output.removeAttribute('data-stale');
      lastValues=values;lastResult=result;setExport(true);
      status.dataset.kind='success';
      status.textContent=initial?'Beispiel berechnet. Ändere Werte und berechne dein Szenario.':'Szenario berechnet. Grafik, Kennzahlen und Tabelle sind aktualisiert.';
    } catch(error) {
      setExport(false);lastValues=null;lastResult=null;output.dataset.stale='true';
      status.dataset.kind='error';status.textContent=`${error.message} Die angezeigte Rechnung gehört zu den vorherigen Eingaben.`;
      const affected=new Set(Array.isArray(error.fields)?error.fields:[]);let first=null;
      for(const field of model.fields){
        const input=form.elements.namedItem(field.name);
        if(affected.has(field.name)||(!affected.size&&!input.validity.valid)){
          input.setAttribute('aria-invalid','true');input.setAttribute('aria-errormessage',status.id);
          input.setAttribute('aria-describedby',[...(input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean),status.id].join(' '));
          first ||= input;
        }
      }
      if(!initial)first?.focus();
    }
  }
  form.addEventListener('submit',event=>{event.preventDefault();calculate();});
  form.addEventListener('input',()=>{setExport(false);lastValues=null;lastResult=null;output.dataset.stale='true';clearErrors();status.dataset.kind='changed';status.textContent='Eingaben geändert. Die angezeigte Rechnung ist noch nicht aktualisiert. Wähle „Szenario berechnen“.';});
  widget.querySelector('[data-learning-reset]').addEventListener('click',()=>{form.reset();calculate();status.textContent='Ausgangsbeispiel wiederhergestellt und berechnet.';});
  for(const button of exportButtons) button.addEventListener('click',()=>{
    if(!lastValues||!lastResult||button.disabled)return;
    const format=button.dataset.format, json=format==='json';
    let url=null,a=null;
    try {
      const content=json?JSON.stringify(scenarioPayload(model,lastValues,lastResult,releaseVersion),null,2):scenarioCSV(model,lastValues,lastResult,releaseVersion);
      const blob=new Blob([content],{type:json?'application/json;charset=utf-8':'text/csv;charset=utf-8'});
      url=URL.createObjectURL(blob);a=document.createElement('a');
      a.href=url;a.download=`digital-labs-${id.toLowerCase()}-szenario.${format}`;a.hidden=true;document.body.append(a);a.click();
      status.dataset.kind='success';status.textContent=`${json?'JSON':'CSV'}-Export angefordert. Die Datei enthält Eingaben, Rechenweg, Grenzen und Ergebnisse.`;
    } catch(error) {status.dataset.kind='error';status.textContent='Export fehlgeschlagen. '+(error.message||'Bitte erneut versuchen.');}
    finally {a?.remove();if(url)setTimeout(()=>URL.revokeObjectURL(url),1000);}
  });
  widget.querySelector('[data-learning-controls]').hidden=false;
  widget.querySelector('[data-learning-exports]').hidden=false;
  calculate({initial:true});
}
