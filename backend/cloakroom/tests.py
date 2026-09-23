"""The desk, refusals first (`CONFERENCE-BRIEF.md` §3.F).

The ordering is the project's own: everything that must be said "no" to comes before anything that
works, because the whole design of this app is a set of refusals — a coat handed to the wrong
person is not recoverable by a later bug fix.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from documents.models import DocumentAcknowledgement, EventDocument
from events.models import Event, EventStaff
from shifts.models import Assignment, Shift, Station
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user

from .models import CloakroomDesk, CloakroomItem
from . import rules


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class DeskCase(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.host = make_user('cloak-host')
        self.clerk = make_user('cloak-clerk')
        self.attendee = make_user('cloak-attendee')
        self.stranger = make_user('cloak-stranger')
        self.event = Event.objects.create(
            host=self.host, title='Konferencja', status='published', visibility='public',
            starts_at=timezone.now() + timedelta(days=2), duration_minutes=480,
            location_kind='onsite', location_text='Banacha 2',
        )
        EventStaff.objects.create(event=self.event, user=self.clerk, role='volunteer')
        self.desk = CloakroomDesk.objects.create(
            event=self.event, name='Szatnia — wejście północne',
            rack_labels=['1', '2', '3'], opens_note='Czynna od 17:00',
        )

    # ---- URLs, spelled once ---------------------------------------------------------------
    def desks_url(self, event=None):
        return reverse('event-cloakroom-desks', args=[(event or self.event).pk])

    def items_url(self, desk=None):
        return reverse('cloakroom-desk-items', args=[(desk or self.desk).pk])

    def return_url(self, desk=None):
        return reverse('cloakroom-desk-return-by-token', args=[(desk or self.desk).pk])

    def item_return_url(self, item):
        return reverse('cloakroom-desk-item-return', args=[item.desk_id, item.pk])

    def exception_url(self, item):
        return reverse('cloakroom-desk-item-return-by-exception', args=[item.desk_id, item.pk])

    def reconcile_url(self, desk=None):
        return reverse('cloakroom-desk-reconcile', args=[(desk or self.desk).pk])

    def export_url(self, desk=None):
        return reverse('cloakroom-desk-export', args=[(desk or self.desk).pk])

    def deposit(self, user, rack='1', **extra):
        return as_(user).post(self.items_url(), {'rack_label': rack, **extra}, format='json')


class RefusalTests(DeskCase):
    def test_a_stranger_cannot_deposit(self):
        r = self.deposit(self.stranger)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()['detail'], 'not_staff')

    def test_an_attendee_cannot_deposit(self):
        """Somebody who is coming is not somebody working the counter. This is the refusal that
        keeps the token meaningful: if an attendee could mint one, the slip would prove nothing."""
        self.event.attendances.create(attendee=self.attendee, status='going')
        r = self.deposit(self.attendee)
        self.assertEqual(r.status_code, 403)

    def test_anonymous_cannot_deposit(self):
        r = APIClient().post(self.items_url(), {'rack_label': '1'}, format='json')
        self.assertIn(r.status_code, (401, 403))

    def test_a_stranger_gets_404_on_a_draft_events_desks(self):
        """Visibility is the queryset filter (house rule 4): for a stranger the draft does not
        exist, so neither does its cloakroom."""
        draft = Event.objects.create(
            host=self.host, title='Jeszcze nieogłoszona', status='draft', visibility='private',
            starts_at=timezone.now() + timedelta(days=9), location_kind='onsite',
            location_text='x',
        )
        CloakroomDesk.objects.create(event=draft, name='Szatnia', rack_labels=['1'])
        self.assertEqual(as_(self.stranger).get(self.desks_url(draft)).status_code, 404)
        self.assertEqual(as_(self.host).get(self.desks_url(draft)).status_code, 200)

    def test_a_taken_rack_is_refused_with_its_reason(self):
        self.assertEqual(self.deposit(self.clerk, '2').status_code, 201)
        r = self.deposit(self.clerk, '2')
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()['detail'], 'rack_taken')

    def test_a_rack_the_desk_does_not_have_is_a_bad_request(self):
        """400, not 409 — the world did not move, the request named a hook that was never there."""
        r = self.deposit(self.clerk, '99')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['detail'], 'unknown_rack')

    def test_a_closed_desk_takes_nothing_more(self):
        as_(self.clerk).post(self.reconcile_url())
        r = self.deposit(self.clerk, '1')
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()['detail'], 'desk_closed')

    def test_an_unknown_token_is_a_verdict_not_a_404(self):
        r = as_(self.clerk).post(self.return_url(), {'token': 'ZZZZZZZZ'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['result'], 'unknown_token')
        self.assertIsNone(r.json()['item'])

    def test_a_coat_only_leaves_once(self):
        token = self.deposit(self.clerk, '1').json()['token']
        self.assertEqual(
            as_(self.clerk).post(self.return_url(), {'token': token}, format='json').json()['result'],
            'returned',
        )
        again = as_(self.clerk).post(self.return_url(), {'token': token}, format='json')
        self.assertEqual(again.json()['result'], 'already_returned')

    def test_a_token_is_blacklisted_after_its_coat_left_by_exception(self):
        """The slip somebody lost is worth nothing from the moment the coat goes home without it —
        including when it turns up in the corridor twenty minutes later."""
        item = CloakroomItem.objects.get(pk=self.deposit(self.clerk, '1').json()['id'])
        token = item.token
        ok = as_(self.clerk).post(self.exception_url(item), {
            'description': 'długi zielony płaszcz', 'identity_kind': 'student_card',
        }, format='json')
        self.assertEqual(ok.status_code, 200)
        r = as_(self.clerk).post(self.return_url(), {'token': token}, format='json')
        self.assertEqual(r.json()['result'], 'blacklisted')

    def test_an_exception_return_without_a_description_is_refused(self):
        item = CloakroomItem.objects.get(pk=self.deposit(self.clerk, '1').json()['id'])
        r = as_(self.clerk).post(self.exception_url(item), {
            'description': '   ', 'identity_kind': 'id_document',
        }, format='json')
        self.assertEqual(r.status_code, 400)

    def test_an_exception_return_without_an_identity_kind_is_refused(self):
        """`none` is a legal value of the field and an illegal answer here — the exception path
        exists because somebody proved something, and the KIND is the only trace of it kept."""
        item = CloakroomItem.objects.get(pk=self.deposit(self.clerk, '1').json()['id'])
        r = as_(self.clerk).post(self.exception_url(item), {
            'description': 'czarna kurtka', 'identity_kind': 'none',
        }, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()['detail'], 'identity_required')

    def test_a_volunteer_cannot_create_or_delete_a_desk(self):
        r = as_(self.clerk).post(self.desks_url(), {'name': 'Druga', 'rack_labels': ['a']}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(as_(self.clerk).delete(
            reverse('cloakroom-desk-detail', args=[self.desk.pk])).status_code, 403)

    def test_a_desk_that_took_a_coat_is_not_deletable(self):
        self.deposit(self.clerk, '1')
        r = as_(self.host).delete(reverse('cloakroom-desk-detail', args=[self.desk.pk]))
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()['detail'], 'has_items')

    def test_the_kill_switch_closes_the_surface_for_a_non_staff_caller(self):
        FeatureFlag.objects.update_or_create(key='cloakroom', defaults={'is_enabled': False})
        self.assertEqual(as_(self.clerk).get(self.desks_url()).status_code, 403)
        self.assertEqual(self.deposit(self.clerk).status_code, 403)
        # …and the neighbouring event endpoint keeps working (house rule 3).
        self.assertEqual(as_(self.clerk).get(reverse('event-detail', args=[self.event.pk])).status_code, 200)


class DepositAndReturnTests(DeskCase):
    def test_a_deposit_hands_back_a_token_and_holds_the_rack(self):
        r = self.deposit(self.clerk, '1', description='szary szalik')
        self.assertEqual(r.status_code, 201)
        body = r.json()
        self.assertEqual(len(body['token']), 8)
        self.assertEqual(body['status'], 'stored')
        self.assertEqual(body['rack_label'], '1')
        desk = as_(self.clerk).get(reverse('cloakroom-desk-detail', args=[self.desk.pk])).json()
        self.assertEqual(desk['stored_count'], 1)
        self.assertEqual(desk['free_racks'], ['2', '3'])
        self.assertTrue(desk['can_operate'])

    def test_a_token_is_never_reused_while_anything_carries_it(self):
        tokens = {self.deposit(self.clerk, rack).json()['token'] for rack in ['1', '2', '3']}
        self.assertEqual(len(tokens), 3)

    def test_the_item_carries_no_person(self):
        """The invariant the whole app exists for, asserted rather than assumed: nothing on the row
        says who the coat belongs to. `deposited_by` is the clerk."""
        self.deposit(self.clerk, '1')
        item = CloakroomItem.objects.get()
        self.assertEqual(item.deposited_by, self.clerk)
        self.assertFalse(any(f.name in ('owner', 'attendee', 'depositor')
                             for f in CloakroomItem._meta.get_fields()))

    def test_a_return_frees_the_rack_for_the_next_coat(self):
        token = self.deposit(self.clerk, '1').json()['token']
        as_(self.clerk).post(self.return_url(), {'token': token}, format='json')
        self.assertEqual(self.deposit(self.clerk, '1').status_code, 201)

    def test_a_token_is_matched_case_insensitively_and_trimmed(self):
        """It is typed off a paper slip at midnight."""
        token = self.deposit(self.clerk, '1').json()['token']
        r = as_(self.clerk).post(self.return_url(), {'token': f'  {token.lower()} '}, format='json')
        self.assertEqual(r.json()['result'], 'returned')

    def test_the_rack_grid_can_hand_a_coat_back_by_item(self):
        item = CloakroomItem.objects.get(pk=self.deposit(self.clerk, '3').json()['id'])
        r = as_(self.clerk).post(self.item_return_url(item))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['result'], 'returned')
        item.refresh_from_db()
        self.assertEqual(item.status, 'returned')
        self.assertEqual(item.returned_by, self.clerk)

    def test_an_exception_return_records_the_kind_and_not_the_number(self):
        item = CloakroomItem.objects.get(pk=self.deposit(self.clerk, '1').json()['id'])
        as_(self.clerk).post(self.exception_url(item), {
            'description': 'granatowy płaszcz, czerwony szalik',
            'identity_kind': 'id_document',
            'note': 'zgubiony numerek',
        }, format='json')
        item.refresh_from_db()
        self.assertEqual(item.status, 'returned_by_exception')
        self.assertEqual(item.exception_identity_kind, 'id_document')
        self.assertEqual(item.exception_verified_by, self.clerk)
        self.assertTrue(item.is_blacklisted)

    def test_an_attendee_is_told_there_is_a_cloakroom_and_nothing_else(self):
        """The reduced shape (`CONFERENCE-BRIEF.md` §3.F's attendee line): the name and the note,
        never the racks, never how full it is."""
        self.deposit(self.clerk, '1')
        body = as_(self.attendee).get(self.desks_url()).json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]['name'], 'Szatnia — wejście północne')
        self.assertEqual(body[0]['opens_note'], 'Czynna od 17:00')
        self.assertFalse(body[0]['can_operate'])
        for leaked in ('rack_labels', 'racks', 'free_racks', 'stored_count'):
            self.assertNotIn(leaked, body[0])

    def test_an_organiser_opens_a_desk(self):
        r = as_(self.host).post(self.desks_url(), {
            'name': 'Szatnia — wejście południowe', 'rack_labels': ['A', 'A', ' B ', ''],
            'opens_note': '',
        }, format='json')
        self.assertEqual(r.status_code, 201)
        # Deduplicated, trimmed, blanks dropped — a hand-typed list is untrusted input.
        self.assertEqual(r.json()['racks'], ['A', 'B'])


class ReconcileTests(DeskCase):
    def test_reconcile_marks_everything_still_on_a_rack_unclaimed_and_closes_the_desk(self):
        left = CloakroomItem.objects.get(pk=self.deposit(self.clerk, '2').json()['id'])
        taken = self.deposit(self.clerk, '1').json()
        as_(self.clerk).post(self.return_url(), {'token': taken['token']}, format='json')

        r = as_(self.clerk).post(self.reconcile_url())
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body['desk']['status'], 'closed')
        self.assertEqual([row['rack_label'] for row in body['unclaimed']], ['2'])
        left.refresh_from_db()
        self.assertEqual(left.status, 'unclaimed')
        self.desk.refresh_from_db()
        self.assertEqual(self.desk.closed_by, self.clerk)

    def test_reconciling_twice_says_the_same_thing(self):
        self.deposit(self.clerk, '1')
        first = as_(self.clerk).post(self.reconcile_url()).json()
        second = as_(self.clerk).post(self.reconcile_url()).json()
        self.assertEqual(
            [row['id'] for row in first['unclaimed']], [row['id'] for row in second['unclaimed']]
        )

    def test_the_unclaimed_list_walks_the_rail_in_rack_order(self):
        desk = CloakroomDesk.objects.create(
            event=self.event, name='Duża szatnia', rack_labels=['9', '10', '11'],
        )
        for rack in ['11', '9', '10']:
            as_(self.clerk).post(self.items_url(desk), {'rack_label': rack}, format='json')
        body = as_(self.clerk).post(self.reconcile_url(desk)).json()
        self.assertEqual([row['rack_label'] for row in body['unclaimed']], ['9', '10', '11'])

    def test_a_stranger_cannot_close_a_desk(self):
        self.assertEqual(as_(self.stranger).post(self.reconcile_url()).status_code, 403)

    def test_the_csv_has_six_columns_and_not_one_person_in_it(self):
        item = CloakroomItem.objects.get(pk=self.deposit(self.clerk, '1').json()['id'])
        as_(self.clerk).post(self.exception_url(item), {
            'description': 'zielony płaszcz', 'identity_kind': 'account',
        }, format='json')
        self.deposit(self.clerk, '2')
        r = as_(self.clerk).get(self.export_url())
        self.assertEqual(r.status_code, 200)
        self.assertIn('text/csv', r['Content-Type'])
        lines = r.content.decode().strip().splitlines()
        self.assertEqual(
            lines[0], 'rack,token,status,deposited_at,returned_at,identity_kind'
        )
        self.assertEqual(len(lines), 3)
        body = r.content.decode()
        for name in (self.clerk.username, self.host.username, self.attendee.username):
            self.assertNotIn(name, body)

    def test_a_stranger_cannot_export(self):
        self.assertEqual(as_(self.stranger).get(self.export_url()).status_code, 403)


class RuleModuleTests(DeskCase):
    """The rule module answers on its own, so the integrator's later change to `can_operate`
    (a confirmed `cloakroom` station on step E's rota) has one place to land."""

    def test_can_operate_is_staff_membership_today(self):
        self.assertTrue(rules.can_operate(self.host, self.event))
        self.assertTrue(rules.can_operate(self.clerk, self.event))
        self.assertFalse(rules.can_operate(self.stranger, self.event))

    def test_a_rostered_desk_is_worked_by_its_assignees_and_the_organisers(self):
        # Integration with step E (CONFERENCE-BRIEF.md §5): once the event has a `cloakroom`
        # station, plain staff membership stops being enough for the desk.
        other = make_user('cloak-other-volunteer')
        EventStaff.objects.create(event=self.event, user=other, role='volunteer')
        station = Station.objects.create(event=self.event, kind='cloakroom', name='Szatnia')
        shift = Shift.objects.create(
            station=station, starts_at=self.event.starts_at,
            ends_at=self.event.starts_at + timedelta(hours=4), needed=1,
        )
        self.assertFalse(rules.can_operate(self.clerk, self.event))   # staff, not rostered
        self.assertFalse(rules.can_operate(other, self.event))
        self.assertTrue(rules.can_operate(self.host, self.event))      # organisers always
        Assignment.objects.create(shift=shift, user=self.clerk, status='claimed')
        self.assertFalse(rules.can_operate(self.clerk, self.event))   # claimed is not confirmed
        Assignment.objects.filter(user=self.clerk).update(status='confirmed')
        self.assertTrue(rules.can_operate(self.clerk, self.event))
        self.assertFalse(rules.can_operate(self.stranger, self.event))
        # With the rota switched off, a station nobody can see must not lock the desk.
        FeatureFlag.objects.update_or_create(key='shifts', defaults={'is_enabled': False})
        self.assertTrue(rules.can_operate(other, self.event))

    def test_an_unread_briefing_blocks_the_desk_writes_and_not_its_reads(self):
        # Integration with step C: the same 409 the check-in button answers with.
        doc = EventDocument.objects.create(
            event=self.event, title='Instruktaż ppoż.', kind='link', url='https://example.org/ppoz',
            visibility='staff', requires_acknowledgement=True, uploaded_by=self.host,
        )
        grid = as_(self.clerk).get(self.items_url())
        self.assertEqual(grid.status_code, 200)
        refused = self.deposit(self.clerk, '1')
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.data['detail'], 'briefing_unread')
        self.assertEqual(refused.data['documents'], [doc.pk])
        self.assertFalse(CloakroomItem.objects.exists())
        returned = as_(self.clerk).post(self.return_url(), {'token': 'ABCDEFGH'}, format='json')
        self.assertEqual(returned.status_code, 409)
        DocumentAcknowledgement.objects.create(document=doc, user=self.clerk, version=doc.version)
        self.assertEqual(self.deposit(self.clerk, '1').status_code, 201)

    def test_free_racks_is_derived_not_counted(self):
        self.deposit(self.clerk, '2')
        self.assertEqual(rules.free_racks(self.desk), ['1', '3'])

    def test_an_unclaimed_coat_still_occupies_its_hook(self):
        self.deposit(self.clerk, '2')
        rules.reconcile(self.desk, self.host)
        self.assertEqual(rules.free_racks(self.desk), ['1', '3'])

    def test_deposit_block_reason_orders_its_answers(self):
        self.assertEqual(rules.deposit_block_reason(self.stranger, self.desk, '1'), 'not_staff')
        self.assertEqual(rules.deposit_block_reason(self.clerk, self.desk, 'nope'), 'unknown_rack')
        self.deposit(self.clerk, '1')
        self.assertEqual(rules.deposit_block_reason(self.clerk, self.desk, '1'), 'rack_taken')
        rules.reconcile(self.desk, self.host)
        self.assertEqual(rules.deposit_block_reason(self.clerk, self.desk, '2'), 'desk_closed')
