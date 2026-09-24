# -*- coding: utf-8 -*-
"""Mały eksport aSc pokrywający dwa przypadki, których nie ma w plan-sp12.xml:

  * lekcje międzyoddziałowe (`classids` z dwoma oddziałami),
  * godzina lekcyjna o numerze 0 (7:10),
  * dodatkowo: druga pisownia atrybutu w korzeniu (`displaycountries`) — patrz README §1 i §7.

Wyjście: ../asc/plan-extra.xml.  Plik jest budowany wprost (bez układacza), żeby liczby
w testach były oczywiste i stabilne.
"""
import os
import sys
from xml.sax.saxutils import quoteattr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'asc')

PERIODS = [('0', '7:10', '7:55'), ('1', '8:00', '8:45'), ('2', '8:55', '9:40'),
           ('3', '9:50', '10:35'), ('4', '10:45', '11:30'), ('5', '11:45', '12:30'),
           ('6', '12:45', '13:30')]
DAYS = [('Poniedziałek', 'Po', '10000'), ('Wtorek', 'Wt', '01000'), ('Środa', 'Śr', '00100'),
        ('Czwartek', 'Cz', '00010'), ('Piątek', 'Pi', '00001')]
SUBJECTS = [('rel', 'Religia', 'Rel'), ('wf', 'Wychowanie fizyczne', 'WF'),
            ('mat', 'Matematyka', 'Mat'), ('ang', 'Język angielski', 'J.ang'),
            ('inf', 'Informatyka', 'Inf')]
TEACHERS = [('ŻM', 'Małgorzata', 'Żak', 'F'), ('MA', 'Anna', 'Mazur', 'F'),
            ('NJ', 'Joanna', 'Nowak', 'F'), ('KE', 'Ewa', 'Król', 'F')]
ROOMS = [('11', 'Sala 11'), ('sg', 'Sala gimnastyczna'), ('12', 'Sala 12'), ('15', 'Sala 15'),
         ('sk', 'Pracownia komputerowa')]
CLASSES = [('7a', '7 A', 'NJ', '12'), ('7b', '7 B', 'NJ', '12'), ('8a', '8 A', 'MA', '11')]


class Ids:
    def __init__(self):
        self.n = 0
        self.m = {}

    def new(self, key=None):
        self.n += 1
        i = '*%d' % self.n
        if key:
            self.m[key] = i
        return i

    def __getitem__(self, k):
        return self.m[k]


def A(**kw):
    return ' '.join('%s=%s' % (k.rstrip('_'), quoteattr(str(v))) for k, v in kw.items())


def main():
    os.makedirs(OUT, exist_ok=True)
    ids = Ids()
    out = []
    w = out.append
    w('<?xml version="1.0" encoding="UTF-8"?>')
    # UWAGA: tu celowo użyta jest pisownia `displaycountries` — w plan-sp12.xml jest
    # `displaycountry`. Żadnej z nich nie umiem potwierdzić; importer ma przyjąć obie.
    w('<timetable %s>' % A(ascttversion='2012.3.2', importtype='database',
                           options='idprefix:ID,exportlicensename:SP nr 12 w Krakowie,'
                                   'exportlicensenumber:987654321',
                           displayname='Plan lekcji 2026/2027 — zajęcia międzyoddziałowe i godzina 0',
                           displaycountries='pl'))

    w('<periods options="canadd,canremove,canupdate,silent" columns="period,name,short,starttime,endtime">')
    for no, st, en in PERIODS:
        w('<period %s/>' % A(name=no, short=no, period=no, starttime=st, endtime=en))
    w('</periods>')

    w('<daysdefs options="canadd,canremove,canupdate,silent" columns="id,name,short,days">')
    for nm, sh, bits in DAYS:
        w('<daysdef %s/>' % A(id=ids.new('d_' + sh), name=nm, short=sh, days=bits))
    w('<daysdef %s/>' % A(id=ids.new('d_any'), name='Dowolny dzień', short='X',
                          days='10000,01000,00100,00010,00001'))
    w('</daysdefs>')

    w('<weeksdefs options="canadd,canremove,canupdate,silent" columns="id,name,short,weeks">')
    w('<weeksdef %s/>' % A(id=ids.new('w11'), name='Każdy tydzień', short='E', weeks='11'))
    w('<weeksdef %s/>' % A(id=ids.new('w10'), name='Tydzień I', short='I', weeks='10'))
    w('<weeksdef %s/>' % A(id=ids.new('w01'), name='Tydzień II', short='II', weeks='01'))
    w('</weeksdefs>')

    w('<termsdefs options="canadd,canremove,canupdate,silent" columns="id,name,short,terms">')
    w('<termsdef %s/>' % A(id=ids.new('t1'), name='Cały rok', short='C', terms='1'))
    w('</termsdefs>')

    w('<subjects options="canadd,canremove,canupdate,silent" columns="id,name,short,partner_id">')
    for sid, nm, sh in SUBJECTS:
        w('<subject %s/>' % A(id=ids.new('s_' + sid), name=nm, short=sh, partner_id=''))
    w('</subjects>')

    w('<teachers options="canadd,canremove,canupdate,silent" columns="id,firstname,lastname,short,gender,partner_id">')
    for sh, fn, ln, g in TEACHERS:
        w('<teacher %s/>' % A(id=ids.new('n_' + sh), firstname=fn, lastname=ln, short=sh,
                              gender=g, partner_id=''))
    w('</teachers>')

    w('<classrooms options="canadd,canremove,canupdate,silent" columns="id,name,short,capacity,buildingid,partner_id">')
    for sh, nm in ROOMS:
        w('<classroom %s/>' % A(id=ids.new('r_' + sh), name=nm, short=sh, capacity='*',
                                buildingid='', partner_id=''))
    w('</classrooms>')

    w('<classes options="canadd,canremove,canupdate,silent" columns="id,name,short,teacherid,classroomids,partner_id">')
    for cid, nm, wy, home in CLASSES:
        w('<class %s/>' % A(id=ids.new('c_' + cid), name=nm, short=nm.replace(' ', ''),
                            teacherid=ids['n_' + wy], classroomids=ids['r_' + home], partner_id=''))
    w('</classes>')

    w('<groups options="canadd,canremove,canupdate,silent" columns="id,classid,name,entireclass,divisiontag,studentcount,partner_id">')
    for cid, _nm, _wy, _h in CLASSES:
        w('<group %s/>' % A(id=ids.new('g_%s_all' % cid), classid=ids['c_' + cid], name='Cała klasa',
                            entireclass='1', divisiontag='0', studentcount='0', partner_id=''))
        w('<group %s/>' % A(id=ids.new('g_%s_rel' % cid), classid=ids['c_' + cid], name='Religia',
                            entireclass='0', divisiontag='3', studentcount='0', partner_id=''))
        w('<group %s/>' % A(id=ids.new('g_%s_ch' % cid), classid=ids['c_' + cid], name='Chłopcy',
                            entireclass='0', divisiontag='2', studentcount='0', partner_id=''))
    w('</groups>')

    # --- lekcje --------------------------------------------------------------------
    # (klucz, [oddziały], przedmiot, [nauczyciele], [grupy], [sale], ppc, ppw, weeksdef)
    LES = [
        # zajęcia międzyoddziałowe: religia 7a+7b razem, jedna grupa z każdego oddziału
        ('rel_7ab', ['7a', '7b'], 'rel', ['ŻM'], ['g_7a_rel', 'g_7b_rel'], ['11'], 1, 2, 'w11'),
        # zajęcia międzyoddziałowe: WF chłopcy z 7b i 8a w jednej grupie ćwiczebnej
        ('wf_7b8a', ['7b', '8a'], 'wf', ['MA'], ['g_7b_ch', 'g_8a_ch'], ['sg'], 2, 2, 'w11'),
        # godzina 0 — zajęcia przed pierwszą lekcją
        ('ang0_7a', ['7a'], 'ang', ['KE'], ['g_7a_all'], ['15'], 1, 1, 'w11'),
        ('mat0_8a', ['8a'], 'mat', ['NJ'], ['g_8a_all'], ['12'], 1, 1, 'w11'),
        # zwykłe lekcje, żeby plik nie składał się z samych wyjątków
        ('mat_7a', ['7a'], 'mat', ['NJ'], ['g_7a_all'], ['12'], 1, 2, 'w11'),
        ('mat_7b', ['7b'], 'mat', ['NJ'], ['g_7b_all'], ['12'], 1, 2, 'w11'),
        ('inf_8a', ['8a'], 'inf', ['KE'], ['g_8a_all'], ['sk'], 1, 1, 'w10'),
    ]
    lid = {}
    w('<lessons options="canadd,canremove,canupdate,silent" columns="id,classids,subjectid,periodspercard,'
      'periodsperweek,teacherids,groupids,classroomids,seminargroup,termsdefid,weeksdefid,daysdefid,partner_id">')
    for key, cls, subj, teas, grps, rooms, ppc, ppw, wd in LES:
        i = ids.new()
        lid[key] = i
        w('<lesson %s/>' % A(id=i, classids=','.join(ids['c_' + c] for c in cls),
                             subjectid=ids['s_' + subj], periodspercard=ppc, periodsperweek=ppw,
                             teacherids=','.join(ids['n_' + t] for t in teas),
                             groupids=','.join(ids[g] for g in grps),
                             classroomids=','.join(ids['r_' + r] for r in rooms),
                             seminargroup='2' if len(cls) > 1 else '',
                             termsdefid=ids['t1'], weeksdefid=ids[wd], daysdefid=ids['d_any'],
                             partner_id=''))
    w('</lessons>')

    # --- karty ---------------------------------------------------------------------
    # (lekcja, dzień 0..4, period, weeks, sala)
    CARDS = [
        ('rel_7ab', 0, '3', '11', '11'), ('rel_7ab', 2, '3', '11', '11'),
        ('wf_7b8a', 1, '4', '11', 'sg'),
        ('ang0_7a', 3, '0', '11', '15'),          # godzina 0
        ('mat0_8a', 4, '0', '11', '12'),          # godzina 0
        ('mat_7a', 0, '1', '11', '12'), ('mat_7a', 2, '1', '11', '12'),
        ('mat_7b', 0, '2', '11', '12'), ('mat_7b', 2, '2', '11', '12'),
        ('inf_8a', 1, '1', '10', 'sk'),
    ]
    w('<cards options="canadd,canremove,canupdate,silent" columns="lessonid,period,days,weeks,terms,classroomids">')
    for key, day, per, wk, room in CARDS:
        w('<card %s/>' % A(lessonid=lid[key], period=per, days=DAYS[day][2], weeks=wk, terms='1',
                           classroomids=ids['r_' + room]))
    w('</cards>')
    w('</timetable>')
    data = '\n'.join(out) + '\n'
    open(os.path.join(OUT, 'plan-extra.xml'), 'w', encoding='utf-8', newline='\n').write(data)
    print('plan-extra.xml: lekcji %d, kart %d, w tym %d międzyoddziałowych i %d na godzinie 0'
          % (len(LES), len(CARDS), sum(1 for l in LES if len(l[1]) > 1),
             sum(1 for c in CARDS if c[2] == '0')))


if __name__ == '__main__':
    main()
