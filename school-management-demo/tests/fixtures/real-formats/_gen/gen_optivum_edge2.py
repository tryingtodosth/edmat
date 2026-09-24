# -*- coding: utf-8 -*-
"""Publikacja Optivum z CELOWĄ niespójnością strona oddziału ↔ strona nauczyciela.

Kontrola krzyżowa importera ma tu co zgłosić. Dwie rozbieżności, opisane w README §4b:

  M1  sala:      7A, poniedziałek, godz. 2, matematyka NJ
                 o1.html -> sala 12,  n1.html -> sala 15,  s1.html (12) potwierdza 12
  M2  nauczyciel:7B, środa, godz. 1, j.polski
                 o2.html -> SB,  n1.html (Nowak) ma tę godzinę u siebie,  n2.html (Sikora) nie ma

Wyjście: ../optivum/edge2/  (windows-1250)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as K
from gen_optivum import HEAD, FOOT, GEN_DATE, write
import school as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'optivum', 'edge2')

CLASSES = [('7a', '7 A'), ('7b', '7 B')]               # o1, o2
TEACHERS = ['NJ', 'SB']                                # n1, n2
ROOMS = [('12', 'Sala 12'), ('15', 'Sala 15')]         # s1, s2
TNAME = {t[0]: t for t in S.TEACHERS}
O = {c[0]: 'o%d' % (i + 1) for i, c in enumerate(CLASSES)}
N = {t: 'n%d' % (i + 1) for i, t in enumerate(TEACHERS)}
R = {r[0]: 's%d' % (i + 1) for i, r in enumerate(ROOMS)}
CNAME = dict(CLASSES)

# stan faktyczny — to, co pokazują strony oddziałów i strony sal
# (oddział, dzień 0..4, godzina, przedmiot, nauczyciel, sala)
TRUTH = [
    ('7a', 0, 1, 'matematyka', 'NJ', '12'),
    ('7a', 0, 2, 'matematyka', 'NJ', '12'),     # M1 — na stronie nauczyciela będzie sala 15
    ('7a', 1, 1, 'j.polski', 'SB', '15'),
    ('7a', 2, 2, 'j.polski', 'SB', '15'),
    ('7a', 3, 1, 'matematyka', 'NJ', '12'),
    ('7b', 0, 3, 'matematyka', 'NJ', '12'),
    ('7b', 1, 2, 'j.polski', 'SB', '15'),
    ('7b', 2, 1, 'j.polski', 'SB', '15'),       # M2 — na stronie nauczyciela trafi do Nowak
    ('7b', 3, 2, 'matematyka', 'NJ', '12'),
    ('7b', 4, 1, 'j.polski', 'SB', '15'),
]
M1 = ('7a', 0, 2)      # (oddział, dzień, godzina)
M2 = ('7b', 2, 1)


def teacher_view():
    """To, co pokazują strony nauczycieli — z dwiema wstawionymi rozbieżnościami."""
    out = []
    for (cls, day, per, subj, tea, room) in TRUTH:
        if (cls, day, per) == M1:
            out.append((cls, day, per, subj, tea, '15'))        # inna sala niż na stronie oddziału
        elif (cls, day, per) == M2:
            out.append((cls, day, per, subj, 'NJ', room))       # inny nauczyciel
        else:
            out.append((cls, day, per, subj, tea, room))
    return out


def page(title, rows, cs='windows-1250'):
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
    out.append(FOOT % {'date': GEN_DATE})
    return ''.join(out)


def collect(items, key, cell):
    rows = {}
    for it in items:
        if key(it):
            rows.setdefault(it[2], {}).setdefault(it[1], []).append(it)
    return {p: {d: '<br>'.join(cell(i) for i in v) for d, v in dd.items()} for p, dd in rows.items()}


def build(cs='windows-1250'):
    pages = {}
    tv = teacher_view()

    def c_cell(i):
        _cls, _d, _p, subj, tea, room = i
        return ('<span class="p">%s</span> <a href="../plany/%s.html" class="n">%s</a> '
                '<a href="../plany/%s.html" class="s">%s</a>' % (subj, N[tea], tea, R[room], room))

    def t_cell(i):
        cls, _d, _p, subj, _tea, room = i
        return ('<span class="p">%s</span> <a href="../plany/%s.html" class="o">%s</a> '
                '<a href="../plany/%s.html" class="s">%s</a>'
                % (subj, O[cls], CNAME[cls].replace(' ', ''), R[room], room))

    def r_cell(i):
        cls, _d, _p, subj, tea, _room = i
        return ('<span class="p">%s</span> <a href="../plany/%s.html" class="o">%s</a> '
                '<a href="../plany/%s.html" class="n">%s</a>'
                % (subj, O[cls], CNAME[cls].replace(' ', ''), N[tea], tea))

    for cid, nm in CLASSES:      # strony oddziałów — stan faktyczny
        pages['plany/%s.html' % O[cid]] = page(nm, collect(TRUTH, lambda i, c=cid: i[0] == c, c_cell), cs)
    for t in TEACHERS:           # strony nauczycieli — z rozbieżnościami
        sh, fn, ln, _g, _s = TNAME[t]
        pages['plany/%s.html' % N[t]] = page('%s %s (%s)' % (ln, fn, sh),
                                             collect(tv, lambda i, t=t: i[4] == t, t_cell), cs)
    for sh, nm in ROOMS:         # strony sal — stan faktyczny
        pages['plany/%s.html' % R[sh]] = page(nm, collect(TRUTH, lambda i, s=sh: i[5] == s, r_cell), cs)

    pages['index.html'] = (
        '<html>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=%s">\n'
        '<title>Plan lekcji</title>\n</head>\n<frameset cols="210,*">\n'
        '<frame src="lista.html" name="list" scrolling="auto">\n'
        '<frame src="plany/o1.html" name="plan">\n'
        '<noframes><body><a href="lista.html">Lista planów</a></body></noframes>\n'
        '</frameset>\n</html>\n' % cs)
    lst = [HEAD % {'cs': cs, 'title': 'Lista'}, '<table>\n<tr><td>\n<b>Oddziały:</b><br>\n']
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
    lst.append(FOOT % {'date': GEN_DATE})
    pages['lista.html'] = ''.join(lst)
    return pages


def main():
    pages = build()
    write(pages, OUT, 'cp1250')
    print('optivum/edge2: %d stron, %d godzin, 2 celowe rozbieżności (M1 sala, M2 nauczyciel)'
          % (len(pages), len(TRUTH)))


if __name__ == '__main__':
    main()
