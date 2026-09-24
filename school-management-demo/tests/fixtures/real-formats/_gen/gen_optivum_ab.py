# -*- coding: utf-8 -*-
"""Publikacja Optivum z cyklem dwutygodniowym (tydzień I / tydzień II).

REKONSTRUKCJA — patrz README §4a. Nie umiem potwierdzić, żeby „Plan lekcji Optivum”
miał w publikacji HTML własny wymiar tygodnia; ten plik odtwarza obejście, którego
szkoły faktycznie używają: obie lekcje w jednej komórce, rozdzielone <br>, z markerem
tygodnia doklejonym do nazwy przedmiotu, plus legenda pod tabelą.

Wyjście: ../optivum/ab/  (windows-1250)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as K
from gen_optivum import HEAD, FOOT, GEN_DATE, write
import school as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'optivum', 'ab')

CLASSES = [('7a', '7 A'), ('7b', '7 B'), ('8a', '8 A'), ('8b', '8 B')]     # o1..o4
TEACHERS = ['NJ', 'WA', 'KE']                                              # n1..n3
ROOMS = [('12', 'Sala 12'), ('sk', 'Pracownia komputerowa')]               # s1..s2
TNAME = {t[0]: t for t in S.TEACHERS}
O = {c[0]: 'o%d' % (i + 1) for i, c in enumerate(CLASSES)}
N = {t: 'n%d' % (i + 1) for i, t in enumerate(TEACHERS)}
R = {r[0]: 's%d' % (i + 1) for i, r in enumerate(ROOMS)}
CNAME = dict(CLASSES)

LEGEND = ('<p class="opis">T1 &#8211; tydzień nieparzysty (I), '
          'T2 &#8211; tydzień parzysty (II)</p>\n')

# każdy oddział ma własną godzinę lekcyjną, żeby plan był bezkonfliktowy
# (dzień, przedmiot, nauczyciel, sala, marker tygodnia)
BASE = [
    (0, 'matematyka', 'NJ', '12', ''),
    (1, 'fizyka', 'WA', '12', ''),
    (2, 'informatyka', 'WA', 'sk', 'T1'),     # tydzień I
    (2, 'fizyka', 'WA', '12', 'T2'),          # tydzień II, to samo okienko
    (3, 'j.angielski', 'KE', '12', ''),
    (4, 'matematyka', 'NJ', '12', ''),
]


def cards():
    out = []
    for ci, (cid, _nm) in enumerate(CLASSES):
        for (day, subj, tea, room, wk) in BASE:
            out.append({'cls': cid, 'day': day, 'period': ci + 1, 'subj': subj,
                        'tea': tea, 'room': room, 'week': wk})
    return out


def label(subj, wk):
    return subj + ('-' + wk if wk else '')


def page(title, rows, legend, cs='windows-1250'):
    out = [HEAD % {'cs': cs, 'title': title}]
    out.append('<table>\n<tr><td><span class="tytulnapis">%s</span></td></tr>\n</table>\n' % title)
    out.append('<table class="tabela">\n')
    out.append('<tr><th class="nr">Nr</th><th class="g">Godz</th>' +
               ''.join('<th>%s</th>' % d for d in K.DAYS) + '</tr>\n')
    for no, st, en in K.PERIODS:
        out.append('<tr><td class="nr">%d</td><td class="g">%s-%s</td>' % (no, st, K.hhmm(en)))
        for d in range(5):
            c = rows.get(no, {}).get(d)
            out.append('<td class="l">%s</td>' % (c if c else '&nbsp;'))
        out.append('</tr>\n')
    out.append('</table>\n')
    if legend:
        out.append(LEGEND)
    out.append(FOOT % {'date': GEN_DATE})
    return ''.join(out)


def build(cs='windows-1250'):
    cs_ = cs
    cds = cards()
    pages = {}

    def group(key):
        g = {}
        for c in cds:
            if key(c):
                g.setdefault(c['period'], {}).setdefault(c['day'], []).append(c)
        return g

    for cid, nm in CLASSES:
        g = group(lambda c, cid=cid: c['cls'] == cid)
        rows = {}
        for p, dd in g.items():
            for d, cs_list in dd.items():
                rows.setdefault(p, {})[d] = '<br>'.join(
                    '<span class="p">%s</span> <a href="../plany/%s.html" class="n">%s</a> '
                    '<a href="../plany/%s.html" class="s">%s</a>'
                    % (label(c['subj'], c['week']), N[c['tea']], c['tea'], R[c['room']], c['room'])
                    for c in cs_list)
        pages['plany/%s.html' % O[cid]] = page(nm, rows, legend=True, cs=cs_)

    for t in TEACHERS:
        sh, fn, ln, _g, _s = TNAME[t]
        g = group(lambda c, t=t: c['tea'] == t)
        rows = {}
        for p, dd in g.items():
            for d, cs_list in dd.items():
                rows.setdefault(p, {})[d] = '<br>'.join(
                    '<span class="p">%s</span> <a href="../plany/%s.html" class="o">%s</a> '
                    '<a href="../plany/%s.html" class="s">%s</a>'
                    % (label(c['subj'], c['week']), O[c['cls']], CNAME[c['cls']].replace(' ', ''),
                       R[c['room']], c['room'])
                    for c in cs_list)
        pages['plany/%s.html' % N[t]] = page('%s %s (%s)' % (ln, fn, sh), rows, legend=True, cs=cs_)

    for sh, nm in ROOMS:
        g = group(lambda c, sh=sh: c['room'] == sh)
        rows = {}
        for p, dd in g.items():
            for d, cs_list in dd.items():
                rows.setdefault(p, {})[d] = '<br>'.join(
                    '<span class="p">%s</span> <a href="../plany/%s.html" class="o">%s</a> '
                    '<a href="../plany/%s.html" class="n">%s</a>'
                    % (label(c['subj'], c['week']), O[c['cls']], CNAME[c['cls']].replace(' ', ''),
                       N[c['tea']], c['tea'])
                    for c in cs_list)
        pages['plany/%s.html' % R[sh]] = page(nm, rows, legend=True, cs=cs_)

    pages['index.html'] = (
        '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=%s">\n'
        '<title>Plan lekcji</title>\n</head>\n<frameset cols="210,*">\n'
        '<frame src="lista.html" name="list" scrolling="auto">\n'
        '<frame src="plany/o1.html" name="plan">\n'
        '<noframes><body><a href="lista.html">Lista planów</a></body></noframes>\n'
        '</frameset>\n</html>\n' % cs_)

    lst = [HEAD % {'cs': cs_, 'title': 'Lista'}, '<table>\n<tr><td>\n<b>Oddziały:</b><br>\n']
    for cid, nm in CLASSES:
        lst.append('<a href="plany/%s.html" target="plan">%s</a><br>\n' % (O[cid], nm))
    lst.append('<br><b>Nauczyciele:</b><br>\n')
    for t in TEACHERS:
        sh, fn, ln, _g, _s = TNAME[t]
        lst.append('<a href="plany/%s.html" target="plan">%s %s (%s)</a><br>\n' % (N[t], ln, fn, sh))
    lst.append('<br><b>Sale:</b><br>\n')
    for sh, nm in ROOMS:
        lst.append('<a href="plany/%s.html" target="plan">%s</a><br>\n' % (R[sh], nm))
    lst.append('</td></tr>\n</table>\n')
    lst.append(LEGEND)
    lst.append(FOOT % {'date': GEN_DATE})
    pages['lista.html'] = ''.join(lst)
    return pages


def main():
    pages = build()
    write(pages, OUT, 'cp1250')
    print('optivum/ab: %d stron, %d wpisów (w tym %d w cyklu A/B)'
          % (len(pages), len(cards()), sum(1 for c in cards() if c['week'])))


if __name__ == '__main__':
    main()
