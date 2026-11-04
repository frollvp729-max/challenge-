import subprocess, sys, json, os, glob
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype(subprocess.run(['fc-match','-f','%{file}','Inter:bold'],capture_output=True,text=True).stdout, 18)
def dur(f):
    return float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True).stdout)
def frame(f,t,w=160):
    out=subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',f,'-frames:v','1','-vf',f'scale={w}:-2','-f','image2pipe','-vcodec','png','-'],capture_output=True).stdout
    from io import BytesIO
    return Image.open(BytesIO(out)).convert('RGB')
prefix=sys.argv[1]; outp=sys.argv[2]
files=sorted(glob.glob(prefix+'_*.mp4'))
rows=[]
for f in files:
    d=dur(f); n=7
    ts=[min(d-0.5, i*d/(n-1)) for i in range(n)]
    ims=[frame(f,t) for t in ts]
    h=max(i.height for i in ims)
    row=Image.new('RGB',(160*n, h+26),'white')
    dr=ImageDraw.Draw(row)
    dr.text((4,2),f'{os.path.basename(f)}  dur={d:.1f}s',fill='black',font=font)
    for k,(im,t) in enumerate(zip(ims,ts)):
        row.paste(im,(160*k,26))
        dr.text((160*k+4,30),f'{t:.1f}s',fill='yellow',font=font,stroke_width=2,stroke_fill='black')
    rows.append(row)
W=max(r.width for r in rows); H=sum(r.height for r in rows)
sheet=Image.new('RGB',(W,H),'white'); y=0
for r in rows: sheet.paste(r,(0,y)); y+=r.height
sheet.save(outp,quality=85)
print(outp, sheet.size)
