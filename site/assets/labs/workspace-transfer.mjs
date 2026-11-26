import {WORKSPACE_LIMIT,PROJECT_IMPORT_LIMIT,PROJECT_LIMIT,validateWorkspace,validateProject,routeOK,readUTF8File} from './workspace-store.mjs';

// Portable full backups supplement the existing single-project format. Restore
// always adds copies; it never replaces an existing project or snapshot.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isRouteList=(value,max)=>Array.isArray(value)&&value.length<=max&&value.every(routeOK)&&new Set(value).size===value.length;
function checkedWorkspace(value) {
  if(!object(value)||!['light','dark'].includes(value.theme)||typeof value.track!=='boolean'
    ||!isRouteList(value.favorites,110)||!isRouteList(value.recent,12))
    throw Error('Die Sicherung enthält ungültige Einstellungen oder Werkzeuglinks.');
  const workspace=validateWorkspace(value);
  if(JSON.stringify(workspace).length>WORKSPACE_LIMIT)
    throw Error('Die Sicherung überschreitet das Projektlimit von 2 Millionen Zeichen.');
  return workspace;
}
export function backupSummary(workspace) {
  const value=validateWorkspace(workspace),units=JSON.stringify(value).length;
  return {projects:value.projects.length,snapshots:value.projects.reduce((n,p)=>n+p.snapshots.length,0),
    favorites:value.favorites.length,units,limit:WORKSPACE_LIMIT,percent:Math.min(100,units/WORKSPACE_LIMIT*100)};
}
export function serializeBackup(workspace,exportedAt=new Date().toISOString()) {
  if(typeof exportedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(exportedAt)||!Number.isFinite(Date.parse(exportedAt)))
    throw Error('Ungültiges Sicherungsdatum.');
  const clean=checkedWorkspace(workspace);
  delete clean.generation; // Local lifecycle identity is never a portable setting.
  // Compact JSON keeps every valid workspace within the existing UTF-8 input cap.
  return JSON.stringify({format:'digital-labs-workspace',version:1,exportedAt,workspace:clean});
}
export function parseBackup(raw) {
  if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>PROJECT_IMPORT_LIMIT)
    throw Error('Die Sicherungsdatei ist zu groß.');
  const parsed=JSON.parse(raw.replace(/^\uFEFF/,''));
  if(!object(parsed))throw Error('Keine gültige Digital-Labs-Sicherung.');
  if(parsed.format==='digital-labs-project')throw Error('Dies ist eine einzelne Projektdatei. Nutze „Projektdatei importieren“.');
  const wrapped=parsed.format==='digital-labs-workspace';
  if(wrapped&&parsed.version!==1)throw Error('Diese Sicherungsversion wird noch nicht unterstützt.');
  if(!wrapped&&(parsed.format!==undefined||parsed.version!==1))throw Error('Unbekanntes Sicherungsformat.');
  const workspace=checkedWorkspace(wrapped?parsed.workspace:parsed);
  delete workspace.generation;
  return {workspace,exportedAt:wrapped&&typeof parsed.exportedAt==='string'?parsed.exportedAt:null,legacy:!wrapped};
}
export async function readBackupFile(file) {
  if(!file||!Number.isFinite(file.size)||file.size<0||file.size>PROJECT_IMPORT_LIMIT)
    throw Error('Sicherungsdatei zu groß oder nicht lesbar.');
  return parseBackup(await readUTF8File(file));
}
export function projectFingerprint(project) {
  const value=validateProject(project);
  return JSON.stringify({name:value.name,snapshots:value.snapshots.slice().sort((a,b)=>a.tool.localeCompare(b.tool)).map(snapshot=>({
    ...snapshot,values:Object.fromEntries(Object.entries(snapshot.values).sort(([a],[b])=>a.localeCompare(b)))
  }))});
}
export function mergeBackup(current,backup,{selectedIds,restorePreferences=false,idFactory=()=>crypto.randomUUID()}={}) {
  const latest=checkedWorkspace(current),incoming=checkedWorkspace(backup.workspace);
  if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length
    ||selectedIds.some(id=>!incoming.projects.some(project=>project.id===id)))throw Error('Ungültige Projektauswahl.');
  if(!selectedIds.length&&!restorePreferences)throw Error('Wähle mindestens ein Projekt oder die Einstellungen aus.');
  const selected=new Set(selectedIds),fingerprints=new Set(latest.projects.map(projectFingerprint)),ids=new Set(latest.projects.map(p=>p.id));
  const added=[];let skipped=0;
  for(const project of incoming.projects) {
    if(!selected.has(project.id))continue;
    const signature=projectFingerprint(project);
    if(fingerprints.has(signature)){skipped++;continue;}
    const id=idFactory();
    if(typeof id!=='string'||!id||id.length>80||ids.has(id))throw Error('Keine eindeutige Projektkennung erzeugt. Bitte erneut versuchen.');
    const copy=validateProject({...project,id});ids.add(id);fingerprints.add(signature);added.push(copy);
  }
  if(latest.projects.length+added.length>PROJECT_LIMIT)
    throw Error('Die Auswahl würde mehr als 30 Projekte ergeben. Importiere weniger Projekte oder exportiere und entferne zuerst nicht mehr benötigte Projekte.');
  const preferences=restorePreferences?{theme:incoming.theme,track:incoming.track,favorites:incoming.favorites,recent:incoming.recent}:{};
  const next=checkedWorkspace({...latest,...preferences,projects:[...latest.projects,...added]});
  return {state:next,added:added.length,skipped,summary:backupSummary(next)};
}
export function projectFilename(name='projekt') {
  const slug=String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'projekt';
  return 'digital-labs-'+slug+'.json';
}
