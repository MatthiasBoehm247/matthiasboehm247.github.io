(() => {
  'use strict';
  const STORAGE = 'boehm.appstudio.projects.v1';
  const $ = (id) => document.getElementById(id);
  const S = { step:1, rawUrl:'', source:null, meta:null, reviews:[], reviewSource:'none', selectedIdea:'focus', selectedDesign:'clear', draft:null };
  const CATEGORY = {
    audio: { label:'Audio & Klang', basic:['Szenen erkunden und abspielen','Eigene Favoriten speichern','Wiedergabe pausieren und fortsetzen','Timer und Lautstärke einstellen','Klare Audio-Unterbrechungen behandeln'], plus:['Eigene Kombinationen erstellen','Mischungen benennen und speichern','Auswahl und Einstellungen exportieren'], priv:['Offline-Bibliothek mit rechtlich geklärten Inhalten','Lokale Einstellungen und Favoriten','Transparente Audio- und Speicherberechtigungen'] },
    wellness: { label:'Wohlbefinden', basic:['Einträge einfach erfassen','Persönliche Übersicht ansehen','Verlauf verstehen','Einträge ändern und löschen','Passende Erinnerungen einstellen'], plus:['Individuelle Ziele und Auswertungen','Filter und benutzerdefinierte Kategorien','Datenexport und Verlaufskontrolle'], priv:['Daten standardmäßig lokal speichern','Private Informationen vor fremdem Zugriff schützen','Einfache vollständige Datenlöschung'] },
    learning: { label:'Lernen', basic:['Lerneinheit auswählen','Kurze interaktive Aufgaben absolvieren','Direkte, verständliche Rückmeldungen erhalten','Lernfortschritt speichern','Einheit jederzeit fortsetzen'], plus:['Individuelle Lernpfade','Vertiefende Übungen und Wiederholung','Fortschritt und Ziele anpassen'], priv:['Lernstand lokal speichern','Ohne Konto lernen, wo möglich','Daten löschen und exportieren'] },
    tools: { label:'Produktivität & Tools', basic:['Werkzeug direkt starten','Ergebnis mit wenigen Schritten erhalten','Werte prüfen und korrigieren','Ergebnis speichern oder exportieren','Zuletzt verwendete Einstellungen wiederherstellen'], plus:['Mehrere Arbeitsabläufe kombinieren','Vorlagen und individuelle Einstellungen','Erweiterte Filter und Exportoptionen'], priv:['Ohne Anmeldung starten','Berechnungen möglichst lokal ausführen','Keine unnötige Übertragung von Eingaben'] },
    games: { label:'Spiel & Interaktion', basic:['Ohne lange Einführung starten','Intuitive Eingabe und Steuerung','Erkennbares Spielziel und Fortschritt','Pause und Wiederaufnahme','Angemessenes Feedback und Belohnungen'], plus:['Unterschiedliche Spielmodi','Abwechslungsreiche Ziele und Level','Anpassbare Steuerung und Schwierigkeit'], priv:['Offline-Spielstand','Keine unnötigen Nutzerkonten','Sparsame Berechtigungen und transparente Käufe'] },
    general: { label:'Alltag & Lifestyle', basic:['Wichtigste Aufgabe sofort erreichen','Inhalte einfach ansehen oder erfassen','Favoriten speichern','Einträge ändern und löschen','Hilfe und Fehlermeldungen verstehen'], plus:['Persönliche Ansichten und Filter','Zusätzliche Vorlagen und Kategorien','Geordneter Export und Verlauf'], priv:['Ohne Konto nutzen, wenn möglich','Lokale Datenverwaltung','Transparentes Löschen und Exportieren'] }
  };
  const IDEAS = [
    {id:'focus',name:'Einfach & schnell',desc:'Die wichtigsten Funktionen sofort erreichbar. Weniger Schritte, ein ruhiger Einstieg.',icon:'↗',short:'Fokus auf den Hauptnutzen'},
    {id:'studio',name:'Flexibel & vielseitig',desc:'Mehr Möglichkeiten für Menschen, die ihre App individuell verwenden möchten.',icon:'▤',short:'Mehr Kontrolle und Anpassung'},
    {id:'private',name:'Privat & unabhängig',desc:'So wenig Datenweitergabe wie möglich. Offline-Nutzung und Kontrolle im Mittelpunkt.',icon:'◎',short:'Datensparsam und bewusst'}
  ];
  const DESIGNS = [
    {id:'clear',name:'Klar & präzise',desc:'Reduziert, ruhig, hervorragend lesbar',preview:'mock-light',line:'Alles im Blick.'},
    {id:'warm',name:'Warm & organisch',desc:'Natürlich, weich und einladend',preview:'mock-warm',line:'Ein guter Moment.'},
    {id:'dark',name:'Dunkel & elegant',desc:'Kontraststark, souverän, fokussiert',preview:'mock-dark',line:'Im eigenen Rhythmus.'}
  ];
  const MODULES = [
    ['01','App-Grundstruktur','Navigation, Zustände, Übersetzungen und reproduzierbare Konfiguration.'],
    ['02','Designsystem','Schrift, Farben, Abstände und zugängliche Bedienelemente.'],
    ['03','Lokale Daten','Robuste Speicherung, Datenmigration, Export und Löschung.'],
    ['04','Anmeldung','Optionaler Zugang mit Rechtesystem und Kontolöschung.'],
    ['05','Synchronisation','Optionaler Geräteabgleich mit Konflikt- und Offline-Regeln.'],
    ['06','Audio & Medien','Berechtigungen, Dateien, Unterbrechungen und Nutzungsrechte.'],
    ['07','Bezahlung','In-App-Käufe, Abos und Kaufwiederherstellung.'],
    ['08','Benachrichtigungen','Einwilligung, Erinnerungseinstellungen und Zustellfehler.'],
    ['09','Qualitätssicherung','Automatische Tests, Geräteprüfungen und überprüfbare Nachweise.'],
    ['10','Store-Vorbereitung','Metadaten, Screenshots, Datenschutzangaben und Freigabe.'],
    ['11','Betriebsbeobachtung','Fehlererkennung, Support, Kosten- und Versionsübersicht.'],
    ['12','Update-Steuerung','Versionen, Abhängigkeiten, Migrations- und Freigaberegeln.']
  ];
  const CHECKS = [
    ['Produktnutzen','Eigenständiger Nutzen, Zielgruppe, Hauptabläufe und begrenzte erste Version.'],
    ['Nachweisbare Recherche','Quellen, App-Versionen, Datenlücken und Hypothesen getrennt dokumentiert.'],
    ['Bedienung','Erster Start, Navigation, Rückmeldungen, Fehlerzustände und Unterbrechungen.'],
    ['Barrierefreiheit','Kontrast, größere Schrift, Bedienflächen und Screenreader.'],
    ['Persistenz und Daten','Speichern, Wiederöffnen, Export, Löschung und ggf. Synchronisation.'],
    ['Sicherheit und Datenschutz','Datenflüsse, Berechtigungen, Geheimnisse und Abhängigkeiten.'],
    ['Rechte an Inhalten','Audio, Bilder, Schriften, Code und Veröffentlichungslizenzen.'],
    ['Wirtschaftlichkeit','Entwicklungs- und Betriebskosten, wirksame Grenzen, Finanzierung.'],
    ['Android-Prüfung','Echter Android-Build sowie nachvollziehbare Hauptabläufe und Fehlerfälle.'],
    ['iOS-Prüfung','Eigenständiger iOS-Build sowie nachvollziehbare Hauptabläufe und Fehlerfälle.'],
    ['Store-Compliance','Aktuelle Apple-/Google-Regeln, Metadaten und offengelegte Datenverarbeitung.'],
    ['Betrieb und Updates','Support, Fehleranalyse, neue Versionen, Wiederherstellung und Stilllegung.']
  ];
  const CATEGORIES = ['Audio & Klang','Wohlbefinden','Lernen','Produktivität & Tools','Spiel & Interaktion','Alltag & Lifestyle'];
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g,(m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const cap = (v, n=500) => String(v ?? '').slice(0,n);
  const val = (s) => String(s ?? '').trim();
  const date = () => new Date().toISOString().slice(0,10);
  const randomId = () => globalThis.crypto?.randomUUID?.() || ('p_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7));
  function parseStoreUrl(s) {
    if (!s || s.length > 2048) return {error:'Bitte einen vollständigen App-Store-Link einfügen.'};
    let u; try {u=new URL(s.trim())} catch {return {error:'Der Link ist keine gültige URL.'}};
    if(u.protocol!=='https:')return {error:'Bitte einen HTTPS-Link verwenden.'};
    if(u.username||u.password||u.port) return {error:'Bitte einen normalen App-Store-Link ohne Zugangsdaten oder Port verwenden.'};
    const h=u.hostname.toLowerCase();
    if(['apps.apple.com','itunes.apple.com'].includes(h)){
      const x=u.pathname.match(/(?:^|\/)id(\d{6,15})(?:\/|$)/i) || (u.pathname.toLowerCase().includes('/lookup')&&u.searchParams.get('id')?.match(/^(\d{6,15})$/));
      if(!x)return {error:'Im Apple-Link fehlt die numerische App-ID (…/id123456789).'};
      const pathCountry=u.pathname.match(/^\/([a-z]{2})(?:\/|$)/i)?.[1]?.toLowerCase();
      return {type:'apple',id:x[1],country:(pathCountry||'de'),url:u.toString()};
    }
    if(h==='play.google.com'&&u.pathname.startsWith('/store/apps/details')){
      const id=u.searchParams.get('id')||'';
      if(!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*){1,15}$/.test(id)||id.length>180)return {error:'Im Google-Play-Link fehlt eine gültige Paketkennung (?id=com.beispiel.app).'};
      return {type:'google',id,url:u.toString(),country:'de'};
    }
    return {error:'Unterstützt werden Links von apps.apple.com und play.google.com.'};
  }
  function classify(m) {
    const g=(m?.genre||'').toLowerCase(), n=(m?.name||'').toLowerCase(), d=(m?.description||'').slice(0,1500).toLowerCase();
    if(/music|musik|sound|audio|klang|naturgeräusch/.test(g+' '+n)) return 'audio';
    if(/health|fitness|gesund|mediz|wellness|meditation|sleep|wohlbefinden/.test(g+' '+n)) return 'wellness';
    if(/education|lernen|bildung|schule|learn|vocab/.test(g+' '+n)) return 'learning';
    if(/games|spiel|game/.test(g+' '+n)) return 'games';
    if(/productivity|utilities|werkzeug|finance|produktiv|dienstprogramm|business/.test(g+' '+n)) return 'tools';
    if(/synthesizer|mixer|podcast|playlist|sleep sounds/.test(d)) return 'audio';
    return 'general';
  }
  function normalizeApple(json,ref) {
    const arr=Array.isArray(json?.results)?json.results:[];
    const r=arr.find(x=>String(x.trackId)===ref.id && x.wrapperType==='software')||arr.find(x=>String(x.trackId)===ref.id)||arr[0];
    if(!r)return null;
    return {name:cap(r.trackName||'Unbenannte App',130),genre:cap(r.primaryGenreName||'Nicht angegeben',80),description:cap(r.description||'',10000),version:cap(r.version||'',25),developer:cap(r.artistName||'',150),rating:Number.isFinite(Number(r.averageUserRating))?Number(r.averageUserRating):null,ratingCount:Number.isFinite(Number(r.userRatingCount))?Number(r.userRatingCount):null,storeUrl:typeof r.trackViewUrl==='string' && r.trackViewUrl.startsWith('https://apps.apple.com/')?r.trackViewUrl:ref.url,source:'Apple Lookup',fetchedAt:new Date().toISOString()};
  }
  async function fetchJSON(url,timeoutMs=9000){const c=new AbortController();const timeout=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{signal:c.signal,credentials:'omit',cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timeout)}}
  async function loadAppleReviews(ref){
    const url=`https://itunes.apple.com/${ref.country}/rss/customerreviews/page=1/id=${ref.id}/sortby=mostrecent/json`;
    const json=await fetchJSON(url,6500);
    const entries=json?.feed?.entry;
    if(!Array.isArray(entries))return [];
    return entries.filter(e=>e?.['im:rating']?.label && e?.content?.label).slice(0,50).map(e=>({rating:Number(e['im:rating'].label)||null,title:cap(e.title?.label||'',200),text:cap(e.content?.label||'',2000),version:cap(e['im:version']?.label||'',20),date:cap(e.updated?.label||'',50)}));
  }
  function reviewPatterns(reviews) {
    const groups=[['Abstürze & Fehler',/abst[uü]rz|crash|st[uü]rz|h[aä]ngt|bug|fehler|funktioniert nicht|doesn.t work|broken/i],['Bedienung',/un[uü]bersichtlich|kompliziert|bedien|navigation|unintuitiv|confus|difficult|verwirrend/i],['Kosten & Werbung',/werbung|abo|preis|paywall|kosten|ads|expensive|subscription|zahlung/i],['Leistung',/langsam|lange lade|ruckel|performance|slow|lag|batterie|akku/i],['Speichern & Synchronisation',/verloren|gespeichert|synchron|sync|save|lost data|backup/i],['Offline & Internet',/offline|internet|verbindung|connection|without wifi/i],['Barrierefreiheit',/kontrast|schrift|lesbar|screenreader|voiceover|accessib|font size/i]];
    return groups.map(([title,re])=>({title,matched:reviews.filter(r=>re.test(r.title+' '+r.text))})).filter(x=>x.matched.length).sort((a,b)=>b.matched.length-a.matched.length);
  }
  function buildPlan() {
    const m=S.meta||{name:'App-Referenz',genre:'',description:''};
    const cat=classify(m), c=CATEGORY[cat];
    const choice=IDEAS.find(x=>x.id===S.selectedIdea)||IDEAS[0], theme=DESIGNS.find(x=>x.id===S.selectedDesign)||DESIGNS[0];
    const features=[...c.basic];
    if(choice.id==='studio')features.push(...c.plus);
    if(choice.id==='private')features.push(...c.priv);
    const patterns=reviewPatterns(S.reviews);
    const issues=patterns.map(x=>({topic:x.title,count:x.matched.length,excerpts:x.matched.slice(0,2).map(r=>cap(r.title+' – '+r.text,200))}));
    return {schemaVersion:1,id:S.draft?.id||randomId(),createdAt:S.draft?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),stage:'Plan erstellt – nicht entwickelt',name:'Neue '+c.label+'-App',reference:{...S.source,metadata:m,reviewSource:S.reviewSource,reviewSampleSize:S.reviews.length||S.draft?.reference?.reviewSampleSize||0},category:cat,positioning:choice,design:theme,features,reviewIssues:S.reviews.length?issues:(S.draft?.reviewIssues||issues),requirements:CHECKS.map(([title,detail])=>({title,detail,status:'Geplant; nicht implementiert oder geprüft'})),validation:{android:'Nicht gebaut / nicht geprüft',ios:'Nicht gebaut / nicht geprüft',store:'Nicht eingereicht'},notes:['Produkt und Gestaltung sind eigene Vorschläge, keine Kopie der Referenz-App.','Quellenlage und fehlende Rezensionen müssen vor verbindlichen Wettbewerbsbehauptungen ergänzt werden.','Technische Umsetzbarkeit, Rechte, Budget und Store-Regeln benötigen projektspezifische Prüfungen.','Besondere Datenverarbeitung, Käufe und Online-Dienste lösen zusätzliche Pflichtaufgaben aus.']};
  }
  function createMarkdown(p) {
    const lines=[`# ${p.name} – Produkt-Masterplan`,``, `Erstellt: ${p.createdAt?.slice(0,10)||date()} · Status: ${p.stage}`,``,`## Referenz`,`Store: ${p.reference.type==='apple'?'Apple App Store':'Google Play'}`,`URL: ${p.reference.url}`,`App-Kennung: ${p.reference.id}`,`Name laut Quelle: ${p.reference.metadata.name}`,`Kategorie laut Quelle: ${p.reference.metadata.genre||'Nicht verfügbar'}`,`Datenquelle: ${p.reference.metadata.source}`,`Rezensionen in Stichprobe: ${p.reference.reviewSampleSize} · Quelle: ${p.reference.reviewSource}`,``,`## Eigenständige Produktidee`,`Ausrichtung: ${p.positioning.name} – ${p.positioning.short}`,`Design: ${p.design.name} – ${p.design.desc}`,``,`## Vorgesehene Kernfunktionen`,...p.features.map(f=>'- '+f),``,`## Hinweise aus Nutzerrezensionen`];
    if(!p.reviewIssues.length)lines.push('Keine belastbaren Rezensionsthemen aus verfügbaren Texten abgeleitet. Weiterführende Recherche nötig.');
    for(const i of p.reviewIssues){lines.push(`- ${i.topic}: ${i.count} von ${p.reference.reviewSampleSize} untersuchten Rezensionen haben entsprechende Wortmuster.`);for(const q of i.excerpts)lines.push('  - Beispiel: '+q.replace(/\s+/g,' '))}
    lines.push('','## Verbindlicher Qualitäts- und Aufgabenrahmen',...p.requirements.map(x=>`- [ ] ${x.title}: ${x.detail} [${x.status}]`),'','## Release-Status',`- Android: ${p.validation.android}`,`- iOS: ${p.validation.ios}`,`- Stores: ${p.validation.store}`,'','## Offene Aufgaben und Grenzen',...p.notes.map(x=>'- '+x),'','## Entwicklungsauftrag','Erstelle auf Grundlage dieses Plans eine eigenständige Android- und iOS-App. Prüfe zuerst die vorhandene Projektumgebung und Rechte. Implementiere vereinbarte Funktionen vollständig, dokumentiere getroffene Entscheidungen und alle echten Tests. Ungeprüfte Funktionen oder Builds dürfen nicht als fertig gelten. Schütze Nutzerdaten und Geheimnisse; nutze keine ungeklärten Rechte an fremden Inhalten. Verlange vor externen Kosten und Store-Veröffentlichungen die vorgesehenen Genehmigungen.','');
    return lines.join('\n');
  }
  function queryPrompt(p) {return ['Bitte entwickle dieses Projekt mit Codex bzw. einer geeigneten Entwicklungsumgebung weiter. Nutze den folgenden Produktplan als Ausgangspunkt, prüfe aber die Umsetzbarkeit, Plattformregeln und Quellenlage. Setze zuerst eine funktionsfähige Android- und iOS-Pilot-App mit nachvollziehbaren Tests um. Behaupte keine Builds oder Veröffentlichungen, die nicht durchgeführt wurden.','',createMarkdown(p)].join('\n')}
  function showNotice(id,message,isError=false) {const e=$(id);e.hidden=!message;e.textContent=message||'';e.classList.toggle('error',!!isError)}
  function storageGet(){try{const r=JSON.parse(localStorage.getItem(STORAGE)||'[]');return Array.isArray(r)?r.filter(x=>x&&x.id&&x.reference):[]}catch{return []}}
  function storageSet(a){localStorage.setItem(STORAGE,JSON.stringify(a));$('navProjectCount').textContent=String(a.length)}
  function refreshProjectCount(){$('navProjectCount').textContent=String(storageGet().length)}
  function openView(name){document.querySelectorAll('.view').forEach(v=>{v.hidden=v.id!==`view-${name}`;v.classList.toggle('active',v.id===`view-${name}`)});document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$('breadcrumbCurrent').textContent={new:'Neue App',projects:'Meine Projekte',modules:'App-Baukasten',quality:'Qualität & Standards'}[name]||'Neue App';if(name==='projects')renderProjects();window.scrollTo({top:0,behavior:'instant'})}
  function goto(step){S.step=step;for(let i=1;i<=4;i++)$('step'+i).hidden=i!==step;document.querySelectorAll('[data-stepbar]').forEach(x=>{const s=Number(x.dataset.stepbar);x.classList.toggle('active',s===step);x.classList.toggle('complete',s<step)});$('stepCaption').textContent=`0${step} / 04 · ${['','REFERENZ','PRODUKTRICHTUNG','GESTALTUNG','PRODUKTPLAN'][step]}`;$('stepRight').textContent=['','Einfach beginnen','1 von 3 wählen','Design aussuchen','Entwurf exportieren'][step];openView('new')}
  function renderReference(){const m=S.meta, r=S.source; if(!m)return;
    const rating=m.rating!=null?`<span>Bewertung ${esc(m.rating.toFixed(1))}/5 · ${esc(m.ratingCount==null?'Anzahl unbekannt':m.ratingCount+' Bewertungen')}</span>`:'';
    $('referenceCard').innerHTML=`<div class="reference-row"><div><strong>${esc(m.name)}</strong><small>${esc(m.genre||'Kategorie nicht verfügbar')} · ${esc(m.source)}</small></div><a href="${esc(m.storeUrl||r.url)}" target="_blank" rel="noopener noreferrer">Store öffnen ↗</a></div><div class="ref-tags"><span>${r.type==='apple'?'Apple App Store':'Google Play'}</span>${m.version?`<span>Version ${esc(m.version)}</span>`:''}${rating}</div>`;
    $('referenceCard').hidden=false;
  }
  async function runImport(event){event.preventDefault();const p=parseStoreUrl($('storeUrl').value);if(p.error){showNotice('importNotice',p.error,true);return}S.rawUrl=$('storeUrl').value.trim();S.source=p;S.reviews=[];S.reviewSource='none';S.draft=null;showNotice('importNotice','Referenz wird geprüft …');$('startAnalysis').disabled=true;try{
      if(p.type==='apple'){
        let meta;
        try{const j=await fetchJSON(`https://itunes.apple.com/lookup?id=${p.id}&country=${p.country}&entity=software`,9000);meta=normalizeApple(j,p)}catch(e){meta=null}
        S.meta=meta||{name:'Apple-App '+p.id,genre:'Nicht abrufbar',description:'',version:'',source:'Nur Linkkennung – öffentliche Metadaten nicht verfügbar',storeUrl:p.url};
        showNotice('importNotice',meta?'Öffentliche App-Angaben übernommen. Rezensionen werden separat geprüft.':'Der Apple-Katalog war nicht erreichbar. Der Entwurf kann trotzdem erstellt werden; App-Angaben und Rezensionen bleiben ungeprüft.');
        renderReference();
        try{S.reviews=await loadAppleReviews(p);if(S.reviews.length){S.reviewSource=`Öffentlicher Apple-RSS-Feed, ${p.country.toUpperCase()}, neueste verfügbare Einträge (nicht vollständig)`;showNotice('importNotice',`App-Angaben übernommen. ${S.reviews.length} öffentlich verfügbare Rezensionstexte wurden als begrenzte Stichprobe eingelesen.`)}}catch{ /* Unavailable feed is not represented as an absence of complaints. */ }
      } else {
        S.meta={name:'App mit Kennung '+p.id,genre:'Nicht verfügbar',description:'',version:'',source:'Nur Linkkennung – kein öffentlicher Google-Play-Metadatenzugang eingebunden',storeUrl:p.url};
        renderReference();showNotice('importNotice','Google-Play-Link erkannt. Ein verlässlicher Metadaten- und Rezensionsimport für fremde Apps ist hier noch nicht angebunden. Der Produktplan markiert diese Lücke deutlich.');
      }
      $('manualAppName').value=S.meta?.source?.startsWith('Nur Linkkennung')?'':(S.meta?.name||'');$('manualGenre').value='';$('manualReviews').value='';renderIdeas();goto(2);
    } catch {showNotice('importNotice','Der Import konnte nicht abgeschlossen werden. Bitte den Link prüfen und erneut versuchen.',true)}finally{$('startAnalysis').disabled=false}
  }
  function renderIdeas(){const cat=CATEGORY[classify(S.meta)];$('ideaCards').innerHTML=IDEAS.map(x=>`<button type="button" class="option-card ${x.id===S.selectedIdea?'selected':''}" data-idea="${x.id}" aria-pressed="${x.id===S.selectedIdea}"><span class="choice-mark">${x.icon}</span>${x.id==='focus'?'<span class="reco-tag">EMPFOHLEN</span>':''}<h3>${x.name}</h3><p>${x.desc}</p></button>`).join('');document.querySelectorAll('[data-idea]').forEach(b=>b.addEventListener('click',()=>{S.selectedIdea=b.dataset.idea;renderIdeas()}));$('step2title').textContent=`Welche ${cat.label}-App passt zu dir?`}
  function renderDesigns(){$('designCards').innerHTML=DESIGNS.map(x=>`<button type="button" class="design-card ${S.selectedDesign===x.id?'selected':''}" data-design="${x.id}" aria-pressed="${S.selectedDesign===x.id}"><div class="mock-screen ${x.preview}" aria-hidden="true"><div class="mock-header"><span>DEINE APP</span><i></i></div><div class="mock-title">${x.line}</div><div class="mock-card"><b>◦</b><span></span></div></div><div class="design-meta"><h3>${x.name}</h3><p>${x.desc}</p></div></button>`).join('');document.querySelectorAll('[data-design]').forEach(b=>b.addEventListener('click',()=>{S.selectedDesign=b.dataset.design;renderDesigns()}))}
  function renderPlan(){S.draft=buildPlan();const p=S.draft;$('planOverview').innerHTML=`<div class="fact"><small>APP-REFERENZ</small><strong>${esc(p.reference.metadata.name)}</strong></div><div class="fact"><small>PRODUKTRICHTUNG</small><strong>${esc(p.positioning.name)}</strong></div><div class="fact"><small>GESTALTUNG</small><strong>${esc(p.design.name)}</strong></div>`;
    const featureList=p.features.map(f=>`<li>${esc(f)}</li>`).join('');
    const qualityList=p.requirements.slice(0,7).map(q=>`<li class="open">${esc(q.title)}</li>`).join('');
    const sample=p.reference.reviewSampleSize;
    $('planDetail').innerHTML=`<div class="plan-block"><h3>Vorgesehene Funktionen · ${p.features.length}</h3><ul>${featureList}</ul></div><div class="plan-block"><h3>Automatisch berücksichtigte Prüfungen</h3><ul>${qualityList}</ul><small>Alle ${p.requirements.length} Bereiche werden im exportierten Masterplan aufgeführt. Noch kein Test wurde durchgeführt.</small><h3 class="feedback-heading">Feedback-Lage</h3><p class="feedback-description">${sample?`${sample} verfügbare Rezensionen als Stichprobe. ${p.reviewIssues.length} automatisch erkannte Themen; Hinweise sind noch keine bestätigten App-Fehler.`:'Keine auswertbaren Rezensionen importiert. Nutzerkritik und Produktlücken sind daher nicht verifiziert.'}</p></div>`;
  }
  function download(name,content,type='text/plain'){const a=document.createElement('a'),blob=new Blob([content],{type:type+';charset=utf-8'});const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
  function slugify(s){return String(s).toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'app'}
  function savePlan(){if(!S.draft)return;try{const arr=storageGet(),index=arr.findIndex(x=>x.id===S.draft.id);if(index>=0)arr[index]=S.draft;else arr.unshift(S.draft);storageSet(arr.slice(0,80));showNotice('planNotice','Projekt gespeichert. Du findest es unter „Meine Projekte“ in diesem Browser.')}catch{showNotice('planNotice','Speichern nicht möglich (z. B. privater Browser oder voller Speicher). Bitte den Masterplan herunterladen.',true)}}
  async function copyPrompt(){if(!S.draft)return;const t=queryPrompt(S.draft);try{await navigator.clipboard.writeText(t);showNotice('planNotice','Der vollständige Entwicklungsauftrag wurde kopiert. Du kannst ihn jetzt in ChatGPT oder Codex einfügen.')}catch{openModal('Entwicklungsauftrag kopieren','Die Zwischenablage ist nicht verfügbar. Markiere und kopiere den Text aus dem folgenden Feld.',{textarea:t})}}
  function renderProjects(){const list=storageGet();if(!list.length){$('projectList').innerHTML='<div class="empty-panel"><h2>Noch keine Projekte gespeichert</h2><p>Beginne mit einer App-Store-URL. Dein erster Entwurf erscheint anschließend hier.</p><button class="primary-btn" type="button" id="emptyStart">Neue App beginnen →</button></div>';$('emptyStart').onclick=()=>goto(1);return}
    $('projectList').innerHTML=list.map(p=>`<article class="project-card"><div><h3>${esc(p.name||'Unbenannter Entwurf')}</h3><p>${esc(p.reference.metadata?.name||p.reference.id)} · ${esc(p.positioning?.name||'Entwurf')} · ${esc(p.createdAt?.slice(0,10)||'')}</p><p class="project-status">Plan erstellt · Builds und Stores noch nicht verbunden</p></div><div class="project-actions"><button class="secondary-btn" data-open="${esc(p.id)}">Öffnen</button><button class="secondary-btn" data-export="${esc(p.id)}">Export</button><button class="danger-btn" data-delete="${esc(p.id)}">Löschen</button></div></article>`).join('');
    document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>loadSaved(b.dataset.open));document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>{const p=storageGet().find(x=>x.id===b.dataset.export);if(p)download('masterplan-'+slugify(p.name)+'.md',createMarkdown(p),'text/markdown')});document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>openModal('Projekt wirklich löschen?','Der lokal gespeicherte Entwurf wird aus diesem Browser entfernt. Bereits exportierte Dateien bleiben erhalten.',{confirm:'Löschen',doConfirm:()=>{storageSet(storageGet().filter(x=>x.id!==b.dataset.delete));renderProjects()}}))}
  function loadSaved(id){const p=storageGet().find(x=>x.id===id);if(!p)return;S.source=p.reference;S.meta=p.reference.metadata;S.reviewSource=p.reference.reviewSource;S.reviews=[];S.selectedIdea=p.positioning?.id||'focus';S.selectedDesign=p.design?.id||'clear';S.draft=p;S.rawUrl=p.reference.url;$('storeUrl').value=S.rawUrl;$('manualAppName').value='';$('manualGenre').value='';$('manualReviews').value='';renderReference();renderIdeas();renderDesigns(); // preserve exported metadata and evidence; do not generate away saved review findings.
    $('planOverview').innerHTML=`<div class="fact"><small>APP-REFERENZ</small><strong>${esc(p.reference.metadata?.name||'')}</strong></div><div class="fact"><small>PRODUKTRICHTUNG</small><strong>${esc(p.positioning?.name||'')}</strong></div><div class="fact"><small>GESTALTUNG</small><strong>${esc(p.design?.name||'')}</strong></div>`;
    $('planDetail').innerHTML=`<div class="plan-block"><h3>Vorgesehene Funktionen</h3><ul>${(p.features||[]).map(f=>`<li>${esc(f)}</li>`).join('')}</ul></div><div class="plan-block"><h3>Qualitätsrahmen</h3><ul>${(p.requirements||[]).slice(0,8).map(q=>`<li class="open">${esc(q.title)}</li>`).join('')}</ul><small>Kein Build und kein Test nachgewiesen.</small></div>`;
    showNotice('planNotice','Gespeicherter Entwurf geöffnet. Bei einer erneuten Auswahl werden die Produktoptionen neu berechnet.');goto(4)}
  function openModal(title,body,options={}){$('modalTitle').textContent=title;$('modalText').textContent=body;$('modalTextarea').hidden=!options.textarea;$('modalTextarea').value=options.textarea||'';$('modalCancel').hidden=!!options.textarea;$('modalConfirm').textContent=options.confirm||'Schließen';$('modalConfirm').onclick=()=>{if(options.doConfirm)options.doConfirm();$('modal').close()};$('modal').showModal();if(options.textarea)$('modalTextarea').select()}
  function setup(){
    refreshProjectCount();
    document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>openView(b.dataset.view));
    $('topNew').onclick=()=>{S.step=1;S.draft=null;S.source=null;S.meta=null;S.reviews=[];S.reviewSource='none';S.selectedIdea='focus';S.selectedDesign='clear';$('storeUrl').value='';$('referenceCard').hidden=true;showNotice('importNotice','');showNotice('planNotice','');goto(1);$('storeUrl').focus()};
    $('pasteBtn').onclick=async()=>{try{const s=await navigator.clipboard.readText();$('storeUrl').value=s;$('storeUrl').focus()}catch{showNotice('importNotice','Zum Einfügen das Link-Feld berühren und „Einfügen“ wählen.','error')}};
    $('importForm').addEventListener('submit',runImport);
    document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>goto(Number(b.dataset.back)));
    $('chooseIdea').onclick=()=>{
      const name=$('manualAppName').value.trim(),genre=$('manualGenre').value;
      if(name)S.meta.name=cap(name,130);
      if(genre)S.meta.genre=genre;
      if(name||genre)S.meta.source=String(S.meta.source||'')+'; manuell ergänzt';
      const lines=$('manualReviews').value.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=6).slice(0,100);
      if(lines.length){S.reviews=lines.map(x=>({rating:null,title:'Manueller Hinweis',text:cap(x,2000),date:'',version:''}));S.reviewSource='Manuell eingefügte Hinweise, ungeprüft'}
      renderDesigns();goto(3)
    };
    $('chooseDesign').onclick=()=>{renderPlan();goto(4)};
    $('savePlan').onclick=savePlan;
    $('downloadPlan').onclick=()=>{if(S.draft)download('boehm-appstudio-'+slugify(S.draft.name)+'-'+date()+'.md',createMarkdown(S.draft),'text/markdown')};
    $('copyPrompt').onclick=copyPrompt;
    $('exportAll').onclick=()=>download('boehm-appstudio-projekte-'+date()+'.json',JSON.stringify({format:'boehm-app-studio',version:1,exportedAt:new Date().toISOString(),projects:storageGet()},null,2),'application/json');
    $('importAll').onchange=async(e)=>{const f=e.target.files?.[0];if(!f)return;if(f.size>2e6){openModal('Datei zu groß','Der Projektimport ist auf 2 MB begrenzt.');return}try{const parsed=JSON.parse(await f.text());if(parsed.format!=='boehm-app-studio'||!Array.isArray(parsed.projects)||parsed.projects.length>80||parsed.projects.some(p=>!p.id||!p.reference?.id||!Array.isArray(p.features)))throw Error('format');const merged=storageGet();for(const p of parsed.projects){if(!merged.some(x=>x.id===p.id))merged.push(p)}storageSet(merged.slice(0,80));renderProjects();openModal('Import abgeschlossen',`${parsed.projects.length} Projektdateien gelesen. ${storageGet().length} Projekte sind lokal verfügbar.`)}catch{openModal('Import nicht möglich','Die Datei hat nicht das erwartete Format oder enthält unvollständige Daten.')}finally{e.target.value=''}};
    $('clearAll').onclick=()=>openModal('Alle lokalen Projekte löschen?','Hiermit entfernst du alle gespeicherten Entwürfe aus diesem Browser. Exportiere sie vorher, falls du sie behalten möchtest.',{confirm:'Endgültig löschen',doConfirm:()=>{localStorage.removeItem(STORAGE);refreshProjectCount();renderProjects()}});
    $('closeModal').onclick=()=>$('modal').close();$('modalCancel').onclick=()=>$('modal').close();
    $('moduleList').innerHTML=MODULES.map(([n,t,d])=>`<article class="module-card"><span class="module-number">MODUL ${n}</span><h3>${esc(t)}</h3><p>${esc(d)}</p><small>Geplant · noch nicht implementiert</small></article>`).join('');
    $('qualityList').innerHTML=CHECKS.map(([n,d],i)=>`<article class="quality-item"><span>${String(i+1).padStart(2,'0')}</span><div><h3>${esc(n)}</h3><p>${esc(d)}</p></div></article>`).join('');
    const params=new URLSearchParams(location.search);const link=params.get('url');if(link&&parseStoreUrl(link).type){$('storeUrl').value=link}
    goto(1);
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={parseStoreUrl,classify,normalizeApple,reviewPatterns,createMarkdown,buildPlan,CATEGORY,CHECKS}};
  if(typeof document!=='undefined') document.addEventListener('DOMContentLoaded',setup);
})();