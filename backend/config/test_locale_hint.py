"""`/api/locale-hint/` — the first-visit interface language.

The endpoint has no database in it, so what is worth pinning is the decision itself and the two
properties a shared cache could quietly break: that it is per-caller and never stored.
"""

from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APISimpleTestCase

from config.geo import country_for_ip
from config.views import suggested_locale


class SuggestedLocaleTests(SimpleTestCase):
    """The rule in one place, so both the endpoint and any future caller agree on it."""

    def test_unknown_country_is_polish(self):
        # The case every clone, every test run and every deployment without a MaxMind database is
        # in. "I do not know" must not become English by accident.
        self.assertEqual(suggested_locale(None), 'pl')

    def test_poland_is_polish(self):
        self.assertEqual(suggested_locale('PL'), 'pl')

    def test_anywhere_else_is_english(self):
        self.assertEqual(suggested_locale('DE'), 'en')
        self.assertEqual(suggested_locale('GB'), 'en')


class CountryForIpWithoutADatabaseTests(SimpleTestCase):
    """House rule 10: with no database this answers "unknown", never a guess."""

    def test_no_database_configured_means_unknown(self):
        with self.settings(EDMAT_GEOIP_DB=''):
            self.assertIsNone(country_for_ip('8.8.8.8'))

    def test_no_address_means_unknown(self):
        self.assertIsNone(country_for_ip(None))
        self.assertIsNone(country_for_ip(''))


class LocaleHintEndpointTests(APISimpleTestCase):
    """The endpoint as a caller sees it: no fixtures, and the view itself makes no query at all.

    `databases` is nevertheless open, and only because of something OUTSIDE the view:
    `RequestLogMiddleware` writes one row per request to a log shard, swallows its own failures and
    reports them — so with the shards closed, every test here passed while printing a
    `DatabaseOperationForbidden` traceback that reads exactly like a real fault.
    """

    databases = '__all__'
    url = '/api/locale-hint/'

    def test_an_unknown_visitor_is_offered_polish(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['suggested_locale'], 'pl')
        # Honest about WHY: nothing is claimed about a country we could not determine.
        self.assertIsNone(response.data['country'])

    def test_a_visitor_in_poland_is_offered_polish(self):
        with patch('config.views.country_for_ip', return_value='PL'):
            response = self.client.get(self.url)
        self.assertEqual(response.data, {'suggested_locale': 'pl', 'country': 'PL'})

    def test_a_visitor_elsewhere_is_offered_english(self):
        with patch('config.views.country_for_ip', return_value='DE'):
            response = self.client.get(self.url)
        self.assertEqual(response.data, {'suggested_locale': 'en', 'country': 'DE'})

    def test_the_answer_is_never_stored_by_a_cache(self):
        # Per-CALLER, so a shared cache would hand one visitor's answer to the next. `cachemw`
        # already refuses it (it is not on PUBLIC_PREFIXES); this is the header that says the same
        # thing to every cache between here and the browser.
        response = self.client.get(self.url)
        self.assertEqual(response['Cache-Control'], 'no-store')

    def test_it_is_open_to_a_visitor_with_no_account(self):
        # AllowAny with no authentication classes at all: this answers before anybody has signed
        # in, and an expired token in the header must not turn it into a 401.
        response = self.client.get(self.url, HTTP_AUTHORIZATION='Token not-a-real-token')
        self.assertEqual(response.status_code, 200)
