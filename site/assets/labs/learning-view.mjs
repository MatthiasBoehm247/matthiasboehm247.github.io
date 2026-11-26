/* Shared static/browser rendering. No network, storage or DOM dependencies. */
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function formatNumber(value, precision = 2) {
  if (value === null || value === undefined) return 'Nicht definiert';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return 'Nicht definiert';
  return new Intl.NumberFormat('de-DE', {maximumFractionDigits:precision}).format(value);
}
const e = escapeHTML;
const axisNumber = value => Math.abs(value) >= 100000 ? value.toExponential(1).replace('.', ',') : formatNumber(value, 3);
export function chartHTML(chart, id) {
  const series = (chart?.series ?? []).filter(s => Array.isArray(s.points) && s.points.length);
  if (!series.length) return '';
  const points = series.flatMap(s => s.points);
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('Die Grafik enthält ungültige Werte.');
  let xmin = chart.xMin ?? Math.min(...points.map(p => p.x));
  let xmax = chart.xMax ?? Math.max(...points.map(p => p.x));
  let ymin = chart.yMin ?? Math.min(0, ...points.map(p => p.y));
  let ymax = chart.yMax ?? Math.max(...points.map(p => p.y));
  if (xmin === xmax) xmax = xmin + 1;
  if (ymin === ymax) ymax = ymin + 1;
  const w = 720, h = 370, left = 86, top = 28, pw = 600, ph = 254;
  const x = value => left + (value - xmin) / (xmax - xmin) * pw;
  const y = value => top + ph - (value - ymin) / (ymax - ymin) * ph;
  const xy = p => `${x(p.x).toFixed(3)},${y(p.y).toFixed(3)}`;
  const dashes = ['', '10 5', '3 4', '14 4 3 4'];
  const titleId = `learning-chart-title-${id}`, descId = `learning-chart-desc-${id}`;
  let grid = '';
  for (let n = 0; n <= 4; n++) {
    const xv = xmin + (xmax - xmin) * n / 4, yv = ymin + (ymax - ymin) * n / 4;
    grid += `<line class="learning-gridline" x1="${left}" y1="${y(yv)}" x2="${left+pw}" y2="${y(yv)}"/><text class="learning-axis-tick" x="${left-12}" y="${y(yv)+5}" text-anchor="end">${e(axisNumber(yv))}</text><text class="learning-axis-tick" x="${x(xv)}" y="${top+ph+26}" text-anchor="middle">${e(axisNumber(xv))}</text>`;
  }
  return `<figure class="learning-figure" data-learning-chart><div class="learning-chart-scroll" tabindex="0" role="region" aria-label="Modelldiagramm; bei schmaler Ansicht horizontal verschiebbar"><svg class="learning-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="${titleId} ${descId}"><title id="${titleId}">${e(chart.yLabel)} in Abhängigkeit von ${e(chart.xLabel)}</title><desc id="${descId}">Berechnetes Modell. ${series.map(s=>e(s.label)).join('; ')}. Ausgewählte Zahlen stehen zusätzlich in der Datentabelle.</desc>${grid}<line class="learning-axis" x1="${left}" y1="${top}" x2="${left}" y2="${top+ph}"/><line class="learning-axis" x1="${left}" y1="${top+ph}" x2="${left+pw}" y2="${top+ph}"/>${series.map((s,i)=>`<polyline class="learning-line learning-series-${i%4}" points="${s.points.map(xy).join(' ')}" fill="none" stroke-width="3"${dashes[i%4]?` stroke-dasharray="${dashes[i%4]}"`:''}/>${s.points.length<=20?s.points.map(p=>`<circle class="learning-point learning-series-${i%4}" cx="${x(p.x)}" cy="${y(p.y)}" r="3.5"/>`).join(''):''}`).join('')}<text class="learning-axis-title" x="${left+pw/2}" y="${h-22}" text-anchor="middle">${e(chart.xLabel)}</text><text class="learning-axis-title" transform="translate(20 ${top+ph/2}) rotate(-90)" text-anchor="middle">${e(chart.yLabel)}</text></svg></div><figcaption><ul class="learning-legend">${series.map((s,i)=>`<li><svg width="34" height="12" aria-hidden="true"><line class="learning-series-${i%4}" x1="0" y1="6" x2="34" y2="6" stroke-width="3"${dashes[i%4]?` stroke-dasharray="${dashes[i%4]}"`:''}/></svg>${e(s.label)}</li>`).join('')}</ul>Modellrechnung mit den angezeigten Eingaben. Die Grafik ist keine empirische Messung.</figcaption></figure>`;
}
export function resultHTML(result, id) {
  const preview = result.preview;
  const previewSafe = preview && /^#[0-9a-f]{6}$/i.test(preview.foreground) && /^#[0-9a-f]{6}$/i.test(preview.background);
  return `<div class="learning-metrics">${result.metrics.map(m=>`<div><span>${e(m.label)}</span><strong>${e(formatNumber(m.value,m.precision??2))}${m.unit?` <small>${e(m.unit)}</small>`:''}</strong></div>`).join('')}</div>${previewSafe?`<div class="learning-color-example" style="color:${preview.foreground};background:${preview.background}">${e(preview.text)}</div>`:''}${chartHTML(result.chart,id)}<p class="learning-explanation">${e(result.explanation)}</p><details class="learning-table"><summary>Berechnete Werte als Tabelle ansehen</summary><div class="learning-table-scroll" tabindex="0" role="region" aria-label="Berechnete Werte"><table><caption>Ausgewählte Werte des aktuellen Szenarios</caption><thead><tr>${result.table.headers.map(h=>`<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${result.table.rows.map(row=>`<tr>${row.map(v=>`<td>${e(formatNumber(v,6))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function scenarioVersion(version) {
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))throw new Error('Release-Version fehlt oder ist ungültig. Bitte die Seite neu laden.');
  return version;
}
export function scenarioPayload(model, values, result, version) {
  return {application:'Digital Labs',version:scenarioVersion(version),model:model.id,title:model.title,status:'Modellrechnung; keine Messdaten',inputs:values,formula:model.formula,limits:model.limit,result};
}
export function scenarioCSV(model, values, result, version) {
  scenarioVersion(version);
  const cell = value => {
    let s = typeof value === 'number' ? String(value).replace('.', ',') : String(value ?? '');
    if (typeof value !== 'number' && /^[\s\u0000-\u001f]*[=+@-]/u.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g,'""') + '"';
  };
  const rows = [['Digital Labs', version, model.id, model.title],['Status','Modellrechnung; keine Messdaten'],['Formel',model.formula],['Grenzen',model.limit],[],['Eingabe','Wert','Einheit'],...model.fields.map(f=>[f.label,values[f.name],f.unit??'']),[],['Ergebnis','Wert','Einheit'],...result.metrics.map(m=>[m.label,m.value,m.unit??'']),[],result.table.headers,...result.table.rows];
  return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n';
}
