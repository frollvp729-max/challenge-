#!/usr/bin/env python3
"""Render 9:16 challenge reels: real footage + Instagram-native text plates + music.
Visual spec mirrors the three reels already rendered in vidIQ (Nov 6 08:00/08:30/10:00)."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

S = os.path.dirname(os.path.abspath(__file__))
CLIPS = os.path.join(S, 'clips')
OUT = os.path.join(S, 'out')
PLATES = os.path.join(S, 'plates')
MUSIC = {'A': os.path.join(S, 'music', 'trackA.mp3'), 'B': os.path.join(S, 'music', 'trackB.mp3')}
W, H, FPS, DUR = 1080, 1920, 30, 12.0
F_XB = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
F_B = '/usr/share/fonts/opentype/inter/Inter-Bold.otf'

STYLES = {
    #        x     w     h      font  size lh    fill                 text
    'tag':  (0.12, 0.76, 0.042, F_B,  40, 1.0, (0, 0, 0, 97),       (255, 255, 255, 255)),
    'hook': (0.07, 0.86, 0.115, F_XB, 58, 1.15, (255, 255, 255, 240), (17, 17, 17, 255)),
    'beat': (0.07, 0.86, 0.105, F_B,  50, 1.2, (255, 255, 255, 240), (17, 17, 17, 255)),
    'cta':  (0.10, 0.80, 0.12,  F_XB, 66, 1.12, (255, 255, 255, 242), (17, 17, 17, 255)),
    'sub':  (0.12, 0.76, 0.045, F_B,  40, 1.0, (0, 0, 0, 128),      (255, 255, 255, 255)),
}
PAD_X, PAD_Y, RADIUS = 34, 12, 14


def plate(kind, text, y, path):
    x, w, h, fpath, size, lh, fill, color = STYLES[kind]
    px, py, pw, ph = round(x * W), round(y * H), round(w * W), round(h * H)
    lines = text.split('\n')
    while True:  # shrink until every line fits the plate
        font = ImageFont.truetype(fpath, size)
        widest = max(font.getlength(l) for l in lines)
        block = len(lines) * size * lh
        if widest <= pw - 2 * PAD_X and block <= ph - 2 * PAD_Y:
            break
        size -= 1
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([px, py, px + pw, py + ph], radius=RADIUS, fill=fill)
    top = py + (ph - block) / 2
    for i, line in enumerate(lines):
        d.text((px + pw / 2, top + (i + 0.5) * size * lh), line, font=font, fill=color, anchor='mm')
    img.save(path)
    return size


def render(r):
    name = r['name']
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PLATES, exist_ok=True)
    cmd = ['ffmpeg', '-v', 'error', '-y']
    fc, labels = [], []
    for i, (clip, start, dur) in enumerate(r['scenes']):
        cmd += ['-ss', str(start), '-t', str(dur), '-i', os.path.join(CLIPS, clip + '.mp4')]
        fc.append(f'[{i}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},'
                  f'fps={FPS},setsar=1,format=yuv420p,trim=duration={dur},setpts=PTS-STARTPTS[v{i}]')
        labels.append(f'[v{i}]')
    n = len(r['scenes'])
    assert abs(sum(s[2] for s in r['scenes']) - DUR) < 1e-6, name
    fc.append(''.join(labels) + f'concat=n={n}:v=1:a=0[base]')
    cur, k = 'base', n
    sizes = []
    for j, ov in enumerate(r['overlays']):
        kind, text, t0, t1, y = ov
        p = os.path.join(PLATES, f'{name}_{j}.png')
        sizes.append((kind, plate(kind, text, y, p)))
        cmd += ['-loop', '1', '-t', str(DUR), '-i', p]
        fc.append(f"[{cur}][{k}:v]overlay=0:0:enable='between(t,{t0},{t1 - 0.001})'[o{j}]")
        cur, k = f'o{j}', k + 1
    track, offset = r['music']
    cmd += ['-ss', str(offset), '-t', str(DUR), '-i', MUSIC[track]]
    fc.append(f'[{k}:a]volume=0.85,afade=t=in:st=0:d=0.15,afade=t=out:st={DUR - 0.7}:d=0.7,'
              f'aresample=48000,aformat=channel_layouts=stereo[aout]')
    out = os.path.join(OUT, name + '.mp4')
    cmd += ['-filter_complex', ';'.join(fc), '-map', f'[{cur}]', '-map', '[aout]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high',
            '-pix_fmt', 'yuv420p', '-r', str(FPS), '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart', '-t', str(DUR), out]
    subprocess.run(cmd, check=True)
    return out, sizes


if __name__ == '__main__':
    reels = json.load(open(os.path.join(S, 'reels.json')))
    only = sys.argv[1:]
    for r in reels:
        if only and r['name'] not in only:
            continue
        out, sizes = render(r)
        shrunk = [f'{k}:{s}' for k, s in sizes if s < STYLES[k][4]]
        print(out, 'shrunk fonts:', shrunk or 'none')
