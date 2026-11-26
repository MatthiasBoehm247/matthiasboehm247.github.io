"""Self-authored explanatory diagrams. All numerical examples are illustrative."""
from pathlib import Path
from xml.sax.saxutils import escape
import math
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'site/assets/labs/diagrams';OUT.mkdir(parents=True,exist_ok=True)
PAPER='#f6f4ef';INK='#202720';GREEN='#415b46';PALE='#e2eae1';LINE='#a5afa4';OCHRE='#a67d3d';WHITE='#fffefa'
def txt(x,y,s,size=18,weight=400,anchor='start',fill=INK):return f'<text x="{x}" y="{y}" font-family="system-ui,sans-serif" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{fill}">{escape(str(s))}</text>'
def rect(x,y,w,h,fill=PALE,stroke=LINE,rx=5):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}"/>'
def line(x,y,X,Y,stroke=GREEN,width=2,dash=''):return f'<line x1="{x}" y1="{y}" x2="{X}" y2="{Y}" stroke="{stroke}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>'
def arrow(x,y,X,Y):return line(x,y,X,Y)+f'<path d="M{X} {Y} l-9 -5 v10z" fill="{GREEN}" transform="rotate({math.degrees(math.atan2(Y-y,X-x))} {X} {Y})"/>'
def box(x,y,w,h,label,sub):return rect(x,y,w,h)+txt(x+w/2,y+29,label,18,650,'middle')+txt(x+w/2,y+53,sub,15,400,'middle',GREEN)
def svg(name,title,sub,body):
 text=f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="280" viewBox="0 0 900 280" role="img" aria-label="{escape(title)}"><title>{escape(title)}</title><rect width="900" height="280" fill="{PAPER}"/>{txt(30,36,title,23,650)}{txt(30,61,sub,14,400,fill=GREEN)}{body}</svg>\n'; (OUT/f'{name}.svg').write_text(text)
# Matrix: localized variants, not a plan to internationalize Digital Labs.
b=''; labels=['de','de-AT','en'];
for i,l in enumerate(labels):
 b+=txt(315+i*134,100,l,18,650,'middle')+txt(128,140+i*43,l,18,650)
 for j in range(3):
  x=260+j*134;y=111+i*43;b+=rect(x,y,110,35,GREEN if i==j else PALE,GREEN)+txt(x+55,y+23,'selbst' if i==j else 'verweist',15,600,'middle',WHITE if i==j else INK)
svg('hreflang-matrix','Hreflang: vollständige Verweismatrix','Illustration: drei tatsächlich vorhandene Varianten; jede Zeile nennt alle drei.',b+txt(30,266,'Diagonal = Selbstreferenz. Alle übrigen Felder = gegenseitige Referenz.',15,400,fill=GREEN))
# Metric separation
b=box(30,91,260,70,'Organische Suche','Impressionen → Klicks')+box(320,91,260,70,'KI-Stichprobe','Antworten → Zitationen')+box(610,91,260,70,'Website-Nutzung','Besuche → Aufgaben')+txt(160,190,'CTR = Klicks / Impressionen',15,500,'middle')+txt(450,190,'Quote = Zitationen / Antworten',15,500,'middle')+txt(740,190,'Erfolg / beobachtete Besuche',15,500,'middle')+line(30,220,870,220,LINE)+txt(450,249,'Unterschiedliche Nenner. Keine gemeinsame Prozentzahl ohne Modell.',17,650,'middle')
svg('seo-geo-metrics','SEO und GEO: getrennte Messgrößen','Kennzahlen nur mit festgelegter Definition und Stichprobe vergleichen.',b)
# ROI waterfall (illustrative)
b=''; vals=[(45,2000,'Beitrag',GREEN),(345,1500,'Kosten',OCHRE),(645,500,'Überschuss',GREEN)]
for x,v,label,c in vals:
 h=v/2000*105;b+=rect(x,211-h,210,h,c,c,0)+txt(x+105,201-h,f'{v:,} €'.replace(',','.'),19,650,'middle')+txt(x+105,238,label,18,600,'middle')
b+=txt(300,168,'−',27,650,'middle')+txt(600,168,'=',27,650,'middle')+txt(450,265,'ROI = 500 / 1.500 = 33,3 % (hypothetisch)',16,650,'middle')
svg('seo-roi','ROI: Beitrag statt Umsatz','Beispielszenario mit einheitlichem Zeitraum.',b)
# CSS clamp chart
b=line(88,223,845,223)+line(88,223,88,89)+line(88,191,845,191,LINE,1,'5 5')+line(88,106,845,106,LINE,1,'5 5')+txt(72,195,'16',16,400,'end')+txt(72,110,'24',16,400,'end')+txt(32,87,'px',15)+txt(177,247,'320 px',16,500,'middle')+txt(698,247,'1120 px',16,500,'middle')+line(177,223,177,191,LINE)+line(698,223,698,106,LINE)+f'<path d="M88 191 H177 L698 106 H845" stroke="{GREEN}" stroke-width="5" fill="none"/>'+txt(410,145,'linearer Bereich',16,500,'middle')+txt(803,94,'Maximum',14,500,'middle')
svg('clamp-curve','Typografie: Minimum, Verlauf, Maximum','Beispiel mit 16 px Root-Schrift; clamp(1rem, 0.8rem + 1vw, 1.5rem).',b)
# responsive candidates
b=rect(32,92,240,138,WHITE)+rect(49,110,112,99,PALE)+txt(105,163,'400w',18,650,'middle')+rect(308,92,240,138,WHITE)+rect(325,110,205,99,PALE)+txt(427,163,'800w',18,650,'middle')+rect(584,92,282,138,WHITE)+rect(601,110,248,99,PALE)+txt(725,163,'1600w',18,650,'middle')+txt(450,255,'sizes beschreibt die CSS-Breite; der Browser wählt die Ressource.',16,650,'middle')
svg('responsive-sources','Responsive Bilder: drei Quelldateien','Breitenangaben müssen den tatsächlichen Dateiabmessungen entsprechen.',b)
# Sprite grid
b=''; cell=60; step=62; x0=80;y0=96
for i in range(6):
 x=x0+(i%3)*step;y=y0+(i//3)*step;b+=rect(x,y,cell,cell,WHITE,LINE,0)+f'<circle cx="{x+30}" cy="{y+27}" r="16" fill="{PALE}" stroke="{GREEN}"/><path d="M{x+18} {y+44}L{x+42} {y+44}" stroke="{GREEN}" stroke-width="3"/>'+txt(x+30,y+54,str(i+1),10,400,'middle')
b+=txt(173,249,'3 × 2 Frames',16,650,'middle')+box(350,102,500,70,'196 × 130 px','3 × 64 + 2 × 2; 2 × 64 + 1 × 2')+txt(600,214,'Zellen: 64 × 64 px · Abstand: 2 px',17,500,'middle')+txt(600,241,'Pivot und Kollision separat dokumentieren.',16,400,'middle')
svg('sprite-grid','Sprite-Sheet: Raster und Abstände','Schematische Frame-Rechtecke, nicht maßstabgetreu.',b)
# Loot probability with repeated independent draws
b=rect(40,100,492,40,GREEN,GREEN,0)+rect(532,100,246,40,PALE,GREEN,0)+rect(778,100,82,40,OCHRE,OCHRE,0)+txt(286,126,'60 %',18,650,'middle',WHITE)+txt(655,126,'30 %',18,650,'middle')+txt(819,126,'10 %',15,650,'middle',WHITE)+txt(40,177,'Genau ein gewichteter Eintrag pro Ziehung',17,600)+txt(40,205,'Bei 10 unabhängigen Ziehungen:',17)+txt(40,238,'P(mindestens ein 10-%-Treffer) = 1 − 0,9¹⁰ ≈ 65,13 %',22,650)
svg('loot-probability','Loot: Gewichte und Trefferwahrscheinlichkeit','Rechenbeispiel ohne Pity-System oder Ziehung ohne Zurücklegen.',b)
# Timing grid
b='';
for i in range(16):
 x=40+i*51;b+=rect(x,114,43,47,GREEN if i%4==0 else PALE,GREEN if i%4==0 else LINE,3)+txt(x+21.5,143,str(i+1),15,650,'middle',WHITE if i%4==0 else INK)
for i in range(5):
 x=40+i*204;b+=line(x,177,x,188)+txt(x,211,str(i*.5).replace('.',',')+' s',15,500,'middle')
b+=line(40,182,856,182,LINE)+txt(450,252,'16 Schritte × 0,125 s = 2 Sekunden',20,650,'middle')
svg('sequencer-timing','Sequencer: ein 4/4-Takt bei 120 BPM','Sechzehntelraster; Audiozeit und grafische Anzeige getrennt führen.',b)
# Envelope
b=line(70,225,855,225)+line(70,225,70,86)+txt(60,103,'1',15,400,'end')+txt(60,158,'0,6',15,400,'end')+txt(60,229,'0',15,400,'end')+f'<path d="M70 225 L177 104 L350 153 L638 153 L815 225 Z" fill="{PALE}"/><path d="M70 225 L177 104 L350 153 L638 153 L815 225" fill="none" stroke="{GREEN}" stroke-width="4"/>'
for x,label in [(123,'Attack'),(263,'Decay'),(494,'Sustain'),(730,'Release')]:b+=txt(x,251,label,16,650,'middle')
b+=line(177,104,177,225,LINE,1,'4 4')+line(350,153,350,225,LINE,1,'4 4')+line(638,91,638,225,OCHRE,1,'5 4')+txt(638,87,'Taste loslassen',15,500,'middle')
svg('adsr-envelope','ADSR: vier unterschiedliche Phasen','Schematischer Pegelverlauf, Zeitachsen nicht maßstabgetreu.',b)
# Experiment flow
b=box(30,94,250,75,'Hypothese','Ziel und Messgröße')+arrow(280,132,325,132)+box(325,94,250,75,'Vergleich','Gruppen und Daten')+arrow(575,132,620,132)+box(620,94,250,75,'Auswertung','Effekt und Unsicherheit')+line(30,204,870,204,LINE)+txt(450,232,'Vorab: Stichprobe, Abbruchregeln und Ausschlüsse festlegen.',18,650,'middle')+txt(450,258,'Nachher: Abweichungen offenlegen; neutrale Ergebnisse zulassen.',16,400,'middle')
svg('experiment-workflow','Web-Experiment: vor der Messung planen','Ein Ablaufmodell, kein tatsächlich durchgeführtes Experiment.',b)
print('10 selbst erstellte Fachdiagramme erzeugt')
