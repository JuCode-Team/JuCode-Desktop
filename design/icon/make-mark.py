"""JuCode backend mark (src/lib/jucode-mark.svg): the app icon's glyph — the
Instrument Serif "Ju" and the violet text cursor — as a square SVG. The
letters take currentColor so the mark follows the theme like the other
backend marks.

Regenerate:
  pip install fonttools brotli
  python design/icon/make-mark.py
"""
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT = 'node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2'
ACCENT = '#8b5cf6'

font = TTFont(FONT)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm
asc = font['hhea'].ascent

x, paths, bounds = 0, [], BoundsPen(glyphs)
for ch in 'Ju':
    g = glyphs[cmap[ord(ch)]]
    pen = SVGPathPen(glyphs)
    flip = (1, 0, 0, -1, x, asc)  # font units are y-up
    g.draw(TransformPen(pen, flip))
    g.draw(TransformPen(bounds, flip))
    paths.append(pen.getCommands())
    x += g.width
xmin, ymin, xmax, ymax = bounds.bounds

# Cursor proportions as in make-icon.py (size = the em).
caret_x = xmax + 0.11 * upm
caret_w = 0.034 * upm
caret_bottom = asc + 0.10 * upm
# The J descends below the baseline; keep all of it in the box.
w, h = caret_x + caret_w - xmin, max(ymax, caret_bottom) - ymin
side = max(w, h) * 1.04
ox, oy = xmin - (side - w) / 2, ymin - (side - h) / 2

r = lambda v: f'{v:.1f}'.rstrip('0').rstrip('.')
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{r(ox)} {r(oy)} {r(side)} {r(side)}">'
    f'<path fill="currentColor" d="{" ".join(paths)}"/>'
    f'<rect fill="{ACCENT}" x="{r(caret_x)}" y="{r(ymin)}" width="{r(caret_w)}" height="{r(caret_bottom - ymin)}" rx="{r(caret_w / 2)}"/>'
    '</svg>\n'
)
open('src/lib/jucode-mark.svg', 'w').write(svg)
