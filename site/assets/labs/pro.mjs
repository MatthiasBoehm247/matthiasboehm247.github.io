// Pure calculations for professional views. No network or external dependencies.
import {parseCSV,keywordMapping} from './tools.mjs';
const ensure=(ok,msg)=>{if(!ok)throw new Error(msg);};
const rate=(n,d)=>d?n/d*100:null;
const sum=(rows,key)=>rows.reduce((a,x)=>{let n=a+(x[key]??0);ensure(Number.isSafeInteger(n),'Summe außerhalb des sicheren Ganzzahlbereichs.');return n;},0);
// Floor the chosen decimal CTR scenario exactly; binary multiplication can lose a whole click.
function scenarioFraction(target){
 const [mantissa,exp='0']=target.toString().split('e'),fraction=(mantissa.split('.')[1]||'').length;
 const digits=BigInt(mantissa.replace('.','')),scale=Number(exp)-fraction;
 return scale>=0?[digits*10n**BigInt(scale),100n]:[digits,100n*10n**BigInt(-scale)];
}
export function searchReport(rows,{min=100,target=4,brand='',segment='all',comparison=false}={}){
 ensure(Array.isArray(rows)&&rows.length<=50000,'Ungültige Zeilenliste.');
 ensure(Number.isFinite(min)&&min>=0&&Number.isFinite(target)&&target>=0&&target<=100,'Ungültige Schwellenwerte.');
 ensure(typeof brand==='string','Markenbegriffe müssen Text sein.');
 const terms=brand.toLocaleLowerCase('de').split('|').map(x=>x.trim()).filter(Boolean);
 ensure(['all','brand','nonbrand'].includes(segment),'Unbekanntes Segment.');
 ensure(segment==='all'||terms.length,'Für dieses Segment mindestens einen Markenbegriff eingeben.');
 const dimensions=new Set();
 for(const row of rows){
  ensure(row&&typeof row.query==='string'&&row.query.trim()&&Number.isSafeInteger(row.clicks)&&Number.isSafeInteger(row.impressions)&&row.clicks>=0&&row.impressions>=row.clicks,'Ungültige Suchdaten.');
  const dimension=row.dimension??'query';ensure(['query','page'].includes(dimension),'Unbekannte GSC-Dimension.');dimensions.add(dimension);
  if(comparison){
   ensure(Number.isSafeInteger(row.previousClicks)&&Number.isSafeInteger(row.previousImpressions)&&row.previousClicks>=0&&row.previousImpressions>=row.previousClicks&&row.clickDelta===row.clicks-row.previousClicks,'Ungültige Vergleichsdaten.');
   ensure(['beide Exporte','nur aktueller Export','nur Vergleichsexport'].includes(row.presence),'Unbekannter Vergleichsstatus.');
  }
 }
 ensure(dimensions.size<=1,'Suchanfragen und Seiten dürfen nicht zusammen ausgewertet werden.');
 ensure(segment==='all'||!dimensions.has('page'),'Markenfilter nur auf Suchanfragen anwenden. Bei Seitenexporten das Segment Alle wählen.');
 const included=rows.filter(row=>{const branded=terms.some(term=>row.query.toLocaleLowerCase('de').includes(term));return segment==='all'||(segment==='brand'?branded:!branded);});
 const clicks=sum(included,'clicks'),impressions=sum(included,'impressions'),[numerator,denominator]=scenarioFraction(target);
 const result=included.map(row=>({...row,rate:rate(row.clicks,row.impressions),potential:row.impressions>=min?Math.max(0,Number(BigInt(row.impressions)*numerator/denominator)-row.clicks):0,observedLoss:comparison&&row.presence==='beide Exporte'?Math.max(0,-row.clickDelta):null,action:!row.impressions||row.impressions<min?'Zu wenig Daten':row.clicks/row.impressions*100<target?'Suchintention und Snippet prüfen':'Beobachten'}));
 return {clicks,impressions,ctr:rate(clicks,impressions),previousClicks:comparison?sum(included,'previousClicks'):null,previousImpressions:comparison?sum(included,'previousImpressions'):null,potential:sum(result,'potential'),unmatched:comparison?result.filter(row=>row.presence!=='beide Exporte').length:0,rows:result};
}
export const mappingReport=keywordMapping;
export function geoReport(text,separator=','){
 const [h,...body]=parseCSV(text,separator);ensure(h&&new Set(h).size===h.length&&['model','date','prompt','mentioned','cited'].every(k=>h.includes(k)),'Messspalten fehlen oder sind doppelt.');ensure(body.length<=50000,'Zu viele Messungen.');let models=new Set(),prompts=new Map(),dates=new Set(),invalidDates=0;
 for(const a of body){ensure(a.length===h.length,'Uneinheitliche Spaltenzahl.');let r=Object.fromEntries(h.map((k,i)=>[k,a[i]]));ensure(r.model.trim()&&r.prompt.trim()&&['0','1'].includes(r.mentioned)&&['0','1'].includes(r.cited),'Ungültige Messzeile.');let d=r.date;if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)dates.add(d);else invalidDates++;models.add(r.model);let m=prompts.get(r.prompt)||new Map();let v=m.get(r.model)||{n:0,mentions:0,citations:0};v.n++;v.mentions+=+r.mentioned;v.citations+=+r.cited;m.set(r.model,v);prompts.set(r.prompt,m);}
 const list=[...models].sort((a,b)=>a.localeCompare(b,'de'));ensure(list.length<=100,'Maximal 100 Modelle in der Matrix.');ensure(list.length*prompts.size<=100000,'Matrix zu groß. Teile die Messdaten in kleinere Gruppen.');let rows=[...prompts].map(([prompt,m])=>({prompt,coverage:m.size,models:list.map(model=>{let x=m.get(model);return x?{model,...x,mentionRate:rate(x.mentions,x.n),citationRate:rate(x.citations,x.n)}:{model,n:0,mentionRate:null,citationRate:null};})}));return {models:list,rows,measurements:body.length,complete:rows.filter(r=>r.coverage===list.length).length,invalidDates,dates:[...dates].sort()};
}
export function safeCSV(rows){return '\uFEFF'+rows.map(row=>row.map(x=>{let s=String(x??'');if(typeof x!=='number'&&/^[\s\u0000-\u001f]*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
export function parseGrid(text){const grid=String(text).trim().split(/\r\n?|\n/).map(r=>[...r.trim()]);ensure(grid.length>=2&&grid.length<=20&&grid[0].length>=2&&grid[0].length<=20&&grid.every(r=>r.length===grid[0].length&&r.every(c=>'01SE'.includes(c))),'Visueller Editor: rechteckiges Raster 2×2 bis 20×20 mit 0, 1, S, E.');ensure(grid.flat().filter(c=>c==='S').length===1&&grid.flat().filter(c=>c==='E').length===1,'Genau ein Start und Ziel erforderlich.');return grid;}
export function paintGrid(grid,x,y,brush){ensure(Number.isInteger(x)&&Number.isInteger(y)&&grid[y]?.[x]&&['0','1','S','E'].includes(brush),'Ungültige Kachel.');let next=grid.map(r=>r.slice()),old=next[y][x];if(old===brush)return next;if(['S','E'].includes(old))throw Error('Start oder Ziel zuerst auf ein freies Feld verschieben.');if(brush==='S'||brush==='E')for(let r of next){let i=r.indexOf(brush);if(i!==-1)r[i]='0';}next[y][x]=brush;return next;}
