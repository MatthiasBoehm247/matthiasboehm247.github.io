// Explicit, serialized local persistence. Input forms themselves are never autosaved.
export const WORKSPACE_KEY = 'digital-labs.workspace.v1';
export const WORKSPACE_LIMIT = 2_000_000;
// Stored strings count UTF-16 units. UTF-8 needs up to three bytes per unit;
// one additional workspace-sized allowance covers the bounded pretty JSON wrapper.
export const PROJECT_IMPORT_LIMIT = WORKSPACE_LIMIT * 4;
export const PROJECT_LIMIT = 30;
export const SNAPSHOT_LIMIT = 80;
export const emptyWorkspace = () => ({version:1,theme:'light',track:false,favorites:[],recent:[],projects:[],active:''});
export function storageWriteError(error) {
  const name=error?.name;
  if(name==='QuotaExceededError'||name==='NS_ERROR_DOM_QUOTA_REACHED')
    return Error('Der Browserspeicher ist voll. Der bisherige Stand bleibt erhalten. Sichere Projekte als Datei und entferne anschließend gezielt nicht mehr benötigte Stände.');
  if(name==='SecurityError'||name==='NotAllowedError')
    return Error('Der Browser blockiert das lokale Speichern. Der bisherige Stand bleibt erhalten. Du kannst deine Eingaben weiterhin als Projektdatei sichern.');
  return Error('Speichern fehlgeschlagen. Der bisherige Stand bleibt erhalten. Sichere deine Eingaben als Projektdatei; der Browser hat den Schreibvorgang nicht bestätigt.');
}
export const routeOK = route => typeof route === 'string' && /^\/tools\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(route);
const text = (value,max=200) => typeof value === 'string' && value.length <= max;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateSnapshot(snapshot) {
  if (!object(snapshot) || typeof snapshot.tool !== 'string' || !/^T\d{3}$/.test(snapshot.tool)
    || !routeOK(snapshot.route) || !text(snapshot.title) || !text(snapshot.updated,40)
    || !object(snapshot.values) || Object.keys(snapshot.values).length > 80
    || !Object.entries(snapshot.values).every(([key,value]) => /^[a-zA-Z0-9_-]{1,60}$/.test(key) && text(value,500000))
    || !text(snapshot.result,500000)) throw Error('Ungültiger Werkzeugeintrag.');
  return {tool:snapshot.tool,route:snapshot.route,title:snapshot.title,updated:snapshot.updated,
    values:Object.fromEntries(Object.entries(snapshot.values)),result:snapshot.result};
}

export function validateProject(project) {
  if (!object(project) || !text(project.name,100) || !project.name.trim() || !text(project.id,80)
    || !project.id || !Array.isArray(project.snapshots) || project.snapshots.length > SNAPSHOT_LIMIT)
    throw Error('Ungültiges Projekt: Name und höchstens 80 Werkzeugstände erforderlich.');
  const snapshots = project.snapshots.map(validateSnapshot);
  if (new Set(snapshots.map(item=>item.tool)).size !== snapshots.length) throw Error('Doppelte Werkzeuge im Projekt.');
  return {id:project.id,name:project.name,snapshots};
}

export function validateWorkspace(value) {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.projects) || value.projects.length > PROJECT_LIMIT)
    throw Error('Ungültiges Speicherformat.');
  if (value.generation !== undefined && (typeof value.generation !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.generation)))
    throw Error('Ungültige Arbeitsbereichskennung.');
  const projects = value.projects.map(validateProject);
  if (new Set(projects.map(item=>item.id)).size !== projects.length) throw Error('Doppelte Projektkennungen.');
  const uniqueRoutes = (items,max) => Array.isArray(items) ? [...new Set(items.filter(routeOK))].slice(0,max) : [];
  return {version:1,theme:value.theme==='dark'?'dark':'light',track:value.track===true,
    favorites:uniqueRoutes(value.favorites,110),recent:value.track===true?uniqueRoutes(value.recent,12):[],projects,
    active:text(value.active,80)&&projects.some(item=>item.id===value.active)?value.active:'',
    ...(value.generation === undefined ? {} : {generation:value.generation})};
}

export function parseWorkspace(raw) {
  if (raw === null) return emptyWorkspace();
  try {
    if (typeof raw !== 'string' || raw.length > WORKSPACE_LIMIT) throw Error();
    return validateWorkspace(JSON.parse(raw));
  } catch {
    throw Error('Vorhandene lokale Daten sind nicht lesbar. Sie wurden nicht überschrieben. Sichere die Speicherdatei im Arbeitsbereich.');
  }
}

export const snapshotSignature = snapshot => snapshot ? JSON.stringify(validateSnapshot(snapshot)) : null;

export function createSnapshotTracker() {
  const signatures=new Map();
  return {
    select:(projectId,snapshot)=>{if(projectId&&!signatures.has(projectId))signatures.set(projectId,snapshotSignature(snapshot));},
    accept:(projectId,snapshot)=>{if(projectId)signatures.set(projectId,snapshotSignature(snapshot));},
    expected:projectId=>signatures.get(projectId)??null,
    changed:(projectId,snapshot)=>signatures.has(projectId)&&signatures.get(projectId)!==snapshotSignature(snapshot)
  };
}

export function serializeProject(project) {
  return JSON.stringify({format:'digital-labs-project',version:1,project:validateProject(project)},null,2);
}

export async function readUTF8File(file) {
  if (!file || !Number.isFinite(file.size) || file.size<0 || file.size>PROJECT_IMPORT_LIMIT)
    throw Error('Importdatei zu groß oder nicht lesbar.');
  if(typeof file.arrayBuffer!=='function')throw Error('Die Datei kann in diesem Browser nicht gelesen werden.');
  const bytes=await file.arrayBuffer();
  if(!Number.isSafeInteger(bytes?.byteLength)||bytes.byteLength>PROJECT_IMPORT_LIMIT)throw Error('Importdatei zu groß oder nicht lesbar.');
  try {return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch {throw Error('Die Datei enthält ungültiges UTF-8. Es wurden keine Zeichen ersetzt und keine Daten importiert.');}
}

export async function readProjectFile(file) {
  const raw=await readUTF8File(file);
  const parsed=JSON.parse(raw.replace(/^\uFEFF/,''));
  if(parsed?.format!=='digital-labs-project'||parsed.version!==1)throw Error('Unbekanntes Projektformat.');
  const project=validateProject(parsed.project);
  if(JSON.stringify({...emptyWorkspace(),projects:[project]}).length>WORKSPACE_LIMIT)
    throw Error('Das Projekt überschreitet das lokale Speicherlimit von 2 Millionen Zeichen.');
  return project;
}

export function saveSnapshot(state,projectId,snapshot,expectedSignature) {
  const clean = validateSnapshot(snapshot), project = state.projects.find(item=>item.id===projectId);
  if (!project) throw Error('Das gewählte Projekt wurde entfernt. Bitte ein vorhandenes Projekt wählen.');
  const previous = project.snapshots.find(item=>item.tool===clean.tool);
  if (snapshotSignature(previous) !== expectedSignature)
    throw Error('Dieser Werkzeugstand wurde in einem anderen Tab geändert. Lade den aktuellen Stand, bevor du ihn erneut speicherst.');
  if (!previous && project.snapshots.length >= SNAPSHOT_LIMIT)
    throw Error('Maximal 80 Werkzeugstände pro Projekt. Einen Stand entfernen oder ein weiteres Projekt anlegen.');
  const updated = {...project,snapshots:[...project.snapshots.filter(item=>item.tool!==clean.tool),clean]};
  return {...state,projects:state.projects.map(item=>item.id===projectId?updated:item)};
}

export function createWorkspaceStore({storage,locks}={}) {
  const getRaw = () => {
    try { if (!storage) throw Error(); return storage.getItem(WORKSPACE_KEY); }
    catch { throw Error('Lokaler Browserspeicher ist nicht verfügbar. Es wurden keine Daten geändert.'); }
  };
  const locked = async action => {
    if (!locks || typeof locks.request !== 'function')
      return Promise.reject(Error('Sicheres Speichern benötigt einen aktuellen Browser über HTTPS oder localhost. Vorhandene Projekte lassen sich weiterhin exportieren.'));
    // Keep the transaction synchronous. Carry failures out of the native
    // callback as values, then reject our awaited promise after lock release.
    // This avoids browser-internal rejected callback promises for handled errors.
    const outcome = await locks.request(WORKSPACE_KEY,{mode:'exclusive',ifAvailable:true},lock=>{
      try {
        if (!lock) throw Error('Ein anderer Tab speichert gerade. Bitte die Aktion erneut ausführen.');
        return {ok:true,value:action()};
      } catch(error) { return {ok:false,error}; }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
  return {
    read:()=>parseWorkspace(getRaw()),
    raw:getRaw,
    mutate:change=>locked(()=>{
      const before=getRaw(), latest=parseWorkspace(before), generation=latest.generation;
      const next=validateWorkspace(change(latest));
      // One identifier per newly created workspace. Keeping it in the same
      // atomic storage value avoids a separate write when clearing full storage.
      // Legacy workspaces remain unchanged until they are actually cleared.
      if(before===null)next.generation=globalThis.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2);
      else if(generation===undefined)delete next.generation;
      else next.generation=generation;
      const serialized=JSON.stringify(next);
      if (serialized.length>WORKSPACE_LIMIT) throw Error('Lokales Speicherlimit von 2 Millionen Zeichen erreicht. Projekte zuerst exportieren und anschließend gezielt entfernen.');
      if (getRaw()!==before) throw Error('Der lokale Speicher hat sich geändert. Bitte die Aktion erneut ausführen.');
      if (serialized===before) return next;
      try { storage.setItem(WORKSPACE_KEY,serialized); }
      catch(error) { throw storageWriteError(error); }
      return next;
    }),
    clear:()=>locked(()=>{
      try { if (!storage) throw Error(); storage.removeItem(WORKSPACE_KEY); }
      catch { throw Error('Lokale Daten konnten nicht gelöscht werden.'); }
      return emptyWorkspace();
    })
  };
}
