#!/usr/bin/env python3
"""
Extracts the card and class art from YOUR OWN copies of the Wonder Domain PDFs.
The art is not distributed with the module; upload the output folder's files with the
"Install Wonder Card Art" macro (they go to <Foundry Data>/wonder-domain-art/).

Usage:
  python3 tools/build_art.py Wonder_Domain.pdf Enchanter_Class.pdf Stargazer_Class.pdf out_dir
Requires: poppler-utils (pdfimages), opencv-contrib-python, pillow.
"""
import cv2, numpy as np, os, subprocess, sys, tempfile, glob
from PIL import Image

WD_PDF, EN_PDF, SG_PDF, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
TMP = tempfile.mkdtemp()

def extract(pdf, first, last, prefix):
    subprocess.run(['pdfimages', '-f', str(first), '-l', str(last), '-png', pdf, os.path.join(TMP, prefix)], check=True)

extract(WD_PDF, 5, 7, 'wd'); extract(WD_PDF, 1, 1, 'cover_wd'); extract(WD_PDF, 2, 3, 'wdp')
extract(EN_PDF, 11, 11, 'en'); extract(EN_PDF, 1, 1, 'cover_en')
extract(SG_PDF, 10, 10, 'sg'); extract(SG_PDF, 1, 1, 'cover_sg')
R = lambda name: os.path.join(TMP, name)
im = Image.open(R('wdp-008.png')).convert('RGB'); im.putalpha(Image.open(R('wdp-009.png'))); im.save(R('wdp-008_rgba.png'))
W, H, OX, OY = 750, 1050, 150, 75
BANNER = np.array([[34,0],[180,0],[180,248],[107,224],[34,248]], np.int32)

def inpaint(art, mask):
    mask = cv2.dilate(mask, np.ones((7,7),np.uint8))
    scale = 0.5
    small = cv2.resize(art, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    smask = cv2.resize(mask, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    dst = np.zeros_like(small)
    cv2.xphoto.inpaint(small, 255 - smask, dst, cv2.xphoto.INPAINT_FSR_FAST)
    fill = cv2.resize(dst, (art.shape[1], art.shape[0]), interpolation=cv2.INTER_CUBIC)
    soft = cv2.GaussianBlur(mask, (0,0), 3).astype(np.float32)[...,None]/255.0
    return (art*(1-soft) + fill*soft).astype(np.uint8)

def ribbon_y(img, x0, y0):
    card = img[y0:y0+H, x0:x0+W].astype(int)
    b, g, r = card[...,0], card[...,1], card[...,2]
    yellow = (r > 200) & (g > 140) & (b < 130)
    edge = np.concatenate([yellow[:, :110], yellow[:, -110:]], axis=1).mean(axis=1)
    for y in range(150, H):
        if edge[y] > 0.6: return y
    return 458

def crop(page, col, row, art_h, badge):
    img = cv2.imread(page)
    x0, y0 = OX + col*W, OY + row*H
    art_h = ribbon_y(img, x0, y0) - (32 if badge else 6)
    art = img[y0:y0+art_h, x0:x0+W].copy()
    mask = np.zeros(art.shape[:2], np.uint8)
    cv2.fillPoly(mask, [BANNER], 255)
    if badge: cv2.circle(mask, (660, 92), 58, 255, -1)
    return inpaint(art, mask)

def save(arr, name):
    cv2.imwrite(os.path.join(OUT, name + '.webp'), arr, [cv2.IMWRITE_WEBP_QUALITY, 88])

cards = {
 R('wd-000.png'): [['craftsmanship','runicShot','sharedDreams'],['runebound','windsOfChange','divergingLens'],['masterpiece','dreamSignal','fidgetyBolt']],
 R('wd-001.png'): [['aerialStrike','gemology','moonShield'],['twinnedMinds','auroraBlast','wonderTouched'],['archiveOfPossibilities','breakthrough','cosmicInspiration']],
 R('wd-002.png'): [['ruleOfSix','imaginarium','paradoxFlux']],
}
for page, rows in cards.items():
    for r, names in enumerate(rows):
        for c, n in enumerate(names):
            save(crop(page, c, r, 458, True), 'card-' + n)

subs = {
 R('en-000.png'): [['appraiser-foundation','appraiser-specialization','appraiser-mastery'],['spellweaver-foundation','spellweaver-specialization','spellweaver-mastery']],
 R('sg-000.png'): [['astrologer-foundation','astrologer-specialization','astrologer-mastery'],['clairvoyant-foundation','clairvoyant-specialization','clairvoyant-mastery']],
}
for page, rows in subs.items():
    for r, names in enumerate(rows):
        for c, n in enumerate(names):
            save(crop(page, c, r, 288, False), 'sub-' + n)

# class / domain covers (crop below the title, above the publisher logo)
for src, name in [(R('cover_en-000.png'),'class-enchanter'),(R('cover_sg-000.png'),'class-stargazer'),(R('cover_wd-000.png'),'domain-wonder')]:
    im = cv2.imread(src); h, w = im.shape[:2]
    y0, y1 = int(h*0.21), int(h*0.88)
    c = im[y0:y1, :]
    c = cv2.resize(c, (1200, int(1200 * c.shape[0] / c.shape[1])), interpolation=cv2.INTER_AREA)
    save(c, name)

# domain emblem: white glyph of the banner -> transparent PNG/WebP icon
ban = Image.open(R('wdp-008_rgba.png')).convert('RGBA')
a = np.asarray(ban).astype(np.int32)
white = (a[...,0] > 200) & (a[...,1] > 200) & (a[...,2] > 200) & (a[...,3] > 200)
ys, xs = np.where(white)
box = (xs.min()-4, ys.min()-4, xs.max()+5, ys.max()+5)
alpha = (white * 255).astype(np.uint8)
glyph = np.zeros(a.shape, np.uint8); glyph[...,:3] = 255; glyph[...,3] = alpha
g = Image.fromarray(glyph).crop(box)
size = max(g.size); sq = Image.new('RGBA', (size, size), (0,0,0,0)); sq.paste(g, ((size-g.width)//2, (size-g.height)//2))
sq = sq.resize((256, 256), Image.LANCZOS)
sq.save(os.path.join(OUT, 'wonder-emblem.png'))
print('done', len(os.listdir(OUT)))
