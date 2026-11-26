const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const text=value=>typeof value==='string'&&value.trim().length>0;
const validDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};
const validReference=value=>{
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}
};
export function validateEditorialRegister(rows,guideIds) {
  if(!Array.isArray(rows)||!Array.isArray(guideIds))throw Error('Ungültiges Quellenregister.');
  const expected=new Set(guideIds),seen=new Set();
  for(const row of rows){
    if(!row||!expected.has(row.id)||seen.has(row.id)||!text(row.reference_status))throw Error('Fehlender, doppelter oder unbekannter Leitfaden im Quellenregister.');
    seen.add(row.id);
    const checked=[row.checked_at,row.checked_scope,row.references].some(value=>value!==undefined);
    if(!checked)continue;
    if(!validDate(row.checked_at)||!text(row.checked_scope)||!Array.isArray(row.references)||!row.references.length)
      throw Error('Unvollständiger gezielter Quellenabgleich: '+row.id);
    const urls=new Set();
    for(const reference of row.references){
      if(!reference||!validReference(reference.url)||urls.has(reference.url)||!text(reference.title)||!Array.isArray(reference.claims)||!reference.claims.length||!reference.claims.every(text))
        throw Error('Quelle ohne gültige URL, Titel oder Aussagenzuordnung: '+row.id);
      urls.add(reference.url);
    }
  }
  if(seen.size!==expected.size)throw Error('Quellenregister deckt nicht alle Leitfäden ab.');
}

export function editorialReferencesHTML(ref,source='') {
  const checked=Boolean(ref.checked_at&&ref.references?.length);
  const refs=checked?ref.references:[];
  const defaultSource=source&&!refs.some(item=>item.url===source)
    ?`<p><a href="${esc(source)}">${esc(new URL(source).hostname)} – weiterführende Dokumentation</a></p>`:'';
  const references=checked?`<div class="guide-sources"><h3>Quellen zu den geprüften Aussagen</h3><ol>${refs.map(reference=>`<li><a href="${esc(reference.url)}">${esc(reference.title)}</a><ul>${reference.claims.map(claim=>`<li>${esc(claim)}</li>`).join('')}</ul></li>`).join('')}</ol></div>`:'';
  const reviewed=checked?`<p class="small muted" data-source-review>Gezielter Quellenabgleich am <time datetime="${esc(ref.checked_at)}">${ref.checked_at.split('-').reverse().join('.')}</time>. ${esc(ref.checked_scope)}</p>`:'';
  const status=`<p class="small muted">${esc(ref.reference_status)}. ${checked?'Der Abgleich betrifft die hier genannten Aussagen.':'Vertiefte redaktionelle Fassung vom 25.11.2026.'} Keine unabhängige Fachfreigabe und keine empirische Studie.</p>`;
  return reviewed+references+defaultSource+(!checked&&!source?'<p>Eigene redaktionelle Methode und illustrative Beispiele. Fachliche Prüfung ausstehend.</p>':'')+status;
}
