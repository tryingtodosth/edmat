"""`manage.py import_concepts` — every property the import-exercises skill's `reference/concepts.md`
promises: idempotent by slug, a changed file is a new revision on the SAME article, links filed in
a second pass whatever the file order, nothing announced, one bad file imports nothing, a dry run
leaves nothing, the licence only widens, and nobody else's work is overwritten.
"""

from __future__ import annotations

import shutil
import tempfile
from io import StringIO
from pathlib import Path

from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from rest_framework.test import APIClient

from activity.models import ActivityEvent
from concepts.models import Concept, ConceptArticle, ConceptLink, ConceptRevision
from concepts.services import create_concept, create_revision, publish_revision
from exercises.models import Exercise
from licensing.models import LicenceChange
from notifications.models import Notification
from provenance.models import AuthorMark
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

FOOTER = '<p><em>Opracowanie przygotowane z pomocą AI (Claude) — czeka na sprawdzenie przez prowadzącego.</em></p>'


def page(slug, title='Tytuł', *, summary='Krótko o pojęciu.', branches='[analiza-matematyczna]',
         body='Definicja \\(x^2\\).', extra=''):
    lines = ['---', f'slug: {slug}', f'title: {title}', f'summary: {summary}', f'branches: {branches}']
    if extra:
        lines.append(extra)
    lines.append('---')
    return '\n'.join(lines) + '\n' + body + '\n'


class ImportConceptsBase(TestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.branch = make_branch('analiza-matematyczna')
        self.other_branch = make_branch('fale', discipline_slug='fizyka')
        self.exercise = make_exercise(self.branch, 7)
        self.author = make_user('todoonet')
        self.dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, name, text):
        path = self.dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    def run_import(self, **kwargs):
        out = StringIO()
        kwargs.setdefault('author', self.author.username)
        try:
            call_command('import_concepts', str(self.dir), stdout=out, stderr=out, **kwargs)
        finally:
            self.last_output = out.getvalue()
        return self.last_output

    def refused(self, **kwargs):
        with self.assertRaises(CommandError):
            self.run_import(**kwargs)
        return self.last_output

    def sample(self):
        self.write('granica.md', page('granica', 'Granica', body='Granica ciągu.\n\n### Wzór\n\\[ \\lim a_n = g \\]\n' + FOOTER))
        self.write('pochodna.md', page(
            'pochodna', 'Pochodna',
            extra='tags: [pochodne, analiza]\nprerequisites: [granica]\nexercises: [analiza-matematyczna/7]',
            body='Pochodna to granica ilorazu.\n\n### Definicja\n\\[ f\'(x)=\\lim_{h\\to0}\\frac{f(x+h)-f(x)}{h} \\]\n\n### Zob.\n[[granica]]\n',
        ))


class CreateTests(ImportConceptsBase):
    def test_creates_concepts_articles_and_published_revisions(self):
        self.sample()
        out = self.run_import()
        self.assertIn('2 created, 0 revised, 0 unchanged', out)

        pochodna = Concept.objects.get(slug='pochodna')
        self.assertEqual(pochodna.created_by, self.author)
        self.assertEqual(list(pochodna.branches.values_list('slug', flat=True)), ['analiza-matematyczna'])
        self.assertEqual(set(pochodna.tags.values_list('slug', flat=True)), {'pochodne', 'analiza'})
        article = pochodna.articles.get()
        self.assertEqual((article.audience, article.locale, article.created_by), ('university', 'pl', self.author))
        revision = article.revisions.get()
        self.assertEqual(revision.status, 'published')
        self.assertEqual(revision.title, 'Pochodna')
        # Split at every `### `, each block keeping its own heading.
        self.assertEqual([b['kind'] for b in revision.blocks], ['markdown'] * 3)
        self.assertTrue(revision.blocks[1]['body'].startswith('### Definicja'))
        self.assertIn('\\[ f\'(x)', revision.blocks[1]['body'])

    def test_links_prerequisite_and_exercise(self):
        self.sample()
        self.run_import()
        pochodna = Concept.objects.get(slug='pochodna')
        granica = Concept.objects.get(slug='granica')
        concept_ct = ContentType.objects.get_for_model(Concept)
        prerequisite = ConceptLink.objects.get(concept=pochodna, content_type=concept_ct, object_id=granica.pk)
        # The body also says [[granica]], which harvested a `related` body row at publish time; the
        # file's `prerequisites:` must win, as a manual row the next harvest leaves alone.
        self.assertEqual((prerequisite.relation, prerequisite.origin), ('prerequisite', 'manual'))
        exercise_link = ConceptLink.objects.get(
            concept=pochodna, content_type=ContentType.objects.get_for_model(Exercise)
        )
        self.assertEqual((exercise_link.object_id, exercise_link.relation), (self.exercise.pk, 'related'))

    def test_file_order_does_not_matter(self):
        # `a-…` sorts first and needs `z-…`, which does not exist until later in pass 1.
        self.write('a.md', page('a-pojecie', extra='prerequisites: [z-pojecie]\nrelated: [m-pojecie]'))
        self.write('m.md', page('m-pojecie'))
        self.write('z.md', page('z-pojecie'))
        self.run_import()
        a = Concept.objects.get(slug='a-pojecie')
        self.assertEqual(
            {(link.target.slug, link.relation) for link in a.links.all()},
            {('z-pojecie', 'prerequisite'), ('m-pojecie', 'related')},
        )

    def test_announces_nothing(self):
        self.sample()
        self.run_import()
        self.assertFalse(ActivityEvent.objects.exists())
        self.assertFalse(Notification.objects.exists())

    def test_slug_is_the_files_even_when_the_title_slugifies_elsewhere(self):
        self.write('x.md', page('wzor-de-moivrea', "Wzór de Moivre'a"))
        self.run_import()
        self.assertTrue(Concept.objects.filter(slug='wzor-de-moivrea').exists())
        self.assertEqual(Concept.objects.count(), 1)

    def test_batch_yaml_gives_defaults(self):
        # `branch:` (singular, import_exercises' batch.yaml key) is the same as `branches: [fale]`.
        self.write('fale/pojecia/batch.yaml', 'branch: fale\naudience: secondary\nlicence: cc-by-4.0\n')
        text = page('rezonans').replace('branches: [analiza-matematyczna]\n', '')
        self.write('fale/pojecia/rezonans.md', text)
        self.run_import()
        concept = Concept.objects.get(slug='rezonans')
        self.assertEqual(list(concept.branches.values_list('slug', flat=True)), ['fale'])
        article = concept.articles.get()
        self.assertEqual((article.audience, article.licence), ('secondary', 'cc-by-4.0'))


class RerunTests(ImportConceptsBase):
    def test_unchanged_rerun_writes_nothing(self):
        self.sample()
        self.run_import()
        revisions = ConceptRevision.objects.count()
        links = ConceptLink.objects.count()
        out = self.run_import()
        self.assertIn('0 created, 0 revised, 2 unchanged', out)
        self.assertIn('links: 0 added, 0 re-filed', out)
        self.assertEqual(ConceptRevision.objects.count(), revisions)
        self.assertEqual(ConceptLink.objects.count(), links)

    def test_changed_text_is_a_new_revision_on_the_same_article(self):
        self.sample()
        self.run_import()
        article = ConceptArticle.objects.get(concept__slug='granica')
        self.write('granica.md', page('granica', 'Granica ciągu', body='Nowy tekst.\n'))
        out = self.run_import()
        self.assertIn('0 created, 1 revised, 1 unchanged', out)
        self.assertEqual(ConceptArticle.objects.filter(concept__slug='granica').count(), 1)
        statuses = list(article.revisions.order_by('number').values_list('number', 'status', 'created_by'))
        self.assertEqual(statuses, [(1, 'superseded', self.author.pk), (2, 'published', self.author.pk)])
        head = article.revisions.get(status='published')
        self.assertEqual((head.title, head.based_on.number), ('Granica ciągu', 1))
        self.assertFalse(ActivityEvent.objects.exists())

    def test_tags_added_branches_replaced_links_never_removed(self):
        self.sample()
        self.run_import()
        pochodna = Concept.objects.get(slug='pochodna')
        pochodna.tags.create(slug='od-czytelnika')
        self.write('pochodna.md', page('pochodna', 'Pochodna', branches='[fale]', body='Krócej.\n'))
        self.run_import()
        self.assertEqual(list(pochodna.branches.values_list('slug', flat=True)), ['fale'])
        self.assertIn('od-czytelnika', set(pochodna.tags.values_list('slug', flat=True)))
        self.assertIn('pochodne', set(pochodna.tags.values_list('slug', flat=True)))
        self.assertEqual(pochodna.links.filter(relation='prerequisite').count(), 1)
        self.assertEqual(pochodna.links.filter(content_type=ContentType.objects.get_for_model(Exercise)).count(), 1)

    def test_somebody_elses_article_and_concept_are_not_touched(self):
        stranger = make_user('ktos', is_verified_contributor=True)
        concept, theirs, revision = create_concept(
            stranger, title='Granica', summary='Ich.', blocks=[{'kind': 'markdown', 'body': 'Ich tekst.'}],
            audience='university', locale='pl', branches=[self.other_branch],
        )
        concept.slug = 'granica'
        concept.save(update_fields=['slug'])
        publish_revision(revision, stranger)
        self.sample()
        out = self.run_import()
        self.assertIn('1 created, 0 revised, 0 unchanged, 1 new article(s)', out)
        self.assertEqual(concept.articles.count(), 2)
        self.assertEqual(theirs.revisions.get().blocks, [{'kind': 'markdown', 'body': 'Ich tekst.'}])
        # Somebody else's concept: the file adds its branch and takes none away.
        self.assertEqual(set(concept.branches.values_list('slug', flat=True)), {'fale', 'analiza-matematyczna'})
        ours = concept.articles.get(created_by=self.author)
        self.assertEqual(ours.revisions.get().status, 'published')

    def test_a_community_head_is_not_published_over(self):
        self.sample()
        self.run_import()
        article = ConceptArticle.objects.get(concept__slug='granica')
        editor = make_user('redaktor')
        head = article.revisions.get(status='published')
        theirs = create_revision(article, editor, title='Granica', summary='Lepiej.',
                                 blocks=[{'kind': 'markdown', 'body': 'Poprawione.'}], based_on=head)
        publish_revision(theirs, self.author)
        # File unchanged since the author's last import: nothing to say, nothing published.
        out = self.run_import()
        self.assertIn('is the head', out)
        self.assertEqual(article.revisions.get(status='published').pk, theirs.pk)
        # File changed: refused with a warning, still not published over.
        self.write('granica.md', page('granica', 'Granica', body='Inny tekst.\n'))
        out = self.run_import()
        self.assertIn('NOT published over it', out)
        self.assertEqual(article.revisions.get(status='published').pk, theirs.pk)

    def test_an_open_draft_is_named_and_skipped(self):
        self.sample()
        self.run_import()
        article = ConceptArticle.objects.get(concept__slug='granica')
        create_revision(article, self.author, title='Szkic', blocks=[], based_on=article.revisions.get())
        self.write('granica.md', page('granica', 'Granica', body='Zmienione.\n'))
        out = self.run_import()
        self.assertIn('open draft', out)
        self.assertEqual(article.revisions.get(status='published').number, 1)

    def test_a_removed_article_stays_removed(self):
        self.sample()
        self.run_import()
        ConceptArticle.objects.filter(concept__slug='granica').update(is_removed=True)
        self.write('granica.md', page('granica', 'Granica', body='Zmienione.\n'))
        out = self.run_import()
        self.assertIn('removed by a moderator', out)
        self.assertEqual(ConceptArticle.objects.get(concept__slug='granica').revisions.count(), 1)


class LicenceTests(ImportConceptsBase):
    def test_default_is_unknown_and_a_flag_or_file_declares_one(self):
        self.write('a.md', page('a-pojecie'))
        self.write('b.md', page('b-pojecie', extra='licence: cc-by-sa-4.0'))
        self.run_import(licence='cc-by-nc-4.0')
        self.assertEqual(ConceptArticle.objects.get(concept__slug='a-pojecie').licence, 'cc-by-nc-4.0')
        self.assertEqual(ConceptArticle.objects.get(concept__slug='b-pojecie').licence, 'cc-by-sa-4.0')
        self.write('c.md', page('c-pojecie'))
        self.run_import()
        self.assertEqual(ConceptArticle.objects.get(concept__slug='c-pojecie').licence, 'unknown')

    def test_a_rerun_widens_and_records_but_never_narrows(self):
        self.write('a.md', page('a-pojecie', extra='licence: cc-by-nc-4.0'))
        self.run_import()
        self.write('a.md', page('a-pojecie', extra='licence: cc-by-4.0'))
        self.run_import()
        article = ConceptArticle.objects.get(concept__slug='a-pojecie')
        self.assertEqual(article.licence, 'cc-by-4.0')
        change = LicenceChange.objects.get()
        self.assertEqual((change.from_licence, change.to_licence, change.changed_by), ('cc-by-nc-4.0', 'cc-by-4.0', self.author))
        self.write('a.md', page('a-pojecie', extra='licence: edmat-only'))
        out = self.run_import()
        self.assertIn('narrower', out)
        article.refresh_from_db()
        self.assertEqual(article.licence, 'cc-by-4.0')
        self.assertEqual(LicenceChange.objects.count(), 1)


class ValidationTests(ImportConceptsBase):
    def assertNothingImported(self):
        self.assertFalse(Concept.objects.exists())
        self.assertFalse(ConceptRevision.objects.exists())

    def test_one_bad_file_aborts_the_batch_and_every_problem_is_named(self):
        self.write('ok.md', page('dobre'))
        self.write('bad1.md', page('Zly_Slug', 'A < B', extra='colour: red'))
        self.write('bad2.md', page('drugie', body='Otwarte \\( bez zamknięcia.\n'))
        out = self.refused()
        self.assertNothingImported()
        for needle in ('bad1.md: `slug: Zly_Slug`', 'bad1.md: `title:` contains', 'unknown front-matter key `colour:`',
                       'bad2.md: block 1: 1× "\\(" but 0× "\\)"'):
            self.assertIn(needle, out)

    def test_required_keys(self):
        self.write('x.md', '---\ntitle: T\n---\n\n')
        out = self.refused()
        for needle in ('`slug:` is required', '`summary:` is required', '`branches:` is required', 'the body is empty'):
            self.assertIn(needle, out)

    def test_display_maths_and_line_breaks_are_balanced(self):
        # `\\[3mm]` is a LaTeX line break, not an opening delimiter (import_exercises' count).
        self.write('x.md', page('x', body='\\[ \\begin{cases} a \\\\[3mm] b \\end{cases} \\]\n'))
        self.run_import()
        self.assertTrue(Concept.objects.filter(slug='x').exists())

    def test_a_heading_inside_a_formula_is_caught_per_block(self):
        self.write('x.md', page('x', body='\\[ a\n### nagłówek\nb \\]\n'))
        out = self.refused()
        self.assertIn('unbalanced maths', out)

    def test_headings_above_level_three_are_refused_but_fenced_ones_are_text(self):
        self.write('x.md', page('x', body='## Za wysoki\n'))
        self.assertIn('section headings in a concept body are `###`', self.refused())
        self.write('x.md', page('x', body='```\n## w kodzie\n### też w kodzie\n```\n'))
        self.run_import()
        self.assertEqual(len(ConceptRevision.objects.get().blocks), 1)

    def test_unknown_branch_concept_and_exercise(self):
        self.write('x.md', page('x', branches='[nie-ma]',
                                extra='prerequisites: [widmo]\nexercises: [analiza-matematyczna/999, zle]'))
        out = self.refused()
        self.assertNothingImported()
        self.assertIn("no branch 'nie-ma'", out)
        self.assertIn("'widmo' is neither in this batch nor an existing concept", out)
        self.assertIn('analiza-matematyczna/999 does not exist', out)
        self.assertIn("`exercises:` entry 'zle'", out)

    def test_unpublished_exercise_is_refused_and_skip_flag_downgrades(self):
        hidden = make_exercise(self.branch, 8)
        Exercise.objects.filter(pk=hidden.pk).update(published=False)
        self.write('x.md', page('x', extra='exercises: [analiza-matematyczna/8, analiza-matematyczna/7]'))
        self.assertIn('analiza-matematyczna/8 is not published', self.refused())
        out = self.run_import(skip_missing_exercises=True)
        self.assertIn('skipped (--skip-missing-exercises)', out)
        concept = Concept.objects.get(slug='x')
        self.assertEqual(list(concept.links.values_list('object_id', flat=True)), [self.exercise.pk])

    def test_duplicate_slug_self_link_both_lists_and_cycle(self):
        self.write('a.md', page('a', extra='prerequisites: [b, a]\nrelated: [b]'))
        self.write('a2.md', page('a'))
        self.write('b.md', page('b', extra='prerequisites: [c]'))
        self.write('c.md', page('c', extra='prerequisites: [b]'))
        out = self.refused()
        self.assertIn('names the concept itself', out)
        self.assertIn('in both `prerequisites:` and `related:`', out)
        self.write('a.md', page('a', extra='prerequisites: [b]'))
        out = self.refused()
        self.assertIn('`slug: a` is also used by', out)
        self.assertIn('prerequisites form a cycle: b → c → b', out)
        self.assertNothingImported()

    def test_a_summary_that_storage_would_cut_is_refused(self):
        self.write('x.md', page('x', summary='Gdy \\(a<b\\) oraz \\(c>d\\).'))
        self.assertIn('would be cut when stored', self.refused())

    def test_a_minor_cannot_be_the_author(self):
        minor = make_user('dziecko')
        minor.profile.is_minor = True
        minor.profile.save(update_fields=['is_minor'])
        self.write('x.md', page('x'))
        with self.assertRaisesMessage(CommandError, 'minor'):
            self.run_import(author='dziecko')


class DryRunTests(ImportConceptsBase):
    def test_dry_run_leaves_nothing(self):
        self.sample()
        out = self.run_import(dry_run=True, ai_assisted='z pomocą AI')
        self.assertIn('2 created', out)
        self.assertIn('rolling the transaction back', out)
        self.assertFalse(Concept.objects.exists())
        self.assertFalse(ConceptRevision.objects.exists())
        self.assertFalse(ConceptLink.objects.exists())
        self.assertFalse(AuthorMark.objects.exists())

    def test_dry_run_of_a_change_leaves_the_head(self):
        self.sample()
        self.run_import()
        self.write('granica.md', page('granica', 'Inna', body='Inny.\n'))
        self.assertIn('1 revised', self.run_import(dry_run=True))
        self.assertEqual(ConceptRevision.objects.filter(article__concept__slug='granica').count(), 1)


class AiAssistedTests(ImportConceptsBase):
    def test_marks_every_article_once(self):
        self.sample()
        out = self.run_import(ai_assisted='Napisane z Claude')
        self.assertIn('AI-assisted: 2 marked, 0 already marked', out)
        ct = ContentType.objects.get_for_model(ConceptArticle)
        marks = AuthorMark.objects.filter(content_type=ct)
        self.assertEqual(marks.count(), 2)
        self.assertTrue(all(m.assisted and m.declared_by == self.author and m.note == 'Napisane z Claude' for m in marks))
        self.assertIn('AI-assisted: 0 marked, 2 already marked', self.run_import(ai_assisted='Napisane z Claude'))

    def test_declare_ai_assisted_accepts_the_kind(self):
        self.sample()
        self.run_import()
        out = StringIO()
        call_command('declare_ai_assisted', author=self.author.username, kinds='concept_article', stdout=out)
        self.assertIn('concept_article: 2 by todoonet; 2 marked', out.getvalue())


class ProvenanceConceptKindTests(ImportConceptsBase):
    """The registry entry the import's `--ai-assisted` writes against, read back through the API."""

    client_class = APIClient

    def test_summary_answers_for_a_published_article_and_hides_an_unpublished_one(self):
        from moderation.models import FeatureFlag

        FeatureFlag.objects.update_or_create(key='ai_assisted', defaults={'is_enabled': True})
        self.sample()
        self.run_import(ai_assisted='')
        published = ConceptArticle.objects.get(concept__slug='granica')
        stranger = make_user('ktos')
        _concept, waiting, _rev = create_concept(
            stranger, title='Czeka', audience='university', locale='pl', blocks=[{'kind': 'markdown', 'body': 'x'}],
        )
        response = self.client.get(
            '/api/ai-assistance/', {'targets': f'concept_article:{published.pk},concept_article:{waiting.pk}'}
        )
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()
        self.assertTrue(rows[f'concept_article:{published.pk}']['author_marked'])
        # Waiting for review: for a stranger it does not exist (house rule 4), mark or no mark.
        self.assertNotIn(f'concept_article:{waiting.pk}', rows)

    def test_the_concept_pages_menu_writes_through_the_same_endpoints(self):
        # What the concept page's "Mark as AI-assisted…" item does (2026-10-21, the chip's frontend
        # half): the author answers for their own article, a reader votes on it, nobody but staff
        # may lock it (`branch_of` is None for a concept), and a waiting article 404s a stranger.
        from moderation.models import FeatureFlag

        FeatureFlag.objects.update_or_create(key='ai_assisted', defaults={'is_enabled': True})
        self.sample()
        self.run_import()
        article = ConceptArticle.objects.get(concept__slug='granica')
        base = f'/api/ai-assistance/concept_article/{article.pk}'
        reader = make_user('czytelnik')

        self.client.force_authenticate(reader)
        refused = self.client.put(f'{base}/author-mark/', {'assisted': True}, format='json')
        self.assertEqual(refused.status_code, 403, refused.content)
        voted = self.client.put(f'{base}/vote/', {'confidence': 70}, format='json')
        self.assertEqual(voted.status_code, 200, voted.content)
        self.assertEqual(voted.json()['my_confidence'], 70)
        self.assertFalse(voted.json()['can_lock'])
        locked = self.client.put(f'{base}/lock/', {'value': 0, 'reason': 'x'}, format='json')
        self.assertEqual(locked.status_code, 403, locked.content)

        self.client.force_authenticate(self.author)
        declared = self.client.put(f'{base}/author-mark/', {'assisted': True, 'note': 'Claude'}, format='json')
        self.assertEqual(declared.status_code, 200, declared.content)
        self.assertTrue(declared.json()['author_marked'])
        self.assertEqual(declared.json()['score'], 100)
        self.assertFalse(declared.json()['can_vote'])  # the author may not vote on their own work

        _concept, waiting, _rev = create_concept(
            self.author, title='Czeka', audience='university', locale='pl', blocks=[{'kind': 'markdown', 'body': 'x'}],
        )
        self.client.force_authenticate(reader)
        hidden = self.client.put(f'/api/ai-assistance/concept_article/{waiting.pk}/vote/', {'confidence': 50}, format='json')
        self.assertEqual(hidden.status_code, 404, hidden.content)


class SweepTests(ImportConceptsBase):
    def test_dump_text_fields_carries_concept_heads_for_the_katex_sweep(self):
        import json

        self.sample()
        self.run_import()
        out_path = self.dir / 'fields.json'
        call_command('dump_text_fields', out=str(out_path), stdout=StringIO())
        rows = [r for r in json.loads(out_path.read_text()) if r['kind'] == 'concept']
        self.assertEqual(len(rows), 2)
        pochodna = next(r for r in rows if r['ref'].startswith('pochodna'))
        self.assertEqual(pochodna['title'], 'Pochodna')
        self.assertIn('### Definicja', pochodna['description'])
        self.assertIn('[[granica]]', pochodna['description'])
