// Tab selection survives navigation without changing another tab's project.
export const PROJECT_SESSION_KEY = 'digital-labs.workspace.active.v1';
const exists = (projects,id) => typeof id === 'string' && projects.some(project=>project.id===id);

export function persistProjectSelection(storage,id) {
  try { if (!storage) return false; storage.setItem(PROJECT_SESSION_KEY,id); return true; }
  catch { return false; }
}

export function restoreProjectSelection(storage,projects,legacyActive='') {
  let saved;
  try { if (!storage) return {id:'',persistent:false}; saved=storage.getItem(PROJECT_SESSION_KEY); }
  catch { return {id:'',persistent:false}; }
  // The legacy shared preference is used once, only when this tab has no choice yet.
  const candidate=saved===null?legacyActive:saved;
  const id=exists(projects,candidate)?candidate:'';
  return {id,persistent:persistProjectSelection(storage,id)};
}

export function projectLink(route,id) {
  return route+'#'+new URLSearchParams({projekt:id}).toString();
}

export function projectFromFragment(hash,projects) {
  const parameters=new URLSearchParams(String(hash||'').replace(/^#/,''));
  if (!parameters.has('projekt')) return {requested:false,id:''};
  const ids=parameters.getAll('projekt'),id=ids[0];
  if (ids.length!==1 || !exists(projects,id)) return {requested:true,id:'',error:'Das verknüpfte Projekt ist in diesem Browser nicht vorhanden. Bitte ein vorhandenes Projekt wählen.'};
  return {requested:true,id};
}

const focusNodes = container => [...container.querySelectorAll('[data-workspace-focus]')];
export function captureWorkspaceFocus(container,activeElement) {
  const nodes=focusNodes(container),index=nodes.indexOf(activeElement);
  if (index<0) return null;
  const group=activeElement.dataset.workspaceGroup;
  return {key:activeElement.dataset.workspaceFocus,group,index,groupIndex:nodes.filter(node=>node.dataset.workspaceGroup===group).indexOf(activeElement)};
}

export function restoreWorkspaceFocus(container,previous,fallback) {
  if (!previous) return;
  const nodes=focusNodes(container),group=nodes.filter(node=>node.dataset.workspaceGroup===previous.group);
  const target=nodes.find(node=>node.dataset.workspaceFocus===previous.key)
    || group[Math.min(previous.groupIndex,group.length-1)]
    || nodes[Math.min(previous.index,nodes.length-1)]
    || fallback;
  target?.focus({preventScroll:true});
}
