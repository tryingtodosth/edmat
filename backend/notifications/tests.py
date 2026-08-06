"""The two notification catalogs, and the fact that they must agree.

This app keeps the list of notification types in two places, for two different reasons:

- `notifications.models.NOTIFICATION_TYPES` — (value, human label), the field's own `choices`, which
  is what the admin renders and what `get_type_display()` reads.
- `notifications.services._PREFERENCE_FIELD_FOR_TYPE` — (value, the Profile boolean that gates it),
  which is what `notify()` checks and what the settings page's per-type list is built from.

Neither can simply be derived from the other: a label is not a preference field, and the gating map
deliberately holds `new_tagged_content` outside the coarse categories. So they are maintained by
hand — and they had drifted in BOTH directions before this test existed. Five course types were
valid choices with no gate, so `notify()` fell through to "no preference gates it" and sent them
even to somebody who had switched course activity off; two material types were gated but were not
valid choices, so the admin showed a bare value for them.

Neither failure is loud. A missing gate silently ignores a setting, and an unlisted choice is not
enforced on `.create()` at all. This test is the thing that makes them loud.
"""

from django.test import TestCase

from notifications.models import NOTIFICATION_TYPES as MODEL_TYPES
from notifications.services import _PREFERENCE_FIELD_FOR_TYPE, NOTIFICATION_TYPES as SERVICE_TYPES


class NotificationCatalogTests(TestCase):
    def test_every_gated_type_is_a_valid_choice(self):
        """Otherwise the admin shows a raw value and get_type_display() lies."""
        model_values = {value for value, _ in MODEL_TYPES}
        gated = set(_PREFERENCE_FIELD_FOR_TYPE)
        self.assertEqual(
            gated - model_values,
            set(),
            'gated in services.py but not a choice in models.py',
        )

    def test_every_choice_is_gated_by_some_preference(self):
        """A type with no entry in the preference map is sent regardless of what the recipient
        turned off — the setting's label then lies for exactly that type."""
        model_values = {value for value, _ in MODEL_TYPES}
        gated = set(_PREFERENCE_FIELD_FOR_TYPE)
        # `new_tagged_content` is the one deliberate exception: it is gated per-tag, on each
        # follower's own TagFollow.notify, rather than by an account-wide category.
        self.assertEqual(
            model_values - gated - {'new_tagged_content'},
            set(),
            'a real choice with no coarse preference gating it',
        )

    def test_the_service_catalog_covers_every_choice(self):
        """It is what the frontend is handed, so a type missing here has no settings row and no
        entry in the frontend's own hand-mirrored map — where an unknown type currently falls back
        to rendering as a comment reply."""
        self.assertEqual(
            {value for value, _ in MODEL_TYPES} - {value for value, _ in SERVICE_TYPES},
            set(),
            'a real choice the frontend is never told about',
        )

    def test_every_preference_field_is_real(self):
        """A typo here fails open rather than loudly: `getattr(profile, field, True)` in `notify()`
        returns True for a field that does not exist, so the category simply stops working."""
        from accounts.models import Profile

        for notif_type, field in _PREFERENCE_FIELD_FOR_TYPE.items():
            with self.subTest(type=notif_type):
                self.assertTrue(
                    hasattr(Profile, field), f'{notif_type} is gated by a nonexistent {field}'
                )
