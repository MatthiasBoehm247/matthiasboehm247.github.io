import {PROJECT_LIMIT,SNAPSHOT_LIMIT,validateProject,validateSnapshot,snapshotSignature} from './workspace-store.mjs';
import {projectFingerprint} from './workspace-transfer.mjs';

// Project operations are applied inside the shared store's Web Lock. They read
// the latest state and never replace unrelated projects, settings or snapshots.
const findProject=(state,id)=>{
  const project=state.projects.find(item=>item.id===id);
  if(!project)throw Error('Dieses Projekt ist nicht mehr vorhanden.');
  return project;
};
const replaceProject=(state,project)=>({...state,projects:state.projects.map(item=>item.id===project.id?project:item)});
const cleanName=name=>{
  if(typeof name!=='string'||!name.trim()||name.trim().length>100)
    throw Error('Ein Projektname mit 1 bis 100 Zeichen ist erforderlich.');
  return name.trim();
};
const limitText=(text,max)=>{
  let result='';
  for(const character of text){if(result.length+character.length>max)break;result+=character;}
  return result.trimEnd();
};
const normalized=text=>String(text).normalize('NFKC').toLocaleLowerCase('de-DE');
const nameOrder=new Intl.Collator('de-DE',{numeric:true,sensitivity:'base'});

export function renameProject(state,id,name,expectedName) {
  const project=findProject(state,id),nextName=cleanName(name);
  if(project.name!==expectedName)
    throw Error('Der Projektname wurde in einem anderen Tab geändert. Schließe die Bearbeitung und öffne den aktuellen Namen erneut. Dein Entwurf bleibt hier erhalten.');
  return nextName===project.name?state:replaceProject(state,{...project,name:nextName});
}

export function duplicateProject(state,id,newId) {
  const original=findProject(state,id);
  if(state.projects.length>=PROJECT_LIMIT)throw Error('Maximal 30 Projekte. Exportiere und entferne zuerst ein nicht mehr benötigtes Projekt.');
  if(typeof newId!=='string'||!newId||newId.length>80||state.projects.some(project=>project.id===newId))
    throw Error('Keine eindeutige Projektkennung erzeugt. Bitte erneut versuchen.');
  const names=new Set(state.projects.map(project=>normalized(project.name.trim())));
  let name;
  for(let number=1;number<=PROJECT_LIMIT+1;number++){
    const suffix=number===1?' · Kopie':' · Kopie '+number;
    name=limitText(original.name,100-suffix.length)+suffix;
    if(!names.has(normalized(name)))break;
  }
  const copy=validateProject({...original,id:newId,name});
  return {state:{...state,projects:[...state.projects,copy]},project:copy};
}

export function removeProject(state,id,expectedFingerprint) {
  const project=findProject(state,id);
  if(projectFingerprint(project)!==expectedFingerprint)
    throw Error('Dieses Projekt wurde inzwischen geändert. Prüfe den aktuellen Stand und bestätige das Entfernen erneut. Es wurde nichts gelöscht.');
  return {state:{...state,projects:state.projects.filter(item=>item.id!==id),active:state.active===id?'':state.active},
    undo:{kind:'project',project:validateProject(project),index:state.projects.indexOf(project)}};
}

export function removeProjectSnapshot(state,id,tool,expectedSignature) {
  const project=findProject(state,id),snapshot=project.snapshots.find(item=>item.tool===tool);
  if(!snapshot)throw Error('Dieser Werkzeugstand ist nicht mehr vorhanden.');
  if(snapshotSignature(snapshot)!==expectedSignature)
    throw Error('Dieser Werkzeugstand wurde inzwischen geändert. Prüfe den aktuellen Stand und bestätige das Entfernen erneut. Es wurde nichts gelöscht.');
  return {state:replaceProject(state,{...project,snapshots:project.snapshots.filter(item=>item.tool!==tool)}),
    undo:{kind:'snapshot',projectId:id,snapshot:validateSnapshot(snapshot),index:project.snapshots.indexOf(snapshot)}};
}

export function restoreRemoved(state,undo) {
  if(!undo||!Number.isInteger(undo.index)||undo.index<0)throw Error('Keine Entfernung zum Rückgängigmachen vorhanden.');
  if(undo.kind==='project'){
    const project=validateProject(undo.project);
    if(state.projects.some(item=>item.id===project.id))
      throw Error('Dieses Projekt ist bereits wieder vorhanden. Es wird nicht überschrieben.');
    if(state.projects.length>=PROJECT_LIMIT)throw Error('Die Wiederherstellung würde mehr als 30 Projekte ergeben. Schaffe zuerst Platz; die Rückgängig-Funktion bleibt verfügbar.');
    const projects=[...state.projects];projects.splice(Math.min(undo.index,projects.length),0,project);
    return {...state,projects};
  }
  if(undo.kind==='snapshot'){
    const project=findProject(state,undo.projectId),snapshot=validateSnapshot(undo.snapshot);
    if(project.snapshots.some(item=>item.tool===snapshot.tool))
      throw Error('Für dieses Werkzeug ist inzwischen ein Stand vorhanden. Die Wiederherstellung überschreibt ihn nicht.');
    if(project.snapshots.length>=SNAPSHOT_LIMIT)throw Error('Das Projekt enthält bereits 80 Werkzeugstände. Schaffe zuerst Platz; die Rückgängig-Funktion bleibt verfügbar.');
    const snapshots=[...project.snapshots];snapshots.splice(Math.min(undo.index,snapshots.length),0,snapshot);
    return replaceProject(state,{...project,snapshots});
  }
  throw Error('Unbekannte Entfernung.');
}

export function selectProjects(projects,{query='',sort='created'}={}) {
  const words=normalized(query).trim().split(/\s+/).filter(Boolean);
  const selected=projects.filter(project=>{
    const text=normalized([project.name,...project.snapshots.map(snapshot=>snapshot.title)].join(' '));
    return words.every(word=>text.includes(word));
  });
  if(sort==='name')selected.sort((a,b)=>nameOrder.compare(a.name,b.name));
  if(sort==='updated'){
    const latest=project=>project.snapshots.reduce((value,snapshot)=>{
      const stamp=Date.parse(snapshot.updated);return Number.isFinite(stamp)?Math.max(value,stamp):value;
    },0);
    selected.sort((a,b)=>latest(b)-latest(a));
  }
  return selected;
}
