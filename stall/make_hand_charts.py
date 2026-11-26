"""
Hand-drawable stall sheets. Run from the project root:  python stall/make_hand_charts.py
Every picture uses real paper sizes: 1 unit = 1 cm, so you can copy it with a ruler and markers.
Six sheets only: one big story chart, two attract banners, three small A4 sheets.
"""
import math
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Rectangle, Circle, Polygon

OUT = Path(__file__).resolve().parent / 'hand'
OUT.mkdir(parents=True, exist_ok=True)
LINK = 'materialhunt-2026.web.app'
for f in ('segoepr.ttf', 'segoeprb.ttf', 'segoeui.ttf', 'segoeuib.ttf'):
    font_manager.fontManager.addfont(r'C:\Windows\Fonts' + '\\' + f)
plt.rcParams['font.family'] = ['Segoe Print', 'Segoe UI']   # Segoe UI only supplies the rupee sign
plt.rcParams['text.parse_math'] = False
plt.rcParams['path.sketch'] = (0.7, 90, 2)      # slightly wobbly lines, like a marker

BLACK, BLUE, RED, GREEN = '#161616', '#1b4fbf', '#d02b20', '#14803c'
LW = 3.2


def paper(w, h, dpi):
    fig = plt.figure(figsize=(w / 2.54, h / 2.54), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, w)
    ax.set_ylim(h, 0)
    ax.axis('off')
    return fig, ax


def T(ax, x, y, s, cm, color=BLACK, ha='center', bold=True, **kw):
    """cm = height of the letters on the real paper"""
    return ax.text(x, y, s, fontsize=cm * 28.35 * 1.02, color=color, ha=ha, va='center', fontweight='bold' if bold else 'normal', linespacing=1.25, zorder=5, **kw)


def rect(ax, x, y, w, h, color=BLACK, lw=LW, fill='none'):
    ax.add_patch(Rectangle((x, y), w, h, fc=fill, ec=color, lw=lw))


def circle(ax, x, y, r, color=BLACK, lw=LW):
    ax.add_patch(Circle((x, y), r, fc='white', ec=color, lw=lw))


def line(ax, xs, ys, color=BLACK, lw=LW):
    ax.plot(xs, ys, color=color, lw=lw, solid_capstyle='round')


def arrow(ax, x1, y1, x2, y2, color=BLACK, head=0.9, lw=LW):
    line(ax, [x1, x2], [y1, y2], color, lw)
    a = math.atan2(y2 - y1, x2 - x1)
    for d in (2.6, -2.6):
        line(ax, [x2, x2 + head * math.cos(a + d)], [y2, y2 + head * math.sin(a + d)], color, lw)


def hexagon(ax, x, y, r, color=BLUE, lw=LW):
    for rr in (r, r * 0.5):
        ax.add_patch(Polygon([(x + rr * math.cos(math.pi / 6 + i * math.pi / 3), y + rr * math.sin(math.pi / 6 + i * math.pi / 3)) for i in range(6)], closed=True, fill=False, ec=color, lw=lw))


def tick(ax, x, y, s, color=GREEN):
    line(ax, [x, x + s * 0.35, x + s], [y, y + s * 0.4, y - s * 0.5], color, LW + 1)


def save(fig, name):
    fig.savefig(OUT / f'{name}.png', dpi=fig.dpi)
    plt.close(fig)
    print('wrote', name)


# ------------------------------------------------------------ 1. BIG story chart, A1 landscape (84 x 59.4 cm)
def big():
    fig, ax = paper(84, 59.4, 60)
    LWB = 5
    hexagon(ax, 22, 4.8, 3, BLUE, LWB)
    T(ax, 45, 4.4, 'MaterialHunt', 3.6, BLUE)
    T(ax, 45, 8.9, 'Test a metal BEFORE you build with it', 1.5, BLACK)

    def panel(x, y, w, h, n, title, color):
        rect(ax, x, y, w, h, color, LWB)
        circle(ax, x + 2.6, y + 2.8, 1.7, color, LWB)
        T(ax, x + 2.6, y + 2.8, str(n), 1.45, color)
        T(ax, x + 5.3, y + 2.8, title, 1.65, color, ha='left')
        line(ax, [x + 1, x + w - 1], [y + 5.4, y + 5.4], color, 3)

    # 1 problem
    panel(2, 11.5, 25.6, 24, 1, 'PROBLEM', RED)
    T(ax, 4.2, 20, '?', 4, RED)
    T(ax, 7.2, 20, 'Which metal?\nMost people guess.', 1.05, ha='left')
    T(ax, 4.2, 26, '₹', 3.4, RED)
    T(ax, 7.2, 26, 'Lab tests cost\ntime and money.', 1.05, ha='left')
    line(ax, [2.8, 4.1, 3.4, 4.8], [31.2, 30.4, 32.2, 31.4], RED, LWB)
    T(ax, 7.2, 31.4, 'Wrong choice:\nbends, rusts, melts.', 1.05, ha='left')

    # 2 what is new
    panel(29.2, 11.5, 25.6, 24, 2, "WHAT'S NEW", BLUE)
    for i, t in enumerate(['Indian grade names', 'Price in ₹ per kg', 'Quote request ready', 'Shows its own errors', 'Train your own ML']):
        y = 20 + i * 3.2
        arrow(ax, 30.8, y, 33, y, BLUE, 0.7)
        T(ax, 34, y, t, 1.05, ha='left')

    # 3 progress
    panel(56.4, 11.5, 25.6, 24, 3, 'PROGRESS', GREEN)
    for i, t in enumerate(['Simulator', 'Alloy Finder', 'Failure Doctor', 'ML Lab + Forum']):
        y = 19.4 + i * 2.7
        tick(ax, 58.2, y, 1.4)
        T(ax, 61, y, t, 1.05, ha='left')
    T(ax, 57.9, 31, 'NEXT:', 1.1, RED, ha='left')
    T(ax, 63.2, 31, 'lab test,\nmore data', 1.05, ha='left')

    # 4 how it works
    panel(2, 37.5, 52.8, 20, 4, 'HOW IT WORKS', BLACK)
    steps = ['Pick a\nmetal', 'Set heat\n+ load', 'Get a\nverdict', 'Grade +\n₹ price']
    for i, t in enumerate(steps):
        x = 4 + i * 13
        rect(ax, x, 44.5, 9.8, 6, BLUE if i != 2 else GREEN, LWB)
        T(ax, x + 4.9, 47.5, t, 1.15)
        if i < 3:
            arrow(ax, x + 10.2, 47.5, x + 12.6, 47.5, BLACK, 0.9, LWB)
    T(ax, 34.9, 52, 'SAFE / UNSAFE', 0.8, GREEN)
    T(ax, 28.4, 54.9, 'Known metal → datasheet.   New mix → ML (about 39% error)', 1.0, BLACK)

    # 5 who it helps
    panel(56.4, 37.5, 25.6, 20, 5, 'WHO IT HELPS', BLUE)
    for i, t in enumerate(['Students', 'Makers', 'Small workshops', 'Teachers']):
        y = 45.2 + i * 2.75
        circle(ax, 59, y - 0.45, 0.45, BLUE, 3)
        line(ax, [59, 59, 58.4, 59, 59.6], [y, y + 0.55, y + 1.1, y + 0.55, y + 1.1], BLUE, 3)
        T(ax, 61.5, y + 0.2, t, 1.1, ha='left')
    save(fig, '1-big-story-chart-A1')


# ------------------------------------------------------------ 2. attract banner A, A2 landscape (59.4 x 42 cm)
def banner_survive():
    fig, ax = paper(59.4, 42, 70)
    rect(ax, 1.2, 1.2, 57, 39.6, BLUE, 8)
    T(ax, 29.7, 7.5, 'WILL YOUR METAL', 4.1, BLACK)
    T(ax, 29.7, 15.5, 'SURVIVE?', 6.4, RED)
    # a metal bar over a flame
    rect(ax, 13, 22.2, 22, 3, BLACK, 7)
    for fx, s in ((18, 1.0), (24, 1.35), (30, 1.0)):
        ax.add_patch(Polygon([(fx - 2 * s, 32), (fx - 1.4 * s, 29), (fx - 0.5 * s, 30), (fx, 32 - 6 * s), (fx + 1 * s, 29.4), (fx + 1.5 * s, 30), (fx + 2 * s, 32)], closed=True, fill=False, ec=RED, lw=7))
    line(ax, [12, 36], [32.4, 32.4], BLACK, 7)
    arrow(ax, 38, 27, 43, 27, GREEN, 1.8, 9)
    T(ax, 49.5, 26.8, 'TRY IT\nFREE!', 3.0, GREEN)
    T(ax, 29.7, 37, LINK, 2.3, BLUE)
    save(fig, '2-banner-will-it-survive-A2')


# ------------------------------------------------------------ 3. attract banner B, A2 landscape
def banner_game():
    fig, ax = paper(59.4, 42, 70)
    rect(ax, 1.2, 1.2, 57, 39.6, RED, 8)
    T(ax, 29.7, 6.8, 'CAN YOU GUESS THE', 3.5, BLACK)
    T(ax, 29.7, 13.8, 'MYSTERY METAL?', 4.8, BLUE)
    for i, lab in enumerate('ABC'):
        x = 8.2 + i * 15.5
        rect(ax, x, 19.5, 12, 10.5, BLACK, 7)
        T(ax, x + 6, 24.8, '?', 6, RED)
        T(ax, x + 6, 32, lab, 2.2, BLACK)
    T(ax, 29.7, 36.6, 'Magnet it.  Weigh it.  Guess it!', 2.4, GREEN)
    save(fig, '3-banner-mystery-metal-A2')


# ------------------------------------------------------------ 4. A4 portrait: accuracy bars (1 cm = 5 %)
def accuracy():
    fig, ax = paper(21, 29.7, 150)
    T(ax, 10.5, 1.8, 'How wrong are we?', 1.25, BLUE)
    T(ax, 10.5, 3.5, 'Strength error. Smaller is better', 0.6)
    base = 23.6
    line(ax, [1.5, 19.8], [base, base])
    for x, v, c, lab in ((2.3, 83, RED, 'Just\nguessing'), (6.7, 42, BLUE, 'Our ML\n+ steels'), (11.1, 39, GREEN, '+ alumin-\nium data')):
        h = v / 5.0
        rect(ax, x, base - h, 3, h, c, 4)
        T(ax, x + 1.5, base - h - 0.8, f'{v}%', 0.85, c)
        T(ax, x + 1.5, base + 1.5, lab, 0.56)
    line(ax, [15.2, 15.2], [9, base + 2], BLACK, 2)
    T(ax, 17.5, 10, 'Aluminium\nonly', 0.5)
    for x, v, c, lab in ((15.8, 26, RED, 'before'), (17.9, 8, GREEN, 'after')):
        h = v / 5.0
        rect(ax, x, base - h, 1.6, h, c, 4)
        T(ax, x + 0.8, base - h - 0.7, f'{v}%', 0.62, c)
        T(ax, x + 0.8, base + 1.2, lab, 0.42)
    rect(ax, 1.5, 26.2, 18, 2.4, BLACK, 3)
    T(ax, 10.5, 27.4, 'Screening only. Test before you build!', 0.62, RED)
    save(fig, '4-A4-accuracy')


# ------------------------------------------------------------ 5. A4: QR
def qr():
    fig, ax = paper(21, 29.7, 150)
    T(ax, 10.5, 2.7, 'SCAN & TRY!', 2.0, BLUE)
    arrow(ax, 10.5, 4.8, 10.5, 7, RED, 0.9, 6)
    rect(ax, 3, 8, 15, 15, BLACK, 5)
    T(ax, 10.5, 15.5, 'stick the\nprinted QR\ncode here', 0.8, '#8a8a8a', bold=False)
    T(ax, 10.5, 25.2, LINK, 0.9, BLACK)
    T(ax, 10.5, 27.4, 'free  •  works on your phone', 0.65, GREEN)
    save(fig, '5-A4-scan-and-try')


# ------------------------------------------------------------ 6. A4: vote
def vote():
    fig, ax = paper(21, 29.7, 150)
    T(ax, 10.5, 2, 'YOU DECIDE!', 1.6, RED)
    T(ax, 10.5, 4.2, 'Which metal for a motor bracket?\nAdd one dot.', 0.65)
    for i, (lab, c) in enumerate((('Aluminium', BLUE), ('Steel', BLACK), ('Stainless', GREEN))):
        x = 1.2 + i * 6.4
        rect(ax, x, 6, 5.8, 10.5, c, 4)
        T(ax, x + 2.9, 17.5, lab, 0.65, c)
    T(ax, 10.5, 20, 'Would you use our site?', 0.75)
    for i, (lab, c) in enumerate((('YES', GREEN), ('MAYBE', BLUE), ('NO', RED))):
        x = 1.2 + i * 6.4
        rect(ax, x, 21.3, 5.8, 5.6, c, 4)
        T(ax, x + 2.9, 28, lab, 0.75, c)
    save(fig, '6-A4-vote')


if __name__ == '__main__':
    for fn in (big, banner_survive, banner_game, accuracy, qr, vote):
        fn()
