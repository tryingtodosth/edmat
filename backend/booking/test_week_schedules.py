"""Weeks that do not follow the repeating pattern, the templates they can be written from, and the
bulk apply that writes a run of them at once.

Weighted heavily towards **precedence** — which of the two sources a given day's hours come from —
because that is the half that fails silently. A schedule editor that refuses to save says so; a
detached week that quietly lets the old repeating pattern show through its gaps goes on publishing
hours the tutor removed, and nobody finds out until a student books one.

The second theme is that a copy is a copy: applying a week forward must carry the hours somebody
works and not the dentist appointment they had that Thursday, and every target week must genuinely
stop following the pattern rather than merely agreeing with it for now.
"""

from datetime import date, time, timedelta

from django.contrib.auth.models import User

from moderation.models import FeatureFlag

from .availability import base_windows_for_week, has_published_hours, slots_for_service
from .models import (
    AvailabilityException,
    WeekSchedule,
    WeekScheduleWindow,
    WeekTemplate,
    WeekTemplateWindow,
    monday_of,
)
from .tests import ApiTestCase

MONDAY, TUESDAY, WEDNESDAY, SUNDAY = 0, 1, 2, 6


class WeekScheduleFixtureMixin:
    def detach(self, monday: date, windows=(), *, tutor=None, source_template=None) -> WeekSchedule:
        """A week with its own hours. `windows` is `(weekday, start_hour, end_hour)` triples, or
        empty for the "I am not working that week" case, which is a real thing to mean and not the
        same as never having detached it."""
        schedule = WeekSchedule.objects.create(
            tutor=tutor or self.tutor, week_start=monday, source_template=source_template
        )
        for weekday, start_hour, end_hour in windows:
            WeekScheduleWindow.objects.create(
                schedule=schedule,
                weekday=weekday,
                start_time=time(start_hour),
                end_time=time(end_hour),
            )
        return schedule

    def template(self, name: str, windows=(), *, tutor=None) -> WeekTemplate:
        made = WeekTemplate.objects.create(tutor=tutor or self.tutor, name=name)
        for weekday, start_hour, end_hour in windows:
            WeekTemplateWindow.objects.create(
                template=made,
                weekday=weekday,
                start_time=time(start_hour),
                end_time=time(end_hour),
            )
        return made

    def slot_hours(self, service, day: date) -> list[int]:
        """The starting hours a student is offered on one day — the thing every precedence test is
        really asking about, reduced to something a failure message can show."""
        days = slots_for_service(service, day, day)
        return [slot.start.hour for slot in days[0].slots] if days else []


class PrecedenceTests(WeekScheduleFixtureMixin, ApiTestCase):
    """Which of the two sources a day's hours come from. Straight against `slots_for_service`, no
    HTTP — these are statements about the arithmetic, and a request would only add noise."""

    def setUp(self):
        super().setUp()
        self.service = self.make_service()
        self.rule(TUESDAY, 14, 16)
        self.tuesday = self.next_weekday(TUESDAY)
        self.monday = monday_of(self.tuesday)

    def test_an_untouched_week_follows_the_repeating_pattern(self):
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [14, 15])

    def test_a_detached_week_replaces_the_pattern_rather_than_adding_to_it(self):
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        # 9 and 10, and crucially NOT 14/15 — the pattern is not consulted at all for this week.
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [9, 10])

    def test_an_empty_detached_week_publishes_nothing(self):
        """The case a "layer on top of the pattern" design gets wrong. Clearing a week means "I am
        not working then"; letting the pattern show through the gaps would re-publish the very hours
        that were just removed, and leave no way to say it at all."""
        self.detach(self.monday, [])
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [])

    def test_the_weeks_around_a_detached_one_are_untouched(self):
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.assertEqual(self.slot_hours(self.service, self.tuesday + timedelta(days=7)), [14, 15])
        self.assertEqual(self.slot_hours(self.service, self.tuesday - timedelta(days=7)), [14, 15])

    def test_a_detached_week_covers_all_seven_of_its_days(self):
        """Detaching is a statement about the week, not about the days that happen to have hours in
        the replacement. A Wednesday rule must not survive into a week whose own schedule is silent
        about Wednesday."""
        self.rule(WEDNESDAY, 10, 12)
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=2)), [])

    def test_a_one_off_block_still_cuts_a_detached_week(self):
        """An exception is a fact about a date and stays true however that week's hours were arrived
        at — the reason exceptions are applied after the branch rather than inside either arm."""
        self.detach(self.monday, [(TUESDAY, 9, 12)])
        AvailabilityException.objects.create(
            tutor=self.tutor,
            date=self.tuesday,
            kind='block',
            start_time=time(10),
            end_time=time(11),
        )
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [9, 11])

    def test_a_one_off_opening_still_adds_to_a_detached_week(self):
        self.detach(self.monday, [(TUESDAY, 9, 10)])
        AvailabilityException.objects.create(
            tutor=self.tutor,
            date=self.tuesday,
            kind='open',
            start_time=time(15),
            end_time=time(16),
        )
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [9, 15])

    def test_an_all_day_block_empties_a_detached_week_day(self):
        self.detach(self.monday, [(TUESDAY, 9, 12)])
        AvailabilityException.objects.create(tutor=self.tutor, date=self.tuesday, kind='block')
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [])

    def test_a_window_pinned_to_another_listing_is_absent_from_this_one(self):
        """The per-listing narrowing survives detaching, which is the whole reason the stored window
        carries a service at all — without it, laying out a term would quietly widen a rule that had
        been pinned to one offering."""
        other = self.make_service(title='Fizyka')
        schedule = self.detach(self.monday, [])
        WeekScheduleWindow.objects.create(
            schedule=schedule,
            weekday=TUESDAY,
            start_time=time(9),
            end_time=time(11),
            service=other,
        )
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [])
        self.assertEqual(self.slot_hours(other, self.tuesday), [9, 10])

    def test_a_window_with_no_listing_reaches_every_listing(self):
        other = self.make_service(title='Fizyka')
        self.detach(self.monday, [(TUESDAY, 9, 10)])
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [9])
        self.assertEqual(self.slot_hours(other, self.tuesday), [9])

    def test_sunday_belongs_to_the_week_that_started_the_previous_monday(self):
        """The one place a Sunday-first reader could be silently wrong. The stored week is always
        Monday-based (`monday_of`), so detaching "the week of the 2nd" has to reach the Sunday of the
        8th and must NOT reach the Sunday of the 1st."""
        sunday_inside = self.monday + timedelta(days=6)
        sunday_before = self.monday - timedelta(days=1)
        self.rule(SUNDAY, 14, 16)
        self.detach(self.monday, [(SUNDAY, 9, 10)])
        self.assertEqual(self.slot_hours(self.service, sunday_inside), [9])
        self.assertEqual(self.slot_hours(self.service, sunday_before), [14, 15])

    def test_a_booking_is_still_subtracted_from_a_detached_week(self):
        """Detaching changes where the hours come from and nothing else — `derived` still means
        derived."""
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.book(self.service, self.tuesday, 9)
        self.assertEqual(self.slot_hours(self.service, self.tuesday), [10])

    def test_a_declared_listing_keeps_publishing_a_detached_week_whole(self):
        declared = self.make_service(title='Declared', availability_mode='declared')
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.book(declared, self.tuesday, 9)
        self.assertEqual(self.slot_hours(declared, self.tuesday), [9, 10])

    def test_a_week_stored_against_a_midweek_date_is_normalised_to_its_monday(self):
        """A row keyed to a Tuesday would be invisible to every lookup, and the week would silently
        go on following the pattern — so the model normalises rather than trusting the caller."""
        schedule = WeekSchedule.objects.create(tutor=self.tutor, week_start=self.tuesday)
        self.assertEqual(schedule.week_start, self.monday)

    def test_has_published_hours_counts_a_week_schedule_on_its_own(self):
        """"No schedule" and "fully booked" need different words on screen, and a tutor who laid out
        their term week by week without ever writing a repeating rule has very much published one."""
        bare = User.objects.create_user('nowy', 'nowy@x.example', 'pw12345!')
        service = self.make_service(provider=bare, title='Nowy')
        self.assertFalse(has_published_hours(service))
        self.detach(self.monday, [(TUESDAY, 9, 11)], tutor=bare)
        self.assertTrue(has_published_hours(service))


class WeekEndpointTests(WeekScheduleFixtureMixin, ApiTestCase):
    """`/api/week-schedules/week/` — the one endpoint the drag editor reads and writes."""

    def setUp(self):
        super().setUp()
        self.service = self.make_service()
        self.rule(TUESDAY, 14, 16)
        self.monday = monday_of(self.next_weekday(TUESDAY))

    def get_week(self, monday, user=None):
        return self.as_(user or self.tutor).get(
            '/api/week-schedules/week/', {'week_start': monday.isoformat()}
        )

    def put_week(self, monday, windows, user=None):
        return self.as_(user or self.tutor).put(
            '/api/week-schedules/week/',
            {'week_start': monday.isoformat(), 'windows': windows},
            format='json',
        )

    def test_an_untouched_week_answers_with_the_pattern_projected_onto_it(self):
        """It answers for every week, detached or not — that is what lets the editor draw the same
        picture either way, and lets the first drag detach a week without a separate step."""
        response = self.get_week(self.monday)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['detached'])
        self.assertEqual(
            response.data['windows'],
            [{'weekday': TUESDAY, 'start_time': '14:00', 'end_time': '16:00', 'service': None}],
        )

    def test_asking_about_a_midweek_date_answers_about_its_monday(self):
        response = self.get_week(self.monday + timedelta(days=3))
        self.assertEqual(response.data['week_start'], self.monday.isoformat())

    def test_saving_a_week_detaches_it_and_leaves_the_pattern_alone(self):
        response = self.put_week(
            self.monday, [{'weekday': TUESDAY, 'start_time': '09:00', 'end_time': '11:00'}]
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data['detached'])
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [9, 10])
        # The following week still reads 14:00 — the pattern was never touched.
        self.assertEqual(
            self.slot_hours(self.service, self.monday + timedelta(days=8)), [14, 15]
        )

    def test_saving_a_week_twice_edits_it_rather_than_failing(self):
        self.put_week(self.monday, [{'weekday': TUESDAY, 'start_time': '09:00', 'end_time': '11:00'}])
        second = self.put_week(
            self.monday, [{'weekday': TUESDAY, 'start_time': '10:00', 'end_time': '12:00'}]
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(WeekSchedule.objects.filter(tutor=self.tutor).count(), 1)
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [10, 11])

    def test_saving_an_empty_week_is_a_real_statement_not_a_no_op(self):
        self.put_week(self.monday, [])
        self.assertTrue(WeekSchedule.objects.filter(tutor=self.tutor).exists())
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [])

    def test_overlapping_windows_are_merged_on_write(self):
        """Merged here rather than only on read, because `_merge` already unions them on the way out
        — so two rows that overlap would be drawn as one band and then reloaded as two blocks on top
        of each other, i.e. the editor disagreeing with the calendar it is drawing on."""
        self.put_week(
            self.monday,
            [
                {'weekday': TUESDAY, 'start_time': '10:00', 'end_time': '12:00'},
                {'weekday': TUESDAY, 'start_time': '11:00', 'end_time': '13:00'},
            ],
        )
        stored = self.get_week(self.monday).data['windows']
        self.assertEqual(
            stored,
            [{'weekday': TUESDAY, 'start_time': '10:00', 'end_time': '13:00', 'service': None}],
        )

    def test_touching_windows_are_merged_too(self):
        self.put_week(
            self.monday,
            [
                {'weekday': TUESDAY, 'start_time': '10:00', 'end_time': '11:00'},
                {'weekday': TUESDAY, 'start_time': '11:00', 'end_time': '12:00'},
            ],
        )
        self.assertEqual(len(self.get_week(self.monday).data['windows']), 1)

    def test_windows_on_different_days_are_not_merged(self):
        self.put_week(
            self.monday,
            [
                {'weekday': TUESDAY, 'start_time': '10:00', 'end_time': '12:00'},
                {'weekday': WEDNESDAY, 'start_time': '11:00', 'end_time': '13:00'},
            ],
        )
        self.assertEqual(len(self.get_week(self.monday).data['windows']), 2)

    def test_windows_on_different_listings_are_not_merged(self):
        """Two windows narrowed to different offerings are not the same hours twice — merging them
        would silently widen one."""
        other = self.make_service(title='Fizyka')
        self.put_week(
            self.monday,
            [
                {
                    'weekday': TUESDAY,
                    'start_time': '10:00',
                    'end_time': '12:00',
                    'service': self.service.pk,
                },
                {
                    'weekday': TUESDAY,
                    'start_time': '11:00',
                    'end_time': '13:00',
                    'service': other.pk,
                },
            ],
        )
        self.assertEqual(len(self.get_week(self.monday).data['windows']), 2)

    def test_a_backwards_window_is_refused(self):
        response = self.put_week(
            self.monday, [{'weekday': TUESDAY, 'start_time': '16:00', 'end_time': '14:00'}]
        )
        self.assertEqual(response.status_code, 400)

    def test_a_window_scoped_to_somebody_elses_listing_is_refused(self):
        theirs = self.make_service(provider=self.other, title='Nie moje')
        response = self.put_week(
            self.monday,
            [
                {
                    'weekday': TUESDAY,
                    'start_time': '09:00',
                    'end_time': '11:00',
                    'service': theirs.pk,
                }
            ],
        )
        self.assertEqual(response.status_code, 400)

    def test_reattaching_a_week_puts_it_back_on_the_pattern(self):
        self.put_week(self.monday, [{'weekday': TUESDAY, 'start_time': '09:00', 'end_time': '11:00'}])
        schedule = WeekSchedule.objects.get(tutor=self.tutor, week_start=self.monday)
        response = self.as_(self.tutor).delete(f'/api/week-schedules/{schedule.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [14, 15])

    def test_somebody_elses_week_is_invisible(self):
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        schedule = WeekSchedule.objects.get(tutor=self.tutor)
        response = self.as_(self.other).delete(f'/api/week-schedules/{schedule.pk}/')
        self.assertEqual(response.status_code, 404)

    def test_the_list_only_shows_my_own_weeks(self):
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.detach(self.monday, [(TUESDAY, 9, 11)], tutor=self.other)
        response = self.as_(self.other).get('/api/week-schedules/')
        self.assertEqual(len(response.data), 1)

    def test_the_list_can_be_bounded_to_the_weeks_being_drawn(self):
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.detach(self.monday + timedelta(weeks=4), [(TUESDAY, 9, 11)])
        response = self.as_(self.tutor).get(
            '/api/week-schedules/',
            {'from': self.monday.isoformat(), 'to': (self.monday + timedelta(days=6)).isoformat()},
        )
        self.assertEqual(len(response.data), 1)

    def test_a_week_needs_a_date(self):
        response = self.as_(self.tutor).get('/api/week-schedules/week/')
        self.assertEqual(response.status_code, 400)

    def test_anonymous_callers_are_refused(self):
        self.assertEqual(self.client.get('/api/week-schedules/week/').status_code, 401)


class WeekTemplateTests(WeekScheduleFixtureMixin, ApiTestCase):
    def setUp(self):
        super().setUp()
        self.service = self.make_service()
        self.rule(TUESDAY, 14, 16)
        self.monday = monday_of(self.next_weekday(TUESDAY))

    def test_saving_a_template(self):
        response = self.as_(self.tutor).post(
            '/api/week-templates/',
            {
                'name': 'Tygodnie z zajęciami',
                'windows': [{'weekday': MONDAY, 'start_time': '09:00', 'end_time': '12:00'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.data['windows']), 1)

    def test_a_template_does_not_change_what_is_published(self):
        """The whole difference between a template and the repeating pattern: a shape on a shelf does
        nothing until it is applied."""
        self.template('Inny tydzień', [(TUESDAY, 9, 11)])
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [14, 15])

    def test_a_duplicate_name_is_refused_rather_than_quietly_suffixed(self):
        self.template('Tygodnie z zajęciami')
        response = self.as_(self.tutor).post(
            '/api/week-templates/',
            {'name': '  tygodnie z zajęciami ', 'windows': []},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_two_people_may_use_the_same_template_name(self):
        self.template('Standard')
        response = self.as_(self.other).post(
            '/api/week-templates/', {'name': 'Standard', 'windows': []}, format='json'
        )
        self.assertEqual(response.status_code, 201)

    def test_saving_the_week_i_am_looking_at_captures_the_pattern(self):
        """`from-week` reads through the effective hours, so it works on a week that is still
        following the repeating pattern — which is most of them, the first time anybody does this."""
        response = self.as_(self.tutor).post(
            '/api/week-templates/from-week/',
            {'week_start': self.monday.isoformat(), 'name': 'Zwykły tydzień'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.data['windows'],
            [{'weekday': TUESDAY, 'start_time': '14:00:00', 'end_time': '16:00:00', 'service': None}],
        )

    def test_saving_a_detached_week_captures_that_weeks_own_hours(self):
        self.detach(self.monday, [(WEDNESDAY, 8, 10)])
        response = self.as_(self.tutor).post(
            '/api/week-templates/from-week/',
            {'week_start': self.monday.isoformat(), 'name': 'Ten tydzień'},
            format='json',
        )
        self.assertEqual(response.data['windows'][0]['weekday'], WEDNESDAY)

    def test_saving_a_week_without_a_name_is_refused(self):
        response = self.as_(self.tutor).post(
            '/api/week-templates/from-week/',
            {'week_start': self.monday.isoformat(), 'name': '   '},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_somebody_elses_template_is_invisible(self):
        theirs = self.template('Ich szablon', tutor=self.other)
        response = self.as_(self.tutor).get(f'/api/week-templates/{theirs.pk}/')
        self.assertEqual(response.status_code, 404)

    def test_deleting_a_template_leaves_the_weeks_written_from_it_alone(self):
        """Provenance, not ownership. A week's hours are its own once applied — reaching back into
        five written weeks because somebody tidied up their template list would be a deletion nobody
        asked for."""
        made = self.template('Standard', [(TUESDAY, 9, 11)])
        self.detach(self.monday, [(TUESDAY, 9, 11)], source_template=made)
        self.as_(self.tutor).delete(f'/api/week-templates/{made.pk}/')
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [9, 10])
        self.assertIsNone(WeekSchedule.objects.get(tutor=self.tutor).source_template_id)

    def test_editing_a_template_replaces_its_windows_wholesale(self):
        made = self.template('Standard', [(TUESDAY, 9, 11)])
        response = self.as_(self.tutor).patch(
            f'/api/week-templates/{made.pk}/',
            {'windows': [{'weekday': WEDNESDAY, 'start_time': '15:00', 'end_time': '17:00'}]},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['windows']), 1)
        self.assertEqual(response.data['windows'][0]['weekday'], WEDNESDAY)


class WeekApplyTests(WeekScheduleFixtureMixin, ApiTestCase):
    """"Use this week for the next five weeks" — the operation the whole feature exists for."""

    def setUp(self):
        super().setUp()
        self.service = self.make_service()
        self.rule(TUESDAY, 14, 16)
        self.monday = monday_of(self.next_weekday(TUESDAY))

    def apply(self, user=None, **body):
        return self.as_(user or self.tutor).post('/api/week-schedules/apply/', body, format='json')

    def test_applying_a_week_forward_writes_every_target_week(self):
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        response = self.apply(
            source_week=self.monday.isoformat(),
            week_start=(self.monday + timedelta(weeks=1)).isoformat(),
            weeks=5,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['written']), 5)
        for offset in range(1, 6):
            tuesday = self.monday + timedelta(weeks=offset, days=1)
            self.assertEqual(self.slot_hours(self.service, tuesday), [9, 10], f'week {offset}')

    def test_the_week_after_the_run_still_follows_the_pattern(self):
        """The bound is real, not "and everything after". A run of five weeks is five weeks."""
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.apply(
            source_week=self.monday.isoformat(),
            week_start=(self.monday + timedelta(weeks=1)).isoformat(),
            weeks=5,
        )
        self.assertEqual(
            self.slot_hours(self.service, self.monday + timedelta(weeks=6, days=1)), [14, 15]
        )

    def test_applying_the_pattern_forward_detaches_the_weeks_it_writes(self):
        """The source can be a week that was never detached — and the targets are detached anyway,
        which is the point: somebody who has just laid out their term means the term, not a default
        that will drift the next time they change a rule."""
        self.apply(
            source_week=self.monday.isoformat(),
            week_start=self.monday.isoformat(),
            weeks=3,
        )
        self.assertEqual(WeekSchedule.objects.filter(tutor=self.tutor).count(), 3)
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [14, 15])
        # Changing the pattern afterwards must not reach the written weeks.
        self.tutor.availability_rules.all().delete()
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [14, 15])

    def test_a_later_week_can_then_be_changed_on_its_own(self):
        """The flow the whole feature is for, end to end: lay out five weeks, then change the third
        without touching the other four."""
        self.detach(self.monday, [(TUESDAY, 9, 11)])
        self.apply(
            source_week=self.monday.isoformat(), week_start=self.monday.isoformat(), weeks=5
        )
        third = self.monday + timedelta(weeks=2)
        self.as_(self.tutor).put(
            '/api/week-schedules/week/',
            {
                'week_start': third.isoformat(),
                'windows': [{'weekday': TUESDAY, 'start_time': '18:00', 'end_time': '19:00'}],
            },
            format='json',
        )
        self.assertEqual(self.slot_hours(self.service, third + timedelta(days=1)), [18])
        for offset in (0, 1, 3, 4):
            tuesday = self.monday + timedelta(weeks=offset, days=1)
            self.assertEqual(self.slot_hours(self.service, tuesday), [9, 10], f'week {offset}')

    def test_applying_a_template(self):
        made = self.template('Standard', [(WEDNESDAY, 8, 10)])
        self.apply(
            source_template=made.pk, week_start=self.monday.isoformat(), weeks=2
        )
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=2)), [8, 9])
        self.assertEqual(
            WeekSchedule.objects.get(tutor=self.tutor, week_start=self.monday).source_template_id,
            made.pk,
        )

    def test_a_one_off_exception_is_not_copied_forward(self):
        """The reason `base_windows_for_week` reads before exceptions. Replicating a dentist
        appointment into the next five weeks would be inventing five appointments nobody made."""
        self.detach(self.monday, [(TUESDAY, 9, 12)])
        AvailabilityException.objects.create(
            tutor=self.tutor,
            date=self.monday + timedelta(days=1),
            kind='block',
            start_time=time(10),
            end_time=time(11),
        )
        self.apply(
            source_week=self.monday.isoformat(),
            week_start=(self.monday + timedelta(weeks=1)).isoformat(),
            weeks=1,
        )
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [9, 11])
        self.assertEqual(
            self.slot_hours(self.service, self.monday + timedelta(weeks=1, days=1)), [9, 10, 11]
        )

    def test_keeping_hand_edited_weeks_skips_them_and_says_so(self):
        made = self.template('Standard', [(WEDNESDAY, 8, 10)])
        third = self.monday + timedelta(weeks=2)
        self.detach(third, [(TUESDAY, 18, 19)])
        response = self.apply(
            source_template=made.pk,
            week_start=self.monday.isoformat(),
            weeks=5,
            overwrite=False,
        )
        self.assertEqual(len(response.data['written']), 4)
        self.assertEqual(response.data['skipped'], [third.isoformat()])
        self.assertEqual(self.slot_hours(self.service, third + timedelta(days=1)), [18])

    def test_overwriting_replaces_a_hand_edited_week(self):
        made = self.template('Standard', [(WEDNESDAY, 8, 10)])
        third = self.monday + timedelta(weeks=2)
        self.detach(third, [(TUESDAY, 18, 19)])
        response = self.apply(
            source_template=made.pk, week_start=self.monday.isoformat(), weeks=5
        )
        self.assertEqual(response.data['skipped'], [])
        self.assertEqual(self.slot_hours(self.service, third + timedelta(days=1)), [])
        self.assertEqual(self.slot_hours(self.service, third + timedelta(days=2)), [8, 9])

    def test_a_midweek_start_is_normalised_to_its_monday(self):
        made = self.template('Standard', [(WEDNESDAY, 8, 10)])
        self.apply(
            source_template=made.pk,
            week_start=(self.monday + timedelta(days=3)).isoformat(),
            weeks=1,
        )
        self.assertEqual(response_weeks := list(
            WeekSchedule.objects.filter(tutor=self.tutor).values_list('week_start', flat=True)
        ), [self.monday], response_weeks)

    def test_exactly_one_source_is_required(self):
        made = self.template('Standard')
        neither = self.apply(week_start=self.monday.isoformat(), weeks=2)
        both = self.apply(
            source_template=made.pk,
            source_week=self.monday.isoformat(),
            week_start=self.monday.isoformat(),
            weeks=2,
        )
        self.assertEqual(neither.status_code, 400)
        self.assertEqual(both.status_code, 400)

    def test_the_run_length_is_bounded(self):
        made = self.template('Standard')
        self.assertEqual(
            self.apply(
                source_template=made.pk, week_start=self.monday.isoformat(), weeks=0
            ).status_code,
            400,
        )
        self.assertEqual(
            self.apply(
                source_template=made.pk, week_start=self.monday.isoformat(), weeks=53
            ).status_code,
            400,
        )

    def test_somebody_elses_template_cannot_be_applied(self):
        theirs = self.template('Ich szablon', [(TUESDAY, 9, 11)], tutor=self.other)
        response = self.apply(
            source_template=theirs.pk, week_start=self.monday.isoformat(), weeks=1
        )
        self.assertEqual(response.status_code, 400)

    def test_applying_writes_only_my_own_weeks(self):
        """`source_week` is read against the caller, so pointing it at a date somebody else has
        detached copies the caller's own hours for that week, never theirs."""
        self.detach(self.monday, [(TUESDAY, 20, 22)], tutor=self.other)
        self.apply(
            source_week=self.monday.isoformat(), week_start=self.monday.isoformat(), weeks=1
        )
        self.assertEqual(self.slot_hours(self.service, self.monday + timedelta(days=1)), [14, 15])

    def test_anonymous_callers_are_refused(self):
        response = self.client.post(
            '/api/week-schedules/apply/',
            {'week_start': self.monday.isoformat(), 'weeks': 1},
            format='json',
        )
        self.assertEqual(response.status_code, 401)


class WeekScheduleKillSwitchTests(WeekScheduleFixtureMixin, ApiTestCase):
    """Booking hides behind the `tutoring` flag rather than one of its own, so the schedule editor
    has to go with it — leaving these live would let a stale tab go on publishing hours for a feature
    that is supposed to be gone."""

    def setUp(self):
        super().setUp()
        self.monday = monday_of(self.next_weekday(TUESDAY))
        FeatureFlag.objects.update_or_create(key='tutoring', defaults={'is_enabled': False})

    def test_the_week_endpoint_is_gone(self):
        response = self.as_(self.tutor).get(
            '/api/week-schedules/week/', {'week_start': self.monday.isoformat()}
        )
        self.assertEqual(response.status_code, 403)

    def test_templates_are_gone(self):
        self.assertEqual(self.as_(self.tutor).get('/api/week-templates/').status_code, 403)

    def test_apply_is_gone(self):
        response = self.as_(self.tutor).post(
            '/api/week-schedules/apply/',
            {'source_week': self.monday.isoformat(), 'week_start': self.monday.isoformat(), 'weeks': 2},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_still_get_through(self):
        self.tutor.is_staff = True
        self.tutor.save(update_fields=['is_staff'])
        response = self.as_(self.tutor).get(
            '/api/week-schedules/week/', {'week_start': self.monday.isoformat()}
        )
        self.assertEqual(response.status_code, 200)


class BaseWindowsForWeekTests(WeekScheduleFixtureMixin, ApiTestCase):
    """The helper both the editor and the apply operation read through, on its own — it is the one
    place "what shape is this week" is answered, so it is worth pinning directly rather than only
    through the two callers."""

    def setUp(self):
        super().setUp()
        self.monday = monday_of(self.next_weekday(TUESDAY))

    def test_it_falls_back_to_the_repeating_pattern(self):
        self.rule(TUESDAY, 14, 16)
        self.assertEqual(
            base_windows_for_week(self.tutor, self.monday),
            [(TUESDAY, time(14), time(16), None)],
        )

    def test_it_prefers_the_weeks_own_hours(self):
        self.rule(TUESDAY, 14, 16)
        self.detach(self.monday, [(WEDNESDAY, 8, 10)])
        self.assertEqual(
            base_windows_for_week(self.tutor, self.monday),
            [(WEDNESDAY, time(8), time(10), None)],
        )

    def test_a_detached_empty_week_is_empty_rather_than_the_pattern(self):
        self.rule(TUESDAY, 14, 16)
        self.detach(self.monday, [])
        self.assertEqual(base_windows_for_week(self.tutor, self.monday), [])

    def test_any_day_of_the_week_answers_about_the_same_week(self):
        self.detach(self.monday, [(WEDNESDAY, 8, 10)])
        self.assertEqual(
            base_windows_for_week(self.tutor, self.monday + timedelta(days=4)),
            [(WEDNESDAY, time(8), time(10), None)],
        )
