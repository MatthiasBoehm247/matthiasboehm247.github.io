import {WORKSPACE_KEY,PROJECT_LIMIT,emptyWorkspace,parseWorkspace,routeOK,readProjectFile,serializeProject,
  validateSnapshot,snapshotSignature,createSnapshotTracker,saveSnapshot,createWorkspaceStore,storageWriteError} from './workspace-store.mjs';
import {backupSummary,serializeBackup,readBackupFile,mergeBackup,projectFilename,projectFingerprint} from './workspace-transfer.mjs';
import {renameProject,duplicateProject,removeProject,removeProjectSnapshot,restoreRemoved,selectProjects} from './workspace-projects.mjs';
import {persistProjectSelection,restoreProjectSelection,projectLink,projectFromFragment,
  captureWorkspaceFocus,restoreWorkspaceFocus} from './workspace-session.mjs';

// Local preferences and explicitly saved snapshots. Form inputs are never autosaved.
const $=(selector,parent=document)=>parent.querySelector(selector);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;};
let storage,sessionStorage;
try { storage=window.localStorage; } catch {}
try { sessionStorage=window.sessionStorage; } catch {}
const store=createWorkspaceStore({storage,locks:globalThis.navigator?.locks});
let state=emptyWorkspace(),storageError='',workspacePresent=false,workspaceGeneration=null,mutationEpoch=0;
let resetDashboardTransient=()=>{};
function invalidatePendingActions(){mutationEpoch++;resetDashboardTransient();}
function readWorkspace(){
  const raw=store.raw();
  if(raw===null&&workspacePresent){workspacePresent=false;invalidatePendingActions();}
  workspacePresent=raw!==null;
  const current=parseWorkspace(raw),generation=current.generation??null;
  if(generation!==workspaceGeneration)invalidatePendingActions();
  workspaceGeneration=generation;return current;
}
const workspaceToken=()=>({epoch:mutationEpoch,generation:workspaceGeneration,hadData:workspacePresent});
const clearedActionError=()=>Object.assign(Error('Änderung oder Import abgebrochen: Der lokale Arbeitsbereich wurde inzwischen gelöscht, neu angelegt oder ersetzt. Bitte prüfe den aktuellen Stand und starte die gewünschte Aktion erneut.'),{name:'WorkspaceClearedError'});
try { state=readWorkspace(); } catch(error) { storageError=error.message; }
const restoredSelection=restoreProjectSelection(sessionStorage,state.projects,state.active);
let activeProjectId=restoredSelection.id,selectionPersistent=restoredSelection.persistent;
const root=document.documentElement,tool=$('[data-tool]'),title=$('h1')?.textContent||document.title;
let route='';
try { route=new URL($('link[rel=canonical]').href).pathname; } catch {}
const isTool=Boolean(tool&&routeOK(route));
const status=element('span','','workspace-status');
status.setAttribute('role','status');status.setAttribute('aria-live','polite');
const report=text=>{status.textContent=text;};
// Browsers may deny Web Locks before a write reaches localStorage. Present the
// same actionable message as a storage access denial instead of a raw DOM error.
const workspaceError=error=>['SecurityError','NotAllowedError'].includes(error?.name)?storageWriteError(error):error;
const link=(url,name)=>{const node=element('a',name);node.href=url;return node;};
const action=(label,fn)=>{
  const button=element('button',label,'secondary');button.type='button';
  let pending=false;
  button.addEventListener('click',async()=>{
    if(pending)return;
    pending=true;button.setAttribute('aria-disabled','true');button.setAttribute('aria-busy','true');
    try { await fn(); } catch(error) { report(workspaceError(error).message||'Aktion fehlgeschlagen.'); }
    finally { pending=false;button.removeAttribute('aria-disabled');button.removeAttribute('aria-busy'); }
  });
  return button;
};
const focusItem=(node,group,...identity)=>{node.dataset.workspaceGroup=group;node.dataset.workspaceFocus=JSON.stringify([group,...identity]);return node;};
const getActive=()=>state.projects.find(project=>project.id===activeProjectId);
const freshId=()=>globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);
const expectedSnapshots=createSnapshotTracker();
const rememberSnapshot=(accepted=false)=>{
  if(isTool&&activeProjectId)expectedSnapshots[accepted?'accept':'select'](activeProjectId,getActive()?.snapshots.find(s=>s.tool===tool.dataset.tool));
};
const selectionHint=()=>selectionPersistent?'':' Die Projektauswahl gilt nur für diese Seite, weil der Tabspeicher nicht verfügbar ist.';
function setActiveProject(id) {
  if(id&&!state.projects.some(project=>project.id===id))throw Error('Projekt nicht mehr vorhanden.');
  activeProjectId=id;selectionPersistent=persistProjectSelection(sessionStorage,id);
}
function chooseProject(id) {
  state=readWorkspace();storageError='';setActiveProject(id);rememberSnapshot();synchronize();
  report((id?'Projekt „'+getActive().name+'“ für diesen Tab gewählt.':'Kein Projekt gewählt.')+selectionHint());
}
let themeButton,favoriteButton,picker,stored,projectFold,transferFrom,transferField,remember,list,favorites,recents,preferenceStatus;
let renderDashboard=()=>{};

function refreshTool() {
  if(!isTool||!picker)return;
  const placeholder=element('option','Projekt wählen');placeholder.value='';picker.replaceChildren(placeholder);
  for(const project of state.projects){const option=element('option',project.name);option.value=project.id;picker.append(option);}
  picker.value=activeProjectId;
  const snapshot=getActive()?.snapshots.find(item=>item.tool===tool.dataset.tool);
  const changed=expectedSnapshots.changed(activeProjectId,snapshot);
  stored.textContent=changed?'Dieser Stand wurde in einem anderen Tab geändert. Zum Bearbeiten zuerst laden.':snapshot?'Gespeicherter Stand vorhanden.':'Noch kein Stand für dieses Werkzeug.';
  if(transferFrom){const choice=element('option','Ergebnis wählen');choice.value='';const previous=transferFrom.value;transferFrom.replaceChildren(choice);
    for(const item of getActive()?.snapshots||[]){if(!item.result)continue;const option=element('option',item.title);option.value=item.tool;transferFrom.append(option);}
    if([...transferFrom.options].some(option=>option.value===previous))transferFrom.value=previous;
  }
}

function synchronize() {
  if(activeProjectId&&!state.projects.some(project=>project.id===activeProjectId))setActiveProject('');
  root.dataset.theme=state.theme;
  if(themeButton)themeButton.textContent=state.theme==='dark'?'Hell':'Dunkel';
  if(favoriteButton){const saved=state.favorites.includes(route);favoriteButton.textContent=saved?'★ Favorit':'☆ Merken';favoriteButton.setAttribute('aria-pressed',String(saved));}
  if(remember)remember.checked=state.track;
  if(preferenceStatus)preferenceStatus.textContent=storageError||'Daten verbleiben im Browser. Speichere keine vertraulichen Informationen.';
  refreshTool();renderDashboard();
}

async function changeWorkspace(change,token=workspaceToken()) {
  try { const saved=await store.mutate(latest=>{
    if(token.epoch!==mutationEpoch)throw clearedActionError();
    // The storage event may be delayed. Check for a removed key inside the
    // lock before an earlier operation can recreate projects or preferences.
    if((token.hadData&&store.raw()===null)||(latest.generation??null)!==token.generation){invalidatePendingActions();throw clearedActionError();}
    return change(latest);
  });state=saved;workspacePresent=true;workspaceGeneration=saved.generation??null;storageError='';synchronize();return saved; }
  catch(error){
    try {state=readWorkspace();storageError='';synchronize();}catch(readError){storageError=readError.message;if(preferenceStatus)preferenceStatus.textContent=storageError;}
    throw workspaceError(error);
  }
}

function downloadJSON(data,name) {
  let url,anchor;
  try {
    const text=typeof data==='string'?data:JSON.stringify(data,null,2);
    url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
    anchor=element('a');anchor.href=url;anchor.download=name;anchor.hidden=true;document.body.append(anchor);anchor.click();
  } finally { anchor?.remove();if(url)setTimeout(()=>URL.revokeObjectURL(url),1500); }
}

const header=$('.brand-row');
if(header){
  const controls=element('div',null,'labs-header-actions');
  themeButton=action(state.theme==='dark'?'Hell':'Dunkel',async()=>{
    const next=root.dataset.theme==='dark'?'light':'dark';
    try { await changeWorkspace(latest=>({...latest,theme:next}));report('Farbschema gespeichert.'); }
    catch(error){if(error.name==='WorkspaceClearedError'){report(error.message);return;}state.theme=next;root.dataset.theme=next;themeButton.textContent=next==='dark'?'Hell':'Dunkel';report('Farbschema nur für diese Seite geändert. '+error.message);}
  });
  themeButton.setAttribute('aria-label','Farbschema wechseln');
  controls.append(link('/suche/','Suche'),link('/arbeitsbereich/','Arbeitsbereich'),themeButton);header.append(controls,status);
}

if(isTool){
  const form=$('#tool-form'),toolbar=element('section',null,'workspace-toolbar');
  toolbar.setAttribute('aria-label','Lokale Werkzeugeinstellungen');
  favoriteButton=action('☆ Merken',async()=>{
    await changeWorkspace(latest=>({...latest,favorites:latest.favorites.includes(route)?latest.favorites.filter(item=>item!==route):[...latest.favorites,route]}));
    report(state.favorites.includes(route)?'In Favoriten gespeichert.':'Aus Favoriten entfernt.');
  });
  const fold=element('details',null,'project-fold'),panel=element('div',null,'workspace-panel');
  projectFold=fold;
  fold.append(element('summary','Mit Projekt arbeiten'));
  panel.append(element('p','Formulardaten werden ausschließlich durch „Stand speichern“ abgelegt. Dateien selbst werden nicht gespeichert. Export und Löschen im Arbeitsbereich.','small muted'));
  picker=element('select');picker.id='labs-project-select';
  const label=element('label','Aktives Projekt in diesem Tab');label.htmlFor=picker.id;panel.append(label,picker);
  picker.addEventListener('change',()=>{
    try {chooseProject(picker.value);}
    catch(error){report(error.message);refreshTool();}
  });
  stored=element('p','','small muted');panel.append(stored);
  const snapshotFromForm=()=>{
    const values={};
    for(const control of form.elements){
      if(!control.name||['file','submit','button','reset'].includes(control.type))continue;
      values[control.name]=control.value;
    }
    return validateSnapshot({tool:tool.dataset.tool,route,title:title.slice(0,200),updated:new Date().toISOString(),values,result:$('#download-result')?.disabled?'':$('#result-output').value});
  };
  const row=element('div',null,'controls');
  row.append(action('Stand speichern',async()=>{
    const projectId=activeProjectId;
    if(!projectId)throw Error('Lege zuerst im Arbeitsbereich ein Projekt an oder wähle ein vorhandenes Projekt.');
    const snapshot=snapshotFromForm();
    const expected=expectedSnapshots.expected(projectId);
    await changeWorkspace(latest=>saveSnapshot(latest,projectId,snapshot,expected));
    // Accept precisely our saved revision; a later storage event must still conflict.
    expectedSnapshots.accept(projectId,snapshot);refreshTool();report('Stand gespeichert.');
  }),action('Stand laden',()=>{
    state=readWorkspace();storageError='';synchronize();const snapshot=getActive()?.snapshots.find(item=>item.tool===tool.dataset.tool);
    if(!snapshot)throw Error('Für dieses Werkzeug ist kein Stand gespeichert.');
    // A snapshot replaces the form: omitted/retired fields use defaults and
    // files from another task must never be combined with the loaded values.
    form.reset();
    for(const [key,value] of Object.entries(snapshot.values)){
      const control=form.elements.namedItem(key);
      if(!control||control.type==='file'||control.tagName==='BUTTON')continue;
      if(control.tagName==='SELECT'&&![...control.options].some(option=>option.value===value))continue;
      control.value=value;
    }
    form.dispatchEvent(new Event('input',{bubbles:true}));
    const restored={result:snapshot.result,restored:false};
    if(tool.dataset.tool==='T087'&&snapshot.result)form.dispatchEvent(new CustomEvent('labs:restore-snapshot',{detail:restored}));
    const hasFiles=[...form.elements].some(control=>control.type==='file');
    const message=restored.restored?'Projektstand geladen. Bearbeitetes Raster wiederhergestellt.':
      restored.error?restored.error+' Eingaben geladen; bitte neu berechnen.':
      hasFiles?'Projektstand geladen. Dateien bitte erneut auswählen und neu berechnen.':'Projektstand geladen – bitte neu berechnen.';
    $('#tool-status').textContent=message;
    rememberSnapshot(true);synchronize();report(message);
  }),action('Stand als Datei sichern',async()=>{
    const project={id:freshId(),name:(getActive()?.name||title).slice(0,100),snapshots:[snapshotFromForm()]};
    const serialized=serializeProject(project);
    // The emergency file must also be accepted by the normal project import.
    await readProjectFile(new Blob([serialized],{type:'application/json'}));
    downloadJSON(serialized,projectFilename(project.name));
    report('Projektdatei mit deinen aktuellen Eingaben erstellt. Sie enthält keine hochgeladenen Dateien und benötigt keinen freien Browserspeicher.');
  }));
  panel.append(row,link('/arbeitsbereich/','Projekte verwalten und exportieren'));
  const areas=[...form.querySelectorAll('textarea')];
  if(areas.length){
    const details=element('details');details.append(element('summary','Ergebnis aus anderem Werkzeug übernehmen'));
    transferFrom=element('select');transferFrom.id='labs-transfer-from';transferField=element('select');transferField.id='labs-transfer-field';
    const fromLabel=element('label','Gespeichertes Ergebnis');fromLabel.htmlFor=transferFrom.id;
    const toLabel=element('label','Ziel-Eingabefeld (wird ersetzt)');toLabel.htmlFor=transferField.id;
    for(const field of areas){const option=element('option',field.labels?.[0]?.textContent||field.name);option.value=field.name;transferField.append(option);}
    details.append(element('p','Nur passende Formate übertragen; es erfolgt keine automatische Umwandlung.','small muted'),fromLabel,transferFrom,toLabel,transferField,
      action('In Eingabefeld übernehmen',()=>{
        const chosen=transferFrom.value;state=readWorkspace();
        const snapshot=getActive()?.snapshots.find(item=>item.tool===chosen),field=areas.find(item=>item.name===transferField.value);
        if(!snapshot||!field)throw Error('Ergebnis und Zielfeld wählen.');
        field.value=snapshot.result;field.dispatchEvent(new Event('input',{bubbles:true}));
        synchronize();report('Eingabe übernommen. Format prüfen und neu berechnen.');
      }));
    panel.append(details);
  }
  fold.append(panel);toolbar.append(favoriteButton,fold,status);tool.before(toolbar);rememberSnapshot();
}

const dashboard=$('#labs-workspace');
if(dashboard){
  let workspaceEpoch=0;
  const create=element('form',null,'workspace-panel'),name=element('input');name.id='labs-project-name';name.required=true;name.maxLength=100;
  const label=element('label','Projektname');label.htmlFor=name.id;
  const submit=element('button','Projekt anlegen');submit.type='submit';create.append(label,name,submit);
  create.addEventListener('submit',async event=>{
    event.preventDefault();if(submit.disabled)return;submit.disabled=true;
    try {
      const projectName=name.value.trim();if(!projectName)throw Error('Projektname erforderlich.');
      const id=freshId(),epoch=workspaceEpoch;
      await changeWorkspace(latest=>{if(epoch!==workspaceEpoch)throw Error('Diese Aktion ist nicht mehr aktuell.');if(latest.projects.length>=PROJECT_LIMIT)throw Error('Maximal 30 Projekte.');return {...latest,projects:[...latest.projects,{id,name:projectName,snapshots:[]}]};});
      setActiveProject(id);name.value='';synchronize();report('Projekt angelegt.'+selectionHint());
    }catch(error){report(error.message);}finally{submit.disabled=false;}
  });
  list=element('div',null,'workspace-projects');favorites=element('div',null,'workspace-panel');recents=element('div',null,'workspace-panel');
  let editing=null,editGeneration=0,lastRemoval=null;
  const projectSearch=element('input');projectSearch.type='search';projectSearch.id='labs-project-search';projectSearch.maxLength=200;
  const searchLabel=element('label','Projekte und Werkzeuge suchen');searchLabel.htmlFor=projectSearch.id;
  const projectSort=element('select');projectSort.id='labs-project-sort';
  for(const [value,text] of [['created','Reihenfolge der Anlage'],['name','Projektname A–Z'],['updated','Zuletzt gespeicherter Stand']]){
    const option=element('option',text);option.value=value;projectSort.append(option);
  }
  projectSort.value='created';
  const sortLabel=element('label','Projekte sortieren');sortLabel.htmlFor=projectSort.id;
  const projectCount=element('p','','small muted');projectCount.id='labs-project-count';projectCount.setAttribute('role','status');
  const filters=element('section',null,'workspace-panel workspace-filters');filters.setAttribute('aria-label','Projekte finden');
  filters.append(searchLabel,projectSearch,sortLabel,projectSort,action('Suchauswahl zurücksetzen',()=>{
    projectSearch.value='';projectSort.value='created';renderDashboard();projectSearch.focus();
  }),projectCount);
  projectSearch.addEventListener('input',()=>renderDashboard());projectSort.addEventListener('change',()=>renderDashboard());
  const focusProject=id=>{
    const target=[...list.querySelectorAll('[data-workspace-focus]')].find(node=>node.dataset.workspaceFocus===JSON.stringify(['project:'+id,'activate']));
    (target||projectSearch).focus({preventScroll:true});
  };
  const editor=element('form',null,'workspace-panel workspace-editor');editor.hidden=true;editor.setAttribute('aria-label','Projekt umbenennen');
  const editorTitle=element('h2','Projekt umbenennen'),editName=element('input');editName.id='labs-project-rename';editName.maxLength=100;editName.required=true;
  const editLabel=element('label','Neuer Projektname');editLabel.htmlFor=editName.id;
  const editSubmit=element('button','Namen speichern');editSubmit.type='submit';
  function closeEditor(focus=true){const id=editing?.id;editGeneration++;editing=null;editor.hidden=true;editName.value='';if(focus)focusProject(id);}
  const editCancel=action('Umbenennen abbrechen',()=>{closeEditor();report('Umbenennen abgebrochen. Keine Änderung übernommen.');});
  const editControls=element('div',null,'controls');editControls.append(editSubmit,editCancel);editor.append(editorTitle,editLabel,editName,editControls);
  editor.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeEditor();report('Umbenennen abgebrochen. Keine Änderung übernommen.');}});
  editor.addEventListener('submit',async event=>{
    event.preventDefault();if(editSubmit.disabled||!editing)return;
    const accepted=editing,generation=editGeneration,nextName=editName.value;editSubmit.disabled=true;
    try{
      await changeWorkspace(latest=>{
        if(generation!==editGeneration||accepted!==editing)throw Error('Das Umbenennen wurde abgebrochen. Keine Änderung übernommen.');
        return renameProject(latest,accepted.id,nextName,accepted.name);
      });
      closeEditor();report('Projekt umbenannt. Gespeicherte Werkzeugstände bleiben erhalten.');
    }catch(error){report(error.message);}finally{editSubmit.disabled=false;}
  });
  const undoPanel=element('section',null,'workspace-panel workspace-undo');undoPanel.hidden=true;undoPanel.setAttribute('aria-label','Letzte Entfernung rückgängig machen');
  const undoText=element('p');
  const undoButton=focusItem(action('Entfernen rückgängig machen',async()=>{
    const pending=lastRemoval,epoch=workspaceEpoch;if(!pending)throw Error('Keine Entfernung zum Rückgängigmachen vorhanden.');
    await changeWorkspace(latest=>{
      if(epoch!==workspaceEpoch||pending!==lastRemoval)throw Error('Diese Rückgängig-Aktion ist nicht mehr aktuell.');
      // A storage event may arrive after this click. Check the actual key inside
      // the lock as well, so clear-all cannot be undone by a stale tab.
      if(store.raw()===null){resetDashboardTransient();throw Error('Die lokalen Daten wurden inzwischen gelöscht. Die frühere Rückgängig-Aktion wurde verworfen.');}
      return restoreRemoved(latest,pending.record);
    });
    lastRemoval=null;
    const id=pending.record.kind==='project'?pending.record.project.id:pending.record.projectId;
    if(pending.wasActive&&!activeProjectId)setActiveProject(id);
    synchronize();focusProject(id);report('Entfernung rückgängig gemacht. Zwischenzeitliche andere Änderungen bleiben erhalten.');
  }),'undo','restore');
  undoPanel.append(undoText,undoButton,element('p','Die letzte Entfernung lässt sich in diesem Tab bis zum Neuladen rückgängig machen. Eine weitere Entfernung ersetzt diese Möglichkeit.','small muted'));
  const preferences=element('div',null,'workspace-panel');preferenceStatus=element('p','','small muted');
  remember=element('input');remember.type='checkbox';remember.id='labs-recent-optin';remember.checked=state.track;
  const rememberLabel=element('label','Zuletzt verwendete Tools lokal speichern');rememberLabel.htmlFor=remember.id;
  remember.addEventListener('change',async()=>{
    const enabled=remember.checked;remember.disabled=true;
    try {await changeWorkspace(latest=>({...latest,track:enabled,recent:enabled?latest.recent:[]}));report(enabled?'Verlauf aktiviert.':'Verlauf deaktiviert und geleert.');}
    catch(error){remember.checked=state.track;report(error.message);}finally{remember.disabled=false;}
  });
  const input=element('input');input.type='file';input.accept='application/json,.json';input.id='labs-project-import';
  const importLabel=element('label','Projektdatei importieren');importLabel.htmlFor=input.id;
  input.addEventListener('change',async()=>{
    const file=input.files[0];if(!file)return;const epoch=workspaceEpoch,mutation=workspaceToken();input.disabled=true;
    try {
      const project=await readProjectFile(file);project.id=freshId();
      await changeWorkspace(latest=>{if(epoch!==workspaceEpoch)throw Error('Dieser Import wurde durch das Löschen der lokalen Daten abgebrochen.');if(latest.projects.length>=PROJECT_LIMIT)throw Error('Maximal 30 Projekte.');return {...latest,projects:[...latest.projects,project]};},mutation);
      setActiveProject(project.id);synchronize();report('Projekt als Kopie importiert.'+selectionHint());
    }catch(error){report(error instanceof SyntaxError?'Die Projektdatei enthält kein gültiges JSON.':error.message);}
    finally{input.value='';input.disabled=false;}
  });
  const usage=element('section',null,'workspace-panel');usage.setAttribute('aria-label','Lokaler Speicher');
  const usageText=element('p','','small'),usageMeter=element('meter');usageMeter.min=0;usageMeter.max=2000000;
  usageMeter.setAttribute('aria-label','Belegung des Digital-Labs-Projektlimits');
  usage.append(element('h2','Sicherungen und Speicher'),usageText,usageMeter,
    element('p','Das Projektlimit ist eine Schutzgrenze der Anwendung. Der Browser kann das Speichern schon früher begrenzen. Eine heruntergeladene Sicherung bleibt davon unabhängig.','small muted'));
  const backupInput=element('input');backupInput.type='file';backupInput.accept='application/json,.json';backupInput.id='labs-backup-import';
  const backupLabel=element('label','Gesamtsicherung einlesen');backupLabel.htmlFor=backupInput.id;
  const backupPreview=element('div',null,'backup-preview');backupPreview.hidden=true;
  let pendingBackup=null,backupChoices=[],restoreSettings,backupGeneration=0;
  function showBackupPreview(backup){
    pendingBackup=backup;backupGeneration++;backupChoices=[];backupPreview.replaceChildren();backupPreview.hidden=false;
    const summary=backupSummary(backup.workspace);
    backupPreview.append(element('h3','Sicherung prüfen'),element('p',`${summary.projects} Projekte · ${summary.snapshots} Werkzeugstände · ${summary.favorites} Favoriten`),
      element('p',backup.legacy?'Bisherige Speicherdatei erkannt. Die Projekte können als Kopien übernommen werden.':'Die Datei wurde eingelesen. Noch wurden keine lokalen Daten geändert.','small muted'));
    const choices=element('fieldset');choices.append(element('legend','Projekte als Kopien hinzufügen'));
    backup.workspace.projects.forEach((project,index)=>{
      const line=element('div',null,'backup-choice'),choice=element('input');choice.type='checkbox';choice.id='labs-backup-project-'+index;choice.checked=true;choice.value=project.id;
      const label=element('label',`${project.name} (${project.snapshots.length} Stände)`);label.htmlFor=choice.id;line.append(choice,label);choices.append(line);backupChoices.push(choice);
    });
    if(!backup.workspace.projects.length)choices.append(element('p','Keine Projekte in dieser Sicherung.','small muted'));
    restoreSettings=element('input');restoreSettings.type='checkbox';restoreSettings.id='labs-backup-settings';
    const settingsLabel=element('label','Favoriten, Farbschema und Verlaufseinstellung aus der Sicherung übernehmen');settingsLabel.htmlFor=restoreSettings.id;
    const settingsLine=element('div',null,'backup-choice');settingsLine.append(restoreSettings,settingsLabel);
    backupPreview.append(choices,settingsLine,element('p','Bestehende Projekte bleiben erhalten. Identische Projektkopien werden übersprungen. Einstellungen werden nur bei gesetztem Haken ersetzt; ein aktivierter Verlauf wird dann ebenfalls übernommen.','small muted'),
      action('Auswahl importieren',async()=>{
        const backup=pendingBackup,generation=backupGeneration;if(!backup)throw Error('Bitte zuerst eine Sicherung einlesen.');
        const selectedIds=backupChoices.filter(input=>input.checked).map(input=>input.value),restorePreferences=restoreSettings.checked;let result;
        await changeWorkspace(latest=>{if(generation!==backupGeneration||pendingBackup!==backup)throw Error('Dieser Import wurde abgebrochen oder durch eine neue Datei ersetzt. Keine Daten daraus übernommen.');result=mergeBackup(latest,backup,{selectedIds,restorePreferences,idFactory:freshId});return result.state;});
        report(`${result.added} Projekte hinzugefügt; ${result.skipped} identische Projekte übersprungen.`+(restorePreferences?' Einstellungen übernommen.':' Vorhandene Einstellungen erhalten.'));
        pendingBackup=null;backupPreview.hidden=true;backupPreview.replaceChildren();backupInput.focus();
      }),action('Import abbrechen',()=>{backupGeneration++;pendingBackup=null;backupPreview.hidden=true;backupPreview.replaceChildren();backupInput.focus();report('Import abgebrochen. Keine Daten geändert.');}));
  }
  backupInput.addEventListener('change',async()=>{
    const file=backupInput.files[0];if(!file)return;const generation=++backupGeneration;backupInput.disabled=true;pendingBackup=null;backupPreview.hidden=true;
    try {const backup=await readBackupFile(file);if(generation!==backupGeneration)return;showBackupPreview(backup);report('Sicherung eingelesen. Wähle die gewünschten Projekte aus.');}
    catch(error){backupPreview.replaceChildren();report(error instanceof SyntaxError?'Die Sicherungsdatei enthält kein gültiges JSON.':error.message);}
    finally{backupInput.value='';backupInput.disabled=false;}
  });
  usage.append(action('Alles als Sicherung exportieren',()=>{
    const current=readWorkspace();downloadJSON(serializeBackup(current),'digital-labs-gesamtsicherung.json');report('Gesamtsicherung erstellt. Sie enthält Projekte, Favoriten und Einstellungen; bewahre sie an einem sicheren Ort auf.');
  }),backupLabel,backupInput,backupPreview);
  resetDashboardTransient=()=>{
    const hiddenFocus=[editor,undoPanel,backupPreview].some(panel=>panel.contains(document.activeElement));
    workspaceEpoch++;lastRemoval=null;closeEditor(false);backupGeneration++;pendingBackup=null;backupPreview.hidden=true;backupPreview.replaceChildren();
    if(hiddenFocus)name.focus({preventScroll:true});
  };
  preferences.append(preferenceStatus,remember,rememberLabel,importLabel,input,
    action('Speicherdatei sichern',()=>{const raw=store.raw();if(raw===null)throw Error('Keine lokale Speicherdatei vorhanden.');downloadJSON(raw,'digital-labs-speicher-sicherung.json');report('Sicherung angestoßen. Eine lesbare Speicherdatei kannst du unter „Gesamtsicherung einlesen“ wiederherstellen.');}),
    action('Alle lokalen Daten löschen',async()=>{if(!confirm('Alle Digital-Labs-Projekte, Favoriten und Einstellungen löschen? Diese vollständige Löschung hat keine Rückgängig-Funktion.'))return;mutationEpoch++;state=await store.clear();workspacePresent=false;workspaceGeneration=null;resetDashboardTransient();storageError='';setActiveProject('');synchronize();report('Lokale Daten gelöscht.');}));

  renderDashboard=()=>{
    const summary=backupSummary(state);usageMeter.value=summary.units;usageMeter.hidden=Boolean(storageError);usageText.textContent=storageError?'Der gespeicherte Stand ist nicht lesbar. Sichere die Rohdatei, bevor du Daten entfernst.':`${summary.percent>0&&summary.percent<.1?'Unter 0,1':summary.percent.toLocaleString('de-DE',{maximumFractionDigits:1})} % des Projektlimits · ${summary.projects} von 30 Projekten · ${summary.snapshots} Werkzeugstände`;
    const previousFocus=captureWorkspaceFocus(dashboard,document.activeElement);
    const selected=selectProjects(state.projects,{query:projectSearch.value,sort:projectSort.value});
    projectCount.textContent=`${selected.length} von ${state.projects.length} Projekten`;
    undoPanel.hidden=!lastRemoval;
    if(lastRemoval)undoText.textContent=lastRemoval.record.kind==='project'?`Projekt „${lastRemoval.record.project.name}“ entfernt.`:`Werkzeugstand „${lastRemoval.record.snapshot.title}“ entfernt.`;
    list.replaceChildren(element('h2','Projekte'));
    if(!state.projects.length)list.append(element('p','Noch keine Projekte. Lege ein Projekt an und speichere anschließend Stände auf den Werkzeugseiten.'));
    else if(!selected.length)list.append(element('p','Keine passenden Projekte. Suche nach dem Projektnamen oder einem gespeicherten Werkzeug, oder setze die Suchauswahl zurück.'));
    for(const project of selected){
      const article=element('article',null,'workspace-project'),row=element('div',null,'controls');
      article.append(element('h3',project.name+(project.id===activeProjectId?' · aktiv':'')),element('p',`${project.snapshots.length} gespeicherte Werkzeugstände`,'small muted'));
      const group='project:'+project.id;
      row.append(focusItem(action('Aktivieren',()=>chooseProject(project.id)),group,'activate'),focusItem(action('Exportieren',()=>{
        const current=readWorkspace().projects.find(item=>item.id===project.id);if(!current)throw Error('Projekt nicht mehr vorhanden.');
        downloadJSON(serializeProject(current),projectFilename(current.name));report('Projektexport angestoßen.');
      }),group,'export'),focusItem(action('Umbenennen',()=>{
        const current=readWorkspace().projects.find(item=>item.id===project.id);if(!current)throw Error('Projekt nicht mehr vorhanden.');
        editGeneration++;editing={id:current.id,name:current.name};editName.value=current.name;editorTitle.textContent='Projekt umbenennen';editor.hidden=false;editName.focus();
        report('Ändere den Projektnamen und speichere ausdrücklich.');
      }),group,'rename'),focusItem(action('Duplizieren',async()=>{
        const epoch=workspaceEpoch;let copy;
        await changeWorkspace(latest=>{if(epoch!==workspaceEpoch)throw Error('Diese Aktion ist nicht mehr aktuell.');const result=duplicateProject(latest,project.id,freshId());copy=result.project;return result.state;});
        setActiveProject(copy.id);synchronize();focusProject(copy.id);report('Projektkopie „'+copy.name+'“ angelegt und für diesen Tab aktiviert.'+selectionHint());
      }),group,'duplicate'),focusItem(action('Entfernen',async()=>{
        const expected=projectFingerprint(project),epoch=workspaceEpoch,wasActive=activeProjectId===project.id;let removed;
        if(!confirm('Projekt „'+project.name+'“ mit '+project.snapshots.length+' Werkzeugständen lokal entfernen?'))return;
        await changeWorkspace(latest=>{if(epoch!==workspaceEpoch)throw Error('Diese Aktion ist nicht mehr aktuell.');removed=removeProject(latest,project.id,expected);return removed.state;});
        lastRemoval={record:removed.undo,wasActive};if(editing?.id===project.id)closeEditor(false);renderDashboard();undoButton.focus();
        report('Projekt entfernt. Du kannst diese Entfernung hier rückgängig machen.');
      }),group,'remove'));
      article.append(row);const ul=element('ul');
      for(const snapshot of project.snapshots){
        const item=element('li');item.append(focusItem(link(projectLink(snapshot.route,project.id),snapshot.title),group,'snapshot',snapshot.tool,'open'),element('span',' · '+snapshot.updated.slice(0,10),'small muted'),focusItem(action('Stand löschen',async()=>{
          const expected=snapshotSignature(snapshot),epoch=workspaceEpoch;let removed;
          if(!confirm('Werkzeugstand „'+snapshot.title+'“ aus diesem Projekt entfernen?'))return;
          await changeWorkspace(latest=>{if(epoch!==workspaceEpoch)throw Error('Diese Aktion ist nicht mehr aktuell.');removed=removeProjectSnapshot(latest,project.id,snapshot.tool,expected);return removed.state;});
          lastRemoval={record:removed.undo,wasActive:false};renderDashboard();undoButton.focus();report('Werkzeugstand entfernt. Du kannst diese Entfernung hier rückgängig machen.');
        }),group,'snapshot',snapshot.tool,'remove'));ul.append(item);
      }
      article.append(ul);list.append(article);
    }
    for(const [container,heading,rows] of [[favorites,'Favoriten',state.favorites],[recents,'Zuletzt verwendet',state.recent]]){
      container.replaceChildren(element('h2',heading));
      if(!rows.length)container.append(element('p','Keine Einträge.','muted'));
      else {
        const ul=element('ul');
        for(const route of rows){const group=container===favorites?'favorites':'recent',item=element('li');item.append(focusItem(link(route,route.split('/').filter(Boolean).at(-1).replace(/-/g,' ')),group,route,'open'));
          if(container===favorites)item.append(focusItem(action('Entfernen',async()=>{await changeWorkspace(latest=>({...latest,favorites:latest.favorites.filter(saved=>saved!==route)}));report('Favorit entfernt.');}),group,route,'remove'));
          ul.append(item);
        }
        container.append(ul);
      }
    }
    restoreWorkspaceFocus(dashboard,previousFocus,name);
  };
  dashboard.replaceChildren(create,filters,editor,undoPanel,list,usage,favorites,recents,preferences,status);
}

window.addEventListener('storage',event=>{
  if(event.storageArea&&event.storageArea!==storage)return;
  if(event.key!==WORKSPACE_KEY&&event.key!==null)return;
  const cleared=event.key===null||event.newValue===null;
  if(cleared){workspacePresent=false;invalidatePendingActions();}
  try {state=readWorkspace();storageError='';synchronize();report(cleared?'Lokale Daten wurden in einem anderen Tab gelöscht. '+(isTool?'Deine ungespeicherten Werkzeugeingaben bleiben erhalten.':'Offene Umbenennungen, Importvorschauen und Rückgängig-Aktionen wurden verworfen.'):'Lokale Daten aus einem anderen Tab aktualisiert. Deine Formulareingaben bleiben unverändert.');}
  catch(error){storageError=error.message;if(preferenceStatus)preferenceStatus.textContent=storageError;report(storageError);}
});
function consumeProjectFragment() {
  const selection=projectFromFragment(window.location.hash,state.projects);
  if(!selection.requested)return;
  setActiveProject(selection.id);rememberSnapshot();
  // Consumed once: a later reload must honor a choice made with the picker.
  try {window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);} catch {}
  if(projectFold)projectFold.open=true;
  synchronize();
  report((selection.error||'Verknüpftes Projekt „'+getActive().name+'“ für diesen Tab gewählt. Den gespeicherten Stand kannst du mit „Stand laden“ übernehmen.')+selectionHint());
}
window.addEventListener('hashchange',()=>{
  if(!projectFromFragment(window.location.hash,state.projects).requested)return;
  try {state=readWorkspace();storageError='';consumeProjectFragment();}
  catch(error){setActiveProject('');synchronize();report(error.message);}
});
synchronize();
consumeProjectFragment();
if(storageError)report(storageError);
if(isTool&&state.track)changeWorkspace(latest=>latest.track?{...latest,recent:[route,...latest.recent.filter(item=>item!==route)].slice(0,12)}:latest).catch(error=>report(error.message));

const search=$('#labs-global-search');
if(search){
  const rows=[...document.querySelectorAll('[data-global-search]')],type=$('#labs-search-kind'),counter=$('#labs-global-count');
  const update=()=>{
    const words=search.value.toLocaleLowerCase('de').trim().split(/\s+/).filter(Boolean);let count=0;
    for(const row of rows){const visible=words.every(word=>row.dataset.globalSearch.toLocaleLowerCase('de').includes(word))&&(!type.value||row.dataset.kind===type.value);row.hidden=!visible;if(visible)count++;}
    counter.textContent=count+' Treffer';
  };
  search.addEventListener('input',update);type.addEventListener('change',update);update();
}
