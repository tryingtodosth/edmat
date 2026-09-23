"""`manage.py seed_concepts` — six concepts with real articles, blocks and links.

What a demo and `e2e/concepts.mjs` both need is not "some rows": it is every shape this app can take,
present at once, so a browser run can click through all of them and a person looking at the site can
see what the feature actually is. So this seeds a concept with articles in three bands, a page with
two competing articles by two different people, an `all` article, articles in both Polish and
English, **every one of the five block kinds**, links to real exercises and materials, one
`prerequisite` relation and one `[[…]]` mention that the harvester turns into a body link.

**Idempotent by slug.** Re-running finds each concept by its slug and leaves it alone rather than
building a second copy — which is what makes it safe to run against a database somebody is already
using, and is exactly what the "runs twice without error" check verifies. Nothing here is deleted or
rewritten: a concept this command made and a person then edited stays edited.

The files are GENERATED rather than shipped: a tiny PNG through Pillow and a minimal valid PDF
written out byte by byte. Both go through the real `services.store_asset`, so the seeded rows are
produced by the same re-encode-and-sniff pipeline a real upload gets (house rule 7) rather than by a
shortcut that would make the seed prove less than it looks like it does. The chemistry drawing is a
small hand-written SVG put through `chem.svg.sanitize_svg`, the way `chem/tests.py` builds one.

Deliberately NOT audited and NOT announced beyond what publishing does on its own: `record_audit`
skips a call with no request (house rule 10 — an honest skip rather than a faked actor), and the
feed rows come from `publish_revision` itself, which is the point of running the real service
functions here instead of writing rows by hand.
"""

from __future__ import annotations

import io

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand

from concepts.models import Concept
from concepts.services import (
    Conflict,
    Refused,
    add_link,
    create_article,
    create_concept,
    harvest_body_links,
    publish_revision,
)

User = get_user_model()

#: The seeded demo identities (`accounts/seed_demo_users`). Looked up rather than created, and the
#: command falls back to whoever exists when they are absent — a seed that insisted on five specific
#: accounts would fail on a database that has real people in it instead.
DEMO_USERNAMES = ['u-kasia', 'u-michal', 'u-ola', 'u-bartek', 'u-julia']


def _tiny_png() -> bytes:
    """A real 4x4 PNG, generated rather than embedded — `store_asset` re-encodes it to WebP anyway,
    and a base64 blob in the source would be bytes nobody can read or check."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new('RGB', (4, 4), (250, 240, 200)).save(buffer, format='PNG')
    return buffer.getvalue()


def _tiny_pdf() -> bytes:
    """The smallest PDF libmagic will call `application/pdf` and a viewer will open: one empty page.

    Written out rather than shipped as a fixture, for the same reason as the PNG — and with the real
    `%PDF-1.4` header, because `materials.validators` sniffs the first bytes and would refuse
    padding (`testing.factories.pdf_bytes` records the same discovery).
    """
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>',
    ]
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{index} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref_at = len(out)
    out += f'xref\n0 {len(objects) + 1}\n'.encode()
    out += b'0000000000 65535 f \n'
    for offset in offsets:
        out += f'{offset:010d} 00000 n \n'.encode()
    out += (
        f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n'
    ).encode()
    return bytes(out)


CHEM_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">'
    '<path d="M10 30 L50 30" stroke="#000" fill="none"/>'
    '<path d="M50 26 L90 26 M50 34 L90 34" stroke="#000" fill="none"/>'
    '<text x="4" y="34" font-family="Arial" font-size="12">H</text>'
    '<text x="94" y="34" font-family="Arial" font-size="12">O</text>'
    '</svg>'
)
CHEM_KET = (
    '{"root": {"nodes": [{"$ref": "mol0"}]}, "mol0": {"type": "molecule", '
    '"atoms": [{"label": "C", "location": [0, 0, 0]}], "bonds": []}}'
)


class Command(BaseCommand):
    help = 'Seeds six concepts with articles, every block kind, and links. Idempotent by slug.'

    def handle(self, *args, **options):
        users = self._users()
        if not users:
            self.stderr.write('No accounts at all — run `manage.py seed_demo_users` first.')
            return
        branches = self._branches()
        if not branches:
            self.stderr.write('No branches — run the corpus import first.')
            return

        drawing = self._drawing(users[0])
        image_asset = self._asset(users[0], 'concept-seed.png', _tiny_png(), 'image/png')
        pdf_asset = self._asset(users[0], 'concept-seed.pdf', _tiny_pdf(), 'application/pdf')

        # Built once and reused: `_specs` is pure data, but it is read three times below and a
        # reader should not have to check whether the three copies agree.
        self._cached_specs = self._specs(users, branches, drawing, image_asset, pdf_asset)

        made = 0
        for spec in self._cached_specs:
            if Concept.objects.filter(slug=spec['slug']).exists():
                continue
            self._build(spec, branches)
            made += 1

        # Prerequisites in a pass of their own, AFTER every concept exists: "know this first" points
        # at another concept, and the one it points at may well be built later in the same run.
        self._wire_prerequisites(users[0])

        # Re-run for every seeded concept, not just the new ones: a concept created on an earlier run
        # may mention one created on this one, and the harvester only ever looks at what is published
        # NOW (it is a recount, not an increment — house rule 5), so running it again is free and
        # correct rather than a second write of the same rows.
        for concept in Concept.objects.filter(
            slug__in=[spec['slug'] for spec in self._cached_specs]
        ):
            harvest_body_links(concept)

        self.stdout.write(
            self.style.SUCCESS(
                f'seed_concepts: {made} new concept(s); '
                f'{Concept.objects.count()} in the database.'
            )
        )

    def _wire_prerequisites(self, user) -> None:
        """`know this first` between two seeded concepts, once both exist.

        Skipped rather than retried when a link between the pair is already there, whatever its
        relation: there is one row per (concept, target) by construction, and a body-harvested
        `related` row is the text's own answer — rewriting it here would make the seed disagree with
        what the article actually says.
        """
        from concepts.models import ConceptLink

        concept_ct = ContentType.objects.get_for_model(Concept)
        for spec in self._prerequisite_pairs():
            source = Concept.objects.filter(slug=spec[0]).first()
            target = Concept.objects.filter(slug=spec[1]).first()
            if source is None or target is None:
                continue
            if ConceptLink.objects.filter(
                concept=source, content_type=concept_ct, object_id=target.pk
            ).exists():
                continue
            try:
                add_link(
                    source, user, target_type='concept', target_id=target.pk, relation='prerequisite'
                )
            except (Conflict, Refused, LookupError):
                # A refusal here costs one row and nothing else; the next run tries again. Narrow
                # rather than a bare `except`, so a real bug in `add_link` still surfaces.
                continue

    def _prerequisite_pairs(self):
        return [
            (spec['slug'], slug)
            for spec in self._cached_specs
            for slug in spec.get('prerequisites', ())
        ]

    # --- fixtures --------------------------------------------------------------------------------

    def _users(self) -> list:
        found = list(User.objects.filter(username__in=DEMO_USERNAMES).order_by('username'))
        if found:
            return found
        return list(User.objects.all().order_by('pk')[:3])

    def _branches(self) -> list:
        from taxonomy.models import Branch

        return list(Branch.objects.order_by('slug')[:3])

    def _drawing(self, author):
        """One `chem.ChemDrawing`, reused by every chem block. Found by its own label so a re-run
        does not mint a second identical picture."""
        from chem.models import ChemDrawing
        from chem.svg import sanitize_svg

        existing = ChemDrawing.objects.filter(author=author, label='seed:concepts').first()
        if existing is not None:
            return existing
        cleaned = sanitize_svg(CHEM_SVG)
        width, height = 120, 60
        drawing = ChemDrawing(
            author=author,
            source_format='ket',
            source=CHEM_KET,
            label='seed:concepts',
            image_kind='svg',
            width=width,
            height=height,
        )
        drawing.image.save(f'chem/seed-concepts-{author.pk}.svg', ContentFile(cleaned.encode()), save=True)
        return drawing

    def _asset(self, user, name: str, payload: bytes, content_type: str):
        """One `ConceptAsset`, through the real `store_asset` so it is processed exactly as an
        upload is. Found by its original name so a re-run reuses it."""
        from concepts.models import ConceptAsset
        from concepts.services import store_asset

        existing = ConceptAsset.objects.filter(uploaded_by=user, original_name=name).first()
        if existing is not None:
            return existing
        return store_asset(user, SimpleUploadedFile(name, payload, content_type=content_type))

    # --- the six concepts -------------------------------------------------------------------------

    def _specs(self, users, branches, drawing, image_asset, pdf_asset):
        """Every concept this command seeds, as data.

        A list of dicts rather than six blocks of code, so the shape of what is seeded is readable
        at a glance and the "did we cover every block kind / both languages / a second article"
        questions can be answered by looking rather than by tracing.
        """
        author = users[0]
        second = users[1] if len(users) > 1 else users[0]
        third = users[2] if len(users) > 2 else author

        markdown = {'kind': 'markdown'}
        return [
            {
                'slug': 'pochodna',
                'branch': 0,
                'tags': ['analiza', 'pochodne'],
                'articles': [
                    {
                        'audience': 'university',
                        'locale': 'pl',
                        'author': author,
                        'title': 'Pochodna',
                        'summary': 'Tempo zmiany funkcji w punkcie — granica ilorazu różnicowego.',
                        'blocks': [
                            {**markdown, 'body': 'Pochodna mierzy, jak szybko funkcja zmienia się w punkcie. '
                                                 'Bliskim pojęciem jest [[granica]].'},
                            {'kind': 'latex', 'source': "f'(x_0) = \\lim_{h \\to 0} \\frac{f(x_0+h)-f(x_0)}{h}"},
                            {**markdown, 'body': 'Jeżeli granica istnieje, funkcja jest różniczkowalna w tym punkcie.'},
                        ],
                    },
                    {
                        'audience': 'secondary',
                        'locale': 'pl',
                        'author': second,
                        'title': 'Pochodna — po ludzku',
                        'summary': 'Nachylenie stycznej do wykresu.',
                        'blocks': [
                            {**markdown, 'body': 'Wyobraź sobie wykres funkcji i prostą, która go dotyka w jednym '
                                                 'punkcie. Pochodna to nachylenie tej prostej.'},
                            {'kind': 'image', 'asset_id': image_asset.pk, 'alt': 'Styczna do wykresu',
                             'caption': 'Styczna w punkcie.'},
                        ],
                    },
                    {
                        'audience': 'secondary',
                        'locale': 'pl',
                        'author': third,
                        'title': 'Pochodna — inne ujęcie',
                        'summary': 'To samo pojęcie, opowiedziane od strony prędkości.',
                        'blocks': [
                            {**markdown, 'body': 'Prędkość jest pochodną drogi po czasie. To jest ta sama idea, '
                                                 'tylko nazwana inaczej.'},
                        ],
                    },
                    {
                        'audience': 'university',
                        'locale': 'en',
                        'author': author,
                        'title': 'Derivative',
                        'summary': 'The rate at which a function changes at a point.',
                        'blocks': [
                            {**markdown, 'body': 'The derivative is the limit of the difference quotient. '
                                                 'See also [[granica]].'},
                            {'kind': 'latex', 'source': "\\frac{d}{dx}x^n = n x^{n-1}"},
                        ],
                    },
                ],
            },
            {
                'slug': 'granica',
                'branch': 0,
                'tags': ['analiza'],
                'articles': [
                    {
                        'audience': 'university',
                        'locale': 'pl',
                        'author': author,
                        'title': 'Granica',
                        'summary': 'Wartość, do której zbliżają się wyrazy ciągu albo wartości funkcji.',
                        'blocks': [
                            {**markdown, 'body': 'Granica opisuje zachowanie funkcji w pobliżu punktu, '
                                                 'niekoniecznie w nim samym.'},
                            {'kind': 'latex', 'source': '\\lim_{n \\to \\infty} a_n = g'},
                        ],
                    },
                    {
                        'audience': 'all',
                        'locale': 'en',
                        'author': second,
                        'title': 'Limit',
                        'summary': 'Where something is heading, whether or not it ever arrives.',
                        'blocks': [
                            {**markdown, 'body': 'A limit says where a sequence is heading. It is the one idea '
                                                 'the whole of analysis is built on.'},
                        ],
                    },
                ],
            },
            {
                'slug': 'mol',
                'branch': min(1, len(branches) - 1),
                'tags': ['chemia'],
                'articles': [
                    {
                        'audience': 'secondary',
                        'locale': 'pl',
                        'author': author,
                        'title': 'Mol',
                        'summary': 'Jednostka liczności materii.',
                        'blocks': [
                            {**markdown, 'body': 'Jeden mol to tyle cząstek, ile atomów jest w 12 g węgla-12.'},
                            {'kind': 'chem', 'drawing_id': drawing.pk, 'caption': 'Cząsteczka, której mol dotyczy.'},
                            {'kind': 'latex', 'source': 'N_A \\approx 6{,}022 \\cdot 10^{23}\\ \\mathrm{mol^{-1}}'},
                        ],
                    },
                    {
                        'audience': 'primary',
                        'locale': 'pl',
                        'author': second,
                        'title': 'Mol — dla najmłodszych',
                        'summary': 'Sposób liczenia bardzo małych rzeczy.',
                        'blocks': [
                            {**markdown, 'body': 'Tak jak tuzin to dwanaście, mol to bardzo, bardzo dużo.'},
                        ],
                    },
                ],
            },
            {
                'slug': 'rekurencja',
                'branch': min(2, len(branches) - 1),
                'tags': ['informatyka'],
                'articles': [
                    {
                        'audience': 'university',
                        'locale': 'pl',
                        'author': second,
                        'title': 'Rekurencja',
                        'summary': 'Definiowanie czegoś przez nie samo, z warunkiem stopu.',
                        'blocks': [
                            {**markdown, 'body': 'Funkcja rekurencyjna wywołuje samą siebie na mniejszym problemie.'},
                            {'kind': 'pdf', 'asset_id': pdf_asset.pk, 'caption': 'Notatka o drzewie wywołań.'},
                        ],
                    },
                    {
                        'audience': 'secondary',
                        'locale': 'en',
                        'author': third,
                        'title': 'Recursion',
                        'summary': 'Something defined in terms of itself, with a way to stop.',
                        'blocks': [
                            {**markdown, 'body': 'To understand recursion, first understand recursion — and then '
                                                 'notice that the joke leaves out the base case.'},
                        ],
                    },
                ],
            },
            {
                'slug': 'mechanika-kwantowa',
                'branch': 0,
                'tags': ['fizyka'],
                'prerequisites': ['pochodna'],
                'articles': [
                    {
                        'audience': 'university',
                        'locale': 'pl',
                        'author': author,
                        'title': 'Mechanika kwantowa',
                        'summary': 'Teoria opisująca świat w skali atomowej.',
                        'blocks': [
                            {**markdown, 'body': 'Stan układu opisuje funkcja falowa, a jej ewolucję — równanie '
                                                 'Schrödingera.'},
                            {'kind': 'latex', 'source': 'i\\hbar \\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi'},
                        ],
                    },
                    {
                        'audience': 'primary',
                        'locale': 'pl',
                        'author': third,
                        'title': 'Mechanika kwantowa — dla dzieci',
                        'summary': 'Bardzo małe rzeczy zachowują się inaczej niż piłki.',
                        'blocks': [
                            {**markdown, 'body': 'Najmniejsze cząstki nie są małymi kulkami. Czasem zachowują się '
                                                 'jak fala na wodzie.'},
                        ],
                    },
                    {
                        'audience': 'senior',
                        'locale': 'pl',
                        'author': second,
                        'title': 'Mechanika kwantowa — spokojne wprowadzenie',
                        'summary': 'Bez wzorów, za to z historią.',
                        'blocks': [
                            {**markdown, 'body': 'Zaczęło się od problemu, którego fizyka klasyczna nie umiała '
                                                 'rozwiązać: promieniowania ciała doskonale czarnego.'},
                        ],
                    },
                ],
            },
            {
                'slug': 'calka',
                'branch': 0,
                'tags': ['analiza'],
                'articles': [
                    {
                        'audience': 'university',
                        'locale': 'pl',
                        'author': author,
                        'title': 'Całka',
                        'summary': 'Sumowanie ciągłe — pole pod wykresem.',
                        'blocks': [
                            {**markdown, 'body': 'Całka oznaczona to pole pod wykresem. Odwrotnością różniczkowania '
                                                 'jest całkowanie — zobacz [[pochodna]].'},
                            {'kind': 'latex', 'source': '\\int_a^b f(x)\\,dx = F(b) - F(a)'},
                        ],
                    },
                    {
                        'audience': 'university',
                        'locale': 'en',
                        'author': second,
                        'title': 'Integral',
                        'summary': 'Continuous summation — the area under a curve.',
                        'blocks': [
                            {**markdown, 'body': 'Integration undoes differentiation; see [[pochodna]].'},
                        ],
                    },
                ],
                # Deliberately `granica` and not `pochodna`: this article's body already mentions
                # `[[pochodna]]`, and one row per (concept, target) means the harvested link would
                # be the one that exists. A prerequisite has to be a pair nothing mentions.
                'prerequisites': ['granica'],
            },
        ]

    def _build(self, spec, branches) -> None:
        branch = branches[min(spec['branch'], len(branches) - 1)]
        first = spec['articles'][0]

        concept, article, revision = create_concept(
            first['author'],
            title=first['title'],
            summary=first['summary'],
            blocks=first['blocks'],
            audience=first['audience'],
            locale=first['locale'],
            branches=[branch],
            tags=self._tags(spec['tags']),
            submit=False,
        )
        # The slug allocator would have derived it from the title; the specs above name the slug
        # explicitly, because that is what `[[…]]` mentions and the e2e script both address.
        if concept.slug != spec['slug'] and not Concept.objects.filter(slug=spec['slug']).exists():
            concept.slug = spec['slug']
            concept.save(update_fields=['slug'])
        publish_revision(revision, first['author'])

        for extra in spec['articles'][1:]:
            _article, extra_revision = create_article(
                concept,
                extra['author'],
                audience=extra['audience'],
                locale=extra['locale'],
                title=extra['title'],
                summary=extra['summary'],
                blocks=extra['blocks'],
                submit=False,
            )
            publish_revision(extra_revision, extra['author'])

        self._link_content(concept, branch, first['author'])

    def _tags(self, slugs):
        from exercises.models import Tag

        rows = []
        for slug in slugs:
            tag, _created = Tag.objects.get_or_create(slug=slug)
            rows.append(tag)
        return rows

    def _link_content(self, concept, branch, user) -> None:
        """Two exercises and one material of the concept's own branch — the chip rows the exercise
        and material pages show, seeded so a browser run has something real to click."""
        from exercises.models import Exercise
        from materials.models import Material

        exercises = list(Exercise.objects.filter(branch=branch, published=True).order_by('number')[:2])
        materials = list(Material.objects.filter(branch=branch, published=True).order_by('slug')[:1])
        for target, kind in [(e, 'exercise') for e in exercises] + [(m, 'material') for m in materials]:
            try:
                add_link(concept, user, target_type=kind, target_id=target.pk)
            except (Conflict, Refused, LookupError):
                # Already linked, or a target this account may not link — one row lost, never the
                # whole seed. Narrow rather than a bare `except`, so a real bug still surfaces.
                continue
