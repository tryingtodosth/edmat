<script lang="ts">
	// "My schedule" — one page, three tabs, because they are three views of the same calendar rather
	// than three features. Splitting them across routes would mean a tutor answering a request has to
	// leave the page to check whether they had already blocked that afternoon.
	//
	//   Requests    — bookings made WITH you: what to answer, and what is coming up.
	//   My bookings — bookings YOU made with somebody else.
	//   Availability — the weekly rules and one-off exceptions everything above is computed from.
	//
	// Most accounts here are both a tutor and a student (the same reasoning messaging's own single
	// inbox already follows), so neither side is hidden behind a role the account has to hold.
	import { resolve } from '$app/paths';
	import type {
		AvailabilityException,
		AvailabilityRule,
		Booking,
		EffectiveWeek,
		ScheduleWindow,
		Service,
		TutorSchedule,
		WeekTemplate
	} from '$lib/types';
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import {
		applyWeeks,
		BookingConflictError,
		cancelBooking,
		completeBooking,
		confirmBooking,
		createAvailabilityException,
		createAvailabilityRule,
		declineBooking,
		deleteAvailabilityException,
		deleteAvailabilityRule,
		deleteWeekTemplate,
		getAvailabilityExceptions,
		getAvailabilityRules,
		getBookings,
		getEffectiveWeek,
		getWeekTemplates,
		reattachWeek,
		saveWeek,
		saveWeekAsTemplate,
		updateAvailabilityRule
	} from '$lib/services/booking';
	import { getMySchedule } from '$lib/services/booking';
	import { getMyServices } from '$lib/services/tutoring';
	import { authStore } from '$lib/state/auth.svelte';
	import { cachedList, opacityFor, type TrackedRow } from '$lib/state/cachedList.svelte';
	import NewSinceNotice from '$lib/components/shared/NewSinceNotice.svelte';
	import { displayPrefs } from '$lib/state/displayPrefs.svelte';
	import { formatClock, formatDateTime } from '$lib/utils/datetime';
	import CalendarMonth from '$lib/components/booking/CalendarMonth.svelte';
	import CalendarWeek from '$lib/components/booking/CalendarWeek.svelte';
	import ViewSwitcher from '$lib/components/booking/ViewSwitcher.svelte';
	import {
		type CalendarEntry,
		type CalendarMonthDay,
		clockToMinutes,
		dayRange,
		type EditableWindow,
		fromIsoDate,
		isoDate,
		minutesToClock,
		monthGridDays,
		monthOf,
		shiftDays,
		shiftMonth,
		startOfWeek
	} from '$lib/components/booking/calendar';

	type Tab = 'incoming' | 'mine' | 'availability';
	let tab = $state<Tab>('incoming');

	// Both booking lists read through `cachedList`. This is the surface where the "N new" count
	// earns its keep most directly: a tutor opening this page wants to know whether anybody has
	// asked for an hour since they last looked, and that is exactly what the merge already knows.
	// The availability tab is NOT cached — rules and one-off exceptions are what you come here to
	// EDIT, and editing a stale copy of your own schedule is how you publish hours you meant to
	// withdraw.
	let incoming = $state<TrackedRow<Booking>[]>([]);
	let mine = $state<TrackedRow<Booking>[]>([]);
	let newIncoming = $state(0);
	let newMine = $state(0);
	let rules = $state<AvailabilityRule[]>([]);
	let exceptions = $state<AvailabilityException[]>([]);
	let myServices = $state<Service[]>([]);
	let loading = $state(true);
	let actionError = $state('');

	// The stored weekday VALUE is always Monday-based 0-6, matching Python's `date.weekday()`, which
	// is what the backend compares a rule against — see AvailabilityRule (types/booking.ts) for why
	// the wire format follows the side doing the arithmetic rather than JS's Sunday-first `getDay()`.
	// Only the ORDER the options are offered in follows the viewer's own week-start preference: a
	// Sunday-first reader picking "Sunday" must still store 6, or the rule would land on Monday.
	const WEEKDAYS = $derived([
		m.booking_weekday_monday(),
		m.booking_weekday_tuesday(),
		m.booking_weekday_wednesday(),
		m.booking_weekday_thursday(),
		m.booking_weekday_friday(),
		m.booking_weekday_saturday(),
		m.booking_weekday_sunday()
	]);
	/** The 0-6 values in the viewer's own week order — [0..6] Monday-first, [6, 0..5] Sunday-first. */
	let weekdayOrder = $derived(
		displayPrefs.weekStartsOn === 0 ? [6, 0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6]
	);

	let newRule = $state({ weekday: 0, startTime: '14:00', endTime: '16:00', serviceId: '' });
	let newException = $state({
		date: '',
		kind: 'block' as 'block' | 'open',
		startTime: '',
		endTime: '',
		note: ''
	});
	let ruleError = $state('');
	let exceptionError = $state('');

	function todayIso(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}

	// Deliberately does NOT clear `actionError`. A real bug found by driving this in a browser: the
	// refusal path below sets the message and then reloads to show the world as it now is, and a
	// reset here silently wiped the explanation on its way past — the tutor saw the list rearrange
	// itself with no word about why their click had not worked. Callers clear it before acting
	// instead, which is the moment it actually stops being true.
	async function load() {
		loading = true;
		newIncoming = 0;
		newMine = 0;
		try {
			const [, , ruleRows, exceptionRows, services] = await Promise.all([
				cachedList<Booking>(
					'bookings:incoming',
					() => getBookings({ role: 'tutor' }),
					(r) => {
						incoming = r.rows;
						newIncoming = r.newCount;
						// Painted as soon as the device's own copy is in hand, before the network answers.
						loading = false;
					}
				),
				cachedList<Booking>(
					'bookings:mine',
					() => getBookings({ role: 'student' }),
					(r) => {
						mine = r.rows;
						newMine = r.newCount;
						loading = false;
					}
				),
				getAvailabilityRules(),
				getAvailabilityExceptions(todayIso()),
				getMyServices()
			]);
			rules = ruleRows;
			exceptions = exceptionRows;
			myServices = services;
		} catch {
			actionError = m.booking_loadFailed();
		} finally {
			loading = false;
		}
	}

	// A real `$effect` on `isAuthenticated` rather than a one-shot `onMount` check: a hard reload
	// re-runs the root layout's own async `authStore.init()` from scratch, which has not necessarily
	// resolved by the time this component mounts — the exact race CLAUDE.md records the messages page
	// having shipped with once. `loadedOnce` stops it re-firing and resetting the tab afterwards.
	let loadedOnce = $state(false);
	$effect(() => {
		if (!authStore.isAuthenticated || loadedOnce) return;
		loadedOnce = true;
		load();
	});

	// Through the shared helper rather than Intl's own per-locale default, which would hand an English
	// reader 12-hour whether they asked for it or not.
	const formatWhen = formatDateTime;

	const STATUS_LABEL: Record<Booking['status'], () => string> = {
		requested: () => m.booking_status_requested(),
		confirmed: () => m.booking_status_confirmed(),
		declined: () => m.booking_status_declined(),
		cancelled: () => m.booking_status_cancelled(),
		completed: () => m.booking_status_completed()
	};

	async function act(what: 'confirm' | 'decline' | 'cancel' | 'complete', booking: Booking) {
		actionError = '';
		try {
			if (what === 'confirm') await confirmBooking(booking.id);
			else if (what === 'decline') await declineBooking(booking.id);
			else if (what === 'cancel') await cancelBooking(booking.id);
			else await completeBooking(booking.id);
			await load();
		} catch (e) {
			// A 409 is not "something went wrong" — it is the world having moved (somebody else acted,
			// or the tutor already has that hour confirmed), so it gets its own sentence and a reload
			// rather than a generic failure the user would keep retrying. The reload comes FIRST and
			// the message is set after it, so the refreshed list and the explanation of why it changed
			// arrive together rather than the one overwriting the other.
			if (e instanceof BookingConflictError) await load();
			actionError = e instanceof BookingConflictError ? e.message : m.booking_actionFailed();
		}
	}

	async function addRule(event: SubmitEvent) {
		event.preventDefault();
		ruleError = '';
		try {
			await createAvailabilityRule({
				weekday: newRule.weekday,
				startTime: newRule.startTime,
				endTime: newRule.endTime,
				serviceId: newRule.serviceId || undefined
			});
			rules = await getAvailabilityRules();
		} catch {
			ruleError = m.booking_ruleFailed();
		}
	}

	async function addException(event: SubmitEvent) {
		event.preventDefault();
		exceptionError = '';
		try {
			await createAvailabilityException({
				date: newException.date,
				kind: newException.kind,
				startTime: newException.startTime || undefined,
				endTime: newException.endTime || undefined,
				note: newException.note
			});
			exceptions = await getAvailabilityExceptions(todayIso());
			newException = { date: '', kind: 'block', startTime: '', endTime: '', note: '' };
		} catch {
			exceptionError = m.booking_exceptionFailed();
		}
	}

	async function removeRule(id: string) {
		await deleteAvailabilityRule(id);
		rules = await getAvailabilityRules();
	}

	async function removeException(id: string) {
		await deleteAvailabilityException(id);
		exceptions = await getAvailabilityExceptions(todayIso());
	}

	// ---- the calendar over the tutor's own schedule -------------------------------------------
	//
	// Read from its own endpoint rather than assembled here out of `rules` + `exceptions` + `incoming`.
	// Expanding a weekly rule over real dates, adding one-off openings and then subtracting blocks is
	// exactly the arithmetic booking/availability.py exists to own, and a second implementation of it
	// in the browser is how the calendar and the slots a student is offered start disagreeing.

	type CalendarView = 'week' | 'month';
	let calendarView = $state<CalendarView>('week');
	/** The day being looked at, not the first day of the range — see BookingPanel's own note. Storing
	 * the focus and deriving the range is what makes the week follow the viewer's week-start
	 * preference once `authStore` resolves, rather than freezing whatever the default was at mount. */
	let calendarFocus = $state(isoDate(new Date()));
	let schedule = $state<TutorSchedule | undefined>(undefined);
	let scheduleFailed = $state(false);

	let calendarDays = $derived(
		calendarView === 'month'
			? monthGridDays(monthOf(calendarFocus), displayPrefs.weekStartsOn)
			: dayRange(startOfWeek(fromIsoDate(calendarFocus), displayPrefs.weekStartsOn), 7)
	);

	// Which seven days the grid draws, and which week an edit lands on. Declared here rather than with
	// the rest of the editor further down, because the period label below reads `gridDays` and a
	// `$derived` cannot be read before it is declared.
	let editing = $state(false);
	/** The Monday of the week being edited. Always a Monday, whatever week order the viewer reads in:
	 * a stored week is keyed by its Monday (see the backend's `monday_of`), so editing anything else
	 * would mean one displayed week straddling two stored ones and a drag on the leading day quietly
	 * changing the week before. The grid switches to Monday-first while editing for the same reason,
	 * and says so to the minority who read Sunday-first. */
	let editMonday = $derived(isoDate(startOfWeek(fromIsoDate(calendarFocus), 1)));
	let editDays = $derived(dayRange(fromIsoDate(editMonday), 7));
	let gridDays = $derived(editing && calendarView === 'week' ? editDays : calendarDays);

	async function loadSchedule() {
		scheduleFailed = false;
		try {
			schedule = await getMySchedule(calendarDays[0], calendarDays[calendarDays.length - 1]);
		} catch {
			scheduleFailed = true;
		}
	}

	// Only fetches while the calendar is actually on screen, and only when the range changes — the
	// same range-keyed guard the student-facing panel uses, for the same reason a bare $effect would
	// refetch on every keystroke in the forms below.
	let scheduleLoadedFor = $state<string | undefined>(undefined);
	$effect(() => {
		if (!authStore.isAuthenticated || tab !== 'availability') return;
		const range = `${calendarDays[0]}..${calendarDays[calendarDays.length - 1]}`;
		if (range === scheduleLoadedFor) return;
		scheduleLoadedFor = range;
		loadSchedule();
	});

	/** Which statuses belong on a calendar at all.
	 *
	 * A declined or cancelled session is not an appointment, and drawing it would fill the week with
	 * blocks nobody is going to attend. A completed one stays, because looking back at what you
	 * actually taught last week is half of why anybody opens a calendar. */
	const ON_CALENDAR: Booking['status'][] = ['requested', 'confirmed', 'completed'];
	const TONE_FOR_STATUS: Record<string, CalendarEntry['tone']> = {
		requested: 'requested',
		confirmed: 'confirmed',
		completed: 'settled'
	};

	let calendarEntries = $derived<CalendarEntry[]>([
		// Published hours first, as background bands — the point of the tutor's own calendar is seeing
		// each booking sitting INSIDE the window it occupies, which is exactly what the student-facing
		// endpoint (correctly) subtracts away.
		...(schedule?.days ?? []).flatMap((day) =>
			day.windows.map((window) => ({
				id: `window-${day.date}-${window.start}`,
				date: day.date,
				start: window.start,
				end: window.end,
				label: m.booking_calendar_published(),
				tone: 'window' as const
			}))
		),
		...(schedule?.bookings ?? [])
			.filter((booking) => ON_CALENDAR.includes(booking.status))
			.map((booking) => ({
				id: booking.id,
				date: booking.startsAt.slice(0, 10),
				start: booking.startsAt,
				end: booking.endsAt,
				// Whichever party is not you — a calendar row saying your own name would be useless, and
				// this page shows both the lessons you teach and the ones you take.
				label:
					booking.tutorId === authStore.user?.id
						? booking.studentDisplayName
						: booking.tutorDisplayName,
				sublabel: booking.serviceTitle,
				tone: TONE_FOR_STATUS[booking.status] ?? 'confirmed'
			})),
		// Events the caller is running or going to. On the calendar because an evening spent running a
		// workshop is gone whether or not anybody paid for it — the same reason both sides of the
		// caller's bookings are here. Drawn in its own tone (dashed, not the confirmed green) because
		// an event does NOT take the hour off what students are offered; the clash is shown, and the
		// tutor decides. See backend `MyScheduleView` for that decision in full.
		...(schedule?.events ?? [])
			.filter((event) => event.status !== 'cancelled')
			.map((event) => ({
				id: `event-${event.id}`,
				date: event.startsAt.slice(0, 10),
				start: event.startsAt,
				end: event.endsAt,
				label: event.title,
				sublabel: event.isHost ? m.events_scheduleHosting() : m.events_scheduleGoing(),
				tone: 'event' as const
			}))
	]);

	let calendarMonthDays = $derived<CalendarMonthDay[]>(
		(schedule?.days ?? []).map((day) => {
			const onDay = (schedule?.bookings ?? []).filter(
				(booking) =>
					booking.startsAt.slice(0, 10) === day.date && ON_CALENDAR.includes(booking.status)
			);
			// Counted alongside bookings rather than in a separate number: the month grid answers "is
			// anything on that day", and an event is something on that day.
			const eventsOnDay = (schedule?.events ?? []).filter(
				(event) => event.startsAt.slice(0, 10) === day.date && event.status !== 'cancelled'
			);
			return {
				date: day.date,
				count: onDay.length + eventsOnDay.length,
				// A pending request is the thing on that day that needs you, so it wins the colour.
				tone: onDay.some((booking) => booking.status === 'requested') ? 'requested' : 'confirmed',
				// Published hours with nothing booked into them yet: a dot rather than a number, since
				// it is a different fact from the count beside it.
				marked: day.windows.length > 0
			};
		})
	);

	let calendarPeriodLabel = $derived(
		calendarView === 'month'
			? new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(
					fromIsoDate(`${monthOf(calendarFocus)}-01`)
				)
			: // `gridDays`, not `calendarDays`: while editing, the grid is shifted to the Monday week the
				// change will be saved against, and a header describing a different seven days from the
				// ones drawn underneath it would be worse than no header.
				`${formatShortDay(gridDays[0])} – ${formatShortDay(gridDays[gridDays.length - 1])}`
	);

	function formatShortDay(iso: string): string {
		return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short' }).format(
			fromIsoDate(iso)
		);
	}

	function stepCalendar(direction: number) {
		calendarFocus =
			calendarView === 'month'
				? `${shiftMonth(monthOf(calendarFocus), direction)}-01`
				: isoDate(shiftDays(fromIsoDate(calendarFocus), direction * 7));
	}

	// No re-anchoring needed: a focus DAY reads correctly as both "the week of the 12th" and "the
	// month containing the 12th".
	function changeCalendarView(next: string) {
		calendarView = next as CalendarView;
	}

	// ---- editing the calendar directly ----------------------------------------------------------
	//
	// Two things can be edited on the same grid, and which one is a real choice the tutor makes rather
	// than something inferred from the state of the week they happen to be looking at:
	//
	//   'pattern' — the repeating weekly rules. Unbounded: changing Tuesday changes every Tuesday.
	//   'week'    — this one week's own hours. Detaches the week from the pattern on the first edit.
	//
	// Inferring it would go wrong in the ordinary case: somebody laying out their usual timetable and
	// somebody carving one week out of it are doing different things on identical-looking grids, and
	// guessing which from whether the week happens to be detached already would silently pick the
	// wrong one about half the time. So it is two radio buttons with a sentence each, and the sentence
	// says what the change will reach.

	let editScope = $state<'pattern' | 'week'>('week');
	let editWeek = $state<EffectiveWeek | undefined>(undefined);
	let editServiceId = $state('');
	let editError = $state('');
	let editNotice = $state('');
	let templates = $state<WeekTemplate[]>([]);
	let templateName = $state('');
	let repeatWeeks = $state(4);
	let repeatOverwrite = $state(true);
	let busy = $state(false);

	/** Monday-based, matching `AvailabilityRule.weekday` and the backend's `date.weekday()` — NOT
	 * `Date.getDay()`, which is Sunday-based and would land every rule one day out. */
	function weekdayOf(date: string): number {
		return (fromIsoDate(date).getDay() + 6) % 7;
	}

	/** The windows the grid lets you drag, from whichever source is being edited.
	 *
	 * Both sources become the same shape, which is the point: one editing surface, one set of
	 * gestures, and the difference between them lives entirely in what a gesture then writes. The id
	 * prefix is what tells the handlers apart — a rule carries its own database id, while a stored
	 * week's windows have none of their own (they are written as a whole list) so they are addressed
	 * by position. */
	let editWindows = $derived<EditableWindow[]>(
		editScope === 'pattern'
			? rules.map((rule) => ({
					id: `rule-${rule.id}`,
					date: editDays[rule.weekday],
					startMinutes: clockToMinutes(rule.startTime),
					endMinutes: clockToMinutes(rule.endTime),
					label: rule.serviceId ? serviceTitle(rule.serviceId) : undefined
				}))
			: (editWeek?.windows ?? []).map((window, index) => ({
					id: `win-${index}`,
					date: editDays[window.weekday],
					startMinutes: clockToMinutes(window.startTime),
					endMinutes: clockToMinutes(window.endTime),
					label: window.serviceId ? serviceTitle(window.serviceId) : undefined
				}))
	);

	// The read-only calendar is only refetched when editing STOPS, not after every drag. Nothing it
	// shows changes under an edit except the published bands, which the editor hides anyway (see
	// CalendarWeek) — so a fetch per gesture would be a round trip to redraw something invisible.
	let scheduleStale = $state(false);

	let editWeekLoadedFor = $state<string | undefined>(undefined);
	$effect(() => {
		if (!editing) return;
		const monday = editMonday;
		if (monday === editWeekLoadedFor) return;
		editWeekLoadedFor = monday;
		loadEditWeek(monday);
	});

	async function loadEditWeek(monday: string) {
		try {
			editWeek = await getEffectiveWeek(monday);
		} catch {
			editError = m.booking_loadFailed();
		}
	}

	async function startEditing() {
		editing = true;
		editError = '';
		editNotice = '';
		try {
			templates = await getWeekTemplates();
		} catch {
			// A template list that will not load is not a reason to refuse to edit hours — the two are
			// independent, and the panel simply shows none.
			templates = [];
		}
	}

	async function stopEditing() {
		editing = false;
		editError = '';
		editNotice = '';
		if (scheduleStale) {
			scheduleStale = false;
			await loadSchedule();
		}
	}

	/** Run one edit, and put the world back the way the server sees it if it fails.
	 *
	 * Every gesture saves immediately rather than collecting into a Save button. A schedule editor
	 * with unsaved state is one browser crash away from publishing hours somebody thought they had
	 * withdrawn, and the same page already refuses to cache this tab for that reason. The cost is a
	 * request per drag, which for a handful of windows is the right side of that trade.
	 */
	async function edit(change: () => Promise<void>) {
		if (busy) return;
		busy = true;
		editError = '';
		editNotice = '';
		try {
			await change();
			scheduleStale = true;
		} catch {
			editError = m.booking_edit_saveFailed();
			// Reload rather than leave the grid showing an edit the server refused — the alternative is
			// a calendar that disagrees with what is published, which is the one thing it must not be.
			if (editScope === 'pattern') rules = await getAvailabilityRules();
			else await loadEditWeek(editMonday);
		} finally {
			busy = false;
		}
	}

	/** Write the week's whole window list. The backend merges overlaps and hands back what it stored,
	 * so the grid redraws from the saved truth rather than from what was dragged. */
	async function saveWindows(windows: ScheduleWindow[]) {
		editWeek = await saveWeek(editMonday, windows);
	}

	function currentWindows(): ScheduleWindow[] {
		return (editWeek?.windows ?? []).map((window) => ({ ...window }));
	}

	function handleCreate(date: string, startMinutes: number, endMinutes: number) {
		const weekday = weekdayOf(date);
		const startTime = minutesToClock(startMinutes);
		const endTime = minutesToClock(endMinutes);
		edit(async () => {
			if (editScope === 'pattern') {
				await createAvailabilityRule({
					weekday,
					startTime,
					endTime,
					serviceId: editServiceId || undefined
				});
				rules = await getAvailabilityRules();
			} else {
				await saveWindows([
					...currentWindows(),
					{ weekday, startTime, endTime, serviceId: editServiceId || undefined }
				]);
			}
		});
	}

	function handleMove(id: string, date: string, startMinutes: number, endMinutes: number) {
		const weekday = weekdayOf(date);
		const startTime = minutesToClock(startMinutes);
		const endTime = minutesToClock(endMinutes);
		edit(async () => {
			if (id.startsWith('rule-')) {
				await updateAvailabilityRule(id.slice(5), { weekday, startTime, endTime });
				rules = await getAvailabilityRules();
			} else {
				const index = Number(id.slice(4));
				await saveWindows(
					currentWindows().map((window, at) =>
						at === index ? { ...window, weekday, startTime, endTime } : window
					)
				);
			}
		});
	}

	function handleRemove(id: string) {
		edit(async () => {
			if (id.startsWith('rule-')) {
				await deleteAvailabilityRule(id.slice(5));
				rules = await getAvailabilityRules();
			} else {
				const index = Number(id.slice(4));
				await saveWindows(currentWindows().filter((_, at) => at !== index));
			}
		});
	}

	function handleReattach() {
		const id = editWeek?.id;
		if (!id) return;
		edit(async () => {
			await reattachWeek(id);
			await loadEditWeek(editMonday);
		});
	}

	function handleRepeat() {
		edit(async () => {
			const result = await applyWeeks({
				sourceWeek: editMonday,
				weekStart: isoDate(shiftDays(fromIsoDate(editMonday), 7)),
				weeks: repeatWeeks,
				overwrite: repeatOverwrite
			});
			editNotice = result.skipped.length
				? m.booking_edit_repeatSkipped({
						written: result.written.length,
						skipped: result.skipped.length
					})
				: m.booking_edit_repeatDone({ count: result.written.length });
			await loadEditWeek(editMonday);
		});
	}

	function handleApplyTemplate(template: WeekTemplate) {
		edit(async () => {
			const result = await applyWeeks({
				sourceTemplateId: template.id,
				weekStart: editMonday,
				weeks: repeatWeeks,
				overwrite: repeatOverwrite
			});
			editNotice = result.skipped.length
				? m.booking_edit_repeatSkipped({
						written: result.written.length,
						skipped: result.skipped.length
					})
				: m.booking_edit_repeatDone({ count: result.written.length });
			await loadEditWeek(editMonday);
		});
	}

	async function handleSaveTemplate(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		busy = true;
		editError = '';
		editNotice = '';
		try {
			await saveWeekAsTemplate(editMonday, templateName.trim());
			templates = await getWeekTemplates();
			templateName = '';
		} catch {
			editError = m.booking_edit_templateFailed();
		} finally {
			busy = false;
		}
	}

	function handleDeleteTemplate(id: string) {
		edit(async () => {
			await deleteWeekTemplate(id);
			templates = await getWeekTemplates();
		});
	}

	let editWeekLabel = $derived(
		m.booking_edit_weekOf({
			date: new Intl.DateTimeFormat(getLocale(), {
				day: 'numeric',
				month: 'long'
			}).format(fromIsoDate(editMonday))
		})
	);

	let pendingCount = $derived(incoming.filter((r) => r.item.status === 'requested').length);
	function serviceTitle(id?: string): string {
		return myServices.find((s) => s.id === id)?.title ?? '';
	}
</script>

<svelte:head>
	<title>{m.booking_pageTitle()} — {m.common_appName()}</title>
</svelte:head>

<div class="page">
	<h1>{m.booking_pageTitle()}</h1>

	{#if authStore.restoring}
		<p class="session-restoring">{m.common_loading()}</p>
	{:else if !authStore.isAuthenticated}
		<p data-session-hidden class="muted">
			<a href={resolve('/login')}>{m.booking_loginToBook()}</a>
		</p>
	{:else}
		<nav class="tabs" aria-label={m.booking_pageTitle()}>
			<button type="button" class:active={tab === 'incoming'} onclick={() => (tab = 'incoming')}>
				{m.booking_tab_incoming()}{pendingCount > 0 ? ` (${pendingCount})` : ''}
			</button>
			<button type="button" class:active={tab === 'mine'} onclick={() => (tab = 'mine')}>
				{m.booking_tab_mine()}
			</button>
			<button
				type="button"
				class:active={tab === 'availability'}
				onclick={() => (tab = 'availability')}
			>
				{m.booking_tab_availability()}
			</button>
		</nav>

		{#if actionError}
			<p class="error">{actionError}</p>
		{/if}

		{#if loading}
			<p class="muted">{m.common_loading()}</p>
		{:else if tab === 'incoming'}
			{#if incoming.length === 0}
				<p class="muted">{m.booking_noIncoming()}</p>
			{:else}
				<NewSinceNotice count={newIncoming} />
				<ul class="bookings">
					{#each incoming as row (row.item.id)}
						{@const booking = row.item}
						<li class="booking" style="opacity: {opacityFor(row.confirmedAt)}">
							<div class="booking__head">
								<strong>{formatWhen(booking.startsAt)}</strong>
								<span class="pill pill--{booking.status}">{STATUS_LABEL[booking.status]()}</span>
							</div>
							<p class="booking__who">
								{m.booking_withStudent({
									student: booking.studentDisplayName,
									listing: booking.serviceTitle
								})}
							</p>
							{#if booking.studentNote}
								<p class="booking__note">&ldquo;{booking.studentNote}&rdquo;</p>
							{/if}
							{#if booking.status === 'requested' && booking.overlappingCount > 0}
								<!-- The one thing a tutor running a `declared` listing genuinely needs before
								     deciding: that this hour is contested. Confirming one request does NOT
								     auto-decline the others — they may be the same study group, or worth a
								     counter-offer — but nobody should have to decide blind. -->
								<p class="booking__clash">
									{m.booking_clashWarning({ count: booking.overlappingCount })}
								</p>
							{/if}
							<div class="booking__actions">
								{#if booking.status === 'requested'}
									<button type="button" class="primary" onclick={() => act('confirm', booking)}>
										{m.booking_confirm()}
									</button>
									<button type="button" onclick={() => act('decline', booking)}>
										{m.booking_decline()}
									</button>
								{:else if booking.status === 'confirmed'}
									<button type="button" onclick={() => act('complete', booking)}>
										{m.booking_markComplete()}
									</button>
									<button type="button" onclick={() => act('cancel', booking)}>
										{m.booking_cancel()}
									</button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tab === 'mine'}
			{#if mine.length === 0}
				<p class="muted">
					{m.booking_noneOfMine()}
					<a href={resolve('/services')}>{m.booking_findATutor()}</a>
				</p>
			{:else}
				<NewSinceNotice count={newMine} />
				<ul class="bookings">
					{#each mine as row (row.item.id)}
						{@const booking = row.item}
						<li class="booking" style="opacity: {opacityFor(row.confirmedAt)}">
							<div class="booking__head">
								<strong>{formatWhen(booking.startsAt)}</strong>
								<span class="pill pill--{booking.status}">{STATUS_LABEL[booking.status]()}</span>
							</div>
							<p class="booking__who">
								{m.booking_withTutor({
									tutor: booking.tutorDisplayName,
									listing: booking.serviceTitle
								})}
							</p>
							{#if booking.tutorNote}
								<p class="booking__note">&ldquo;{booking.tutorNote}&rdquo;</p>
							{/if}
							{#if booking.status === 'requested' || booking.status === 'confirmed'}
								<div class="booking__actions">
									<button type="button" onclick={() => act('cancel', booking)}>
										{m.booking_cancel()}
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<!-- The calendar comes first, and the two editors below it are what produce it: a tutor
			     opening this tab wants to see the shape of their week before deciding whether to change
			     a rule. Week and month only — there is no list view here, because the rules and
			     exceptions listed underneath already ARE the list, and offering a third rendering of
			     the same facts on the same screen would be noise. -->
			<section class="panel">
				<div class="panel-head">
					<h2>{m.booking_calendar_heading()}</h2>
					<!-- Only in the week view: the month grid is a summary with no time axis, so there is
					     nothing on it a window could be dragged along. -->
					{#if calendarView === 'week'}
						<button
							type="button"
							class={editing ? 'primary' : 'link'}
							onclick={() => (editing ? stopEditing() : startEditing())}
						>
							{editing ? m.booking_edit_done() : m.booking_edit_start()}
						</button>
					{/if}
				</div>
				<ViewSwitcher
					value={calendarView}
					options={[
						{ value: 'week', label: m.booking_view_week() },
						{ value: 'month', label: m.booking_view_month() }
					]}
					onchange={changeCalendarView}
					onprevious={() => stepCalendar(-1)}
					onnext={() => stepCalendar(1)}
					ontoday={() => (calendarFocus = isoDate(new Date()))}
					periodLabel={calendarPeriodLabel}
				/>

				{#if editing && calendarView === 'week'}
					<div class="editor">
						<!-- Named here rather than in the period label above it, which is `capitalize`d for
						     the locale month names it usually carries and turns any sentence into Title
						     Case. This is also the honest place for it: it is the week the SAVE lands on,
						     which is the editor's business rather than the calendar's. -->
						<p class="editor__week">{editWeekLabel}</p>
						<fieldset class="editor__scope">
							<legend>{m.booking_edit_scope()}</legend>
							<label>
								<input type="radio" value="week" bind:group={editScope} />
								<span>{m.booking_edit_scope_week()}</span>
							</label>
							<label>
								<input type="radio" value="pattern" bind:group={editScope} />
								<span>{m.booking_edit_scope_pattern()}</span>
							</label>
						</fieldset>
						<p class="muted">
							{editScope === 'week'
								? m.booking_edit_scopeHint_week()
								: m.booking_edit_scopeHint_pattern()}
						</p>

						{#if editScope === 'week'}
							<!-- Which of the two states this week is in, said before an edit rather than
							     discovered after one. "The first change gives it hours of its own" is the
							     whole behaviour, and nobody should have to find it out by trying. -->
							<p class="editor__state" class:editor__state--detached={editWeek?.detached}>
								{#if editWeek?.detached}
									{editWeek.sourceTemplateName
										? m.booking_edit_detachedFrom({ name: editWeek.sourceTemplateName })
										: m.booking_edit_detached()}
									<button type="button" class="link" disabled={busy} onclick={handleReattach}>
										{m.booking_edit_reattach()}
									</button>
								{:else}
									{m.booking_edit_following()}
								{/if}
							</p>
						{/if}

						<label class="editor__service">
							<span>{m.booking_edit_newWindowsApplyTo()}</span>
							<select bind:value={editServiceId}>
								<option value="">{m.booking_allListings()}</option>
								{#each myServices as service (service.id)}
									<option value={service.id}>{service.title}</option>
								{/each}
							</select>
						</label>

						<p class="muted">{m.booking_edit_dragHint()}</p>
						<p class="muted">{m.booking_edit_keyboardHint()}</p>
						{#if displayPrefs.weekStartsOn === 0}
							<p class="muted">{m.booking_edit_mondayNote()}</p>
						{/if}
						{#if editError}<p class="error">{editError}</p>{/if}
						{#if editNotice}<p class="notice">{editNotice}</p>{/if}
					</div>
				{/if}

				{#if scheduleFailed}
					<p class="error">{m.booking_loadFailed()}</p>
				{:else if !schedule}
					<p class="muted">{m.common_loading()}</p>
				{:else if calendarView === 'week'}
					<CalendarWeek
						days={gridDays}
						entries={calendarEntries}
						emptyLabel={editing ? undefined : m.booking_calendar_emptyWeek()}
						editable={editing}
						editWindows={editing ? editWindows : []}
						oncreatewindow={handleCreate}
						onmovewindow={handleMove}
						onremovewindow={handleRemove}
					/>
					{#if !editing}
						<p class="muted legend">{m.booking_calendar_legend()}</p>
					{/if}
				{:else}
					<CalendarMonth
						month={monthOf(calendarFocus)}
						days={calendarMonthDays}
						cellLabel={(day) => m.booking_calendar_daySessions({ count: day.count })}
						onselect={(date) => {
							calendarFocus = date;
							calendarView = 'week';
						}}
					/>
					<p class="muted">{m.booking_calendar_monthHint()}</p>
				{/if}
			</section>

			<!-- Both of these only exist while editing. They act on "the week you are looking at", which
			     is a phrase with no referent when nothing is being edited and the calendar might be
			     showing a month. -->
			{#if editing && calendarView === 'week'}
				<section class="panel">
					<h2>{m.booking_edit_repeatHeading()}</h2>
					<div class="inline-form">
						<label>
							<span>{m.booking_edit_repeatWeeks()}</span>
							<!-- `type="text" inputmode="numeric"` rather than `type="number"`: Svelte's
							     `bind:value` on a number input binds a real number or `undefined`, and this
							     project has shipped that exact mismatch twice (the node-governor grant form
							     and the material price field). Kept a string here and parsed at the edge. -->
							<input
								type="text"
								inputmode="numeric"
								pattern="[0-9]*"
								value={String(repeatWeeks)}
								oninput={(event) => {
									const parsed = Number(event.currentTarget.value.replace(/\D/g, ''));
									repeatWeeks = Math.min(52, Math.max(1, parsed || 1));
								}}
							/>
						</label>
						<label class="check">
							<input type="checkbox" bind:checked={repeatOverwrite} />
							<span>{m.booking_edit_overwrite()}</span>
						</label>
						<button type="button" class="primary" disabled={busy} onclick={handleRepeat}>
							{m.booking_edit_repeatButton()}
						</button>
					</div>
				</section>

				<section class="panel">
					<h2>{m.booking_edit_templatesHeading()}</h2>
					<p class="muted">{m.booking_edit_templatesHint()}</p>
					{#if templates.length === 0}
						<p class="muted">{m.booking_edit_noTemplates()}</p>
					{:else}
						<ul class="rules">
							{#each templates as template (template.id)}
								<li>
									<span>
										{template.name}
										<em>{m.booking_edit_templateWindows({ count: template.windows.length })}</em>
									</span>
									<span class="row-actions">
										<button
											type="button"
											class="link"
											disabled={busy}
											onclick={() => handleApplyTemplate(template)}
										>
											{m.booking_edit_applyTemplate()}
										</button>
										<button
											type="button"
											class="link"
											disabled={busy}
											onclick={() => handleDeleteTemplate(template.id)}
										>
											{m.common_delete()}
										</button>
									</span>
								</li>
							{/each}
						</ul>
					{/if}

					<form class="inline-form" onsubmit={handleSaveTemplate}>
						<label>
							<span>{m.booking_edit_templateName()}</span>
							<input type="text" bind:value={templateName} maxlength="100" required />
						</label>
						<button type="submit" class="primary" disabled={busy}>
							{m.booking_edit_saveTemplate()}
						</button>
					</form>
				</section>
			{/if}

			<section class="panel">
				<h2>{m.booking_weeklyHours()}</h2>
				<p class="muted">{m.booking_weeklyHoursHint()}</p>
				{#if rules.length === 0}
					<p class="muted">{m.booking_noRules()}</p>
				{:else}
					<ul class="rules">
						{#each rules as rule (rule.id)}
							<li>
								<span>
									{WEEKDAYS[rule.weekday]}
									{formatClock(rule.startTime)}–{formatClock(rule.endTime)}
									{#if rule.serviceId}
										<em>({serviceTitle(rule.serviceId) || m.booking_oneListingOnly()})</em>
									{/if}
								</span>
								<button type="button" class="link" onclick={() => removeRule(rule.id)}>
									{m.common_delete()}
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<form class="inline-form" onsubmit={addRule}>
					<label>
						<span>{m.booking_field_weekday()}</span>
						<select bind:value={newRule.weekday}>
							{#each weekdayOrder as day (day)}
								<option value={day}>{WEEKDAYS[day]}</option>
							{/each}
						</select>
					</label>
					<label>
						<span>{m.booking_field_from()}</span>
						<input type="time" bind:value={newRule.startTime} required />
					</label>
					<label>
						<span>{m.booking_field_to()}</span>
						<input type="time" bind:value={newRule.endTime} required />
					</label>
					<label>
						<span>{m.booking_field_appliesTo()}</span>
						<select bind:value={newRule.serviceId}>
							<!-- The default, and the common case: a person has one calendar, so a rule
							     applies to every listing they run unless they say otherwise. -->
							<option value="">{m.booking_allListings()}</option>
							{#each myServices as service (service.id)}
								<option value={service.id}>{service.title}</option>
							{/each}
						</select>
					</label>
					<button type="submit" class="primary">{m.booking_addRule()}</button>
				</form>
				{#if ruleError}
					<p class="error">{ruleError}</p>
				{/if}
			</section>

			<section class="panel">
				<h2>{m.booking_exceptions()}</h2>
				<p class="muted">{m.booking_exceptionsHint()}</p>
				{#if exceptions.length === 0}
					<p class="muted">{m.booking_noExceptions()}</p>
				{:else}
					<ul class="rules">
						{#each exceptions as exception (exception.id)}
							<li>
								<span>
									{exception.date}
									{#if exception.startTime && exception.endTime}
										{formatClock(exception.startTime)}–{formatClock(exception.endTime)}
									{:else}
										<em>{m.booking_allDay()}</em>
									{/if}
									<span class="pill pill--{exception.kind}">
										{exception.kind === 'open' ? m.booking_kind_open() : m.booking_kind_block()}
									</span>
									{#if exception.note}<em>{exception.note}</em>{/if}
								</span>
								<button type="button" class="link" onclick={() => removeException(exception.id)}>
									{m.common_delete()}
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<form class="inline-form" onsubmit={addException}>
					<label>
						<span>{m.booking_field_date()}</span>
						<input type="date" bind:value={newException.date} required />
					</label>
					<label>
						<span>{m.booking_field_kind()}</span>
						<select bind:value={newException.kind}>
							<option value="block">{m.booking_kind_block()}</option>
							<option value="open">{m.booking_kind_open()}</option>
						</select>
					</label>
					<label>
						<span>{m.booking_field_from()}</span>
						<input type="time" bind:value={newException.startTime} />
					</label>
					<label>
						<span>{m.booking_field_to()}</span>
						<input type="time" bind:value={newException.endTime} />
					</label>
					<label class="wide">
						<span>{m.booking_field_note()}</span>
						<input type="text" bind:value={newException.note} maxlength="200" />
					</label>
					<button type="submit" class="primary">{m.booking_addException()}</button>
				</form>
				<!-- Said out loud because it is the one asymmetry between the two kinds, and a tutor who
				     leaves the times blank on an opening gets a validation error they would otherwise
				     have to guess the reason for. -->
				<p class="muted">{m.booking_allDayBlockOnly()}</p>
				{#if exceptionError}
					<p class="error">{exceptionError}</p>
				{/if}
			</section>
		{/if}
	{/if}
</div>

<style lang="scss">
	@use '../../lib/styles/mixins' as mix;

	.page {
		max-width: 780px;
		margin: 0 auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		font-size: var(--font-size-xl);
	}
	h2 {
		font-size: var(--font-size-sm);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}
	.muted {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		a {
			color: var(--accent);
			font-weight: 600;
		}
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-sm);
		}
		button.active {
			background: var(--accent);
			color: var(--accent-contrast);
			border-color: var(--accent);
		}
	}
	.bookings {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}
	.booking {
		@include mix.card-surface;
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.booking__head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
	}
	.booking__who,
	.booking__note {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.booking__note {
		font-style: italic;
	}
	.booking__clash {
		@include mix.status-pill(var(--status-warning), var(--status-warning-bg));
		align-self: flex-start;
	}
	.booking__actions {
		display: flex;
		gap: var(--space-2);
		padding-top: var(--space-1);
		button {
			@include mix.button-secondary;
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-sm);
		}
		button.primary {
			@include mix.button-primary;
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-sm);
		}
	}
	.pill {
		font-size: var(--font-size-xs);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
		color: var(--text-secondary);
	}
	.pill--confirmed,
	.pill--open {
		background: var(--status-success-bg);
		color: var(--status-success);
	}
	.pill--declined,
	.pill--cancelled,
	.pill--block {
		background: var(--status-danger-bg);
		color: var(--status-danger);
	}
	.pill--requested {
		background: var(--status-warning-bg);
		color: var(--status-warning);
	}
	.panel {
		@include mix.card-surface;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.rules {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		list-style: none;
		padding: 0;
		font-size: var(--font-size-sm);
		li {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: var(--space-2);
		}
		em {
			color: var(--text-secondary);
		}
	}
	.link {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
		padding: 0;
		@include mix.focus-ring;
	}
	.inline-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: flex-end;
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-color);
		label {
			display: flex;
			flex-direction: column;
			gap: 2px;
			font-size: var(--font-size-xs);
			font-weight: 600;
		}
		label.wide {
			flex: 1 1 180px;
		}
		input,
		select {
			@include mix.focus-ring;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
			font-family: inherit;
			font-size: var(--font-size-sm);
		}
		button.primary {
			@include mix.button-primary;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-sm);
		}
	}
	.error {
		@include mix.status-pill(var(--status-danger), var(--status-danger-bg));
		align-self: flex-start;
	}
	.notice {
		@include mix.status-pill(var(--status-success), var(--status-success-bg));
		align-self: flex-start;
	}
	.legend {
		font-size: var(--font-size-xs);
	}

	/* ---- the schedule editor ------------------------------------------------------------------ */

	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2);
		h2 {
			margin: 0;
		}
		button.primary {
			@include mix.button-primary;
			padding: var(--space-1) var(--space-3);
			font-size: var(--font-size-sm);
		}
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-sm);
		background: var(--bg-surface-alt);
	}
	.editor__week {
		font-size: var(--font-size-sm);
		font-weight: 600;
	}
	.editor__scope {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		margin: 0;
		padding: 0;
		border: 0;
		legend {
			float: left;
			width: 100%;
			padding: 0;
			font-size: var(--font-size-xs);
			font-weight: 600;
		}
		label {
			display: flex;
			gap: var(--space-1);
			align-items: center;
			font-size: var(--font-size-sm);
		}
	}
	.editor__state {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: baseline;
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.editor__state--detached {
		color: var(--text-primary);
		font-weight: 600;
	}
	.editor__service {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		font-size: var(--font-size-xs);
		font-weight: 600;
		select {
			@include mix.focus-ring;
			padding: var(--space-1) var(--space-2);
			border: 1px solid var(--border-color);
			border-radius: var(--radius-sm);
			background: var(--bg-page);
			color: var(--text-primary);
			font-family: inherit;
			font-size: var(--font-size-sm);
			font-weight: 400;
		}
	}
	.inline-form label.check {
		flex-direction: row;
		align-items: center;
		gap: var(--space-1);
		font-weight: 400;
		font-size: var(--font-size-sm);
	}
	.row-actions {
		display: flex;
		gap: var(--space-2);
	}
</style>
