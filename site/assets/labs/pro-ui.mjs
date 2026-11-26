import {searchReport,mappingReport,geoReport,safeCSV,parseGrid,paintGrid} from './pro.mjs';
import {gridKeyTarget} from './grid-navigation.mjs';
(()=>{const host=document.querySelector('[data-tool]');if(!host)return;const form=host.querySelector('#tool-form'),status=host.querySelector('#tool-status'),output=host.querySelector('#result-output'),id=host.dataset.tool;
const mk=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};const btn=(text,fn)=>{let b=mk('button',text,'secondary');b.type='button';b.addEventListener('click',fn);return b;};const event=el=>el.dispatchEvent(new Event('input',{bubbles:true}));const fmt=n=>n===null||n===undefined?'—':Number(n).toLocaleString('de-DE',{maximumFractionDigits:2});
function label(text,control){let l=mk('label',text);l.append(control);return l;}
function section(title,desc){let p=mk('section',undefined,'pro-panel');p.append(mk('h3',title),mk('p',desc,'muted small'));return p;}
function table(headers,rows){let wrap=mk('div',undefined,'pro-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Ergebnistabelle, horizontal scrollbar');let t=mk('table',undefined,'pro-table'),thead=mk('thead'),tr=mk('tr');headers.forEach(h=>{let th=mk('th',h);th.scope='col';tr.append(th);});thead.append(tr);t.append(thead);let body=mk('tbody');rows.forEach(row=>{let r=mk('tr');row.forEach(c=>r.append(mk('td',c)));body.append(r);});t.append(body);wrap.append(t);return wrap;}
function cards(values){let grid=mk('div',undefined,'pro-metrics');values.forEach(([label,value])=>{let c=mk('div');c.append(mk('span',label),mk('strong',value));grid.append(c);});return grid;}
function csvButton(name,rows){return btn('Tabelle als CSV exportieren',()=>{let blob=new Blob([safeCSV(rows)],{type:'text/csv;charset=utf-8'});let url=URL.createObjectURL(blob),a=mk('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);});}
// File imports are opt-in, UTF-8 only, never uploaded. A read finishing after a manual edit must not overwrite it.
for(const field of form.querySelectorAll('textarea')){let box=mk('div',undefined,'pro-import'),input=mk('input'),msg=mk('span',undefined,'small muted');input.type='file';input.accept='.txt,.csv,.tsv,.json,.xml,.html,.htm,.md,.yaml,.yml,.css,.svg,.log';input.setAttribute('aria-label','Textdatei laden: '+(field.labels?.[0]?.textContent||field.name));input.hidden=true;msg.setAttribute('role','status');let generation=0;field.addEventListener('input',()=>generation++);form.addEventListener('reset',()=>generation++);input.addEventListener('change',async()=>{let f=input.files[0],token=++generation,original=field.value;if(!f)return;try{if(f.size>2000000)throw Error('Datei zu groß (maximal 2 MB).');let text=new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer());if(text.length>field.maxLength)throw Error('Text überschreitet das Eingabelimit.');if(text.includes('\u0000'))throw Error('Keine UTF-8-Textdatei.');if(token!==generation||field.value!==original){msg.textContent='Import verworfen: Eingabe wurde verändert.';return;}field.value=text;event(field);msg.textContent='Text lokal geladen.';}catch(e){msg.textContent=e.message;}finally{input.value='';}});box.append(btn('Textdatei laden',()=>input.click()),input,msg);field.after(box);}
if(['T038','T011','T014'].includes(id)){let panel=section(id==='T038'?'Analyse & Maßnahmen':id==='T011'?'Keyword-Zielseiten-Matrix':'Messmatrix nach Testfrage','Auswertung der aktuellen Eingabedaten. Änderungen erfordern eine erneute Berechnung.');let controls=mk('div',undefined,'pro-controls'),view=mk('div'),min=mk('input'),target=mk('input'),brand=mk('input'),segment=mk('select'),sort=mk('select'),filter=mk('input'),page=0;for(let [control,val,lo,hi] of [[min,100,0,1e9],[target,4,0,100]]){control.type='number';control.min=lo;control.max=hi;control.value=val;control.step='any';}brand.placeholder='Marke | Variante';filter.placeholder='Ergebnisse filtern';for(let [v,t] of [['all','Alle'],['brand','Markenbegriffe'],['nonbrand','Ohne Marke']]){let o=mk('option',t);o.value=v;segment.append(o);}for(let [v,t] of [['potential','CTR-Szenario'],['impressions','Impressionen'],['clicks','Klicks'],['observedLoss','Verlust (beide Exporte)']]){let o=mk('option',t);o.value=v;sort.append(o);}
 if(id==='T038')controls.append(label('Min. Impressionen',min),label('Ziel-CTR in % (Szenario)',target),label('Markenbegriffe, getrennt mit |',brand),label('Segment (nur Query-Daten)',segment),label('Sortierung',sort));controls.append(label('Tabelle filtern',filter));panel.append(controls,view);(host.querySelector('label[for="result-output"]')||output).before(panel);
 function render(){view.replaceChildren();if(status.dataset.kind!=='success'||!output.value){view.append(mk('p','Berechne zuerst ein aktuelles Ergebnis.','muted'));return;}try{let q=filter.value.trim().toLocaleLowerCase('de'),match=s=>String(s).toLocaleLowerCase('de').includes(q),headers,rows;
 if(id==='T038'){let data=searchReport(JSON.parse(output.value),{min:Number(min.value),target:Number(target.value),brand:brand.value,segment:segment.value,comparison:!!form.elements.baseline.value.trim()});if(min.value===''||target.value==='')throw Error('Schwellenwerte eingeben.');view.append(cards([['Klicks (Export)',fmt(data.clicks)],['Impressionen (Export)',fmt(data.impressions)],['Gewichtete CTR',data.ctr===null?'—':fmt(data.ctr)+' %'],['Zusatzklicks · Szenario',fmt(data.potential)]]));view.append(mk('p',`CTR-Ziel frei gewählt, kein Forecast. ${data.unmatched} nur in einem Export vorhandene Zeilen; diese sind keine belegten Verluste. Markenfilter nur auf Suchanfragen anwenden.`, 'small muted'));headers=['Suchanfrage / Seite','Klicks','Impressionen','CTR %','Zusatzklicks (Szenario)','Beobachteter Verlust','Nächste Prüfung'];rows=data.rows.filter(r=>match(r.query)).sort((a,b)=>(b[sort.value]??-1)-(a[sort.value]??-1)).map(r=>[r.query,r.clicks,r.impressions,r.rate===null?'—':+r.rate.toFixed(2),r.potential,r.observedLoss??'—',r.action]);}
 else if(id==='T011'){let d=mappingReport(JSON.parse(output.value).Zuordnungen);view.append(cards([['Keywords',fmt(d.keywords)],['Zielseiten',fmt(d.targets)],['Prüffälle',fmt(d.conflicts.length)],['Eingabehinweise',fmt(d.issues.length)]]));if(d.issues.length)view.append(mk('p',d.issues.slice(0,10).map(x=>`Zeile ${x.row}: ${x.message}`).join(' · '),'small'));headers=['Keyword','Ziele','Intentionen','Prüfanlass'];rows=d.conflicts.filter(r=>match(r.keyword+' '+r.targets)).map(r=>[r.keyword,r.targets,r.intents,r.reason]);view.append(mk('p','Mehrere Ziele oder Intentionen sind ein Prüfhinweis, kein Beleg für Kannibalisierung.','muted small'));let groups=d.groups.filter(r=>match(r.url+' '+r.keywords));let details=mk('details');details.append(mk('summary',`${groups.length} Zielseiten mit zugeordneten Begriffen`),table(['Zielseite','Keywords','Anzahl'],groups.slice(0,100).map(r=>[r.url,r.keywords,r.count])),csvButton('keyword-zielseiten',[['Zielseite','Keywords','Anzahl'],...groups.map(r=>[r.url,r.keywords,r.count])]));view.append(details);}
 else {let d=geoReport(form.elements.data.value,form.elements.sep?.value||',');view.append(cards([['Messungen',fmt(d.measurements)],['Testfragen',fmt(d.rows.length)],['Vollständig erfasste Fragen',fmt(d.complete)],['Ungültige Datumsangaben',fmt(d.invalidDates)]]));view.append(mk('p','Zellen: Erwähnungsanteil / Zitationsanteil (n). Nicht gemessene Kombinationen bleiben leer; unterschiedliche Stichproben sind nicht kausal vergleichbar.','muted small'));headers=['Testfrage',...d.models];rows=d.rows.filter(r=>match(r.prompt)).map(r=>[r.prompt,...r.models.map(m=>m.n?`${fmt(m.mentionRate)} % / ${fmt(m.citationRate)} % (n=${m.n})`:'—')]);}
 let max=Math.max(0,Math.ceil(rows.length/25)-1);page=Math.min(page,max);view.append(table(headers,rows.slice(page*25,page*25+25)));let nav=mk('div',undefined,'controls');let prev=btn('Zurück',()=>{page--;render();}),next=btn('Weiter',()=>{page++;render();});prev.disabled=page===0;next.disabled=page>=max;nav.append(prev,mk('span',`${rows.length} Zeilen · Seite ${page+1}/${max+1}`,'small'),next,csvButton('analyse-'+id,[headers,...rows]));view.append(nav);
 }catch(e){view.append(mk('p',e.message,'status'));}}
 controls.addEventListener('input',()=>{page=0;render();});new MutationObserver(()=>{page=0;render();}).observe(status,{attributes:true,attributeFilter:['data-kind']});render();}
if(id==='T091'){
 let panel=section('Interaktiver Rastereditor','Wähle eine Kachelart und setze sie per Klick oder Tastatur. Änderungen werden ins Eingabefeld übernommen.');
 let gridBox=mk('div',undefined,'pro-grid'),tools=mk('div',undefined,'controls'),message=mk('p',undefined,'small muted');
 message.setAttribute('role','status');
 let help=mk('p','Mit Tab zur Karte, mit Pfeiltasten zwischen Feldern wechseln. Pos1/Ende wechseln zum Anfang/Ende der Zeile; Strg+Pos1/Ende zur ersten/letzten Zelle. Enter oder Leertaste setzt die Kachel. Tab verlässt die Karte.','small muted');
 help.id='raster-navigation-help';
 gridBox.setAttribute('role','group');
 gridBox.setAttribute('aria-label','Rastereditor');
 gridBox.setAttribute('aria-describedby',help.id);
 let brush='1',history=[],field=form.elements.grid,grid,buttons=[],activeCell=0,writing=false;
 const serialize=g=>g.map(r=>r.join('')).join('\n');
 function selectCell(index,focus=false){activeCell=index;for(let [i,b] of [...gridBox.children].entries())b.tabIndex=i===activeCell?0:-1;if(focus)gridBox.children[activeCell]?.focus();}
 function replace(text){writing=true;try{field.value=text;event(field);}finally{writing=false;}}
 function write(g){replace(serialize(g));}
 function draw(){
  const hadGridFocus=gridBox.contains(document.activeElement);
  gridBox.replaceChildren();
  try{
   grid=parseGrid(field.value);
   message.textContent='';
   activeCell=Math.min(activeCell,grid.length*grid[0].length-1);
   gridBox.style.gridTemplateColumns=`repeat(${grid[0].length},minmax(44px,1fr))`;
   for(let [y,r] of grid.entries())for(let [x,c] of r.entries()){
    let index=y*grid[0].length+x;
    let b=btn(c==='S'?'S':c==='E'?'Z':c==='1'?'■':'·',()=>{
     try{let g=paintGrid(grid,x,y,brush);activeCell=index;history.push(field.value);if(history.length>100)history.shift();write(g);selectCell(index,true);message.textContent='Raster geändert.';}catch(e){message.textContent=e.message;}
    });
    b.dataset.tile=c;b.tabIndex=index===activeCell?0:-1;
    b.setAttribute('aria-label',`Zeile ${y+1}, Spalte ${x+1}: ${({'0':'frei','1':'Wand','S':'Start','E':'Ziel'})[c]}`);
    b.addEventListener('focus',()=>selectCell(index));
    b.addEventListener('keydown',e=>{
     if(e.altKey||e.metaKey||e.shiftKey)return;
     const target=gridKeyTarget(index,grid.length,grid[0].length,e.key,e.ctrlKey);
     if(target!==null){e.preventDefault();selectCell(target,true);}
    });
    gridBox.append(b);
   }
   if(hadGridFocus)selectCell(activeCell,true);
  }catch(e){message.textContent=e.message;}
 }
 for(let [v,text] of [['1','Wand'],['0','Frei'],['S','Start'],['E','Ziel']]){let b=btn(text,()=>{brush=v;buttons.forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.brush===v)));});b.dataset.brush=v;b.setAttribute('aria-pressed',String(v===brush));buttons.push(b);tools.append(b);}
 tools.append(btn('Rückgängig',()=>{if(history.length)replace(history.pop());}),btn('Wände entfernen',()=>{try{history.push(field.value);if(history.length>100)history.shift();write(parseGrid(field.value).map(r=>r.map(c=>c==='1'?'0':c)));}catch(e){message.textContent=e.message;}}));
 panel.append(tools,help,gridBox,message);field.after(panel);field.addEventListener('input',()=>{if(!writing)history=[];draw();});form.addEventListener('reset',()=>{history=[];activeCell=0;setTimeout(draw,0);});draw();
}
})();
