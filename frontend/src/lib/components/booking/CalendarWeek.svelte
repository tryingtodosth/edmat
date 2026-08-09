<script lang="ts">
	// A week laid out against a time axis — the ordinary shape of a timetable, where the height of a
	// block is how long it lasts and two things at the same time sit side by side.
	//
	// Generic over `CalendarEntry` (calendar.ts) and used by both sides of this feature: a student's
	// bookable slots and a tutor's own schedule are the same picture drawn from different data. The
	// component knows nothing about bookings, availability modes or services — each caller resolves
	// its own domain objects into entries first.
	import { m } from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	// `formatClock`, not `formatTimeOfDay`: both take a string, so nothing catches the difference at
	// compile time, but the second one parses an ISO INSTANT — `new Date('09:00')` is an Invalid Date
	// and Intl throws on it, which silently killed the whole editable layer the first time this was
	// driven in a browser.
	import { formatClock, formatHourMark } from '$lib/utils/datetime';
	import {
		BACKGROUND_TONES,
		type CalendarEntry,
		clamp,
		type EditableWindow,
		fromIsoDate,
		hourSpan,
		isoDate,
		layOutDay,
		type LaidOutEntry,
		MIN_WINDOW_MINUTES,
		minutesIntoDay,
		minutesToClock,
		snap,
		SNAP_MINUTES
	} from './calendar';

	let {
		days,
		entries,
		selectedId,
		onselect,
		emptyLabel,
		// ---- editing. Off unless a caller asks for it, so every existing use of this grid is
		// unchanged: no pointer handlers are attached and no extra layer is rendered.
		editable = false,
		editWindows = [],
		hours: hoursOverride,
		oncreatewindow,
		onmovewindow,
		onremovewindow
	}: {
		days: string[];
		entries: CalendarEntry[];
		selectedId?: string;
		onselect?: (entry: CalendarEntry) => void;
		emptyLabel?: string;
		/** Whether the windows below can be dragged, resized and deleted on the grid. */
		editable?: boolean;
		/** The windows being edited. Owned by the caller — this component holds only the in-flight
		 * gesture and reports the result, so there is one copy of the truth rather than two that have
		 * to be kept in step. */
		editWindows?: EditableWindow[];
		/** Force the visible hour range. Editing wants a wider grid than the content strictly needs,
		 * or there would be nowhere to drag a 7am window into on a day that currently starts at 9. */
		hours?: { from: number; to: number };
		oncreatewindow?: (date: string, startMinutes: number, endMinutes: number) => void;
		onmovewindow?: (id: string, date: string, startMinutes: number, endMinutes: number) => void;
		onremovewindow?: (id: string) => void;
	} = $props();

	let hours = $derived(
		hoursOverride ??
			hourSpan(
				[
					...entries.map((entry) => ({
						start: minutesIntoDay(entry.start),
						end: minutesIntoDay(entry.end)
					})),
					...editWindows.map((window) => ({
						start: window.startMinutes,
						end: window.endMinutes
					}))
				],
				editable ? { from: 7, to: 22 } : { from: 8, to: 20 }
			)
	);
	let minMinutes = $derived(hours.from * 60);
	let spanMinutes = $derived((hours.to - hours.from) * 60);
	let maxMinutes = $derived(minMinutes + spanMinutes);
	let hourMarks = $derived(
		Array.from({ length: hours.to - hours.from + 1 }, (_, index) => hours.from + index)
	);

	// Background bands are drawn per day in their own layer, un-laned: a published-hours band is
	// context, not an appointment, so it spans the full column width behind whatever sits on it.
	//
	// Suppressed entirely while editing, deliberately. In this app the only background tone is the
	// tutor's own published hours — which is exactly what the editable layer IS, arrived at from the
	// other side (the band has one-off exceptions already folded in; the editable layer is the hours
	// before them). Drawing both would show the same afternoon twice, in two slightly different
	// shapes, with no way to tell which one a drag was about to change.
	let backgroundByDay = $derived(
		new Map(
			days.map((day) => [
				day,
				editable
					? []
					: entries.filter((entry) => entry.date === day && BACKGROUND_TONES.includes(entry.tone))
			])
		)
	);
	let foregroundByDay = $derived(
		new Map(
			days.map((day) => [
				day,
				layOutDay(
					entries.filter((entry) => entry.date === day && !BACKGROUND_TONES.includes(entry.tone)),
					minMinutes,
					spanMinutes
				)
			])
		)
	);

	const today = isoDate(new Date());

	function dayHeading(date: string): string {
		return new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric' }).format(
			fromIsoDate(date)
		);
	}

	/** Where an hour's line — and its label — sits, as a percentage of the visible span. One function
	 * for both, so the axis can never disagree with the grid beside it. */
	function linePosition(hour: number): string {
		return `top:${((hour * 60 - minMinutes) / spanMinutes) * 100}%`;
	}

	function placementStyle(placed: LaidOutEntry): string {
		return [
			`top:${placed.top * 100}%`,
			`height:${placed.height * 100}%`,
			`left:${(placed.lane / placed.lanes) * 100}%`,
			`width:${(1 / placed.lanes) * 100}%`
		].join(';');
	}

	function bandStyle(entry: CalendarEntry): string {
		const start = minutesIntoDay(entry.start);
		const rawEnd = minutesIntoDay(entry.end);
		const end = rawEnd <= start ? 24 * 60 : rawEnd;
		const top = ((start - minMinutes) / spanMinutes) * 100;
		const height = ((end - start) / spanMinutes) * 100;
		return `top:${top}%;height:${height}%`;
	}

	// ---- dragging ------------------------------------------------------------------------------
	//
	// Pointer events rather than mouse events, so a finger works the same as a cursor — this grid is
	// horizontally scrollable on a phone precisely because people do use it there.
	//
	// Every gesture captures the pointer on ONE stable element (the grid body) rather than on
	// whichever block started it. Capturing on the block would be the obvious reading of the API and
	// is wrong here: a move that leaves the block behind — which is every move, immediately — would
	// stop delivering events to the element still tracking it.

	type Gesture =
		| { kind: 'create'; dayIndex: number; anchor: number; start: number; end: number }
		| { kind: 'move'; id: string; dayIndex: number; start: number; duration: number; grab: number }
		| {
				kind: 'resize';
				id: string;
				edge: 'start' | 'end';
				dayIndex: number;
				start: number;
				end: number;
		  };

	let gesture = $state<Gesture | null>(null);
	let bodyEl: HTMLElement | undefined;
	// Not `$state`: only ever read inside a pointer handler, never during render, so making the array
	// reactive would buy nothing and cost a re-render per column on mount.
	const columnEls: (HTMLElement | undefined)[] = [];

	/** Which day column and what time the pointer is over.
	 *
	 * Hit-tested against the columns' real rects rather than computed from the grid's own width and a
	 * hard-coded axis width — the axis is sized in `rem`, so any arithmetic here would be wrong the
	 * moment somebody changes the root font size or a browser rounds a fractional column differently.
	 *
	 * A pointer dragged off the side of the grid resolves to the NEAREST column rather than to
	 * nothing: releasing outside is a normal way to end a drag, and the alternative is a gesture that
	 * silently does nothing when the pointer strays a few pixels past Sunday.
	 */
	function locate(event: PointerEvent): { dayIndex: number; minutes: number } {
		let dayIndex = 0;
		let nearest = Number.POSITIVE_INFINITY;
		let rect: DOMRect | undefined;
		for (let index = 0; index < days.length; index += 1) {
			const element = columnEls[index];
			if (!element) continue;
			const bounds = element.getBoundingClientRect();
			const distance =
				event.clientX < bounds.left
					? bounds.left - event.clientX
					: event.clientX > bounds.right
						? event.clientX - bounds.right
						: 0;
			if (distance < nearest) {
				nearest = distance;
				dayIndex = index;
				rect = bounds;
			}
			if (distance === 0) break;
		}
		if (!rect) return { dayIndex: 0, minutes: minMinutes };
		const fraction = (event.clientY - rect.top) / rect.height;
		return {
			dayIndex,
			minutes: clamp(minMinutes + fraction * spanMinutes, minMinutes, maxMinutes)
		};
	}

	function capture(event: PointerEvent) {
		// preventDefault stops the browser turning the drag into a text selection or a scroll gesture,
		// both of which make the grid feel broken rather than draggable.
		event.preventDefault();
		bodyEl?.setPointerCapture(event.pointerId);
	}

	function beginCreate(event: PointerEvent, dayIndex: number) {
		if (!editable || event.button !== 0) return;
		const anchor = snap(locate(event).minutes);
		gesture = { kind: 'create', dayIndex, anchor, start: anchor, end: anchor };
		capture(event);
	}

	function beginMove(event: PointerEvent, window: EditableWindow, dayIndex: number) {
		if (!editable || event.button !== 0) return;
		// Or the column underneath would start drawing a new window at the same moment.
		event.stopPropagation();
		gesture = {
			kind: 'move',
			id: window.id,
			dayIndex,
			start: window.startMinutes,
			duration: window.endMinutes - window.startMinutes,
			// Where in the block the drag started, so it does not jump so its top is under the cursor.
			grab: locate(event).minutes - window.startMinutes
		};
		capture(event);
	}

	function beginResize(
		event: PointerEvent,
		window: EditableWindow,
		dayIndex: number,
		edge: 'start' | 'end'
	) {
		if (!editable || event.button !== 0) return;
		event.stopPropagation();
		gesture = {
			kind: 'resize',
			id: window.id,
			edge,
			dayIndex,
			start: window.startMinutes,
			end: window.endMinutes
		};
		capture(event);
	}

	function onPointerMove(event: PointerEvent) {
		const current = gesture;
		if (!current) return;
		const { dayIndex, minutes } = locate(event);
		const at = snap(minutes);

		if (current.kind === 'create') {
			// The day is fixed at the one the drag started in. A window belongs to a day, so dragging
			// sideways while drawing should not smear one across three of them.
			gesture = {
				...current,
				start: Math.min(current.anchor, at),
				end: Math.max(current.anchor, at)
			};
		} else if (current.kind === 'move') {
			gesture = {
				...current,
				dayIndex,
				start: clamp(snap(minutes - current.grab), minMinutes, maxMinutes - current.duration)
			};
		} else if (current.edge === 'end') {
			gesture = { ...current, end: clamp(at, current.start + MIN_WINDOW_MINUTES, maxMinutes) };
		} else {
			gesture = { ...current, start: clamp(at, minMinutes, current.end - MIN_WINDOW_MINUTES) };
		}
	}

	function onPointerUp() {
		const current = gesture;
		if (!current) return;
		gesture = null;
		if (current.kind === 'create') {
			// A drag too short to be a real window is read as a mis-click and dropped, rather than
			// writing a one-minute window somebody then has to hunt down and delete.
			if (current.end - current.start >= MIN_WINDOW_MINUTES) {
				oncreatewindow?.(days[current.dayIndex], current.start, current.end);
			}
		} else if (current.kind === 'move') {
			onmovewindow?.(
				current.id,
				days[current.dayIndex],
				current.start,
				current.start + current.duration
			);
		} else {
			onmovewindow?.(current.id, days[current.dayIndex], current.start, current.end);
		}
	}

	/** The windows as they should be drawn right now — the caller's list, with the gesture in flight
	 * applied on top. Kept here rather than pushed to the caller on every pointer move so a drag is a
	 * local, 60fps concern and the caller only hears about the result. */
	let liveWindows = $derived.by(() => {
		const current = gesture;
		if (!current) return editWindows;
		if (current.kind === 'create') {
			return current.end - current.start < SNAP_MINUTES
				? editWindows
				: [
						...editWindows,
						{
							id: '__drafting__',
							date: days[current.dayIndex],
							startMinutes: current.start,
							endMinutes: current.end
						}
					];
		}
		return editWindows.map((window) =>
			window.id !== current.id
				? window
				: {
						...window,
						date: days[current.dayIndex],
						startMinutes: current.start,
						endMinutes: current.kind === 'move' ? current.start + current.duration : current.end
					}
		);
	});

	let editByDay = $derived(
		new Map(days.map((day) => [day, liveWindows.filter((window) => window.date === day)]))
	);

	function windowStyle(window: EditableWindow): string {
		const top = ((window.startMinutes - minMinutes) / spanMinutes) * 100;
		const height = ((window.endMinutes - window.startMinutes) / spanMinutes) * 100;
		// A floor, so a 15-minute window is still big enough to grab rather than a hairline.
		return `top:${top}%;height:${Math.max(height, 2.5)}%`;
	}

	function windowLabel(window: EditableWindow): string {
		return `${formatClock(minutesToClock(window.startMinutes))}–${formatClock(minutesToClock(window.endMinutes))}`;
	}

	/** Move, resize and delete from the keyboard.
	 *
	 * Not an afterthought bolted beside a mouse-only feature: dragging is one way to say this and the
	 * arrow keys are another, and a schedule editor that could only be operated with a pointer would
	 * be unusable for exactly the people who most need their hours written down correctly. Creating
	 * has its own keyboard route — Enter on a column, and the precise form below the grid.
	 */
	function onWindowKeydown(event: KeyboardEvent, window: EditableWindow) {
		if (!editable) return;
		const dayIndex = days.indexOf(window.date);
		const duration = window.endMinutes - window.startMinutes;
		let handled = true;

		if (event.key === 'Delete' || event.key === 'Backspace') {
			onremovewindow?.(window.id);
		} else if (event.key === 'ArrowUp' && event.shiftKey) {
			onmovewindow?.(
				window.id,
				window.date,
				window.startMinutes,
				Math.max(window.startMinutes + MIN_WINDOW_MINUTES, window.endMinutes - SNAP_MINUTES)
			);
		} else if (event.key === 'ArrowDown' && event.shiftKey) {
			onmovewindow?.(
				window.id,
				window.date,
				window.startMinutes,
				Math.min(maxMinutes, window.endMinutes + SNAP_MINUTES)
			);
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			const step = event.key === 'ArrowUp' ? -SNAP_MINUTES : SNAP_MINUTES;
			const start = clamp(window.startMinutes + step, minMinutes, maxMinutes - duration);
			onmovewindow?.(window.id, window.date, start, start + duration);
		} else if (event.key === 'ArrowLeft' && dayIndex > 0) {
			onmovewindow?.(window.id, days[dayIndex - 1], window.startMinutes, window.endMinutes);
		} else if (event.key === 'ArrowRight' && dayIndex >= 0 && dayIndex < days.length - 1) {
			onmovewindow?.(window.id, days[dayIndex + 1], window.startMinutes, window.endMinutes);
		} else {
			handled = false;
		}
		if (handled) event.preventDefault();
	}

	/** Enter or Space on a day column adds an hour at the first time on that day that is still free.
	 *
	 * Deterministic rather than "wherever the focus ring happens to be", because a keyboard user has
	 * no cursor position to mean — and useful rather than token: on an empty day it lands on the first
	 * hour of the visible range, and on a busy one it finds the gap. */
	function addToDay(day: string) {
		if (!editable) return;
		const taken = [...(editByDay.get(day) ?? [])].sort((a, b) => a.startMinutes - b.startMinutes);
		let start = minMinutes;
		for (const window of taken) {
			if (window.startMinutes - start >= 60) break;
			start = Math.max(start, window.endMinutes);
		}
		if (start + 60 > maxMinutes) return;
		oncreatewindow?.(day, start, start + 60);
	}
</script>

<!-- A gesture is followed on the window rather than on the grid. The grid body is not an interactive
     element — a drag is STARTED by a real button (a day column, or a window's own body) and the body
     only sees the rest of it because it holds the pointer capture. Putting move/up handlers on it
     would mean either giving a plain container an ARIA role it does not deserve, or silencing a lint
     rule that is right. It also means a pointer released outside the grid entirely still ends the
     gesture, instead of leaving a block stuck to the cursor.

     Attached for as long as editing is on, NOT only while a gesture is in flight, and that is a real
     fix rather than a simplification. Binding them to `gesture` makes attaching them a reactive
     effect that runs AFTER the pointerdown handler which set it — so every pointermove dispatched
     before Svelte's next flush is lost, and a drag whose events all arrive in one tick registers as
     a click on the spot. A human mouse spreads its moves over frames and hides this; synthetic input
     does not, and it showed up the first time these gestures were driven in a browser. The handlers
     return immediately when there is no gesture, so the cost of leaving them attached is a null
     check per pointer move. -->
<svelte:window
	onpointermove={editable ? onPointerMove : undefined}
	onpointerup={editable ? onPointerUp : undefined}
	onpointercancel={editable ? () => (gesture = null) : undefined}
/>

{#snippet entryBody(entry: CalendarEntry)}
	<span class="week__entry-label">{entry.label}</span>
	{#if entry.sublabel}
		<span class="week__entry-sub">{entry.sublabel}</span>
	{/if}
{/snippet}

<div class="week">
	{#if entries.length === 0 && emptyLabel}
		<p class="empty">{emptyLabel}</p>
	{/if}

	<!-- Horizontally scrollable rather than reflowed on a narrow screen. Seven columns against a time
	     axis genuinely needs the width; collapsing it to a stack would produce the list view, which is
	     already offered as its own choice next to this one. -->
	<div class="week__scroll">
		<div class="week__head" style="--columns:{days.length}">
			<span class="week__axis-head" aria-hidden="true"></span>
			{#each days as day (day)}
				<span class="week__day-head" class:week__day-head--today={day === today}>
					{dayHeading(day)}
				</span>
			{/each}
		</div>

		<div
			class="week__body"
			class:week__body--editing={editable}
			style="--columns:{days.length};--rows:{hours.to - hours.from}"
			bind:this={bodyEl}
		>
			<div class="week__axis" aria-hidden="true">
				<!-- The same marks the hour lines use, positioned the same way (a percentage of the
				     visible span, from an inline style) so the label and its line cannot drift apart —
				     they did, when the labels were positioned by an nth-child rule in the stylesheet
				     that had to be kept in step with the row height by hand. The last mark is dropped:
				     it would sit on the bottom edge with nothing below it, and be clipped. -->
				{#each hourMarks.slice(0, -1) as hour (hour)}
					<span class="week__hour" style={linePosition(hour)}>{formatHourMark(hour)}</span>
				{/each}
			</div>

			{#each days as day, dayIndex (day)}
				<div
					class="week__column"
					class:week__column--today={day === today}
					bind:this={columnEls[dayIndex]}
				>
					<!-- The hour lines are the column's own background, so they cannot drift out of step
					     with the axis labels beside them. -->
					{#each hourMarks.slice(0, -1) as hour (hour)}
						<span class="week__line" style={linePosition(hour)}></span>
					{/each}

					{#each backgroundByDay.get(day) ?? [] as band (band.id)}
						<span class="week__band" style={bandStyle(band)} title={band.label}></span>
					{/each}

					{#if editable}
						<!-- A real <button> filling the column, not a <div> with a pointer handler. It IS an
						     interactive surface — drag anywhere on it to draw hours — so saying so in the
						     markup is honest rather than a way around a lint rule, and it buys the thing a
						     div could never have: Enter adds an hour from the keyboard, so drawing hours is
						     not a pointer-only capability. Rendered before the blocks so they sit on top. -->
						<button
							type="button"
							class="week__canvas"
							aria-label={m.booking_edit_addOnDay({ day: dayHeading(day) })}
							onpointerdown={(event) => beginCreate(event, dayIndex)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									addToDay(day);
								}
							}}
						></button>

						{#each editByDay.get(day) ?? [] as window (window.id)}
							<div
								class="week__window"
								class:week__window--drafting={window.id === '__drafting__'}
								class:week__window--dragging={gesture?.kind !== 'create' &&
									gesture?.id === window.id}
								style={windowStyle(window)}
							>
								<!-- The block itself is the focusable, draggable thing; the two handles and the
								     remove button sit on top of it. Nested interactive elements inside a
								     <button> would be invalid, so the body is a button and the rest are its
								     siblings within a plain positioned wrapper. -->
								<button
									type="button"
									class="week__window-body"
									aria-label={m.booking_edit_windowLabel({
										day: dayHeading(window.date),
										time: windowLabel(window)
									})}
									onpointerdown={(event) => beginMove(event, window, dayIndex)}
									onkeydown={(event) => onWindowKeydown(event, window)}
								>
									<span class="week__window-time">{windowLabel(window)}</span>
									{#if window.label}
										<span class="week__window-sub">{window.label}</span>
									{/if}
								</button>
								<span
									class="week__handle week__handle--start"
									onpointerdown={(event) => beginResize(event, window, dayIndex, 'start')}
									role="presentation"
								></span>
								<span
									class="week__handle week__handle--end"
									onpointerdown={(event) => beginResize(event, window, dayIndex, 'end')}
									role="presentation"
								></span>
								{#if window.id !== '__drafting__'}
									<button
										type="button"
										class="week__window-remove"
										aria-label={m.booking_edit_removeWindow({ time: windowLabel(window) })}
										onpointerdown={(event) => event.stopPropagation()}
										onclick={() => onremovewindow?.(window.id)}>×</button
									>
								{/if}
							</div>
						{/each}
					{/if}

					{#each foregroundByDay.get(day) ?? [] as placed (placed.entry.id)}
						{@const entry = placed.entry}
						<!-- A real <button> when it does something and a plain <div> when it does not — two
						     branches rather than one `<svelte:element>` switching between them. A bookable
						     slot has to be focusable and announced as pressable, and a session somebody is
						     merely looking at must not pretend to be; a dynamic tag leaves the compiler
						     unable to check either, which it says so about. The shared innards live in one
						     snippet, so the two branches cannot drift. -->
						{#if entry.interactive && onselect}
							<button
								type="button"
								class="week__entry week__entry--{entry.tone}"
								class:week__entry--selected={entry.id === selectedId}
								aria-pressed={entry.id === selectedId}
								style={placementStyle(placed)}
								onclick={() => onselect(entry)}
							>
								{@render entryBody(entry)}
							</button>
						{:else}
							<div class="week__entry week__entry--{entry.tone}" style={placementStyle(placed)}>
								{@render entryBody(entry)}
							</div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	</div>

	<p class="week__hint">{m.booking_calendar_scrollHint()}</p>
</div>

<style lang="scss">
	@use '../../styles/mixins' as mix;

	.week {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.empty {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}
	.week__scroll {
		overflow-x: auto;
	}
	.week__head,
	.week__body {
		display: grid;
		grid-template-columns: 3.5rem repeat(var(--columns), minmax(5.5rem, 1fr));
		min-width: 42rem;
	}
	.week__head {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--bg-surface);
	}
	.week__day-head {
		padding: var(--space-1) 0;
		text-align: center;
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: capitalize;
		border-bottom: 1px solid var(--border-color);
	}
	.week__day-head--today {
		color: var(--accent);
	}
	.week__axis-head {
		border-bottom: 1px solid var(--border-color);
	}
	.week__body {
		/* One row per hour, so the grid's own height follows how many hours are actually in view
		   rather than a fixed pixel figure that would squash a long day. */
		height: calc(var(--rows) * 3rem);
	}
	.week__axis {
		position: relative;
		border-right: 1px solid var(--border-color);
	}
	.week__hour {
		position: absolute;
		right: var(--space-1);
		/* Sits just under its own line rather than centred on it — centring pulled the first label
		   half-way out of the top of the grid, where it was clipped. This is also how a paper
		   timetable reads: the label belongs to the hour that starts there. */
		padding-top: 2px;
		font-size: var(--font-size-xs);
		line-height: 1;
		color: var(--text-secondary);
	}
	.week__column {
		position: relative;
		border-right: 1px solid var(--border-color);
	}
	.week__column--today {
		background: var(--bg-surface-alt);
	}
	.week__line {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--border-color);
		opacity: 0.5;
	}
	.week__band {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--accent);
		opacity: 0.12;
		border-radius: var(--radius-sm);
	}
	.week__entry {
		@include mix.focus-ring;
		position: absolute;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 2px 4px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		font-family: inherit;
		font-size: var(--font-size-xs);
		text-align: left;
		line-height: 1.15;
	}
	button.week__entry {
		cursor: pointer;
	}
	.week__entry-label {
		font-weight: 600;
	}
	.week__entry-sub {
		opacity: 0.85;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.week__entry--free {
		background: var(--bg-surface);
		border-color: var(--accent);
		color: var(--accent);
	}
	.week__entry--selected {
		background: var(--accent);
		color: var(--accent-contrast);
	}
	.week__entry--requested {
		background: var(--status-warning-bg);
		border-color: var(--status-warning);
		color: var(--status-warning);
	}
	.week__entry--confirmed {
		background: var(--status-success-bg);
		border-color: var(--status-success);
		color: var(--status-success);
	}
	.week__entry--event {
		background: var(--bg-surface);
		border-style: dashed;
		border-color: var(--accent);
		color: var(--accent);
	}
	.week__entry--settled {
		background: var(--bg-surface-alt);
		border-color: var(--border-color);
		color: var(--text-secondary);
		text-decoration: line-through;
	}
	/* ---- editing ---------------------------------------------------------------------------- */

	.week__body--editing {
		/* Without this a drag on a touch screen scrolls the grid sideways instead of drawing, and on a
		   desktop it selects the text in every block it crosses. `preventDefault` in the handler covers
		   the mouse; only the CSS reaches the browser's own touch scrolling, which is decided before
		   any handler runs. */
		touch-action: none;
		user-select: none;
	}
	.week__canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: crosshair;
	}
	.week__canvas:focus-visible {
		/* Inset rather than the shared focus-ring mixin: the ring belongs INSIDE the column, or seven
		   adjacent full-height outlines overlap each other and the day borders. */
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.week__window {
		position: absolute;
		left: 2px;
		right: 2px;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--accent-contrast);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
	}
	.week__window--drafting {
		/* The block being drawn right now: same shape, clearly provisional, and never in the way of a
		   pointer that is mid-gesture. */
		opacity: 0.6;
		pointer-events: none;
	}
	.week__window--dragging {
		opacity: 0.85;
		z-index: 2;
	}
	.week__window-body {
		@include mix.focus-ring;
		display: flex;
		flex-direction: column;
		gap: 1px;
		width: 100%;
		height: 100%;
		/* A little more at the top than the bottom, so the label clears the upper grab line. */
		padding: 5px 4px 2px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: inherit;
		font-family: inherit;
		font-size: var(--font-size-xs);
		line-height: 1.15;
		text-align: left;
		overflow: hidden;
		cursor: grab;
	}
	.week__window-body:active {
		cursor: grabbing;
	}
	.week__window-time {
		font-weight: 600;
	}
	.week__window-sub {
		opacity: 0.85;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.week__handle {
		position: absolute;
		left: 0;
		right: 0;
		/* Comfortably taller than it looks: a 2px grab target is a 2px grab target, and the whole
		   gesture fails silently when it is missed. */
		height: 8px;
		cursor: ns-resize;
	}
	.week__handle--start {
		top: -2px;
	}
	.week__handle--end {
		bottom: -2px;
	}
	/* Each grabber's line is pinned to its OWN edge of the block rather than both being offset from
	   the top of the handle. Offsetting both put the upper line one pixel into the block, directly
	   underneath the time label, where it was invisible — so the top edge looked unresizable while
	   the bottom one did not. */
	.week__handle::after {
		content: '';
		position: absolute;
		left: 25%;
		right: 25%;
		border-top: 2px solid var(--accent-contrast);
		opacity: 0.55;
	}
	.week__handle--start::after {
		top: 3px;
	}
	.week__handle--end::after {
		bottom: 3px;
	}
	.week__window-remove {
		position: absolute;
		top: 0;
		right: 0;
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: rgb(0 0 0 / 0.25);
		color: inherit;
		font-size: var(--font-size-sm);
		line-height: 1;
		cursor: pointer;
		/* Hidden until the block is hovered or something inside it has focus. Drawn permanently it
		   sat on top of the time it was next to — "14:15–16:15×" — and a 15-minute window has no room
		   for both at once. Nothing is lost by hiding it: Delete removes a focused block, the hint
		   above the grid says so, and focus-within is what makes it appear for a keyboard or a touch
		   user, neither of whom ever hovers. */
		opacity: 0;
	}
	.week__window:hover .week__window-remove,
	.week__window:focus-within .week__window-remove {
		opacity: 0.9;
	}
	.week__window-remove:hover,
	.week__window-remove:focus-visible {
		opacity: 1;
		background: rgb(0 0 0 / 0.45);
	}

	.week__hint {
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}
	@media (min-width: 720px) {
		.week__hint {
			display: none;
		}
	}
</style>
