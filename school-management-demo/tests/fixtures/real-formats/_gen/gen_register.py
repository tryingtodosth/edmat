# -*- coding: utf-8 -*-
"""Generuje eksporty list uczniów: nabór (VULCAN), Librus, UONET+, kadra.

Wyjście: ../register/nabor-vulcan.csv        (windows-1250, CRLF)
         ../register/nabor-vulcan.utf8.csv   (UTF-8 z BOM, CRLF)
         ../register/librus-uczniowie.csv    (UTF-8 bez BOM, CRLF)
         ../register/uonet-uczniowie.csv     (windows-1250, CRLF, wszystko w cudzysłowach)
         ../register/staff.csv               (windows-1250, CRLF)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import school as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'register')
DASH = '–'          # półpauza, jakiej VULCAN używa w nagłówkach ("Opiekun 1 – imię")


def pesel(y, m, d, serial, male):
    mm = m + (20 if y >= 2000 else 0)
    base = '%02d%02d%02d%03d%d' % (y % 100, mm, d, serial, 1 if male else 2)
    w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
    s = sum(wi * int(base[i]) for i, wi in enumerate(w))
    return base + str((10 - s % 10) % 10)


FIRST_M = ['Jakub', 'Szymon', 'Antoni', 'Kacper', 'Filip', 'Michał', 'Wojciech', 'Miłosz',
           'Stanisław', 'Ignacy', 'Bartosz', 'Krzysztof', 'Łukasz', 'Paweł', 'Adam', 'Tymoteusz']
FIRST_F = ['Zuzanna', 'Julia', 'Maja', 'Hanna', 'Lena', 'Zofia', 'Antonina', 'Aniela',
           'Małgorzata', 'Agnieszka', 'Żaneta', 'Łucja', 'Świetlana', 'Róża', 'Weronika', 'Ćwikła']
SECOND_M = ['Jan', 'Piotr', 'Marek', '', '', 'Andrzej', '']
SECOND_F = ['Maria', 'Anna', '', '', 'Ewa', '', 'Zofia']
LAST = ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowski',
        'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur',
        'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Nowakowski', 'Pawłowski',
        'Michalski', 'Adamczyk', 'Dudek', 'Zając', 'Wieczorek', 'Jabłoński', 'Król', 'Majewski',
        'Olszewski', 'Jaworski', 'Wróbel', 'Malinowski', 'Pawlak', 'Witkowski', 'Walczak']
STREETS = ['ul. Szkolna', 'ul. Długa', 'ul. Krowoderska', 'ul. Łobzowska', 'os. Złotej Jesieni',
           'ul. Świętokrzyska', 'ul. Bracka', 'ul. Mogilska', 'ul. Zwierzyniecka', 'ul. Wąska']
CLASSES = ['1a', '1b', '3a', '3b', '7a', '7b', '8a', '8b']
LEVEL_YEAR = {'1': 2019, '3': 2017, '7': 2013, '8': 2012}


FOLD = str.maketrans('ąćęłńóśźżĄĆĘŁŃÓŚŹŻ', 'acelnoszzACELNOSZZ')


def fold(x):
    return x.translate(FOLD)


def fem(last):
    for a, b in (('ski', 'ska'), ('cki', 'cka'), ('dzki', 'dzka'), ('y', 'a')):
        if last.endswith(a):
            return last[:-len(a)] + b
    return last


class Row(dict):
    pass


def build_students():
    rows = []
    i = 0
    for ci, cls in enumerate(CLASSES):
        year = LEVEL_YEAR[cls[0]]
        for k in range(8 if cls[0] in '78' else 7):
            i += 1
            male = (i % 2 == 1)
            base = LAST[i % len(LAST)]
            first = (FIRST_M if male else FIRST_F)[i % 16]
            last = base if male else fem(base)
            m = 1 + (i % 12)
            d = 1 + ((i * 7) % 27)
            r = Row(
                last=last, first=first,
                second=(SECOND_M if male else SECOND_F)[i % 7],
                pesel=pesel(year, m, d, 100 + i, male), doc='',
                birth='%02d.%02d.%d' % (d, m, year), birth_iso='%d-%02d-%02d' % (year, m, d),
                place='Kraków', street='%s %d' % (STREETS[i % len(STREETS)], 1 + (i * 3) % 60),
                flat='' if i % 4 else str(1 + i % 30),
                zip='31-%03d' % (100 + (i * 13) % 800), city='Kraków', cls=cls,
                g1last=fem(base) if i % 2 else base, g1first='Anna' if i % 2 else 'Marek',
                g1rel='matka' if i % 2 else 'ojciec',
                g1tel='+48 6%02d %03d %03d' % (i % 100, 100 + i, 200 + i), g1mail='',
                g2last=base if i % 2 else fem(base), g2first='Piotr' if i % 2 else 'Ewa',
                g2rel='ojciec' if i % 2 else 'matka',
                g2tel='+48 5%02d %03d %03d' % (i % 100, 300 + i, 400 + i), g2mail='', note='')
            rows.append(r)

    # --- przypadki brzegowe -------------------------------------------------------
    # 1. bliźnięta: to samo nazwisko, ten sam adres, ta sama data urodzenia
    a = rows[30]
    b = Row(a)
    a.update(last='Mazur', first='Jan', second='Krzysztof', pesel=pesel(2013, 5, 14, 231, True),
             birth='14.05.2013', birth_iso='2013-05-14', g1last='Mazur', g1first='Katarzyna',
             g1rel='matka', g2last='Mazur', g2first='Grzegorz', g2rel='ojciec')
    b.update(last='Mazur', first='Maciej', second='Antoni', pesel=pesel(2013, 5, 14, 232, True),
             birth='14.05.2013', birth_iso='2013-05-14', g1last='Mazur', g1first='Katarzyna',
             g1rel='matka', g2last='Mazur', g2first='Grzegorz', g2rel='ojciec',
             note='brat bliźniak — prosimy o przydział do tego samego oddziału')
    rows.insert(31, b)

    # 2. nazwisko dwuczłonowe + imię z diakrytykami
    rows[12].update(last='Kowalska-Wójcik', first='Żaneta', second='Łucja',
                    g1last='Kowalska', g1first='Małgorzata', g2last='Wójcik', g2first='Łukasz')

    # 3. jeden opiekun (samotna matka) — kolumny opiekuna 2 puste
    rows[5].update(g2last='', g2first='', g2rel='', g2tel='', g2mail='',
                   note='jedyny opiekun prawny')

    # 4. adnotacja sądowa w Uwagach, ze średnikiem w środku pola
    rows[19].update(note='Ojciec pozbawiony władzy rodzicielskiej wyrokiem SR dla Krakowa-Krowodrzy '
                         'III Nsm 412/24 z 12.03.2025; kontakt wyłącznie z matką')

    # 5. trzech uczniów bez numeru PESEL (cudzoziemcy)
    rows[8].update(last='Kovalenko', first='Sofiia', second='', pesel='',
                   doc='paszport UA FL123456', place='Kijów (UA)', g1last='Kovalenko',
                   g1first='Iryna', g1rel='matka', g2last='', g2first='', g2rel='', g2tel='', g2mail='',
                   note='uczennica z Ukrainy; zajęcia wyrównawcze z języka polskiego')
    rows[22].update(last='Shcharbakova', first='Alesia', second='', pesel='',
                    doc='karta pobytu BY 0012345', place='Mińsk (BY)', g1last='Shcharbakov',
                    g1first='Andrei', g1rel='ojciec')
    rows[41].update(last='Nguyen', first='Thi Mai', second='', pesel='',
                    doc='paszport VN N1234567', place='Hanoi (VN)', g1last='Nguyen', g1first='Van Hung',
                    g1rel='ojciec', note='')

    # adresy e-mail liczymy na końcu, żeby zgadzały się z nazwiskami po podmianach wyżej
    for i, r in enumerate(rows, 1):
        for g in ('g1', 'g2'):
            if r[g + 'first'] and r[g + 'last']:
                r[g + 'mail'] = '%s.%s%d@example.com' % (fold(r[g + 'first']).lower().replace(' ', ''),
                                                         fold(r[g + 'last']).lower().replace('-', ''), i)
            else:
                r[g + 'mail'] = ''
    return rows[:60]


def csv_line(vals, sep=';', quote_all=False):
    out = []
    for v in vals:
        v = '' if v is None else str(v)
        if quote_all or sep in v or '"' in v or '\n' in v:
            v = '"' + v.replace('"', '""') + '"'
        out.append(v)
    return sep.join(out)


def write(path, lines, enc, bom=False):
    data = '\r\n'.join(lines) + '\r\n'
    b = data.encode(enc, errors='replace')
    if bom:
        b = b'\xef\xbb\xbf' + b
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(b)


def nabor(rows):
    head = ['Nazwisko', 'Imię', 'Drugie imię', 'PESEL', 'Dokument tożsamości', 'Data urodzenia',
            'Miejsce urodzenia', 'Adres zamieszkania', 'Kod pocztowy', 'Miejscowość', 'Oddział',
            'Opiekun 1 %s nazwisko' % DASH, 'Opiekun 1 %s imię' % DASH, 'Opiekun 1 %s telefon' % DASH,
            'Opiekun 1 %s e-mail' % DASH, 'Opiekun 2 %s nazwisko' % DASH, 'Opiekun 2 %s imię' % DASH,
            'Opiekun 2 %s telefon' % DASH, 'Opiekun 2 %s e-mail' % DASH, 'Uwagi']
    lines = [csv_line(head)]
    for r in rows:
        addr = r['street'] + (('/' + r['flat']) if r['flat'] else '')
        lines.append(csv_line([r['last'], r['first'], r['second'], r['pesel'], r['doc'], r['birth'],
                               r['place'], addr, r['zip'], r['city'], r['cls'],
                               r['g1last'], r['g1first'], r['g1tel'], r['g1mail'],
                               r['g2last'], r['g2first'], r['g2tel'], r['g2mail'], r['note']]))
    return lines


def librus(rows):
    head = ['Lp.', 'Nazwisko', 'Imię', 'Imię drugie', 'PESEL', 'Data urodzenia', 'Miejsce urodzenia',
            'Klasa', 'Nr w dzienniku', 'Ulica', 'Kod pocztowy', 'Miejscowość', 'Telefon', 'E-mail',
            'Rodzic/Opiekun 1', 'Telefon 1', 'E-mail 1', 'Rodzic/Opiekun 2', 'Telefon 2', 'E-mail 2']
    lines = [csv_line(head)]
    nr = {}
    for i, r in enumerate(rows, 1):
        nr[r['cls']] = nr.get(r['cls'], 0) + 1
        lines.append(csv_line([
            i, r['last'], r['first'], r['second'], r['pesel'], r['birth_iso'], r['place'],
            r['cls'].upper(), nr[r['cls']], r['street'] + (('/' + r['flat']) if r['flat'] else ''),
            r['zip'], r['city'], '', '',
            ('%s %s' % (r['g1first'], r['g1last'])).strip(), r['g1tel'], r['g1mail'],
            ('%s %s' % (r['g2first'], r['g2last'])).strip(), r['g2tel'], r['g2mail']]))
    return lines


def uonet(rows):
    head = ['Nazwisko', 'Imię', 'Drugie imię', 'Data urodzenia', 'Miejsce urodzenia', 'PESEL',
            'Oddział', 'Nr w księdze', 'Miejscowość', 'Ulica', 'Nr domu', 'Nr mieszkania',
            'Kod pocztowy', 'Poczta', 'Opiekun 1', 'Stopień pokrewieństwa 1', 'Telefon 1', 'E-mail 1',
            'Opiekun 2', 'Stopień pokrewieństwa 2', 'Telefon 2', 'E-mail 2']
    lines = [csv_line(head, quote_all=True)]
    for i, r in enumerate(rows, 1):
        st = r['street'].rsplit(' ', 1)
        lines.append(csv_line([
            r['last'], r['first'], r['second'], r['birth'], r['place'], r['pesel'],
            r['cls'].upper(), 1200 + i, r['city'], st[0], st[1], r['flat'], r['zip'], r['city'],
            ('%s %s' % (r['g1last'], r['g1first'])).strip(), r['g1rel'], r['g1tel'], r['g1mail'],
            ('%s %s' % (r['g2last'], r['g2first'])).strip(), r['g2rel'], r['g2tel'], r['g2mail']],
            quote_all=True))
    return lines


# kody kwalifikacji: układ "przedmiot + kod" z arkusza organizacyjnego. REKONSTRUKCJA.
QUAL = {'mat': '01', 'pol': '02', 'ang': '03', 'nie': '04', 'fiz': '05', 'che': '06', 'bio': '07',
        'geo': '08', 'his': '09', 'inf': '10', 'wf': '11', 'muz': '12', 'pla': '13', 'tec': '14',
        'edw': '15', 'rel': '16', 'ety': '17', 'wdz': '18', 'wsp': '19'}
STOPIEN = ['nauczyciel początkujący', 'nauczyciel mianowany', 'nauczyciel dyplomowany']
SUBJ_NAME = {a: b for a, b, _ in S.SUBJECTS}
SUBJ_NAME['wsp'] = 'Nauczyciel współorganizujący kształcenie'


def staff():
    head = ['Nazwisko', 'Imię', 'Skrót', 'Stopień awansu zawodowego', 'Wymiar zatrudnienia',
            'Przedmioty', 'Kody kwalifikacji', 'Wychowawstwo', 'E-mail']
    wych = {c[3]: c[1] for c in S.CLASSES}
    lines = [csv_line(head)]
    for i, (sh, fn, ln, _g, subs) in enumerate(S.TEACHERS):
        lines.append(csv_line([
            ln, fn, sh, STOPIEN[i % 3], ['18/18', '18/18', '12/18', '9/18'][i % 4],
            ', '.join(SUBJ_NAME[s] for s in subs), '/'.join(QUAL[s] for s in subs),
            wych.get(sh, ''), '%s.%s@sp12.krakow.pl' % (fold(fn[0]).lower(), fold(ln).lower())]))
    return lines


def main():
    rows = build_students()
    write(os.path.join(OUT, 'nabor-vulcan.csv'), nabor(rows), 'cp1250')
    write(os.path.join(OUT, 'nabor-vulcan.utf8.csv'), nabor(rows), 'utf-8', bom=True)
    write(os.path.join(OUT, 'librus-uczniowie.csv'), librus(rows), 'utf-8')
    write(os.path.join(OUT, 'uonet-uczniowie.csv'), uonet(rows), 'cp1250')
    write(os.path.join(OUT, 'staff.csv'), staff(), 'cp1250')
    print('uczniów: %d, bez PESEL: %d, kadra: %d' %
          (len(rows), sum(1 for r in rows if not r['pesel']), len(S.TEACHERS)))


if __name__ == '__main__':
    main()
