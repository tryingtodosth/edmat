"""What the corpus is *about*, with no university anywhere in it.

Three levels, named for the Polish words a student would actually use:

    Discipline (dziedzina)  matematyka
      └─ Branch (dział)     analiza matematyczna
           └─ Topic (temat) ekstrema

**On the restructure.** This app used to model `Field` (kierunek) → `Course` (przedmiot) → `Topic`,
where a przedmiot was a specific university's specific subject — the rows were literally slugged
`uw-matematyka-am2` and carried a `university` CharField. That conflated two different things. "Analiza
Matematyczna II, at UW, taught this winter, with these people on the roster" is an *offering*, and it
now lives in the `courses` app as a `Course` (kurs), which is what the word means to everybody outside
this file. What remains here is the subject matter itself, which no university owns: mathematical
analysis is mathematical analysis whether UW teaches it to second-year mathematicians or to first-year
physicists. Those two are now two Courses pointing at one Branch, which is exactly the distinction the
old model could not draw — it had to be two przedmiot rows with disjoint topic lists.

That also frees the word `Course`, which previously meant a przedmiot here and a kurs in `classroom`,
forcing that app's model to be called `TaughtCourse` and its route `/api/taught-courses/`. Both are
now simply `Course` and `/api/courses/`.

`Chapter` stays here rather than moving to `courses` with the offering, even though a textbook is
chosen by whoever runs the class: the 42 chapter rows are corpus data imported from the source
`mapa_rozdzialow.yaml`, and there are no offerings for them to belong to. Data that exists needs
somewhere to live.
"""

from django.db import models


class Discipline(models.Model):
    """dziedzina — matematyka / informatyka / fizyka.

    A domain of knowledge, NOT a degree programme. The predecessor of this model was `Field`, meaning
    *kierunek*, which is a thing you enrol in; this is a thing you can know something about. The
    rename is the difference in meaning, not just tidier spelling — and it settles the standing
    annoyance of a model called `Field` in a Django codebase, where the word already means something
    on every line of every other model.
    """

    slug = models.SlugField(unique=True)
    published = models.BooleanField(default=True)

    def __str__(self) -> str:
        return self.slug


class DisciplineTranslation(models.Model):
    discipline = models.ForeignKey(
        Discipline, related_name='translations', on_delete=models.CASCADE
    )
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = [('discipline', 'locale')]

    def __str__(self) -> str:
        return f'{self.discipline.slug} ({self.locale})'


class Branch(models.Model):
    """dział — analiza matematyczna, rachunek prawdopodobieństwa.

    A branch of its discipline, in the ordinary English sense of "branch of mathematics". Carries no
    university and no level: "Analiza I" and "Analiza Matematyczna II" are the same branch taught to
    different people at different depths, and that difference belongs to the Course that teaches it.

    `slug` is unique across every discipline rather than scoped to one, because a branch is what a URL
    addresses (`/branches/analiza-matematyczna`) and a globally unique slug keeps that route flat.
    """

    slug = models.SlugField(unique=True)
    discipline = models.ForeignKey(
        Discipline, related_name='branches', on_delete=models.PROTECT
    )
    published = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'slug']

    def __str__(self) -> str:
        return self.slug


class BranchTranslation(models.Model):
    branch = models.ForeignKey(Branch, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    class Meta:
        unique_together = [('branch', 'locale')]

    def __str__(self) -> str:
        return f'{self.branch.slug} ({self.locale})'


class Topic(models.Model):
    """temat — BRANCH-SCOPED, as it was course-scoped before: topic slugs repeat across branches
    (`calki` means something in analysis and something else in probability), so the pair is the key.
    """

    slug = models.SlugField()
    branch = models.ForeignKey(Branch, related_name='topics', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [('branch', 'slug')]
        ordering = ['branch', 'order']

    def __str__(self) -> str:
        return f'{self.branch.slug}/{self.slug}'


class TopicTranslation(models.Model):
    topic = models.ForeignKey(Topic, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=300)

    class Meta:
        unique_together = [('topic', 'locale')]

    def __str__(self) -> str:
        return f'{self.topic} ({self.locale})'


class Subtopic(models.Model):
    """A finer-grained breakdown within a Topic — e.g. within `ekstrema` (extrema), a subtopic
    might be `ekstrema-warunkowe` (constrained extrema). Topic-scoped the same way Topic is
    branch-scoped, one level deeper — added to back Material's own coverage claims (materials
    app: MaterialCoverage), which pin down not just "this material touches Topic X" but how
    deeply, at what granularity.

    Deliberately kept through the Discipline/Branch/Topic restructure even though the browsable
    hierarchy is three levels: this is not a level of that hierarchy, it is the granularity a
    coverage claim is made at, and `MaterialCoverage` reads it.
    """

    slug = models.SlugField()
    topic = models.ForeignKey(Topic, related_name='subtopics', on_delete=models.CASCADE)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [('topic', 'slug')]
        ordering = ['topic', 'order']

    def __str__(self) -> str:
        return f'{self.topic}/{self.slug}'


class SubtopicTranslation(models.Model):
    subtopic = models.ForeignKey(Subtopic, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    name = models.CharField(max_length=300)

    class Meta:
        unique_together = [('subtopic', 'locale')]

    def __str__(self) -> str:
        return f'{self.subtopic} ({self.locale})'


class Chapter(models.Model):
    """From mapa_rozdzialow.yaml — optional textbook cross-reference, branch-scoped."""

    branch = models.ForeignKey(Branch, related_name='chapters', on_delete=models.CASCADE)
    number = models.PositiveIntegerField()
    start_page = models.PositiveIntegerField(null=True, blank=True)
    topics = models.ManyToManyField(Topic, related_name='chapters', blank=True)

    class Meta:
        unique_together = [('branch', 'number')]
        ordering = ['branch', 'number']

    def __str__(self) -> str:
        return f'{self.branch.slug} ch.{self.number}'


class ChapterTranslation(models.Model):
    chapter = models.ForeignKey(Chapter, related_name='translations', on_delete=models.CASCADE)
    locale = models.CharField(max_length=8)
    title = models.CharField(max_length=300)

    class Meta:
        unique_together = [('chapter', 'locale')]

    def __str__(self) -> str:
        return f'{self.chapter} ({self.locale})'
