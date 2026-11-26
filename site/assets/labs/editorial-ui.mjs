/* Progressive enhancement. No data storage, network calls or automatic quality judgments. */
const checklist=document.querySelector('[data-editorial-checklist]');
if(checklist){const boxes=[...checklist.querySelectorAll('input[type=checkbox]')],panel=checklist.querySelector('.editorial-progress'),bar=panel.querySelector('progress'),status=panel.querySelector('[data-check-status]');
 const update=()=>{const n=boxes.filter(b=>b.checked).length;bar.value=n;status.textContent=`${n} von ${boxes.length} geprüft`;};
 panel.hidden=false;boxes.forEach(b=>b.addEventListener('change',update));panel.querySelector('[data-check-reset]').addEventListener('click',()=>{boxes.forEach(b=>b.checked=false);update();});update();}
const filter=document.querySelector('[data-guide-filter]');
if(filter){const q=filter.querySelector('#guide-search'),topic=filter.querySelector('#guide-topic'),count=filter.querySelector('#guide-count'),sections=[...document.querySelectorAll('[data-guide-section]')];
 const norm=v=>String(v).normalize('NFKC').toLocaleLowerCase('de-DE');
 const update=()=>{const words=norm(q.value).trim().split(/\s+/).filter(Boolean);let n=0;for(const section of sections){let shown=0;for(const item of section.querySelectorAll('[data-guide-item]')){const ok=(!topic.value||topic.value===section.dataset.guideSection)&&words.every(w=>norm(item.dataset.guideItem).includes(w));item.hidden=!ok;shown+=Number(ok);}section.hidden=!shown;n+=shown;}count.textContent=n===1?'1 Leitfaden':`${n} Leitfäden`;};
 filter.hidden=false;q.addEventListener('input',update);topic.addEventListener('change',update);update();}
