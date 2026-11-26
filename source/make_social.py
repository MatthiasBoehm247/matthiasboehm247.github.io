"""Create individual first-party social previews from the route registry; no external images."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,os,textwrap
root=Path(__file__).resolve().parents[1];out=root/'site/assets/labs/social';out.mkdir(parents=True,exist_ok=True)
fontdir=Path(os.getenv('LABS_FONT_DIR','/usr/share/fonts/truetype/dejavu'))
serif=fontdir/'DejaVuSerif.ttf';sans=fontdir/'DejaVuSans.ttf';bold=fontdir/'DejaVuSans-Bold.ttf'
if not all(p.exists() for p in [serif,sans,bold]): raise SystemExit('Setze LABS_FONT_DIR auf ein Verzeichnis mit DejaVu-Schriften.')
def font(p,n):return ImageFont.truetype(str(p),n)
def wrap(d,t,f,width):
 lines=[];line=''
 for word in t.split():
  candidate=f'{line} {word}'.strip()
  if d.textlength(candidate,font=f)>width and line:lines.append(line);line=word
  else:line=candidate
 lines.append(line);return lines
routes=json.loads((root/'source/routes.json').read_text());release=json.loads((root/'source/release-config.json').read_text())
for r in routes:
 im=Image.new('RGB',(1200,630),'#f6f4ef');d=ImageDraw.Draw(im);d.rectangle((0,0,1200,12),fill='#415b46');d.line((70,115,1130,115),fill='#98a898',width=2)
 d.text((70,46),'Matthias Böhm / Labs',font=font(serif,39),fill='#263b30');d.text((1130,61),'DIGITAL EDITION · '+release['edition'],font=font(bold,17),fill='#415b46',anchor='ra')
 type_label={'vorlagen':'PRAXISVORLAGEN','tools':'BROWSERWERKZEUG','wissen':'PRAXISWISSEN','studios':'ARBEITSABLAUF','forschung':'FORSCHUNGSAGENDA','labor':'EXPERIMENT','projekte':'PORTFOLIO'}.get(r['route'].split('/')[1],'DIGITAL LABS')
 d.text((70,155),type_label,font=font(bold,20),fill='#415b46')
 size=63
 while size>34:
  f=font(serif,size);lines=wrap(d,r['title'],f,1040)
  if len(lines)<=3 and all(d.textlength(x,font=f)<=1040 for x in lines):break
  size-=3
 for i,line in enumerate(lines[:4]):d.text((70,211+i*(size+10)),line,font=f,fill='#202720')
 d.line((70,511,1130,511),fill='#98a898',width=2);d.text((70,541),'Kostenlos · Deutschsprachig · Direkt im Browser',font=font(sans,25),fill='#415b46');d.text((70,584),'matthiasboehm247.github.io',font=font(sans,18),fill='#526056')
 im.save(out/(r['ogKey']+'.png'),optimize=True)
print(len(routes),'individuelle Vorschaugrafiken erzeugt')
