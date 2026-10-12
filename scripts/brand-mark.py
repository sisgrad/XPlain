#!/usr/bin/env python3
"""
Regenerates the XPlain vector marks from the letter of assets/social-logo.png:
  media/xplain.svg                     activity bar (currentColor silhouette)
  media/gutter-{light,dark}.svg        editor gutter, fresh explanations
  media/gutter-drift-{light,dark}.svg  editor gutter, drifted/outdated explanations
  webview/components/BrandMark.tsx     inline mark for the panel (mask + detail variants)
Coordinates are in the 1024x775 px space of the reference letter. Run from anywhere:
  python3 scripts/brand-mark.py
"""
import math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


W, H = 1024, 775
CX, CY = 512, 425          # the X converges on the card centre
DARK = '#0b0f17'

def band_to_center(x1, y1, x2, y2):
    """Quad whose outer edge is (x1,y1)-(x2,y2) and whose inner edge lies well behind the card."""
    # Extend both edge points toward the centre by factor so the arm ends under the card.
    def toward(x, y, f):
        return (x + (CX - x) * f, y + (CY - y) * f)
    a, b = (x1, y1), (x2, y2)
    c, d = toward(x2, y2, 0.78), toward(x1, y1, 0.78)
    return f'M{a[0]} {a[1]}L{b[0]} {b[1]}L{c[0]:.1f} {c[1]:.1f}L{d[0]:.1f} {d[1]:.1f}Z'

ARM_EDGES = [
    (128, 118, 318, 118),   # top-left
    (128, 727, 318, 727),   # bottom-left
    (706, 727, 896, 727),   # bottom-right
]
ARMS = [band_to_center(*e) for e in ARM_EDGES]

def arm_frame(edge):
    """Local frame of an arm: origin = middle of the outer edge, u = unit toward the centre, v = perpendicular."""
    x1, y1, x2, y2 = edge
    ox, oy = (x1 + x2) / 2, (y1 + y2) / 2
    ux, uy = CX - ox, CY - oy
    L = math.hypot(ux, uy); ux, uy = ux / L, uy / L
    vx, vy = -uy, ux
    return lambda t, sgn: (ox + ux * t + vx * sgn, oy + uy * t + vy * sgn)

def arm_traces():
    """Simplified circuit traces: polylines in arm-local coords (t along the arm, s across)."""
    out, pads = [], []
    for edge in ARM_EDGES:
        f = arm_frame(edge)
        def P(t, s): x, y = f(t, s); return f'{x:.0f} {y:.0f}'
        out.append(f'M{P(40, -30)}L{P(120, -30)}L{P(150, 0)}L{P(230, 0)}')
        out.append(f'M{P(60, 35)}L{P(170, 35)}L{P(200, 10)}')
        out.append(f'M{P(250, -40)}L{P(250, 20)}')
        for t, s_ in ((40, -30), (60, 35), (230, 0), (200, 10)):
            x, y = f(t, s_); pads.append((x, y))
        x, y = f(110, 0); pads.append((x, y, 'chip'))
    return out, pads

# Microscope axis: objective tip near the card's top-right, eyepiece top-right corner.
TIP = (588, 302)
EYE = (812, 52)
ANG = math.degrees(math.atan2(EYE[1] - TIP[1], EYE[0] - TIP[0]))   # ≈ -48°
LEN = math.hypot(EYE[0] - TIP[0], EYE[1] - TIP[1])

def scope_parts():
    """Rects in local coords (x along the axis from the tip)."""
    return [
        # (x, half-width, length, rx)
        (0,   36,  60, 10),   # objective nose
        (56,  54, 160, 20),   # tube
        (210, 66,  44, 10),   # collar
        (248, 56,  LEN - 248 - 4, 22),  # eyepiece cylinder
        (LEN - 34, 64, 34, 10),  # eyepiece top ring
    ]

KNOB = (746, 246)
PIPE = 'M746 300V392q0 42 -36 42H704'   # knob → card right tab

CARD = (330, 298, 364, 254, 70)          # x y w h r
TABS = [(500, 280, 24, 20), (500, 550, 24, 20), (314, 414, 20, 24), (690, 414, 20, 24)]
ROWS = [(372, 592), (411, 560), (449, 586), (487, 545)]   # y, bar end x

CHEV_L = 'M240 300L82 435L240 568'
CHEV_R = f'M{W-240} 300L{W-82} 435L{W-240} 568'

TRACES, PADS = arm_traces()

def outline_svg(glow=True):
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">']
    if glow:
        s.append('<defs><filter id="glow" x="-10%" y="-10%" width="120%" height="120%">'
                 '<feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
    s.append(f'<g filter="{"url(#glow)" if glow else "none"}" fill="{DARK}" stroke="#fff" stroke-width="16" stroke-linejoin="round" stroke-linecap="round">')
    for p in ARMS:
        s.append(f'<path d="{p}"/>')
    # traces
    s.append('<g fill="none" stroke-width="5" opacity="0.8">')
    for t in TRACES:
        s.append(f'<path d="{t}"/>')
    s.append('</g>')
    s.append('<g stroke="none" fill="#fff" opacity="0.9">')
    for pad in PADS:
        x, y = pad[0], pad[1]
        if len(pad) == 3:
            s.append(f'<rect x="{x-16:.0f}" y="{y-16:.0f}" width="32" height="32" rx="4" fill="none" stroke="#fff" stroke-width="5"/>')
            s.append(f'<rect x="{x-7:.0f}" y="{y-7:.0f}" width="14" height="14" rx="2"/>')
        else:
            s.append(f'<rect x="{x-8:.0f}" y="{y-8:.0f}" width="16" height="16" rx="3"/>')
    s.append('</g>')
    # knob pipe (outlined tube)
    s.append(f'<path d="{PIPE}" fill="none" stroke-width="48"/>')
    s.append(f'<path d="{PIPE}" fill="none" stroke="{DARK}" stroke-width="20"/>')
    # microscope
    s.append(f'<g transform="translate({TIP[0]} {TIP[1]}) rotate({ANG:.2f})">')
    for x, hw, ln, rx in scope_parts():
        s.append(f'<rect x="{x:.1f}" y="{-hw}" width="{ln:.1f}" height="{hw*2}" rx="{rx}"/>')
    s.append('</g>')
    # knob
    s.append(f'<circle cx="{KNOB[0]}" cy="{KNOB[1]}" r="50"/>')
    s.append(f'<circle cx="{KNOB[0]}" cy="{KNOB[1]}" r="26"/>')
    # card + tabs
    x, y, w, h, r = CARD
    for tx, ty, tw, th in TABS:
        s.append(f'<rect x="{tx}" y="{ty}" width="{tw}" height="{th}" rx="4" stroke-width="10"/>')
    s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}"/>')
    s.append('<g stroke="none" fill="#fff">')
    for ry, end in ROWS:
        s.append(f'<circle cx="405" cy="{ry}" r="10"/>')
        s.append(f'<rect x="432" y="{ry-10}" width="{end-432}" height="20" rx="10"/>')
    s.append('</g>')
    # chevrons (outlined)
    for c in (CHEV_L, CHEV_R):
        s.append(f'<path d="{c}" fill="none" stroke-width="74"/>')
        s.append(f'<path d="{c}" fill="none" stroke="{DARK}" stroke-width="40"/>')
    s.append('</g></svg>')
    return '\n'.join(s)

def mask_svg():
    """Monochrome currentColor version for the activity bar / gutter (silhouette + knocked-out card)."""
    x, y, w, h, r = CARD
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="24" height="24">']
    # Hide everything that falls inside the card so the arms stop at its edge.
    s.append(f'<defs><mask id="card-hole"><rect width="{W}" height="{H}" fill="#fff"/>'
             f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="#000"/></mask></defs>')
    s.append('<g mask="url(#card-hole)" fill="currentColor" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round" stroke-width="0">')
    for p in ARMS:
        s.append(f'<path d="{p}"/>')
    s.append(f'<path d="{PIPE}" fill="none" stroke-width="48"/>')
    s.append(f'<g transform="translate({TIP[0]} {TIP[1]}) rotate({ANG:.2f})">')
    for x, hw, ln, rx in scope_parts():
        s.append(f'<rect x="{x:.1f}" y="{-hw}" width="{ln:.1f}" height="{hw*2}" rx="{rx}"/>')
    s.append('</g>')
    s.append(f'<circle cx="{KNOB[0]}" cy="{KNOB[1]}" r="50"/>')
    for c in (CHEV_L, CHEV_R):
        s.append(f'<path d="{c}" fill="none" stroke-width="74"/>')
    s.append('</g>')
    s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="none" stroke="currentColor" stroke-width="40"/>')
    s.append('<g fill="currentColor">')
    for ry, end in ROWS:
        s.append(f'<circle cx="405" cy="{ry}" r="14"/>')
        s.append(f'<rect x="432" y="{ry-14}" width="{end-432}" height="28" rx="14"/>')
    s.append('</g></svg>')
    return '\n'.join(s)


def indent(s, n):
    pad=' '*n
    return '\n'.join(pad+l for l in s.strip().split('\n'))
W, H = W, H
SQ = f'viewBox="0 -{(W-H)//2} {W} {W}"'   # square, mark centred

def mask_body(color='currentColor', drift=False):
    body = mask_svg()
    body = body.split('\n', 1)[1].rsplit('</svg>', 1)[0]  # strip <svg> wrapper
    if drift:
        # Replace the text rows with an exclamation mark.
        rows = re.search(r'<g fill="currentColor">\n(?:.*\n)*?</g>', body)
        excl = '<g fill="currentColor"><rect x="494" y="350" width="36" height="88" rx="18"/><circle cx="512" cy="482" r="20"/></g>'
        body = body[:rows.start()] + excl + body[rows.end():]
    return body.replace('currentColor', color)

def mask_file_svg(size, color='currentColor', drift=False, glow=False):
    defs = ''
    g_open, g_close = '', ''
    if glow:
        defs = '<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="28" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        g_open, g_close = '<g filter="url(#glow)">', '</g>'
    body = mask_body(color, drift)
    # move the mask <defs> content and merge with ours
    m = re.search(r'<defs>(.*?)</defs>', body, re.S)
    inner_defs = m.group(1) if m else ''
    body = body.replace(m.group(0), '') if m else body
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" {SQ}>\n'
            f'<!-- XPlain letter (assets/social-logo.png): bold X whose top-right arm is a microscope, side chevrons, explanation card. -->\n'
            f'<defs>{inner_defs}{defs}</defs>\n{g_open}{body}{g_close}\n</svg>\n')

open(ROOT + '/media/xplain.svg', 'w').write(mask_file_svg(24))
open(ROOT + '/media/gutter-dark.svg', 'w').write(mask_file_svg(16, '#e2e8f0', glow=True))
open(ROOT + '/media/gutter-light.svg', 'w').write(mask_file_svg(16, '#1f2937'))
open(ROOT + '/media/gutter-drift-dark.svg', 'w').write(mask_file_svg(16, '#fbbf24', drift=True, glow=True))
open(ROOT + '/media/gutter-drift-light.svg', 'w').write(mask_file_svg(16, '#b45309', drift=True))

# Brand mark component: mask geometry (currentColor) + detailed outline for the hero.
mask_inner = mask_body()
m = re.search(r'<defs>(.*?)</defs>', mask_inner, re.S); mask_defs = m.group(1); mask_inner = mask_inner.replace(m.group(0), '')
detail = outline_svg(glow=False).split('\n', 1)[1].rsplit('</svg>', 1)[0]
detail = detail.replace(DARK, 'var(--xp-card-fill, #0b0f17)').replace('#fff', 'currentColor')
def jsx(s):
    # SVG attrs are valid JSX in Preact as-is (kebab-case allowed); just fix self-closing & mask ids.
    return s.replace('mask="url(#card-hole)"', 'mask="url(#xp-card-hole)"').replace('id="card-hole"', 'id="xp-card-hole"')
tsx = f'''/**
 * Inline XPlain letter — same geometry as media/xplain.svg (generated from the logo in
 * assets/social-logo.png): bold X whose top-right arm is a microscope, side chevrons and
 * the explanation card. `mask` = silhouette in currentColor (header, chips); `detail` =
 * outlined version with dark fills for the Result empty state.
 */
export function BrandMark(props: {{ class?: string; size?: number; title?: string; variant?: 'mask' | 'detail' }}) {{
  const size = props.size ?? 16;
  const detail = props.variant === 'detail';
  return (
    <svg
      class={{`brand-mark ${{props.class ?? ''}}`}}
      width={{size}}
      height={{size}}
      viewBox="0 -{(W-H)//2} {W} {W}"
      aria-hidden={{props.title ? undefined : true}}
      role={{props.title ? 'img' : undefined}}
    >
      {{props.title && <title>{{props.title}}</title>}}
      {{detail ? (
        <>
{indent(jsx(detail), 10)}
        </>
      ) : (
        <>
          <defs>{mask_defs}</defs>
{indent(jsx(mask_inner), 10)}
        </>
      )}}
    </svg>
  );
}}
'''
open(ROOT + '/webview/components/BrandMark.tsx', 'w').write(tsx)
