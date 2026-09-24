# -*- coding: utf-8 -*-
"""Kadra, sale, przedmioty i oddziały SP nr 12 — wspólne dla obu eksportów planu.

Nazwiska i loginy pokrywają się z server/seed/00-base.js tam, gdzie to możliwe,
żeby importer dało się od razu przetestować na zasianej bazie.
"""

SCHOOL = {
    'name': 'Szkoła Podstawowa nr 12 im. Marii Skłodowskiej-Curie w Krakowie',
    'short': 'SP nr 12 w Krakowie',
    'year': '2026/2027',
}

# (short, firstname, lastname, gender, przedmioty) — short = skrót jak w planie
TEACHERS = [
    ('NJ', 'Joanna',     'Nowak',      'F', ['mat']),
    ('WA', 'Adam',       'Wójcik',     'M', ['fiz', 'inf']),
    ('KE', 'Ewa',        'Król',       'F', ['ang']),
    ('SB', 'Beata',      'Sikora',     'F', ['pol']),
    ('GT', 'Tomasz',     'Górski',     'M', ['che', 'bio']),
    ('LK', 'Krzysztof',  'Lis',        'M', ['his', 'geo']),
    ('MA', 'Anna',       'Mazur',      'F', ['wf']),
    ('KI', 'Iwona',      'Kaczmarek',  'F', ['edw']),
    ('WP', 'Piotr',      'Wiśniewski', 'M', ['mat']),
    ('ŻM', 'Małgorzata', 'Żak',        'F', ['rel']),
    ('ĆH', 'Halina',     'Ćwikła',     'F', ['ety']),
    ('SJ', 'Jacek',      'Stec',       'M', ['wf']),
    ('SR', 'Rafał',      'Sobczak',    'M', ['wsp']),
    ('DŁ', 'Łukasz',     'Dąbrowski',  'M', ['muz', 'pla', 'tec']),
    ('ŚZ', 'Zofia',      'Świderska',  'F', ['nie']),
    ('PG', 'Grażyna',    'Pająk',      'F', ['edw']),
    ('ŁU', 'Urszula',    'Łęcka',      'F', ['edw']),
    ('NW', 'Wanda',      'Nowicka',    'F', ['edw']),
    ('BJ', 'Jan',        'Borowiec',   'M', ['wdz']),
    ('AK', 'Agnieszka',  'Kowalczyk',  'F', ['ang']),
]

SUBJECTS = [
    ('mat', 'Matematyka', 'Mat'),
    ('pol', 'Język polski', 'J.pol'),
    ('ang', 'Język angielski', 'J.ang'),
    ('nie', 'Język niemiecki', 'J.niem'),
    ('fiz', 'Fizyka', 'Fiz'),
    ('che', 'Chemia', 'Chem'),
    ('bio', 'Biologia', 'Biol'),
    ('geo', 'Geografia', 'Geo'),
    ('his', 'Historia', 'Hist'),
    ('inf', 'Informatyka', 'Inf'),
    ('wf',  'Wychowanie fizyczne', 'WF'),
    ('muz', 'Muzyka', 'Muz'),
    ('pla', 'Plastyka', 'Plast'),
    ('tec', 'Technika', 'Tech'),
    ('edw', 'Edukacja wczesnoszkolna', 'Edw'),
    ('rel', 'Religia', 'Rel'),
    ('ety', 'Etyka', 'Et'),
    ('wdz', 'Wychowanie do życia w rodzinie', 'WDŻ'),
    ('wych', 'Godzina z wychowawcą', 'Wych'),
]

# (short, pełna nazwa) — short to numer sali, tak jak wpisują go szkoły
ROOMS = [
    ('2',  'Sala 2'), ('3', 'Sala 3'), ('4', 'Sala 4'), ('5', 'Sala 5'),
    ('8',  'Sala 8'), ('9', 'Sala 9'), ('11', 'Sala 11'), ('12', 'Sala 12'),
    ('15', 'Sala 15'), ('16', 'Sala 16'), ('24', 'Sala 24'),
    ('sg', 'Sala gimnastyczna'), ('msg', 'Mała sala gimnastyczna'), ('sk', 'Pracownia komputerowa'),
]

# (id, nazwa, poziom, wychowawca-short, sala wychowawcza)
CLASSES = [
    ('1a', '1 A', 1, 'KI', '2'),
    ('1b', '1 B', 1, 'PG', '3'),
    ('3a', '3 A', 3, 'ŁU', '4'),
    ('3b', '3 B', 3, 'NW', '5'),
    ('7a', '7 A', 7, 'SB', '8'),
    ('7b', '7 B', 7, 'NJ', '12'),
    ('8a', '8 A', 8, 'LK', '9'),
    ('8b', '8 B', 8, 'GT', '24'),
]

PREF_ROOMS = {
    'mat': ['12', '11'], 'pol': ['8', '11'], 'ang': ['15', '16'], 'nie': ['16', '15'],
    'fiz': ['24'], 'che': ['24'], 'bio': ['24', '9'], 'geo': ['9'], 'his': ['9', '11'],
    'inf': ['sk'], 'wf': ['sg', 'msg'], 'muz': ['5'], 'pla': ['5'], 'tec': ['5'],
    'edw': None, 'rel': ['11', '5'], 'ety': None, 'wdz': ['11'], 'wych': None,
}
