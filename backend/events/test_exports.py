"""Data minimisation, the aggregated exports, the export log and the retention purge —
CONFERENCE-BRIEF.md §3.G. Refusals first, then the counts, then what the purge leaves alone.

The most load-bearing test here is `test_a_volunteer_sees_no_answers_no_note_and_no_account_id`:
every other test would still pass if the narrow serializer quietly grew a field back.
"""

from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from telemetry.routers import all_log_shards
from testing.factories import make_user

from .exports import WITHHELD_FROM_NON_ORGANISERS, needs_summary
from cloakroom.models import CloakroomDesk, CloakroomItem

from .models import Event, EventStaff, ExportLog, RegistrationField


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class ExportCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('exp-host')
        self.volunteer = make_user('exp-volunteer')
        self.reviewer = make_user('exp-reviewer')
        self.attendee = make_user('exp-attendee')
        self.stranger = make_user('exp-stranger')
        self.event = Event.objects.create(
            host=self.host, title='Autumn workshop', status='published', visibility='public',
            starts_at=timezone.now() + timedelta(days=3), duration_minutes=120,
            location_kind='hybrid', location_text='Room 2', online_url='https://x.org',
            registration_mode='form',
        )
        EventStaff.objects.create(event=self.event, user=self.volunteer, role='volunteer')
        EventStaff.objects.create(event=self.event, user=self.reviewer, role='reviewer')
        self.diet = RegistrationField.objects.create(
            event=self.event, label='Lunch', kind='choice', options=['Vegan', 'Meat'], order=0
        )
        self.affiliation = RegistrationField.objects.create(
            event=self.event, label='Affiliation', kind='text', order=1
        )
        self.row = self.event.attendances.create(
            attendee=self.attendee, status='going',
            note='I will be twenty minutes late',
            answers={
                '_attendance_mode': 'online', '_needs': 'Step-free access, please', '_consent': True,
                str(self.diet.pk): 'Vegan', str(self.affiliation.pk): 'LO nr 5',
            },
            checked_in_at=timezone.now(), checked_in_by=self.volunteer,
        )

    def url(self, name, *args):
        return reverse(name, args=[self.event.pk, *args])


class RefusalTests(ExportCase):
    """Who is turned away, and from what. A published event is visible to everybody, so the honest
    answer to "you may not have this" is 403 — the 404 case is a draft, which `get_queryset`
    already answers and `events/tests.py` already covers."""

    def test_the_needs_summary_is_organisers_only(self):
        url = reverse('event-exports-needs', args=[self.event.pk])
        self.assertEqual(as_(self.stranger).get(url).status_code, 403)
        self.assertEqual(as_(self.attendee).get(url).status_code, 403)
        self.assertEqual(as_(self.volunteer).get(url).status_code, 403)
        self.assertEqual(as_(self.reviewer).get(url).status_code, 403)
        self.assertEqual(as_(self.host).get(url).status_code, 200)

    def test_the_export_log_is_organisers_only(self):
        url = reverse('event-exports-log', args=[self.event.pk])
        self.assertEqual(as_(self.stranger).get(url).status_code, 403)
        self.assertEqual(as_(self.attendee).get(url).status_code, 403)
        self.assertEqual(as_(self.volunteer).get(url).status_code, 403)
        self.assertEqual(as_(self.host).get(url).status_code, 200)

    def test_the_door_list_is_every_staff_member_and_nobody_else(self):
        url = reverse('event-exports-door-list', args=[self.event.pk])
        self.assertEqual(as_(self.stranger).get(url).status_code, 403)
        self.assertEqual(as_(self.attendee).get(url).status_code, 403)
        self.assertEqual(as_(self.volunteer).get(url).status_code, 200)
        self.assertEqual(as_(self.host).get(url).status_code, 200)

    def test_the_full_csv_is_no_longer_open_to_volunteers(self):
        """It was every staff member until §3.G. This is the whole of the change, in one line."""
        url = reverse('event-registrations-csv', args=[self.event.pk])
        self.assertEqual(as_(self.volunteer).get(url).status_code, 403)
        self.assertEqual(as_(self.reviewer).get(url).status_code, 403)
        self.assertEqual(as_(self.host).get(url).status_code, 200)

    def test_signing_out_refuses_all_three(self):
        for name in ('event-exports-needs', 'event-exports-log', 'event-exports-door-list'):
            with self.subTest(name=name):
                self.assertEqual(
                    APIClient().get(reverse(name, args=[self.event.pk])).status_code, 401
                )


class MinimisationTests(ExportCase):
    def test_a_volunteer_sees_no_answers_no_note_and_no_account_id(self):
        body = as_(self.volunteer).get(self.url('event-registrations')).json()
        self.assertEqual(len(body), 1)
        row = body[0]
        for key in WITHHELD_FROM_NON_ORGANISERS:
            self.assertNotIn(key, row, f'{key} leaked to a volunteer')
        self.assertEqual(
            set(row), {'id', 'attendee', 'status', 'checked_in', 'checked_in_at'}
        )
        self.assertIsNone(row['attendee']['id'])
        self.assertTrue(row['attendee']['display_name'])
        # The row id is kept on purpose: it is what the check-in action addresses.
        self.assertEqual(str(row['id']), str(self.row.pk))

    def test_a_reviewer_gets_the_same_narrow_body(self):
        row = as_(self.reviewer).get(self.url('event-registrations')).json()[0]
        self.assertNotIn('answers', row)

    def test_the_narrow_row_is_still_enough_to_check_somebody_in(self):
        row = as_(self.volunteer).get(self.url('event-registrations')).json()[0]
        undo = as_(self.volunteer).delete(
            reverse('event-registration-checkin', args=[self.event.pk, row['id']])
        )
        self.assertEqual(undo.status_code, 200)
        self.row.refresh_from_db()
        self.assertIsNone(self.row.checked_in_at)

    def test_an_organiser_keeps_everything(self):
        row = as_(self.host).get(self.url('event-registrations')).json()[0]
        self.assertEqual(row['answers']['_needs'], 'Step-free access, please')
        self.assertEqual(row['note'], 'I will be twenty minutes late')
        self.assertEqual(row['attendee']['id'], self.attendee.pk)

    def test_the_public_roster_is_unchanged(self):
        """§3.G tightens the staff list and nothing else — `/attendees/` keeps its own rules."""
        self.event.show_attendees_publicly = True
        self.event.save(update_fields=['show_attendees_publicly'])
        body = APIClient().get(self.url('event-attendees')).json()
        self.assertEqual(len(body), 1)


class NeedsSummaryTests(ExportCase):
    def setUp(self):
        super().setUp()
        self.second = make_user('exp-second')
        self.event.attendances.create(
            attendee=self.second, status='going',
            answers={'_attendance_mode': 'in_person', '_needs': '',
                     str(self.diet.pk): 'Meat', str(self.affiliation.pk): ''},
        )
        self.declined = make_user('exp-declined')
        self.event.attendances.create(
            attendee=self.declined, status='not_going',
            answers={'_attendance_mode': 'in_person', '_needs': 'Ramp',
                     str(self.diet.pk): 'Vegan'},
        )

    def test_it_counts_seat_holders_only_and_carries_no_rows(self):
        body = as_(self.host).get(reverse('event-exports-needs', args=[self.event.pk])).json()
        self.assertEqual(body['total'], 2)
        self.assertEqual(body['attendance_mode'], {'in_person': 1, 'online': 1, 'unstated': 0})
        # The declined row's accessibility note must not reach the count.
        self.assertEqual(body['accessibility'], {'stated': 1, 'none': 1})
        self.assertNotIn('rows', body)
        self.assertNotIn('Step-free access, please', str(body))

    def test_a_choice_field_is_counted_per_option(self):
        body = needs_summary(self.event)
        lunch = next(f for f in body['fields'] if f['field_id'] == self.diet.pk)
        self.assertEqual(lunch['options'], [{'option': 'Vegan', 'count': 1},
                                            {'option': 'Meat', 'count': 1}])

    def test_a_free_text_field_gives_a_count_and_never_the_text(self):
        body = needs_summary(self.event)
        affiliation = next(f for f in body['fields'] if f['field_id'] == self.affiliation.pk)
        self.assertEqual(affiliation['options'], [])
        self.assertEqual((affiliation['answered'], affiliation['unanswered']), (1, 1))
        self.assertNotIn('LO nr 5', str(body))

    def test_an_onsite_event_does_not_report_everyone_as_unstated(self):
        """Only a hybrid event asks the question, so reading the stored key alone would make every
        ordinary lecture's catering figure useless."""
        onsite = Event.objects.create(
            host=self.host, title='Lecture', status='published', visibility='public',
            starts_at=timezone.now() + timedelta(days=1), duration_minutes=60,
            location_kind='onsite', location_text='Hall A',
        )
        onsite.attendances.create(attendee=self.attendee, status='going')
        self.assertEqual(needs_summary(onsite)['attendance_mode'],
                         {'in_person': 1, 'online': 0, 'unstated': 0})


class ExportLogTests(ExportCase):
    def test_the_full_csv_writes_one_log_row_counting_the_people_in_it(self):
        self.assertEqual(
            as_(self.host).get(self.url('event-registrations-csv')).status_code, 200
        )
        log = ExportLog.objects.get()
        self.assertEqual((log.kind, log.rows, log.user), ('full_csv', 1, self.host))

    def test_the_door_list_carries_three_columns_and_logs_too(self):
        response = as_(self.volunteer).get(
            reverse('event-exports-door-list', args=[self.event.pk])
        )
        text = response.content.decode()
        self.assertEqual(text.splitlines()[0], 'name,status,checked_in')
        self.assertEqual(len(text.strip().splitlines()), 2)
        self.assertNotIn('Step-free access', text)
        self.assertNotIn('twenty minutes late', text)
        log = ExportLog.objects.get()
        self.assertEqual((log.kind, log.rows, log.user), ('door_list', 1, self.volunteer))

    def test_reading_the_needs_summary_is_not_logged(self):
        as_(self.host).get(reverse('event-exports-needs', args=[self.event.pk]))
        self.assertEqual(ExportLog.objects.count(), 0)

    def test_the_log_names_who_took_what(self):
        as_(self.host).get(self.url('event-registrations-csv'))
        as_(self.volunteer).get(reverse('event-exports-door-list', args=[self.event.pk]))
        body = as_(self.host).get(reverse('event-exports-log', args=[self.event.pk])).json()
        self.assertEqual([r['kind'] for r in body], ['door_list', 'full_csv'])
        self.assertEqual(body[0]['user']['id'], self.volunteer.pk)
        self.assertEqual(body[1]['rows'], 1)


class PurgeTests(ExportCase):
    def setUp(self):
        super().setUp()
        # Push the event three months into the past. `starts_at` is not editable through `save()`
        # validation here — the model allows it; `clean()` is what the API calls.
        self.event.starts_at = timezone.now() - timedelta(days=90)
        self.event.save(update_fields=['starts_at'])

    def run_command(self, *args):
        out = StringIO()
        call_command('purge_event_data', *args, stdout=out)
        return out.getvalue()

    def test_a_dry_run_reports_and_writes_nothing(self):
        text = self.run_command('--dry-run')
        self.assertIn('[dry run]', text)
        self.assertIn('Autumn workshop', text)
        self.row.refresh_from_db()
        self.assertEqual(self.row.answers['_needs'], 'Step-free access, please')
        self.assertEqual(self.row.checked_in_by, self.volunteer)

    def test_a_real_run_blanks_the_accessibility_note_and_the_free_text(self):
        self.run_command()
        self.row.refresh_from_db()
        self.assertEqual(self.row.answers['_needs'], '')
        self.assertEqual(self.row.answers[str(self.affiliation.pk)], '')
        self.assertIsNone(self.row.checked_in_by)

    def test_it_never_touches_who_attended(self):
        self.run_command()
        self.row.refresh_from_db()
        self.assertEqual(self.row.status, 'going')
        self.assertIsNotNone(self.row.checked_in_at)
        # A choice answer survives, so the aggregate the organiser reported stays reproducible.
        self.assertEqual(self.row.answers[str(self.diet.pk)], 'Vegan')
        self.assertIs(self.row.answers['_consent'], True)
        self.assertEqual(self.row.answers['_attendance_mode'], 'online')
        self.assertEqual(self.row.note, 'I will be twenty minutes late')
        self.assertTrue(Event.objects.filter(pk=self.event.pk).exists())

    def test_it_blanks_the_cloakroom_lost_slip_records_and_keeps_the_rack_history(self):
        # Integration with step F (CONFERENCE-BRIEF.md §5).
        desk = CloakroomDesk.objects.create(event=self.event, name='Szatnia', rack_labels=['1'])
        item = CloakroomItem.objects.create(
            desk=desk, rack_label='1', token='ABCDEFGH', status='returned_by_exception',
            description='czarna kurtka', exception_note='pokazano legitymację',
            exception_identity_kind='student_card',
        )
        text = self.run_command('--dry-run')
        self.assertIn('1 cloakroom lost-slip records blanked', text)
        item.refresh_from_db()
        self.assertEqual(item.exception_note, 'pokazano legitymację')
        self.run_command()
        item.refresh_from_db()
        self.assertEqual(item.exception_note, '')
        self.assertEqual(item.exception_identity_kind, 'none')
        self.assertEqual(item.status, 'returned_by_exception')
        self.assertEqual(item.rack_label, '1')

    def test_a_recent_event_is_left_alone(self):
        self.event.starts_at = timezone.now() - timedelta(days=2)
        self.event.save(update_fields=['starts_at'])
        text = self.run_command()
        self.assertIn('0 accessibility notes', text)
        self.row.refresh_from_db()
        self.assertEqual(self.row.answers['_needs'], 'Step-free access, please')

    def test_the_window_is_a_flag(self):
        self.event.starts_at = timezone.now() - timedelta(days=5)
        self.event.save(update_fields=['starts_at'])
        self.run_command('--older-than-days', '3')
        self.row.refresh_from_db()
        self.assertEqual(self.row.answers['_needs'], '')

    def test_running_it_twice_changes_nothing_the_second_time(self):
        self.run_command()
        text = self.run_command()
        self.assertIn('0 accessibility notes and 0 free-text answers blanked', text)

    def test_it_prints_the_tables_it_does_not_yet_know(self):
        text = self.run_command('--dry-run')
        self.assertIn('ScanEvent', text)
        self.assertIn('CloakroomItem', text)
