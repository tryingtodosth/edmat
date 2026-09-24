# -*- coding: utf-8 -*-
"""Generuje publikację HTML w kształcie 'Plan lekcji Optivum' (VULCAN).

Wyjście: ../optivum/{index.html,lista.html,plany/*.html}  (windows-1250)
         ../optivum/utf8/...                              (ten sam plan w UTF-8)
         ../optivum/edge/...                              (pułapki: rowspan, pusty dzień, wychowawca)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as K
from common import L, place, place_with
import school as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'optivum')
GEN_DATE = '2026-09-01'
NPER = 8

# --- zredukowany zbiór publikacji: 8 oddziałów, 6 nauczycieli, 4 sale -----------------
CLASSES = [('4a', '4 A', 'SB'), ('4b', '4 B', 'SB'), ('5a', '5 A', 'NJ'), ('5b', '5 B', 'NJ'),
           ('6a', '6 A', 'LK'), ('7a', '7 A', 'SB'), ('7b', '7 B', 'NJ'), ('8b', '8 B', 'LK')]
TEACHERS = ['NJ', 'SB', 'KE', 'AK', 'LK', 'MA']          # n1..n6
ROOMS = [('12', 'Sala 12'), ('8', 'Sala 8'), ('15', 'Sala 15'), ('sg', 'Sala gimnastyczna')]  # s1..s4

TNAME = {t[0]: t for t in S.TEACHERS}
# nazwy przedmiotów tak, jak wpisuje je szkoła w Optivum (skrócone, małą literą)
SUBJ = {'mat': 'matematyka', 'pol': 'j.polski', 'ang': 'j.angielski', 'his': 'historia',
        'geo': 'geografia', 'wf': 'w-f'}

O = {c[0]: 'o%d' % (i + 1) for i, c in enumerate(CLASSES)}
N = {t: 'n%d' % (i + 1) for i, t in enumerate(TEACHERS)}
R = {r[0]: 's%d' % (i + 1) for i, r in enumerate(ROOMS)}
ROOM_NAME = dict(ROOMS)
ROOMS_ALL = [r[0] for r in ROOMS]


def build():
    lessons, pairs = [], []
    for cid, _nm, _wy in CLASSES:
        lessons.append(L([cid], 'pol', ['SB'], 3, rooms=['8', '12']))
        lessons.append(L([cid], 'mat', ['NJ'], 3, rooms=['12', '8']))
        lessons.append(L([cid], 'his', ['LK'], 1, rooms=['12', '8', '15']))
        lessons.append(L([cid], 'geo', ['LK'], 1, rooms=['12', '8', '15']))
        a1 = L([cid], 'ang', ['KE'], 2, rooms=['15', '12', '8'], group='1/2', divtag=1)
        a2 = L([cid], 'ang', ['AK'], 2, rooms=['12', '8', '15'], group='2/2', divtag=1)
        lessons += [a1, a2]
        pairs.append((a1, a2))
        lessons.append(L([cid], 'wf', ['MA'], 2, rooms=['sg'], ppc=2))   # lekcja podwójna
    return lessons, pairs


def schedule(lessons, pairs):
    sched = K.Sched()
    cards = []
    lead = {id(a) for a, _ in pairs}
    foll = {id(b) for _, b in pairs}
    for a, b in pairs:
        got = place(sched, [a], ROOMS_ALL, max_period=NPER)
        cards += got
        for c in got:
            f = place_with(sched, b, c, ROOMS_ALL)
            if f:
                cards.append(f)
    cards += place(sched, [l for l in lessons if id(l) not in lead and id(l) not in foll], ROOMS_ALL, max_period=NPER)
    return cards


# --- render ---------------------------------------------------------------------------
HEAD = '''<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=%(cs)s">
<title>%(title)s</title>
<style type="text/css">
body {font-family: Arial, Helvetica, sans-serif; font-size: 10pt}
.tabela {border-collapse: collapse; empty-cells: show}
.tabela td, .tabela th {border: 1px solid #808080; padding: 1px 4px; vertical-align: top}
.nr {text-align: right; width: 20px}
.g {text-align: center; width: 80px; white-space: nowrap}
.l {text-align: left}
.p {color: #000080; font-weight: bold}
.n {color: #800000}
.o {color: #800000}
.s {color: #008000}
.tytulnapis {font-size: 14pt; font-weight: bold}
.opis {font-size: 9pt}
</style>
</head>
<body>
<h1>Plan lekcji</h1>
'''

FOOT = '''<p>
<table>
<tr><td>wygenerowano %(date)s<br>za pomocą programu <b>Plan lekcji Optivum</b> firmy <a href="http://www.vulcan.edu.pl/" target="_blank">VULCAN</a></td></tr>
</table>
</body>
</html>
'''


def grid_html(title, rows, subtitle='', cs='windows-1250'):
    out = [HEAD % {'cs': cs, 'title': title}]
    out.append('<table>\n<tr><td><span class="tytulnapis">%s</span>%s</td></tr>\n</table>\n' %
               (title, (' <span class="opis">%s</span>' % subtitle) if subtitle else ''))
    out.append('<table class="tabela">\n')
    out.append('<tr><th class="nr">Nr</th><th class="g">Godz</th>' +
               ''.join('<th>%s</th>' % d for d in K.DAYS) + '</tr>\n')
    for no, st, en in K.PERIODS:
        cells = rows.get(no, {})
        out.append('<tr><td class="nr">%d</td><td class="g">%s-%s</td>' % (no, st, K.hhmm(en)))
        for d in range(5):
            c = cells.get(d)
            out.append('<td class="l">%s</td>' % (c if c else '&nbsp;'))
        out.append('</tr>\n')
    out.append('</table>\n')
    out.append(FOOT % {'date': GEN_DATE})
    return ''.join(out)


def cell_for_class(cs):
    """Komórka na stronie oddziału: przedmiot, skrót nauczyciela, sala."""
    parts = []
    for c in cs:
        l = c['lesson']
        nm = SUBJ[l['subject']] + ('-' + l['group'] if l['group'] else '')
        t = l['teachers'][0]
        s = '<span class="p">%s</span> <a href="../plany/%s.html" class="n">%s</a>' % (nm, N[t], t)
        if c['room']:
            s += ' <a href="../plany/%s.html" class="s">%s</a>' % (R[c['room']], c['room'])
        parts.append(s)
    return '<br>'.join(parts)


def cell_for_teacher(cs):
    parts = []
    for c in cs:
        l = c['lesson']
        cl = l['classes'][0]
        label = dict((a, b) for a, b, _ in CLASSES)[cl].replace(' ', '') + ('-' + l['group'] if l['group'] else '')
        s = '<span class="p">%s</span> <a href="../plany/%s.html" class="o">%s</a>' % (SUBJ[l['subject']], O[cl], label)
        if c['room']:
            s += ' <a href="../plany/%s.html" class="s">%s</a>' % (R[c['room']], c['room'])
        parts.append(s)
    return '<br>'.join(parts)


def cell_for_room(cs):
    parts = []
    for c in cs:
        l = c['lesson']
        cl = l['classes'][0]
        label = dict((a, b) for a, b, _ in CLASSES)[cl].replace(' ', '') + ('-' + l['group'] if l['group'] else '')
        parts.append('<span class="p">%s</span> <a href="../plany/%s.html" class="o">%s</a> '
                     '<a href="../plany/%s.html" class="n">%s</a>'
                     % (SUBJ[l['subject']], O[cl], label, N[l['teachers'][0]], l['teachers'][0]))
    return '<br>'.join(parts)


def expand(cards):
    """Rozwija lekcje podwójne na pojedyncze godziny (Optivum publikuje każdą godzinę osobno)."""
    out = []
    for c in cards:
        for k in range(c['lesson']['periodspercard']):
            out.append(dict(c, period=c['period'] + k))
    return out


def index_html(cs='windows-1250'):
    return ('<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=%s">\n'
            '<title>Plan lekcji</title>\n</head>\n'
            '<frameset cols="210,*">\n'
            '<frame src="lista.html" name="list" scrolling="auto">\n'
            '<frame src="plany/o1.html" name="plan">\n'
            '<noframes><body><a href="lista.html">Lista planów</a></body></noframes>\n'
            '</frameset>\n</html>\n' % cs)


def lista_html(cs='windows-1250'):
    out = [HEAD % {'cs': cs, 'title': 'Lista'}]
    out.append('<table>\n<tr><td>\n')
    out.append('<b>Oddziały:</b><br>\n')
    for cid, nm, _w in CLASSES:
        out.append('<a href="plany/%s.html" target="plan">%s</a><br>\n' % (O[cid], nm))
    out.append('<br><b>Nauczyciele:</b><br>\n')
    for t in TEACHERS:
        sh, fn, ln, _g, _s = TNAME[t]
        out.append('<a href="plany/%s.html" target="plan">%s %s (%s)</a><br>\n' % (N[t], ln, fn, sh))
    out.append('<br><b>Sale:</b><br>\n')
    for sh, nm in ROOMS:
        out.append('<a href="plany/%s.html" target="plan">%s</a><br>\n' % (R[sh], nm))
    out.append('</td></tr>\n</table>\n')
    out.append(FOOT % {'date': GEN_DATE})
    return ''.join(out)


def all_pages(cards, cs='windows-1250'):
    flat = expand(cards)
    pages = {}
    for cid, nm, wy in CLASSES:
        rows = {}
        for c in flat:
            if cid in c['lesson']['classes']:
                rows.setdefault(c['period'], {}).setdefault(c['day'], []).append(c)
        rows = {p: {d: cell_for_class(sorted(v, key=lambda x: x['lesson']['group'] or '')) for d, v in dd.items()}
                for p, dd in rows.items()}
        pages['plany/%s.html' % O[cid]] = grid_html(nm, rows, cs=cs)
    for t in TEACHERS:
        sh, fn, ln, _g, _s = TNAME[t]
        rows = {}
        for c in flat:
            if t in c['lesson']['teachers']:
                rows.setdefault(c['period'], {}).setdefault(c['day'], []).append(c)
        rows = {p: {d: cell_for_teacher(v) for d, v in dd.items()} for p, dd in rows.items()}
        pages['plany/%s.html' % N[t]] = grid_html('%s %s (%s)' % (ln, fn, sh), rows, cs=cs)
    for sh, nm in ROOMS:
        rows = {}
        for c in flat:
            if c['room'] == sh:
                rows.setdefault(c['period'], {}).setdefault(c['day'], []).append(c)
        rows = {p: {d: cell_for_room(v) for d, v in dd.items()} for p, dd in rows.items()}
        pages['plany/%s.html' % R[sh]] = grid_html(nm, rows, cs=cs)
    pages['index.html'] = index_html(cs)
    pages['lista.html'] = lista_html(cs)
    return pages


# --- warianty brzegowe -----------------------------------------------------------------
def edge_pages(cards):
    """n1 z rowspan na lekcji podwójnej i pustą kolumną dnia; o1 z linią 'Wychowawca'."""
    flat = expand(cards)
    # --- strona nauczyciela MA (w-f) z rowspan i bez lekcji w piątek
    rows = {}
    for c in cards:
        if 'MA' in c['lesson']['teachers'] and c['day'] != 4:
            rows.setdefault(c['period'], {})[c['day']] = (cell_for_teacher([c]), c['lesson']['periodspercard'])
    out = [HEAD % {'cs': 'windows-1250', 'title': 'Mazur Anna (MA)'}]
    out.append('<table>\n<tr><td><span class="tytulnapis">Mazur Anna (MA)</span></td></tr>\n</table>\n')
    out.append('<table class="tabela">\n')
    out.append('<tr><th class="nr">Nr</th><th class="g">Godz</th>' +
               ''.join('<th>%s</th>' % d for d in K.DAYS) + '</tr>\n')
    skip = {}
    for no, st, en in K.PERIODS:
        out.append('<tr><td class="nr">%d</td><td class="g">%s-%s</td>' % (no, st, K.hhmm(en)))
        for d in range(5):
            if skip.get(d, 0) > 0:
                skip[d] -= 1
                continue                      # komórka pochłonięta przez rowspan wyżej
            cell = rows.get(no, {}).get(d)
            if not cell:
                out.append('<td class="l">&nbsp;</td>')
            else:
                html, span = cell
                if span > 1:
                    skip[d] = span - 1
                    out.append('<td class="l" rowspan="%d">%s</td>' % (span, html))
                else:
                    out.append('<td class="l">%s</td>' % html)
        out.append('</tr>\n')
    out.append('</table>\n')
    out.append(FOOT % {'date': GEN_DATE})
    n1 = ''.join(out)

    # --- strona oddziału z wierszem "Wychowawca"
    cid, nm, wy = CLASSES[0]
    sh, fn, ln, _g, _s = TNAME[wy]
    rows2 = {}
    for c in flat:
        if cid in c['lesson']['classes']:
            rows2.setdefault(c['period'], {}).setdefault(c['day'], []).append(c)
    rows2 = {p: {d: cell_for_class(sorted(v, key=lambda x: x['lesson']['group'] or '')) for d, v in dd.items()}
             for p, dd in rows2.items()}
    o1 = grid_html(nm, rows2, subtitle='Wychowawca: <a href="../plany/%s.html" class="n">%s %s</a>' % (N[wy], ln, fn))
    return {'plany/n1.html': n1, 'plany/o1.html': o1}


def write(pages, root, enc):
    for path, html in pages.items():
        full = os.path.join(root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'wb') as f:
            f.write(html.replace('\n', '\r\n').encode(enc))


def main():
    lessons, pairs = build()
    cards = schedule(lessons, pairs)
    bad = [l for l in lessons if l['placed'] * l['periodspercard'] < l['periodsperweek']]
    pages = all_pages(cards, 'windows-1250')
    write(pages, OUT, 'cp1250')
    write(all_pages(cards, 'utf-8'), os.path.join(OUT, 'utf8'), 'utf-8')
    write(edge_pages(cards), os.path.join(OUT, 'edge'), 'cp1250')
    print('stron: %d, kart: %d, nieułożonych: %d' % (len(pages), len(cards), len(bad)))
    for l in bad:
        print('  ', l['classes'], l['subject'], l['group'], l['periodsperweek'], l['placed'])


if __name__ == '__main__':
    main()
