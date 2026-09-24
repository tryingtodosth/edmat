# -*- coding: utf-8 -*-
"""Wspólny model szkoły + mały zachłanny układacz planu.

Używany przez gen_asc.py i gen_optivum.py, żeby oba eksporty opisywały tę samą
szkołę (SP nr 12 w Krakowie) spójnymi danymi. Deterministyczny: brak losowości
poza ustalonym ziarnem, więc regeneracja daje bajt w bajt ten sam wynik.
"""

DAYS = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek']
DAYS_SHORT = ['Po', 'Wt', 'Śr', 'Cz', 'Pi']

# zgodne z config.lessonTimes w server/seed/00-base.js
PERIODS = [
    (1, '8:00', '8:45'), (2, '8:55', '9:40'), (3, '9:50', '10:35'), (4, '10:45', '11:30'),
    (5, '11:45', '12:30'), (6, '12:45', '13:30'), (7, '13:40', '14:25'), (8, '14:35', '15:20'),
]
NPER = len(PERIODS)


def hhmm(t):
    """Optivum wyrównuje godziny do dwóch znaków spacją: '8:00- 8:45', '11:45-12:30'."""
    return t.rjust(5)


class Sched:
    """Zajętość: nauczyciel, sala, oddział (świadoma podziałów na grupy)."""

    def __init__(self):
        self.tea = {}    # (teacher, day, per, week) -> lesson
        self.room = {}   # (room, day, per, week) -> lesson
        self.cls = {}    # (clazz, day, per, week) -> [(divisiontag, group)]

    def class_free(self, clazz, d, p, w, divtag, group):
        here = self.cls.get((clazz, d, p, w))
        if not here:
            return True
        for (dt, g) in here:
            if dt == 0 or divtag == 0:
                return False          # cała klasa nie wejdzie obok podziału
            if dt == divtag and g == group:
                return False          # ta sama grupa tego samego podziału
            if dt != divtag:
                return False          # dwa różne podziały naraz = konflikt uczniów
        return True

    def take(self, lesson, d, p, w, room):
        for t in lesson['teachers']:
            self.tea[(t, d, p, w)] = lesson
        if room:
            self.room[(room, d, p, w)] = lesson
        for c in lesson['classes']:
            self.cls.setdefault((c, d, p, w), []).append((lesson['divtag'], lesson['group']))

    def fits(self, lesson, d, p, w, room):
        for t in lesson['teachers']:
            if (t, d, p, w) in self.tea:
                return False
        if room and (room, d, p, w) in self.room:
            return False
        for c in lesson['classes']:
            if not self.class_free(c, d, p, w, lesson['divtag'], lesson['group']):
                return False
        return True


def weeks_set(mask):
    return {i for i, ch in enumerate(mask) if ch == '1'}


def place(sched, lessons, rooms_all, max_period=NPER, same_day_ok=False):
    """Zachłannie układa karty. Zwraca listę kart: dict(lesson, day, period, weeks, room)."""
    cards = []
    used_day = {}   # (clazz, subject) -> {day}
    order = sorted(range(len(lessons)), key=lambda i: (-lessons[i]['periodspercard'], -lessons[i]['periodsperweek'], i))
    for idx in order:
        les = lessons[idx]
        dur = les['periodspercard']
        need = max(1, les['periodsperweek'] // dur)
        wk = weeks_set(les['weeks'])
        placed = 0
        for relax in (False, True):
            if placed >= need:
                break
            for _round in range(NPER):
                if placed >= need:
                    break
                for d in range(5):
                    if placed >= need:
                        break
                    if not (relax or same_day_ok):
                        if any(d in used_day.get((c, les['subject']), set()) for c in les['classes']):
                            continue
                    for p0 in (les.get('prefer') or range(1, max_period + 1)):
                        if p0 + dur - 1 > max_period:
                            continue
                        slots = [(d, p0 + k, w) for k in range(dur) for w in wk]
                        room = None
                        if not les.get('roomless'):
                            for r in les.get('rooms') or rooms_all:
                                if all(sched.fits(les, dd, pp, ww, r) for (dd, pp, ww) in slots):
                                    room = r
                                    break
                            if room is None:
                                continue
                        else:
                            if not all(sched.fits(les, dd, pp, ww, None) for (dd, pp, ww) in slots):
                                continue
                        for k in range(dur):
                            for w in wk:
                                sched.take(les, d, p0 + k, w, room)
                        cards.append({'lesson': les, 'day': d, 'period': p0, 'weeks': les['weeks'], 'room': room})
                        for c in les['classes']:
                            used_day.setdefault((c, les['subject']), set()).add(d)
                        placed += 1
                        break
        les['placed'] = placed
    return cards


def place_with(sched, lesson, card, rooms_all):
    """Wstawia lekcję dokładnie w to samo okienko co podana karta (cykl A/B, religia||etyka)."""
    d, p0 = card['day'], card['period']
    dur = lesson['periodspercard']
    wk = weeks_set(lesson['weeks'])
    slots = [(d, p0 + k, w) for k in range(dur) for w in wk]
    room = None
    if not lesson.get('roomless'):
        for r in (lesson.get('rooms') or rooms_all):
            if all(sched.fits(lesson, dd, pp, ww, r) for (dd, pp, ww) in slots):
                room = r
                break
        if room is None:
            return None
    elif not all(sched.fits(lesson, dd, pp, ww, None) for (dd, pp, ww) in slots):
        return None
    for k in range(dur):
        for w in wk:
            sched.take(lesson, d, p0 + k, w, room)
    lesson['placed'] = lesson.get('placed', 0) + 1
    return {'lesson': lesson, 'day': d, 'period': p0, 'weeks': lesson['weeks'], 'room': room}


def L(classes, subject, teachers, ppw, rooms=None, group=None, divtag=0, ppc=1,
      weeks='11', roomless=False, prefer=None, tag=None):
    return {'classes': list(classes), 'subject': subject, 'teachers': list(teachers),
            'periodsperweek': ppw, 'periodspercard': ppc, 'rooms': rooms, 'group': group,
            'divtag': divtag, 'weeks': weeks, 'roomless': roomless, 'prefer': prefer,
            'tag': tag, 'placed': 0}
