"""/sitemap.xml — and the one thing about it that is easy to get wrong.

**Every URL here is a FRONTEND route, not a Django one.** Django serves nothing a search engine
should index: it is mounted at `/api/` and `/admin/` only (deploy/apache/edmat.conf), while the
site itself is a SvelteKit SPA Apache serves from the domain root. So `location()` returns a path
like `/exercises/51`, which no urlconf in this project resolves — that is correct, and a
`reverse()` anywhere in this file would be the bug.

The other half of getting it right is that "public" means something different in every app, and
none of them is a single `published` flag:

* Exercise / Material — `published=True` (an auto-hidden row has `published` set to False, so this
  covers moderation too).
* Course        — `visibility` in `LISTED_VISIBILITIES`, which is `public` alone. `private` is
                  reachable-with-a-link and deliberately NOT listed, which is exactly the
                  distinction `courses.models` keeps two frozensets to preserve.
* Event         — `status='published'`. `cancelled` is publicly readable (so the link in the
                  cancellation notice works) but must never be advertised: it is an invitation to
                  something that is not happening.
* Service       — `is_active=True`; a paused listing is the tutor saying not right now.
* Discipline /
  Branch        — `published=True` AND `status='approved'`. A pending node is somebody's unreviewed
                  proposal; it has a real page, but putting it in a sitemap advertises vocabulary
                  no moderator has agreed to yet.

Feature flags are honoured too (`moderation.services.is_feature_enabled`): with `events` or
`tutoring` switched off, an ordinary visitor gets a 403 from those pages, and a sitemap that kept
listing them would be pointing crawlers at errors.
"""

from django.conf import settings
from django.contrib.sitemaps import Sitemap

from courses.models import LISTED_VISIBILITIES, Course
from events.models import Event
from exercises.models import Exercise
from materials.models import Material
from moderation.services import is_feature_enabled
from services.models import Service
from taxonomy.models import Branch, Discipline


class _FrontendSitemap(Sitemap):
    """Absolute URLs come from one setting, not from `django.contrib.sites`.

    The sites framework IS installed (django-postman needs it) with `SITE_ID = 1`, but that row's
    domain is whatever a fixture happened to leave there — `example.com` on a fresh database. A
    sitemap silently full of `https://example.com/...` is worse than no sitemap, so `get_domain` is
    overridden to read `EDMAT_PUBLIC_HOST` instead and the Site row is left alone.
    """

    protocol = 'https'

    def get_domain(self, site=None):
        return settings.EDMAT_PUBLIC_HOST


class StaticSitemap(_FrontendSitemap):
    """The pages that exist regardless of what is in the database.

    Feature-gated sections drop out of the list entirely rather than being listed with a low
    priority, on the same reasoning the navbar removes their links: a killed feature that still
    advertises itself only fails louder.
    """

    changefreq = 'weekly'

    def items(self):
        paths = ['/', '/disciplines', '/materials', '/levels', '/privacy']
        if is_feature_enabled('courses'):
            paths.append('/courses')
        if is_feature_enabled('events'):
            paths.append('/events')
        if is_feature_enabled('tutoring'):
            paths.append('/services')
        return paths

    def location(self, item):
        return item

    def priority(self, item):
        return 1.0 if item == '/' else 0.6


class DisciplineSitemap(_FrontendSitemap):
    changefreq = 'monthly'
    priority = 0.7

    def items(self):
        return Discipline.objects.filter(published=True, status='approved').order_by('slug')

    def location(self, item):
        return f'/disciplines/{item.slug}'


class BranchSitemap(_FrontendSitemap):
    changefreq = 'weekly'
    priority = 0.7

    def items(self):
        return Branch.objects.filter(published=True, status='approved').order_by('slug')

    def location(self, item):
        return f'/branches/{item.slug}'


class ExerciseSitemap(_FrontendSitemap):
    """The bulk of the corpus — ~750 rows, and the reason this sitemap is worth serving at all."""

    changefreq = 'monthly'
    priority = 0.5

    def items(self):
        return Exercise.objects.filter(published=True).order_by('pk')

    def location(self, item):
        return f'/exercises/{item.pk}'

    def lastmod(self, item):
        # `auto_now`, so it genuinely tracks the last edit rather than the import date.
        return item.updated_at


class MaterialSitemap(_FrontendSitemap):
    changefreq = 'monthly'
    priority = 0.5

    def items(self):
        return Material.objects.filter(published=True).order_by('pk')

    def location(self, item):
        return f'/materials/{item.pk}'

    def lastmod(self, item):
        # Material has no `updated_at` — only `created_at`. Reporting the creation date is honest
        # (it is a real date, and never later than the truth); inventing an edit time would not be.
        return item.created_at


class CourseSitemap(_FrontendSitemap):
    changefreq = 'weekly'
    priority = 0.6

    def items(self):
        if not is_feature_enabled('courses'):
            return Course.objects.none()
        return Course.objects.filter(visibility__in=LISTED_VISIBILITIES).order_by('pk')

    def location(self, item):
        return f'/courses/{item.pk}'

    def lastmod(self, item):
        return item.updated_at


class EventSitemap(_FrontendSitemap):
    changefreq = 'daily'
    priority = 0.6

    def items(self):
        if not is_feature_enabled('events'):
            return Event.objects.none()
        return Event.objects.filter(status='published').order_by('pk')

    def location(self, item):
        return f'/events/{item.pk}'

    def lastmod(self, item):
        return item.updated_at


class ServiceSitemap(_FrontendSitemap):
    changefreq = 'weekly'
    priority = 0.5

    def items(self):
        if not is_feature_enabled('tutoring'):
            return Service.objects.none()
        return Service.objects.filter(is_active=True).order_by('pk')

    def location(self, item):
        return f'/services/{item.pk}'

    def lastmod(self, item):
        return item.updated_at


SITEMAPS = {
    'static': StaticSitemap,
    'disciplines': DisciplineSitemap,
    'branches': BranchSitemap,
    'exercises': ExerciseSitemap,
    'materials': MaterialSitemap,
    'courses': CourseSitemap,
    'events': EventSitemap,
    'services': ServiceSitemap,
}
