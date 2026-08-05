"""The institutions the school picker offers.

A data migration rather than a fixture or a static Python table, for two reasons: the rows are real
relational data other tables point at (`EducationProfile.school`), and an institution's details
change — a new faculty domain, an installation that moves — so they need to be editable in the admin
afterwards rather than being frozen in source.

Seeded rather than left empty because an empty picker is a broken picker, and because `usos_base_url`
is genuinely per-institution knowledge that belongs somewhere reviewable. Every URL below is the
conventional `usosapi.<host>` form and **must be confirmed against the consortium's own registry
before any real call** — several installations deviate from the convention. A blank one is a
statement, not a gap: that institution runs no USOS installation, which is why the UI can honestly
say so instead of offering a button that could only fail.

Idempotent by slug, so re-running it never duplicates and never overwrites an admin's later edits.
"""

from django.db import migrations

SCHOOLS = [
    # slug, name, short, country, city, domains, usos base
    (
        'uw',
        'Uniwersytet Warszawski',
        'UW',
        'PL',
        'Warszawa',
        ['uw.edu.pl', 'student.uw.edu.pl', 'fuw.edu.pl', 'mimuw.edu.pl'],
        'https://usosapi.uw.edu.pl/',
    ),
    ('pw', 'Politechnika Warszawska', 'PW', 'PL', 'Warszawa', ['pw.edu.pl'], 'https://usosapi.usos.pw.edu.pl/'),
    ('sgh', 'Szkoła Główna Handlowa', 'SGH', 'PL', 'Warszawa', ['sgh.waw.pl'], 'https://usosapi.sgh.waw.pl/'),
    ('uj', 'Uniwersytet Jagielloński', 'UJ', 'PL', 'Kraków', ['uj.edu.pl', 'student.uj.edu.pl'], 'https://usosapi.uj.edu.pl/'),
    ('agh', 'Akademia Górniczo-Hutnicza', 'AGH', 'PL', 'Kraków', ['agh.edu.pl', 'student.agh.edu.pl'], 'https://usosapi.agh.edu.pl/'),
    ('uam', 'Uniwersytet im. Adama Mickiewicza', 'UAM', 'PL', 'Poznań', ['amu.edu.pl', 'st.amu.edu.pl'], 'https://usosapi.amu.edu.pl/'),
    ('put', 'Politechnika Poznańska', 'PP', 'PL', 'Poznań', ['put.poznan.pl'], 'https://usosapi.put.poznan.pl/'),
    ('pwr', 'Politechnika Wrocławska', 'PWr', 'PL', 'Wrocław', ['pwr.edu.pl', 'student.pwr.edu.pl'], 'https://usosapi.pwr.edu.pl/'),
    ('uwr', 'Uniwersytet Wrocławski', 'UWr', 'PL', 'Wrocław', ['uwr.edu.pl'], 'https://usosapi.uwr.edu.pl/'),
    ('pg', 'Politechnika Gdańska', 'PG', 'PL', 'Gdańsk', ['pg.edu.pl', 'student.pg.edu.pl'], 'https://usosapi.pg.edu.pl/'),
    ('ug', 'Uniwersytet Gdański', 'UG', 'PL', 'Gdańsk', ['ug.edu.pl', 'studms.ug.edu.pl'], 'https://usosapi.ug.edu.pl/'),
    ('umk', 'Uniwersytet Mikołaja Kopernika', 'UMK', 'PL', 'Toruń', ['umk.pl', 'stud.umk.pl'], 'https://usosapi.umk.pl/'),
    ('umcs', 'Uniwersytet Marii Curie-Skłodowskiej', 'UMCS', 'PL', 'Lublin', ['umcs.pl', 'mail.umcs.pl'], 'https://usosapi.umcs.pl/'),
    ('us', 'Uniwersytet Śląski', 'UŚ', 'PL', 'Katowice', ['us.edu.pl'], 'https://usosapi.us.edu.pl/'),
    ('ul', 'Uniwersytet Łódzki', 'UŁ', 'PL', 'Łódź', ['uni.lodz.pl', 'edu.uni.lodz.pl'], 'https://usosapi.uni.lodz.pl/'),
    # No USOS installation — deliberately kept in the list rather than omitted. A student there is
    # still a student, still gets a school picker entry and an email-domain claim, and the UI
    # explains why the connect button is absent instead of silently having none.
    ('pl-lodz', 'Politechnika Łódzka', 'PŁ', 'PL', 'Łódź', ['p.lodz.pl', 'edu.p.lodz.pl'], ''),
    ('asp-warszawa', 'Akademia Sztuk Pięknych w Warszawie', 'ASP Warszawa', 'PL', 'Warszawa', ['asp.waw.pl'], ''),
    ('asp-krakow', 'Akademia Sztuk Pięknych w Krakowie', 'ASP Kraków', 'PL', 'Kraków', ['asp.krakow.pl'], ''),
    # Outside Poland there is no USOS at all — the system is a Polish consortium — so these exist
    # for the school claim and nothing more. Included because EdMat is a public study resource, not
    # a UW intranet, and someone revising abroad still needs a real entry to pick.
    ('knu', 'Taras Shevchenko National University of Kyiv', 'KNU', 'UA', 'Kyiv', ['knu.ua'], ''),
    ('kpi', 'Igor Sikorsky Kyiv Polytechnic Institute', 'KPI', 'UA', 'Kyiv', ['kpi.ua'], ''),
    ('lnu', 'Ivan Franko National University of Lviv', 'LNU', 'UA', 'Lviv', ['lnu.edu.ua'], ''),
    ('cuni', 'Univerzita Karlova', 'CUNI', 'CZ', 'Praha', ['cuni.cz', 'mff.cuni.cz'], ''),
    ('tu-berlin', 'Technische Universität Berlin', 'TU Berlin', 'DE', 'Berlin', ['tu-berlin.de', 'campus.tu-berlin.de'], ''),
]


def seed(apps, schema_editor):
    School = apps.get_model('identity', 'School')
    for slug, name, short, country, city, domains, usos in SCHOOLS:
        School.objects.update_or_create(
            slug=slug,
            defaults={
                'name': name,
                'short_name': short,
                'country': country,
                'city': city,
                'email_domains': domains,
                'usos_base_url': usos,
                'is_active': True,
            },
        )


def unseed(apps, schema_editor):
    School = apps.get_model('identity', 'School')
    School.objects.filter(slug__in=[s[0] for s in SCHOOLS]).delete()


class Migration(migrations.Migration):
    dependencies = [('identity', '0001_initial')]
    operations = [migrations.RunPython(seed, unseed)]
