"""JuCode app icon: the serif "Ju" of the wordmark with a violet text cursor.

Regenerate:
  pip install pillow fonttools brotli
  python -c "from fontTools.ttLib import TTFont; f=TTFont('node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2'); f.flavor=None; f.save('/tmp/InstrumentSerif.ttf')"
  python design/icon/make-icon.py            # writes design/icon/icon-*.png
  npx tauri icon design/icon/icon-source.png -o src-tauri/icons   # desktop sizes
PWA icons (static/icon-192/512, apple-touch-icon) come from icon-fullbleed.png.
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
S = 4  # supersample
FONT = '/tmp/InstrumentSerif.ttf'
FG = (237, 237, 239, 255)
ACCENT = (139, 92, 246, 255)

def gradient(w, h, top, bottom):
    g = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(g)
    for y in range(h):
        t = y / (h - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        d.line([(0, y), (w, y)], fill=c)
    return g

def glyph(canvas, box, size):
    """Draw 'Ju' + caret centred in box (x0,y0,x1,y1), all in supersampled px."""
    d = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(FONT, size)
    text = 'Ju'
    l, t, r, b = d.textbbox((0, 0), text, font=font)
    asc, desc = font.getmetrics()
    stroke = max(1, round(size * 0.012))
    caret_w = round(size * 0.034)
    gap = round(size * 0.11)
    # a text cursor: from the cap height to just below the baseline
    cap_top = t
    caret_below = round(size * 0.10)
    total_w = (r - l) + gap + caret_w
    # optical vertical centre: cap height band (J top .. baseline)
    band_top, band_bot = t, asc
    x0, y0, x1, y1 = box
    ox = x0 + ((x1 - x0) - total_w) / 2 - l
    oy = y0 + ((y1 - y0) - (band_bot - band_top)) / 2 - band_top - size * 0.015
    d.text((ox, oy), text, font=font, fill=FG, stroke_width=stroke, stroke_fill=FG)
    cx = ox + r + gap
    d.rounded_rectangle([cx, oy + cap_top, cx + caret_w, oy + asc + caret_below], radius=caret_w / 2, fill=ACCENT)

def squircle_icon(px=1024):
    W = px * S
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    inset = round(W * 100 / 1024)
    size = W - 2 * inset
    radius = round(size * 0.225)
    # soft shadow like the macOS icon grid
    sh = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([inset, inset + W * 0.012, inset + size, inset + size + W * 0.012], radius=radius, fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(W * 0.018))
    img.alpha_composite(sh)
    bg = gradient(size, size, (30, 30, 34), (10, 10, 11))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    tile.paste(bg, (0, 0), mask)
    # hairline edge: lighter at the top, fading out
    edge = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([1, 1, size - 2, size - 2], radius=radius, outline=(255, 255, 255, 38), width=max(2, S * 2))
    fade = gradient(size, size, (255, 255, 255), (0, 0, 0)).convert('L')
    edge.putalpha(Image.eval(Image.composite(edge.getchannel('A'), Image.new('L', (size, size), 0), fade), lambda a: a))
    tile.alpha_composite(edge)
    glyph(tile, (0, 0, size, size), round(size * 0.62))
    img.alpha_composite(tile, (inset, inset))
    return img.resize((px, px), Image.LANCZOS)

def fullbleed_icon(px=1024):
    W = px * S
    img = gradient(W, W, (30, 30, 34), (10, 10, 11))
    glyph(img, (0, 0, W, W), round(W * 0.50))
    return img.resize((px, px), Image.LANCZOS)

HERE = os.path.dirname(os.path.abspath(__file__))
squircle_icon().save(os.path.join(HERE, 'icon-source.png'))
fullbleed_icon().save(os.path.join(HERE, 'icon-fullbleed.png'))
print('done')
