# -*- coding: utf-8 -*-
"""Generuje ILUSTRACYJNĄ próbkę archiwum rocznego dziennika (§ 21 / § 22).

To NIE jest odtworzenie schematu żadnego konkretnego producenta — patrz README.
Wyjście: ../archive/dziennik-2025-2026-sample.xml
"""
import datetime
import os
import sys
from xml.sax.saxutils import quoteattr, escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import school as S

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'archive')

PUPILS = [
    ('Adamczyk', 'Oliwia', 'K'), ('Bąk', 'Kacper', 'M'), ('Cieślak', 'Zuzanna', 'K'),
    ('Dudek', 'Filip', 'M'), ('Głowacka', 'Maja', 'K'), ('Górski', 'Antoni', 'M'),
    ('Jabłońska', 'Hanna', 'K'), ('Jankowski', 'Szymon', 'M'), ('Kaczmarek', 'Lena', 'K'),
    ('Kowalska-Nowak', 'Łucja', 'K'), ('Krawczyk', 'Wojciech', 'M'), ('Lewandowski', 'Michał', 'M'),
    ('Majewska', 'Zofia', 'K'), ('Mazur', 'Jan', 'M'), ('Mazur', 'Maciej', 'M'),
    ('Nguyen', 'Thi Mai', 'K'), ('Nowak', 'Julia', 'K'), ('Pawlak', 'Ignacy', 'M'),
    ('Sikora', 'Aniela', 'K'), ('Szymański', 'Bartosz', 'M'), ('Wieczorek', 'Żaneta', 'K'),
    ('Wiśniewski', 'Tymoteusz', 'M'), ('Wójcik', 'Antonina', 'K'), ('Zając', 'Miłosz', 'M'),
]

# plan 7B na potrzeby próbki: (nr lekcji, przedmiot, nauczyciel) w kolejnych dniach tygodnia
PLAN = {
    0: [(1, 'Matematyka', 'Joanna Nowak'), (2, 'Język polski', 'Beata Sikora'),
        (3, 'Historia', 'Krzysztof Lis'), (4, 'Wychowanie fizyczne', 'Anna Mazur'),
        (5, 'Język angielski', 'Ewa Król')],
    1: [(1, 'Język polski', 'Beata Sikora'), (2, 'Fizyka', 'Adam Wójcik'),
        (3, 'Matematyka', 'Joanna Nowak'), (4, 'Chemia', 'Tomasz Górski'),
        (5, 'Geografia', 'Krzysztof Lis')],
    2: [(1, 'Matematyka', 'Joanna Nowak'), (2, 'Język angielski', 'Ewa Król'),
        (3, 'Biologia', 'Tomasz Górski'), (4, 'Wychowanie fizyczne', 'Anna Mazur'),
        (5, 'Godzina z wychowawcą', 'Joanna Nowak')],
    3: [(1, 'Język polski', 'Beata Sikora'), (2, 'Historia', 'Krzysztof Lis'),
        (3, 'Fizyka', 'Adam Wójcik'), (4, 'Matematyka', 'Joanna Nowak'),
        (5, 'Technika', 'Łukasz Dąbrowski')],
    4: [(1, 'Chemia', 'Tomasz Górski'), (2, 'Język polski', 'Beata Sikora'),
        (3, 'Język angielski', 'Ewa Król'), (4, 'Informatyka', 'Adam Wójcik'),
        (5, 'Wychowanie fizyczne', 'Anna Mazur')],
}

TEMATY = {
    'Matematyka': ['Wyrażenia algebraiczne — mnożenie sum', 'Równania z jedną niewiadomą',
                   'Zadania tekstowe prowadzące do równań', 'Praca klasowa — wyrażenia algebraiczne',
                   'Omówienie pracy klasowej', 'Procenty w zadaniach praktycznych'],
    'Język polski': ['„Balladyna” — charakterystyka tytułowej bohaterki', 'Środki stylistyczne w liryce',
                     'Redagowanie rozprawki', 'Sprawdzian z lektury', 'Ortografia: pisownia „nie” z różnymi częściami mowy'],
    'Historia': ['Powstanie styczniowe — przyczyny', 'Sytuacja na ziemiach polskich po 1864 r.',
                 'Rewolucja przemysłowa', 'Kartkówka — powstanie styczniowe'],
    'Fizyka': ['Praca, moc, energia', 'Zasada zachowania energii', 'Zadania rachunkowe'],
    'Chemia': ['Tlenki — otrzymywanie i właściwości', 'Kwasy beztlenowe', 'Doświadczenie: badanie odczynu'],
    'Biologia': ['Układ krwionośny człowieka', 'Budowa i praca serca'],
    'Geografia': ['Ludność Europy', 'Migracje we współczesnej Europie'],
    'Język angielski': ['Present Perfect — forma i użycie', 'Słownictwo: travelling', 'Test — unit 5',
                        'Reading comprehension'],
    'Wychowanie fizyczne': ['Piłka siatkowa — odbicia sposobem górnym', 'Gimnastyka — przewrót w przód',
                            'Test sprawnościowy — bieg na 60 m'],
    'Informatyka': ['Arkusz kalkulacyjny — formuły', 'Wykresy w arkuszu'],
    'Technika': ['Rysunek techniczny — rzuty prostokątne'],
    'Godzina z wychowawcą': ['Bezpieczeństwo w sieci', 'Przygotowanie do wywiadówki', 'Samorząd klasowy'],
}

# kody frekwencji tego (przykładowego) producenta — inne niż u nas!
FREKW = [('ob', 'obecność'), ('nb', 'nieobecność nieusprawiedliwiona'),
         ('u', 'nieobecność usprawiedliwiona'), ('sp', 'spóźnienie'),
         ('zw', 'zwolnienie'), ('ns', 'nieobecność z przyczyn szkolnych')]


def school_days(y, m):
    d = datetime.date(y, m, 1)
    out = []
    while d.month == m:
        if d.weekday() < 5:
            out.append(d)
        d += datetime.timedelta(days=1)
    return out


def A(**kw):
    return ' '.join('%s=%s' % (k.rstrip('_'), quoteattr(str(v))) for k, v in kw.items())


def main():
    os.makedirs(OUT, exist_ok=True)
    days = school_days(2026, 3)
    out = []
    w = out.append
    w('<?xml version="1.0" encoding="UTF-8"?>')
    w('<!--')
    w('  PRÓBKA ILUSTRACYJNA — NIE JEST TO SCHEMAT ŻADNEGO KONKRETNEGO PRODUCENTA.')
    w('  Kształt odtworzony z opisu obowiązku z § 21/§ 22 rozporządzenia MEN z 25.08.2017')
    w('  (eksport dziennika do pliku XML + archiwizacja w ciągu 10 dni od końca roku szkolnego)')
    w('  oraz z relacji szkół o tym, CO faktycznie wychodzi z dziennika (oceny bez wag i kategorii).')
    w('  Zakres: jeden oddział (7B), jeden miesiąc (marzec 2026) — pełne archiwum ma cały rok i całą szkołę.')
    w('-->')
    w('<eksportDziennika %s>' % A(wersja='1.0', system='Dziennik elektroniczny (przykład)',
                                  dataEksportu='2026-07-03T09:12:44+02:00',
                                  podstawaPrawna='§ 22 rozporządzenia MEN z dnia 25 sierpnia 2017 r.',
                                  charakter='ilustracyjny'))
    w('  <szkola %s>' % A(rspo='12345', regon='357123456'))
    w('    <nazwa>%s</nazwa>' % escape(S.SCHOOL['name']))
    w('    <adres>ul. Szkolna 4, 31-000 Kraków</adres>')
    w('    <dyrektor>Piotr Wiśniewski</dyrektor>')
    w('  </szkola>')
    w('  <rokSzkolny>2025/2026</rokSzkolny>')
    w('  <zakres %s/>' % A(od='2026-03-02', do='2026-03-31',
                           uwaga='próbka: jeden oddział, jeden miesiąc'))
    w('  <slowniki>')
    w('    <frekwencja>')
    for k, n in FREKW:
        w('      <kod %s/>' % A(symbol=k, nazwa=n))
    w('    </frekwencja>')
    w('    <skalaOcen>')
    for v, n in [(6, 'celujący'), (5, 'bardzo dobry'), (4, 'dobry'), (3, 'dostateczny'),
                 (2, 'dopuszczający'), (1, 'niedostateczny')]:
        w('      <stopien %s/>' % A(wartosc=v, nazwa=n))
    w('    </skalaOcen>')
    w('    <!-- Kategorie i wagi ocen NIE są eksportowane: w archiwum zostają same wartości. -->')
    w('  </slowniki>')
    w('  <oddzial %s>' % A(kod='7B', poziom='7', liczbaUczniow=len(PUPILS)))
    w('    <wychowawca %s/>' % A(imie='Joanna', nazwisko='Nowak'))
    w('    <uczniowie>')
    for i, (ln, fn, sex) in enumerate(PUPILS, 1):
        y, m, d = 2012, 1 + i % 12, 1 + (i * 7) % 27
        mm = m + 20
        base = '%02d%02d%02d%03d%d' % (y % 100, mm, d, 100 + i, 1 if sex == 'M' else 2)
        ws = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
        pes = base + str((10 - sum(wi * int(base[j]) for j, wi in enumerate(ws)) % 10) % 10)
        att = {'nazwisko': ln, 'imie': fn, 'nrWDzienniku': i, 'nrWKsiedze': 1200 + i,
               'dataUrodzenia': '%d-%02d-%02d' % (y, m, d)}
        if ln == 'Nguyen':
            att['pesel'] = ''
            att['dokumentTozsamosci'] = 'paszport VN N1234567'
        else:
            att['pesel'] = pes
        w('      <uczen %s/>' % A(id='U%02d' % i, **att))
    w('    </uczniowie>')

    # --- lekcje z frekwencją
    w('    <zajecia>')
    lid = 0
    absent_plan = {}     # (uczen, dzień) -> kod
    for di, day in enumerate(days):
        for (no, subj, tea) in PLAN[day.weekday()]:
            lid += 1
            tem = TEMATY[subj][(di + no) % len(TEMATY[subj])]
            w('      <lekcja %s>' % A(id='L%04d' % lid, data=day.isoformat(), numer=no,
                                      przedmiot=subj, nauczyciel=tea, temat=tem))
            w('        <frekwencja>')
            for i, (ln, fn, _s) in enumerate(PUPILS, 1):
                seed = (i * 31 + di * 17 + no * 7) % 97
                if seed < 4:
                    st = 'u'
                elif seed < 6:
                    st = 'nb'
                elif seed == 6:
                    st = 'sp'
                elif seed == 7 and subj == 'Wychowanie fizyczne':
                    st = 'zw'
                elif seed == 8 and no == 1:
                    st = 'ns'
                else:
                    st = 'ob'
                a = {'uczen': 'U%02d' % i, 'status': st}
                if st == 'u':
                    a['usprawiedliwil'] = 'rodzic'
                if st == 'sp':
                    a['minuty'] = 5 + (i % 3) * 5
                w('          <wpis %s/>' % A(**a))
            w('        </frekwencja>')
            w('      </lekcja>')
    w('    </zajecia>')

    # --- oceny: bieżące bez kategorii i wag + śródroczne
    w('    <oceny>')
    subjects = ['Matematyka', 'Język polski', 'Historia', 'Fizyka', 'Chemia', 'Biologia',
                'Geografia', 'Język angielski', 'Wychowanie fizyczne', 'Informatyka', 'Technika']
    for i, (ln, fn, _s) in enumerate(PUPILS, 1):
        for si, subj in enumerate(subjects):
            for k in range(1 + (i + si) % 3):
                v = 2 + ((i * 3 + si * 5 + k * 7) % 5)
                dd = days[(i + si * 3 + k * 5) % len(days)]
                w('      <ocena %s/>' % A(uczen='U%02d' % i, przedmiot=subj, data=dd.isoformat(),
                                          wartosc=v, rodzaj='biezaca'))
            sr = 2 + ((i * 2 + si) % 5)
            w('      <ocena %s/>' % A(uczen='U%02d' % i, przedmiot=subj, rodzaj='srodroczna',
                                      wartosc=sr, dataWystawienia='2026-01-23'))
        zach = ['wzorowe', 'bardzo dobre', 'dobre', 'poprawne'][i % 4]
        w('      <ocena %s/>' % A(uczen='U%02d' % i, przedmiot='Zachowanie', rodzaj='srodroczna',
                                  wartosc=zach, dataWystawienia='2026-01-23'))
    w('    </oceny>')

    w('    <uwagi>')
    for i in (3, 9, 14, 21):
        w('      <uwaga %s/>' % A(uczen='U%02d' % i, data='2026-03-%02d' % (4 + i),
                                  autor='Joanna Nowak', rodzaj='negatywna' if i % 2 else 'pozytywna',
                                  tresc='Wpis wychowawczy — treść skrócona w eksporcie'))
    w('    </uwagi>')
    w('    <!-- Brak w eksporcie: wagi ocen, kategorie ocen, kolory, historia poprawek, -->')
    w('    <!-- wiadomości, dokumentacja pomocy psychologiczno-pedagogicznej (osobne PDF-y). -->')
    w('  </oddzial>')
    w('  <podpis %s/>' % A(typ='brak', uwaga='Plik podpisuje dyrektor poza systemem (XAdES); '
                                             'tu podpisu nie ma — próbka ilustracyjna'))
    w('</eksportDziennika>')
    data = '\n'.join(out) + '\n'
    open(os.path.join(OUT, 'dziennik-2025-2026-sample.xml'), 'w', encoding='utf-8', newline='\n').write(data)
    print('lekcji: %d, uczniów: %d, bajtów: %d' % (lid, len(PUPILS), len(data.encode('utf-8'))))


if __name__ == '__main__':
    main()
