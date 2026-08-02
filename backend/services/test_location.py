"""Regression tests for tutor-offer delivery mode and location — "users need to be able to post
tutor offers and specify if stationary or virtually (if stationary location, so we need to have
openmaps connected)".

Its own module rather than more classes in `services/tests.py`, for the same reason
`accounts/test_avatar.py` is separate: the geocoding half needs the Django cache cleared and
Nominatim stubbed, and no other services test wants to pay for that setup.

**Nominatim is never actually called here.** Every geocoding test patches the module's own `_fetch`.
A test suite that made real requests to a public, rate-limited third-party service would be slow,
would fail offline, and — since the usage policy caps the entire application at 1 request/second —
would be exactly the abusive traffic pattern this code exists to avoid.
"""

from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from services.geocoding import GeocodingUnavailable, search
from services.models import Service

User = get_user_model()

# A real Nominatim /search payload shape, trimmed to the fields the client actually reads. Note the
# 7-decimal-place coordinates: that is genuinely what Nominatim returns, and reproducing it here is
# the whole point of `test_search_rounds_coordinates_to_the_stored_precision` below.
FAKE_SEARCH_RESPONSE = [
    {
        'display_name': 'Wydział MIM UW, 2, Stefana Banacha, Warszawa, Polska',
        'lat': '52.2118211',
        'lon': '20.9819442',
    }
]


class GeocodingClientTests(APITestCase):
    def setUp(self):
        # The client caches results and holds a global 1-req/sec gate, both in the Django cache —
        # without clearing, one test's cached answer or spent gate silently changes the next.
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_search_rounds_coordinates_to_the_stored_precision(self):
        """Nominatim returns 7+ decimal places; `Service.location_lat` stores 6, and DRF's
        DecimalField REJECTS excess precision rather than rounding. Without rounding at this
        boundary the frontend echoes a search result straight back and gets a 400 telling it the
        value it was just handed is invalid — which is exactly what happened in live testing."""
        with mock.patch('services.geocoding._fetch', return_value=FAKE_SEARCH_RESPONSE):
            results = search('banacha 2')

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].lat, 52.211821)
        self.assertEqual(results[0].lon, 20.981944)

    def test_a_repeated_search_is_served_from_cache_without_a_second_upstream_call(self):
        """Caching is not an optimization here, it is a condition of Nominatim's usage policy."""
        with mock.patch(
            'services.geocoding._fetch', return_value=FAKE_SEARCH_RESPONSE
        ) as fetch:
            search('banacha 2')
            search('banacha 2')

        self.assertEqual(fetch.call_count, 1)

    def test_queries_differing_only_in_case_and_spacing_share_one_cache_entry(self):
        with mock.patch(
            'services.geocoding._fetch', return_value=FAKE_SEARCH_RESPONSE
        ) as fetch:
            search('Banacha 2')
            search('  banacha   2  ')

        self.assertEqual(fetch.call_count, 1)

    def test_an_empty_result_is_cached_too(self):
        """A misspelled address would otherwise cost a real upstream request on every retry — the
        precise opposite of what caching is for here."""
        with mock.patch('services.geocoding._fetch', return_value=[]) as fetch:
            self.assertEqual(search('qqqq no such place'), [])
            self.assertEqual(search('qqqq no such place'), [])

        self.assertEqual(fetch.call_count, 1)

    def test_an_unreachable_upstream_raises_rather_than_returning_no_results(self):
        """"The service is down" and "that address does not exist" must not look identical, or a
        user retypes a perfectly valid address indefinitely wondering why nothing is found."""
        with mock.patch('services.geocoding._fetch', side_effect=GeocodingUnavailable('boom')):
            with self.assertRaises(GeocodingUnavailable):
                search('banacha 2')

    def test_the_request_identifies_this_application(self):
        """Nominatim's usage policy requires a User-Agent identifying the app; anonymous traffic is
        what gets blocked. Asserted on the real request object the client builds."""
        captured = {}

        def fake_urlopen(request, timeout=None):
            captured['ua'] = request.get_header('User-agent')
            raise GeocodingUnavailable('stop here')

        with mock.patch('services.geocoding.urllib.request.urlopen', fake_urlopen):
            with self.assertRaises(GeocodingUnavailable):
                search('banacha 2')

        self.assertIn('EdMat', captured['ua'])


class GeocodeApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user('geouser', 'geo@example.com', 'pw-for-test')
        self.url = reverse('geocode')

    def tearDown(self):
        cache.clear()

    def test_anonymous_access_is_rejected(self):
        """Not because addresses are secret — they end up on a public listing — but because this
        endpoint spends a shared, rate-limited third-party budget on the caller's behalf."""
        response = self.client.get(self.url, {'q': 'banacha 2'})

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_search_returns_results_with_attribution(self):
        self.client.force_authenticate(self.user)

        with mock.patch('services.geocoding._fetch', return_value=FAKE_SEARCH_RESPONSE):
            response = self.client.get(self.url, {'q': 'banacha 2'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        # ODbL requires credit wherever the data is shown; returning it with the data itself is what
        # stops the UI rendering results while forgetting the attribution.
        self.assertIn('OpenStreetMap', response.data['attribution'])

    def test_missing_parameters_are_a_400(self):
        self.client.force_authenticate(self.user)

        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_endpoint_is_behind_the_tutoring_kill_switch(self):
        """Address lookup exists only to place a tutoring listing's pin, so disabling tutoring must
        close it too — otherwise it stays live spending the shared Nominatim budget for a feature
        that is switched off."""
        from moderation.models import FeatureFlag

        FeatureFlag.objects.update_or_create(key='tutoring', defaults={'is_enabled': False})
        self.client.force_authenticate(self.user)

        with mock.patch('services.geocoding._fetch', return_value=FAKE_SEARCH_RESPONSE):
            response = self.client.get(self.url, {'q': 'banacha 2'})

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_unavailable_upstream_is_a_503_not_an_empty_200(self):
        self.client.force_authenticate(self.user)

        with mock.patch('services.geocoding._fetch', side_effect=GeocodingUnavailable('down')):
            response = self.client.get(self.url, {'q': 'banacha 2'})

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)


class ServiceDeliveryModeTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('tutor', 'tutor@example.com', 'pw-for-test')
        self.client.force_authenticate(self.user)
        self.url = '/api/services/'

    def _create(self, **overrides):
        payload = {'title': 'Calculus tutoring', 'description': 'x', **overrides}
        return self.client.post(self.url, payload, format='json')

    def test_a_listing_defaults_to_online_with_no_location(self):
        response = self._create()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['delivery_mode'], 'online')
        self.assertIsNone(response.data['location_lat'])

    def test_an_in_person_listing_without_a_location_is_rejected(self):
        response = self._create(delivery_mode='in_person')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('location_lat', response.data)

    def test_a_hybrid_listing_without_a_location_is_also_rejected(self):
        response = self._create(delivery_mode='hybrid')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_in_person_listing_with_a_location_is_accepted(self):
        response = self._create(
            delivery_mode='in_person',
            location_label='Banacha 2, Warszawa',
            location_lat='52.211821',
            location_lon='20.981944',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(str(response.data['location_lat']), '52.211821')

    def test_over_precise_coordinates_are_rounded_rather_than_rejected(self):
        """The second layer behind geocoding.py's own rounding, covering coordinates that did NOT
        come from a search — a dragged pin, or any other client. The 7th decimal place is ~1 cm."""
        response = self._create(
            delivery_mode='in_person',
            location_label='Banacha 2',
            location_lat='52.2118211',
            location_lon='20.9819442',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(str(response.data['location_lat']), '52.211821')

    def test_switching_to_online_clears_a_previously_set_location(self):
        """A stale pin left on an online listing would keep rendering a map for a place the tutoring
        no longer happens — worse than showing nothing, because it is wrong rather than absent."""
        created = self._create(
            delivery_mode='in_person',
            location_label='Banacha 2',
            location_lat='52.211821',
            location_lon='20.981944',
        )
        service_id = created.data['id']

        response = self.client.patch(
            f'{self.url}{service_id}/', {'delivery_mode': 'online'}, format='json'
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['location_lat'])
        self.assertEqual(response.data['location_label'], '')

    def test_a_partial_update_is_validated_against_the_existing_mode(self):
        """PATCH must read the mode from the INSTANCE when the request does not supply one — a
        partial update that only clears coordinates must still be checked against the in-person mode
        the listing already has, not treated as unconstrained."""
        created = self._create(
            delivery_mode='in_person',
            location_label='Banacha 2',
            location_lat='52.211821',
            location_lon='20.981944',
        )

        response = self.client.patch(
            f'{self.url}{created.data["id"]}/',
            {'location_lat': None, 'location_lon': None},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ServiceLocationFilterTests(APITestCase):
    """`?delivery_mode=` and `?near=` — what makes a stored location useful rather than decorative."""

    def setUp(self):
        self.user = User.objects.create_user('filtertutor', 'ft@example.com', 'pw-for-test')
        # Warsaw
        self.in_person = Service.objects.create(
            provider=self.user,
            title='In person in Warsaw',
            delivery_mode='in_person',
            location_label='Banacha 2',
            location_lat='52.211821',
            location_lon='20.981944',
        )
        self.online = Service.objects.create(
            provider=self.user, title='Online only', delivery_mode='online'
        )
        self.hybrid = Service.objects.create(
            provider=self.user,
            title='Hybrid in Warsaw',
            delivery_mode='hybrid',
            location_label='Krakowskie Przedmiescie',
            location_lat='52.240000',
            location_lon='21.017000',
        )
        # Gdansk, ~300 km away — far enough that no sane radius includes it.
        self.far = Service.objects.create(
            provider=self.user,
            title='In person in Gdansk',
            delivery_mode='in_person',
            location_label='Gdansk',
            location_lat='54.352025',
            location_lon='18.646638',
        )

    def _ids(self, params=''):
        response = self.client.get(f'/api/services/{params}')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return {row['id'] for row in response.data}

    def test_in_person_filter_includes_hybrid_listings(self):
        """A hybrid tutor genuinely satisfies someone looking to meet in person. Excluding them
        would hide the most flexible listings from every filter at once."""
        ids = self._ids('?delivery_mode=in_person')

        self.assertIn(self.in_person.pk, ids)
        self.assertIn(self.hybrid.pk, ids)
        self.assertNotIn(self.online.pk, ids)

    def test_online_filter_also_includes_hybrid_listings(self):
        ids = self._ids('?delivery_mode=online')

        self.assertIn(self.online.pk, ids)
        self.assertIn(self.hybrid.pk, ids)
        self.assertNotIn(self.in_person.pk, ids)

    def test_near_finds_listings_within_the_radius(self):
        ids = self._ids('?near=52.2297,21.0122&radius_km=15')

        self.assertIn(self.in_person.pk, ids)
        self.assertIn(self.hybrid.pk, ids)

    def test_near_excludes_listings_beyond_the_radius(self):
        ids = self._ids('?near=52.2297,21.0122&radius_km=15')

        self.assertNotIn(self.far.pk, ids)

    def test_near_excludes_listings_with_no_location_at_all(self):
        ids = self._ids('?near=52.2297,21.0122&radius_km=15')

        self.assertNotIn(self.online.pk, ids)

    def test_the_radius_is_a_circle_not_a_bounding_box(self):
        """The SQL stage can only express a lat/lon box; the exact haversine pass is what stops a
        corner result up to ~41% beyond the requested radius from coming back.

        Gdansk sits inside the BOX for this query (its latitude and longitude each fall within the
        box's own bounds) while being ~300 km away — so a bounding-box-only implementation returns
        it and a correct one does not. That is exactly what this asserts.
        """
        ids = self._ids('?near=53.3,19.8&radius_km=120')

        self.assertNotIn(self.far.pk, ids)

    def test_a_malformed_near_degrades_to_unfiltered_rather_than_erroring(self):
        """This is a browse filter — silently showing everything beats failing the whole page."""
        response = self.client.get('/api/services/?near=garbage')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_an_out_of_range_coordinate_is_ignored(self):
        response = self.client.get('/api/services/?near=999,999&radius_km=10')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
