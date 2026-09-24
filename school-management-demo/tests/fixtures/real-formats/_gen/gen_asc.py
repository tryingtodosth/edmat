# -*- coding: utf-8 -*-
"""Generuje eksport XML w kształcie 'aSc Timetables 2012 XML'.

Wyjście: ../asc/plan-sp12.xml, ../asc/plan-old-2008.xml, ../asc/plan-edge.xml
"""
import os
import sys
from xml.sax.saxutils import escape, quoteattr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as K
from common import L, place, place_with
import school as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'asc')

HOMEROOM = {c[0]: c[4] for c in S.CLASSES}
WYCH = {c[0]: c[3] for c in S.CLASSES}
ROOMS_ALL = [r[0] for r in S.ROOMS]

DIV_LANG, DIV_WF, DIV_REL, DIV_INF = 1, 2, 3, 4


def build():
    lessons, pairs = [], []
    for cid, _name, lvl, wych, home in S.CLASSES:
        pr = lambda s: S.PREF_ROOMS.get(s)
        if lvl <= 3:
            edw_t = wych
            lessons.append(L([cid], 'edw', [edw_t], 18 if lvl == 1 else 16, rooms=[home], prefer=range(1, 6)))
            lessons.append(L([cid], 'wf', ['MA' if lvl == 1 else 'SJ'], 3, rooms=pr('wf')))
            if lvl == 3:
                lessons.append(L([cid], 'ang', ['KE'], 2, rooms=pr('ang')))
        else:
            mat_t = ['NJ'] if cid in ('7a', '7b', '8a') else ['WP']
            if cid == '7b':
                mat_t = ['NJ', 'SR']          # lekcja z dwoma nauczycielami (nauczyciel wspomagający)
            lessons.append(L([cid], 'pol', ['SB'], 5, rooms=pr('pol')))
            lessons.append(L([cid], 'mat', mat_t, 5 if lvl == 8 else 4, rooms=pr('mat')))
            lessons.append(L([cid], 'his', ['LK'], 2, rooms=pr('his')))
            lessons.append(L([cid], 'geo', ['LK'], 1, rooms=pr('geo')))
            lessons.append(L([cid], 'bio', ['GT'], 1, rooms=pr('bio')))
            lessons.append(L([cid], 'che', ['GT'], 2, rooms=pr('che')))
            lessons.append(L([cid], 'fiz', ['WA'], 2, rooms=pr('fiz')))
            lessons.append(L([cid], 'tec', ['DŁ'], 1, rooms=pr('tec')))
            if lvl == 7:
                lessons.append(L([cid], 'muz', ['DŁ'], 1, rooms=pr('muz')))
                lessons.append(L([cid], 'pla', ['DŁ'], 1, rooms=pr('pla')))
            else:
                lessons.append(L([cid], 'wdz', ['BJ'], 1, rooms=pr('wdz')))
            # języki obce — dwie grupy w tym samym okienku
            for gi, (gname, tea) in enumerate([('1. grupa', 'KE'), ('2. grupa', 'AK')]):
                lessons.append(L([cid], 'ang', [tea], 3, rooms=pr('ang'), group=gname, divtag=DIV_LANG))
            for gi, gname in enumerate(['1. grupa', '2. grupa']):
                lessons.append(L([cid], 'nie', ['ŚZ'], 2, rooms=pr('nie'), group=gname, divtag=DIV_LANG))
            # WF chłopcy / dziewczęta, w tym jedna lekcja podwójna
            wf_ch = L([cid], 'wf', ['SJ'], 2, rooms=['sg'], group='Chłopcy', divtag=DIV_WF, ppc=2)
            wf_dz = L([cid], 'wf', ['MA'], 2, rooms=['msg'], group='Dziewczęta', divtag=DIV_WF, ppc=2)
            lessons += [wf_ch, wf_dz]
            pairs.append((wf_ch, wf_dz))
            lessons.append(L([cid], 'wf', ['SJ'], 2, rooms=['sg'], group='Chłopcy', divtag=DIV_WF))
            lessons.append(L([cid], 'wf', ['MA'], 2, rooms=['msg'], group='Dziewczęta', divtag=DIV_WF))
            # informatyka w cyklu dwutygodniowym: gr. 1 w tygodniu I, gr. 2 w tygodniu II
            i1 = L([cid], 'inf', ['WA'], 1, rooms=['sk'], group='1. grupa', divtag=DIV_INF, weeks='10')
            i2 = L([cid], 'inf', ['WA'], 1, rooms=['sk'], group='2. grupa', divtag=DIV_INF, weeks='01')
            lessons += [i1, i2]
            pairs.append((i1, i2))
        # godzina z wychowawcą
        if lvl > 3:
            lessons.append(L([cid], 'wych', [wych], 1, rooms=[home]))
        # religia i etyka równolegle
        n = 2 if lvl <= 3 else 1
        rel = L([cid], 'rel', ['ŻM'], n, rooms=S.PREF_ROOMS['rel'], group='Religia', divtag=DIV_REL)
        ety = L([cid], 'ety', ['ĆH'], n, group='Etyka', divtag=DIV_REL, roomless=True)  # lekcja bez sali
        lessons += [rel, ety]
        pairs.append((rel, ety))
    return lessons, pairs


def schedule(lessons, pairs):
    sched = K.Sched()
    cards = []
    leaders = {id(a) for a, _ in pairs}
    followers = {id(b) for _, b in pairs}
    # najpierw pary (najbardziej związane), potem reszta
    for a, b in pairs:
        got = place(sched, [a], ROOMS_ALL)
        cards += got
        for c in got:
            f = place_with(sched, b, c, ROOMS_ALL)
            if f:
                cards.append(f)
    rest = [l for l in lessons if id(l) not in leaders and id(l) not in followers]
    cards += place(sched, rest, ROOMS_ALL)
    return cards


class Ids:
    def __init__(self):
        self.n = 0
        self.map = {}

    def new(self, key=None):
        self.n += 1
        i = '*%d' % self.n
        if key is not None:
            self.map[key] = i
        return i

    def __getitem__(self, k):
        return self.map[k]


def A(**kw):
    return ' '.join('%s=%s' % (k.rstrip('_'), quoteattr(str(v))) for k, v in kw.items())


def render(cards, lessons, version='2012.3.2'):
    ids = Ids()
    out = []
    w = out.append
    w('<?xml version="1.0" encoding="UTF-8"?>')
    w('<timetable ascttversion=%s importtype="database" options=%s displayname=%s displaycountry="pl">' % (
        quoteattr(version),
        quoteattr('idprefix:ID,exportlicensename:SP nr 12 w Krakowie,exportlicensenumber:987654321,numberofweeks:2'),
        quoteattr('Plan lekcji %s — %s' % (S.SCHOOL['year'], S.SCHOOL['short']))))

    w('<periods options="canadd,canremove,canupdate,silent" columns="period,name,short,starttime,endtime">')
    for (no, st, en) in S.PERIODS if hasattr(S, 'PERIODS') else K.PERIODS:
        w('<period %s/>' % A(name=str(no), short=str(no), period=str(no), starttime=st, endtime=en))
    w('</periods>')

    w('<daysdefs options="canadd,canremove,canupdate,silent" columns="id,name,short,days">')
    for i, (nm, sh) in enumerate(zip(K.DAYS, K.DAYS_SHORT)):
        bits = ''.join('1' if j == i else '0' for j in range(5))
        w('<daysdef %s/>' % A(id=ids.new('day%d' % i), name=nm, short=sh, days=bits))
    w('<daysdef %s/>' % A(id=ids.new('dayany'), name='Dowolny dzień', short='X', days='10000,01000,00100,00010,00001'))
    w('<daysdef %s/>' % A(id=ids.new('dayall'), name='Każdy dzień', short='E', days='11111'))
    w('</daysdefs>')

    w('<weeksdefs options="canadd,canremove,canupdate,silent" columns="id,name,short,weeks">')
    w('<weeksdef %s/>' % A(id=ids.new('w11'), name='Każdy tydzień', short='E', weeks='11'))
    w('<weeksdef %s/>' % A(id=ids.new('w10'), name='Tydzień I', short='I', weeks='10'))
    w('<weeksdef %s/>' % A(id=ids.new('w01'), name='Tydzień II', short='II', weeks='01'))
    w('<weeksdef %s/>' % A(id=ids.new('wany'), name='Dowolny tydzień', short='X', weeks='10,01'))
    w('</weeksdefs>')

    w('<termsdefs options="canadd,canremove,canupdate,silent" columns="id,name,short,terms">')
    w('<termsdef %s/>' % A(id=ids.new('t1'), name='Cały rok', short='C', terms='1'))
    w('</termsdefs>')

    w('<buildings options="canadd,canremove,canupdate,silent" columns="id,name,short"/>')

    w('<subjects options="canadd,canremove,canupdate,silent" columns="id,name,short,partner_id">')
    for sid, nm, sh in S.SUBJECTS:
        w('<subject %s/>' % A(id=ids.new('s_' + sid), name=nm, short=sh, partner_id=''))
    w('</subjects>')

    w('<teachers options="canadd,canremove,canupdate,silent" columns="id,firstname,lastname,short,gender,color,email,partner_id">')
    for sh, fn, ln, g, _sub in S.TEACHERS:
        w('<teacher %s/>' % A(id=ids.new('n_' + sh), firstname=fn, lastname=ln, short=sh, gender=g,
                              color='#%02X96C8' % (40 + 7 * len(ln)),
                              email='%s.%s@sp12.krakow.pl' % (fn[0].lower(), ln.lower()), partner_id=''))
    w('</teachers>')

    w('<classrooms options="canadd,canremove,canupdate,silent" columns="id,name,short,capacity,buildingid,partner_id">')
    for sh, nm in S.ROOMS:
        w('<classroom %s/>' % A(id=ids.new('r_' + sh), name=nm, short=sh, capacity='*', buildingid='', partner_id=''))
    w('</classrooms>')

    w('<classes options="canadd,canremove,canupdate,silent" columns="id,name,short,teacherid,classroomids,partner_id">')
    for cid, nm, _lvl, wych, home in S.CLASSES:
        w('<class %s/>' % A(id=ids.new('c_' + cid), name=nm, short=nm.replace(' ', ''),
                            teacherid=ids['n_' + wych], classroomids=ids['r_' + home], partner_id=''))
    w('</classes>')

    # grupy: dla każdego oddziału "Cała klasa" + grupy podziałów faktycznie użyte
    used = {}
    for l in lessons:
        for c in l['classes']:
            if l['divtag']:
                used.setdefault(c, {}).setdefault(l['divtag'], set()).add(l['group'])
    w('<groups options="canadd,canremove,canupdate,silent" columns="id,classid,name,entireclass,divisiontag,studentcount,partner_id">')
    for cid, _nm, _lvl, _wy, _h in S.CLASSES:
        w('<group %s/>' % A(id=ids.new('g_%s_all' % cid), classid=ids['c_' + cid], name='Cała klasa',
                            entireclass='1', divisiontag='0', studentcount='0', partner_id=''))
        for dt in sorted(used.get(cid, {})):
            for gname in sorted(used[cid][dt]):
                w('<group %s/>' % A(id=ids.new('g_%s_%d_%s' % (cid, dt, gname)), classid=ids['c_' + cid],
                                    name=gname, entireclass='0', divisiontag=str(dt), studentcount='0', partner_id=''))
    w('</groups>')

    w('<students options="canadd,canremove,canupdate,silent" columns="id,classid,firstname,lastname,number,email,partner_id"/>')

    # lekcje
    lid = {}
    w('<lessons options="canadd,canremove,canupdate,silent" columns="id,classids,subjectid,periodspercard,'
      'periodsperweek,teacherids,groupids,classroomids,seminargroup,termsdefid,weeksdefid,daysdefid,partner_id">')
    for l in lessons:
        if not l['placed']:
            continue
        i = ids.new()
        lid[id(l)] = i
        gids = []
        for c in l['classes']:
            gids.append(ids['g_%s_%d_%s' % (c, l['divtag'], l['group'])] if l['divtag'] else ids['g_%s_all' % c])
        rooms = sorted({c['room'] for c in cards if c['lesson'] is l and c['room']})
        wdef = {'11': 'w11', '10': 'w10', '01': 'w01'}[l['weeks']]
        w('<lesson %s/>' % A(
            id=i,
            classids=','.join(ids['c_' + c] for c in l['classes']),
            subjectid=ids['s_' + l['subject']],
            periodspercard=str(l['periodspercard']),
            periodsperweek=str(l['periodsperweek']),
            teacherids=','.join(ids['n_' + t] for t in l['teachers']),
            groupids=','.join(gids),
            classroomids=','.join(ids['r_' + r] for r in rooms),
            seminargroup='', termsdefid=ids['t1'], weeksdefid=ids[wdef], daysdefid=ids['dayany'], partner_id=''))
    w('</lessons>')

    w('<cards options="canadd,canremove,canupdate,silent" columns="lessonid,period,days,weeks,terms,classroomids">')
    for c in sorted(cards, key=lambda c: (c['day'], c['period'], lid[id(c['lesson'])])):
        days = ''.join('1' if j == c['day'] else '0' for j in range(5))
        w('<card %s/>' % A(lessonid=lid[id(c['lesson'])], period=str(c['period']), days=days,
                           weeks=c['weeks'], terms='1',
                           classroomids=ids['r_' + c['room']] if c['room'] else ''))
    w('</cards>')
    w('</timetable>')
    return '\n'.join(out) + '\n', ids, lid


def render_2008(cards, lessons):
    """Wariant 'aSc Timetables 2008 XML' — mniejszy i uboższy. REKONSTRUKCJA (patrz README)."""
    ids = Ids()
    keep = {'7a', '7b'}
    les = [l for l in lessons if l['placed'] and set(l['classes']) <= keep]
    cds = [c for c in cards if c['lesson'] in les]
    out = []
    w = out.append
    w('<?xml version="1.0" encoding="UTF-8"?>')
    w('<timetable ascttversion="2008" importtype="database" options="idprefix:ID" displayname="Plan 2008/2009">')
    w('<subjects>')
    subs = sorted({l['subject'] for l in les})
    names = dict((a, (b, c)) for a, b, c in S.SUBJECTS)
    for s in subs:
        w('<subject %s/>' % A(id=ids.new('s_' + s), name=names[s][0], short=names[s][1]))
    w('</subjects>')
    w('<teachers>')
    teas = sorted({t for l in les for t in l['teachers']})
    tmap = {t[0]: t for t in S.TEACHERS}
    for t in teas:
        sh, fn, ln, g, _ = tmap[t]
        w('<teacher %s/>' % A(id=ids.new('n_' + t), name='%s %s' % (fn, ln), short=sh))
    w('</teachers>')
    w('<classrooms>')
    rms = sorted({c['room'] for c in cds if c['room']})
    rmap = dict(S.ROOMS)
    for r in rms:
        w('<classroom %s/>' % A(id=ids.new('r_' + r), name=rmap[r], short=r))
    w('</classrooms>')
    w('<classes>')
    for cid, nm, _lvl, wych, home in S.CLASSES:
        if cid in keep:
            w('<class %s/>' % A(id=ids.new('c_' + cid), name=nm, short=nm.replace(' ', '')))
    w('</classes>')
    w('<lessons>')
    lid = {}
    for l in les:
        i = ids.new()
        lid[id(l)] = i
        grp = '' if not l['divtag'] else ('1' if '1.' in (l['group'] or '') or l['group'] in ('Chłopcy', 'Religia') else '2')
        w('<lesson %s/>' % A(id=i, classids=','.join(ids['c_' + c] for c in l['classes']),
                             subjectid=ids['s_' + l['subject']],
                             teacherids=','.join(ids['n_' + t] for t in l['teachers']),
                             durationperiods=str(l['periodspercard']),
                             periodsperweek=str(l['periodsperweek']),
                             group=grp))
    w('</lessons>')
    w('<cards>')
    for c in sorted(cds, key=lambda c: (c['day'], c['period'])):
        w('<card %s/>' % A(lessonid=lid[id(c['lesson'])], period=str(c['period']), day=str(c['day'] + 1),
                           classroomid=ids['r_' + c['room']] if c['room'] else ''))
    w('</cards>')
    w('</timetable>')
    return '\n'.join(out) + '\n'


def render_edge(xml):
    """Wariant z pułapkami: BOM, CRLF, brakujące id sali, pusty short nauczyciela, zdublowana karta."""
    lines = xml.split('\n')
    small = []
    for ln in lines:
        small.append(ln)
    t = '\n'.join(small)
    # 1. pusty skrót nauczyciela
    t = t.replace('firstname="Halina" lastname="Ćwikła" short="ĆH"', 'firstname="Halina" lastname="Ćwikła" short=""', 1)
    # 2. karta wskazująca na nieistniejące id sali
    i = t.index('<card ')
    j = t.index('/>', i) + 2
    first = t[i:j]
    import re as _re
    broken = _re.sub(r'classroomids="[^"]*"', 'classroomids="*9999"', first)
    # 3. duplikat pierwszej karty (ta sama lekcja, ten sam dzień i godzina)
    t = t[:j] + '\n' + broken + '\n' + first + t[j:]
    t = '﻿' + t
    return t.replace('\n', '\r\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    lessons, pairs = build()
    cards = schedule(lessons, pairs)
    xml, _ids, _lid = render(cards, lessons)
    open(os.path.join(OUT, 'plan-sp12.xml'), 'w', encoding='utf-8', newline='\n').write(xml)
    open(os.path.join(OUT, 'plan-old-2008.xml'), 'w', encoding='utf-8', newline='\n').write(render_2008(cards, lessons))
    with open(os.path.join(OUT, 'plan-edge.xml'), 'wb') as f:
        f.write(render_edge(xml).encode('utf-8'))
    unplaced = [(l['classes'], l['subject'], l['group'], l['periodsperweek'], l['placed']) for l in lessons
                if l['placed'] * l['periodspercard'] < l['periodsperweek']]
    print('kart: %d, lekcji: %d, nieułożonych w całości: %d' % (len(cards), len(lessons), len(unplaced)))
    for u in unplaced[:20]:
        print('  ', u)


if __name__ == '__main__':
    main()
