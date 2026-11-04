import subprocess, sys, os
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Bold.otf', 22)
names = sys.argv[2:]; outp = sys.argv[1]
ts = [1.2, 4.3, 7.4, 10.5]; w = 270
rows = []
for n in names:
    ims = []
    for t in ts:
        b = subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',f'out/{n}.mp4','-frames:v','1','-vf',f'scale={w}:-2','-f','image2pipe','-vcodec','png','-'],capture_output=True).stdout
        ims.append(Image.open(BytesIO(b)).convert('RGB'))
    h = ims[0].height
    row = Image.new('RGB', (w*len(ts)+8*(len(ts)-1), h+30), 'white')
    d = ImageDraw.Draw(row); d.text((4,3), n, fill='black', font=font)
    for i, im in enumerate(ims): row.paste(im, (i*(w+8), 30))
    rows.append(row)
W = max(r.width for r in rows); H = sum(r.height for r in rows)
sheet = Image.new('RGB', (W, H), 'white'); y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.height
sheet.save(outp, quality=88); print(outp, sheet.size)
