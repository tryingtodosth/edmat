# EdMat prototype — usability review

Scope: `public/app/shell.js`, `public/app/core.js`, `public/app/i18n.js`, every screen in
`public/app/screens/`, `public/app/app.css`, and the design-system bundle where a screen depends on it.
Method: static read of every screen, `npm run smoke` (32/32 clean), headless screenshots at **390 / 768 / 1280 px**
in **pl** and **en**, and the ten journeys below driven end to end against a live `EDMAT_DEV=1` server
(API exercised through `tests/helpers.js` in throwaway scripts).

Reviewer's bias, stated up front: a teacher has ~30 s between bells, one hand on the mouse, a projector
showing the screen to 25 children. A parent has a phone, one thumb, and 40 seconds in a corridor.
Everything below is graded against that, not against a desk with two monitors.

---

## Findings

| id | sev | screen | step where it fails | what happens | fix |
| --- | --- | --- | --- | --- | --- |
| **B1** | blocker | `/lekcja` attendance roster (phone, ≤ 720 px) | teacher marks a pupil `u` / `rs` / `w` | `.ed-roster { overflow: hidden }` clips the 7-chip status group; at 390 px only `ob nb sp zw` are visible and there is no scrollbar, so "usprawiedliwiony", "reprezentuje szkołę" and "wycieczka" **cannot be set on a phone at all**. The roster also forces the whole page wider than the viewport, so every card on the screen is cut on the right. | `app.css`: let the chip group wrap below 720 px and give flex/grid children `min-width: 0` so nothing forces page-level horizontal scroll. **Done.** |
| **B2** | blocker | every screen, top bar (phone) | any navigation on a phone | `.ed-topbar nav { flex: 1 1 auto; overflow-x: auto }` sits next to a `margin-left: auto` right group, so at 390 px the nav collapses to ~1 character ("D…"). A parent cannot reach Wiadomości/Spotkania/Ustawienia; a principal has 8 sections hidden in a 20 px strip. `.app-nav-more` exists in `app.css` but is `display: none` and unused — the mobile nav was planned and never built. | `app.css`: below 720 px wrap the top bar so the nav gets its own full-width, horizontally scrollable row; raise nav link height to `--touch`. **Done.** |
| **B3** | blocker | shell announcement dialog (`shell.js:45`) | evaluator acks a principal announcement while offline / after the session expired | `A.api.post('/api/announcements/:id/ack').then(loadSession)` has **no `.catch`**. The dialog is `blocking: true`, so Escape is disabled and there is no close button and no second action. A failed ack leaves the evaluator staring at a dialog that swallows every click, with the rest of the app behind an opaque scrim. | Shell change — **patch proposed below** (add `.catch`, show the error inside the dialog, add a "Później" secondary action that hides it for this session). |
| **B4** | blocker | `/lekcja` → `/oceny` ("Oceny z tej lekcji", "Wystaw ocenę") | teacher jumps from the lesson to the grade book | `teacher-lesson.js` links to `#/oceny?lesson=<id>` (and `&student=<id>` from the homework review dialog). `teacher-grades.js` only reads `klasa`, `semestr`, `tab` — **`lesson` and `student` are ignored**, so the teacher lands on whatever `pairs[0]` happens to be. For `j.nowak` (one pair) it looks fine; for any teacher with two classes it silently opens the wrong grade book and the next grade goes to the wrong class. | Link with `klasa=<classId>|<subjectId>` + `student=<id>` and honour `student` in the editor; add a "← back to the lesson" link. **Done** (`teacher-lesson.js`, `teacher-grades.js`). |
| **B5** | blocker | `/uczen` → Oceny | student opens a grade that has a comment | `GradeCell` gets `comment: !!x.comment`, so the cell shows a *dot* meaning "there is a comment" and the text is never rendered anywhere on the screen. `/api/student/grades` does return the text (3 comments in the seed) and the **parent** screen prints them. The student can see that the teacher wrote something and cannot read it. Journey 5 step 3 is impossible. | Render the comment lines under the subject tab, exactly as `parent.js` does. **Done** (`student.js`). |
| **M1** | major | `/lekcja` attendance | teacher clicks "Wszyscy obecni" *inside* the roster header | The design-system roster ships its own primary "Wszyscy obecni" button that only fills the grid — it does **not** save. Two lines below, the screen has "Wszyscy obecni i zapisz", which does. Same words, same colour, different consequence; the teacher who uses the first one and walks out has recorded nothing, and nothing on the screen says so. | Track a dirty flag against the saved data and show a standing "unsaved changes" warning next to the Save button. **Done** (`teacher-lesson.js`). Longer term: the DS roster button should be `variant: 'secondary'` and say "Zaznacz wszystkich" — proposed below. |
| **M2** | major | `/oceny` grade grid + editor | clicking a grid cell, and every student in bulk mode | `pick()` updates the editor state but never moves focus, and the bulk advance remounts `GradeInput` (its `key` contains `studentId`) without focusing it. Entering a whole class therefore costs **one mouse click per pupil** even with "Wpis seryjny" on. This is the single biggest cost in journey 2. | Focus the `GradeInput` after a cell pick and after each bulk advance. **Done** (`teacher-grades.js`). |
| **M3** | major | English UI, all screens | teacher switches `/oceny` → `/wychowawca` | The same Polish `semestr` is "**Semester**" on `/oceny` (`common.semester`), `/administracja` and `/sekretariat`, and "**Term**" on `/wychowawca` (`hr.sub.term`, `hr.close.btn` "Close term", `hr.locked.title`) and `/dyrekcja` (`pr.sv.currSem`). Two words for one legal object in a product whose whole point is a legally-defined record. | Standardise on "semester" (matches `common.semester`, which the shared dictionary already owns). **Done** (`homeroom.js`, `principal.js`). |
| **M4** | major | every `type="date"` field, both languages | teacher opens `/dyrekcja` → "Nieobecność od" | Native date inputs render in the **browser's** locale, not `document.lang`. In the shipped headless Chromium the Polish UI shows `mm/dd/yyyy` placeholders and `10/23/2026` values — a US format inside a Polish logbook. There is no locale override a page can set. | Client-side mitigation: show the chosen date back in the UI locale (`A.fmtDate`) as the field hint, plus an explicit `DD.MM.RRRR` / `DD/MM/YYYY` format hint. **Done** on the journey-critical fields (`teacher-lesson`, `teacher-grades`, `principal`, `parent`, `student`); a shared `A.dateHint()` helper is proposed for `core.js` so the rest can follow. |
| **M5** | major | `/wiadomosci` (phone) | parent or teacher taps a message | The list and the detail are two columns of a `grid-2`; below 720 px they stack, so the detail renders **after the whole list**. Tapping a message looks like nothing happened, and once you scroll down there is no way back to the list. | Scroll the detail into view on narrow screens and add a "← Wróć do listy" link above it. **Done** (`messages.js`). |
| **M6** | major | `/rodzic` (phone) | parent's four daily tasks | Nine `card` sections stacked vertically: Dzisiaj, Oceny, Frekwencja, Usprawiedliwienia, Wiadomości, Płatności, Zgody, Spotkania, Ustawienia. Submitting an excuse is section 4, paying lunch is section 6, acking a warning is section 5. Every task means thumb-scrolling past the grade wall; the sections have `id`s but nothing links to them. Measured page height at 390 px: **> 2 200 px and still cut**. | Sticky row of section jump chips under the child switcher, and direct action buttons inside the top alerts ("Wyślij usprawiedliwienie", "Potwierdź odczyt"). **Done** (`parent.js`, `app.css`). |
| **M7** | major | `/uczen` → "Wyślij zadanie domowe" | student attaches a photo from the phone camera | No client-side size check. A 12 MB photo is base64-encoded into memory, POSTed, rejected by the server with `413 attachment_too_large`, and the message is shown **only in a toast that disappears after 8 s**. The oversized file stays in the list, so pressing Send again fails again, identically. | Check `file.size` against `hw.maxAttachmentMB` before adding, refuse the file with a persistent `Alert`, and keep the rest of the selection. **Done** (`student.js`). |
| **M8** | major | `/wychowawca`, `/dyrekcja`, `/wiadomosci` | language switch mid-session; also reload / bookmark / browser Back | These keep the active tab in local `React.useState`. The shell remounts the screen with `key: locale` on every language change, so the homeroom teacher halfway through approving excuses is dumped back on "Klasyfikacja", and the principal back on "Zastępstwa". `/oceny`, `/administracja` and `/sekretariat` already write the tab to the URL — so the behaviour is inconsistent between screens as well as wrong. | Write the tab to the query string like the other three. **Done** (`homeroom.js`, `principal.js`, `messages.js`). |
| **M9** | major | `/wychowawca` → Usprawiedliwienia (keyboard) | after approving or rejecting one request | `E.Dialog` restores focus to the element that opened it. That element is the row's "Odrzuć" button, which becomes `disabled` the moment the decision lands, so `prev.focus()` is a no-op and focus falls back to `<body>`. A keyboard user has to Tab from the top of the document again for every request. | Move focus to the live-region status line after each decision. **Done** (`homeroom.js`). |
| **M10** | major | `/rodzic` pay / excuse / consent dialogs, `/wiadomosci` compose | double tap on a slow connection | None of these primary buttons has a `loading` / `disabled` guard, so a second tap fires a second POST. The payment endpoint does answer `409 already_paid` (good), but the excuse endpoint happily creates a second identical request, and the parent sees two rows. | Add busy state to every dialog's primary action. **Done** (`parent.js`, `messages.js`). |
| **M11** | major | `/lekcja` attendance, late minutes | teacher fat-fingers the minutes box | The DS input is `type="number" min=1 max=44`, but `max` does not stop typing and the screen sends whatever is there. Verified against the API: `minutes: 999` is stored with `200 OK`. The register then shows "sp 999 min" on a 45-minute lesson. | Clamp to 1–44 in `save()`. **Done** (`teacher-lesson.js`). |
| **M12** | major | `/dyrekcja` → Komunikaty → preview | principal previews an announcement before publishing | The preview uses `E.Dialog { blocking: true }`, which disables Escape and paints the red "crisis" top border. A *preview* is not a crisis and must be dismissible with Escape. | Drop `blocking`, add `onClose`. **Done** (`principal.js`). |
| **M13** | major | `/wychowawca` → Usprawiedliwienia | approving a batch | Bulk approve exists (good) but there is no "select all pending", so five approvals cost five ticks plus one button. | Add a "Zaznacz wszystkie oczekujące" / clear-selection control. **Done** (`homeroom.js`). |
| **M14** | major | top bar, teacher role | reaching `/wychowawca` | Nav order is `Dziennik 10 · Oceny 20 · Kursy 25 · Spotkania 26 · Wychowawca 30 · Moduły 60 · Wiadomości 90`. The two screens a homeroom teacher opens every single day are separated by two they open a few times a term, and `Alt+3` lands on Kursy. | Move Kursy to 70 and Spotkania to 75. **Done** (`courses.js`, `meetings.js`). |
| **M15** | major | `/wiadomosci` ack, `/uczen` → "Zablokuj dostęp rodzica" | the write fails | `A.api.post(...).then(...)` with no `.catch`: the button simply does nothing and the user has no idea whether the legally-significant acknowledgement or the adult student's objection was recorded. | Add `.catch` + danger toast. **Done** (`messages.js`, `student.js`). |
| **M16** | major | first-run wizard, steps 2 and 3 | school office pastes 20 rows of student CSV | Teachers and students imported **straight into the database with no dry run**, while step 4 (timetable) had "Sprawdź (bez zapisu)" — same job, two different contracts. Validation was partial too: a teacher row with `homeroomOf: "mgr"` created a **phantom class called "mgr"** with no error. | The endpoints gained `dryRun`, `warnings`, `importId` and `POST /api/setup/imports/:id/undo` server-side while this review was running. The wizard now uses them: both CSV steps get a "Sprawdź (bez zapisu)" button, a warnings card, and "Cofnij ten import" on a committed batch. **Done** (`setup.js`). |
| m1 | minor | first-run wizard, step 3 | parent registration-code table | `{ key: 'code', title: 'Kod' }` is a hardcoded Polish literal in `setup.js` — the only untranslated leftover found outside deliberately-Polish domain data. | `t('sw.k.code')`. **Done.** |
| m2 | minor | `/ustawienia` → Film instruktażowy | user presses play | `<video controls preload="none" poster=…>` has **no `src` and no `<source>`** — only a `<track>`. The control is visible and enabled and does nothing. | Say so in the caption, or drop `controls` until a file exists. *Left as-is; noted.* |
| m3 | minor | `/lekcja` → Lekcje dnia | any time of day | `state: current && l.id === current.id ? 'now' : …` uses the LessonCard "TRWA" (in progress) state to mean "selected". At 15:00 the 08:00 lesson still reads TRWA in front of the class. | Use `'now'` only when the clock is inside `start`–`end`. **Done** (`teacher-lesson.js`). |
| m4 | minor | login page after a timeout | evaluator comes back from coffee | The only explanation is an 8 s danger toast (`shell.sessionExpired`). If it is missed, the login page gives no reason for the sign-out. | Persist the reason into the login card. *Shell change — noted, not patched.* |
| m5 | minor | shell, blank install | admin mid-wizard | `shell.js:123` reads `s.setupDismissed`, which **nothing ever sets** — dead code. An admin who starts the wizard has no top bar and no exit until `/api/setup/finish` (which can at least be forced). | Either wire the flag to a "Dokończę później" button or delete it. *Noted in the proposed patches.* |
| m6 | minor | design-system bundle | screen-reader users, English UI | Hardcoded Polish inside `bundle.js`: `GradeGrid`'s blocked-cell `aria-label` ends `', brak oceny'`, and `StatTile`'s delta announces `'wzrost '` / `'spadek '`. Every other bundle string goes through its own `T()` dictionary. | Bundle patch proposed below. |
| m7 | minor | first-run wizard, step 1 | admin types a short school name | The server demands ≥ 5 characters but the field has no hint and the error says only "Podaj pełną nazwę szkoły." for a field that is filled in. | Add a hint / say the minimum. *Noted.* |
| m8 | minor | shortcuts dialog | teacher learns the roster keys | The list says `A` = "wszyscy obecni" and `N S Z U` = "status zaznaczonego ucznia". It does not say that `A` on a focused row marks **that** pupil present, and there is no key at all for `rs` / `w`. | Extend the list; add keys for `rs`/`w` in the DS roster. *Noted.* |
| m9 | minor | `/rodzic` payments, lunch, excuses | after a successful write | The server returns a long human "receipt" string (confirmation number, amount, cut-off time) and the client shows it **only** in a toast. 8 s is not enough to read and copy a receipt number on a phone. | Also write the receipt into the section's `aria-live` line. *Partly done for lunch; payments still toast-only.* |
| m10 | minor | `/oceny` → Kategorie ocen | teacher edits a category weight | The weight field is uncontrolled (`defaultValue` + `onBlur`) and patches immediately, with **no confirmation**, even though changing a weight silently re-computes every average in the class. If the PATCH fails, the field keeps the rejected number. | Confirm the change, or at least make the field controlled and reset it on failure. *Noted.* |
| m11 | minor | `/setup` | admin who finished setup | The screen is registered with `path: '/setup'` but no `nav` entry and no link from anywhere, and once inside there is no way back to `/administracja` except the browser URL bar. | Add a back link. *Noted.* |
| m12 | minor | `/rodzic` child switcher | parent picks their own name | The `AccountSwitcher` lists the children **plus** "my own account", and choosing it navigates away to `/ustawienia`. A profile picker that silently changes screen is a surprise. | Label it "Moje konto i ustawienia" or move it out of the switcher. *Noted.* |
| m13 | minor | `/lekcja` topic card | `Ctrl+S` | `A.onSave` is claimed by the attendance card only. In the topic field, `Ctrl+S` saves *attendance*, not the topic the teacher is typing. | Scope the handler, or bind the topic card when its field has focus. *Noted.* |

### Not defects (checked and cleared)

* **pl/en dictionary parity** — 2 231 keys across `i18n.js` + 14 screens; every `pl` key has an `en` twin and vice
  versa, apart from the plural families, where Polish correctly carries `one/few/many` and English `one/other`.
  No key has an untranslated Polish value sitting in the `en` dictionary.
* **Polish literals outside dictionaries** — all remaining ones are deliberate and commented: legal document
  wording (`Zajęcia rewalidacyjne`, `świadectwo ukończenia klasy 6`), stored reason strings
  (`Sprzeciw ucznia pełnoletniego`), server status codes (`sprawdzian`/`kartkówka`), the video transcript,
  and `label:` fallbacks in `A.screen()` as the contract requires. Only `m1` was a genuine leftover.
* **Destructive actions** — reverting a grade, closing a term, removing a pupil from the register, invalidating
  a grade and blocking an account all require a typed reason or a decision number in a dialog; rejecting an
  excuse is refused server-side without a reason (`400 reason_required`). This is better than most shipping
  e-logbooks.
* **Toast lifetime** — 8 s, dismissible, in an `aria-live="polite"` region. Long enough. (See `m9` for the
  separate problem of *what* is put in them.)
* **`E.Table`** stacks by default below 720 px (`p.stack !== false`), so no screen's data table overflows —
  the only overflowing tables are the deliberately-scrollable `GradeGrid` and the clipped roster (B1).
* **Session timeout** — `/api/auth/session` is polled with `noTouch: true`, so polling does not keep a session
  alive; the 2-minute warning dialog is an `alertdialog`, focuses "Pozostań zalogowany", and Escape is
  correctly disabled.
* **Expired demo session** — a demo session expires only through the normal 15-minute inactivity rule, and the
  login page still renders the persona picker (`/api/demo/personas` is public), so an evaluator is never stuck.

---

## Click counts

Counted as **mouse clicks** (a click into a text field counts; typing does not), from the screen the role
lands on after sign-in. "Screen change" = the top-level screen swaps, not a panel refresh.

### Journey 1 — bell rings → today's 3rd lesson → all present → two late with minutes → one absent → save → topic → link curriculum → one grade

| # | action | clicks |
| --- | --- | --- |
| 1 | `/lekcja` auto-selects **lesson 1**, not the lesson that is about to start → "Otwórz" on lesson 3 | 1 |
| 2 | "Wszyscy obecni i zapisz" (server write #1, toast) | 1 |
| 3 | pupil A → chip `sp`, then the minutes box | 2 |
| 4 | pupil B → chip `sp`, then the minutes box | 2 |
| 5 | pupil C → chip `nb` | 1 |
| 6 | "Zapisz frekwencję" (server write #2, toast) | 1 |
| 7 | click into "Temat lekcji" | 1 |
| 8 | curriculum Select → open, choose, "Powiąż punkt" | 3 |
| 9 | "Zapisz temat" (server write #3) | 1 |
| 10 | "Oceny z tej lekcji" → **screen change** | 1 |
| 11 | click the pupil's cell in the grade grid | 1 |
| 12 | click into `GradeInput` (**M2** — no autofocus), type `5`, Enter | 1 |
| | **total** | **16 clicks · 2 screen changes · 3 writes** |

Under 60 s? **Only for a teacher who knows the keyboard.** With `A` → letter keys → `Ctrl+S` → Tab → topic →
`Ctrl+S` the same result is about 6 pointer actions and comfortably fits the gap between bells. With the mouse
alone, 16 clicks across two screens is 60–80 s in practice. Three things cost the most: attendance has to be
saved **twice** (the one-click "all present" commits immediately, so the three exceptions are a second write),
the grade lives on a **different screen**, and that screen does not focus the grade box.

### Journey 2 — grades for a whole class (13 pupils) from a test scored in points

| # | action | clicks |
| --- | --- | --- |
| 1 | class + subject Select (open, choose) | 2 |
| 2 | category Select → "sprawdzian" | 2 |
| 3 | "Punkty" switch | 1 |
| 4 | "Maksimum punktów" field, type 25 | 1 |
| 5 | "Wpis seryjny" switch — **at the bottom of the editor card**, below Save and Revert | 1 |
| 6 | pupil Select → first pupil | 2 |
| 7 | × 13 pupils: click into `GradeInput`, type the points, Enter | 13 |
| | **total** | **22 clicks · 0 screen changes · 13 writes** |

With **M2** fixed this becomes **9 clicks + 13 × (digits, Enter)** — the hand leaves the keyboard once instead
of fourteen times. The date defaults to today and the category persists across the advance, which is right.

### Journey 3 — homeroom approves 5 excuses and rejects 1

| # | action | clicks |
| --- | --- | --- |
| 1 | top bar → "Wychowawca" (**screen change**) | 1 |
| 2 | tab "Usprawiedliwienia" | 1 |
| 3 | tick 5 rows | 5 |
| 4 | "Zatwierdź zaznaczone (5)" | 1 |
| 5 | 6th row → "Odrzuć" (dialog, reason field auto-focused — good) | 1 |
| 6 | type the reason → "Odrzuć" in the dialog | 1 |
| | **total** | **10 clicks · 2 screen changes · 2 writes** |

With **M13** ("select all pending") this drops to **6 clicks**. Note the demo seed only carries **3** pending
requests, so the five-approval scenario cannot actually be demonstrated — worth seeding a few more.

---

## The best parts

1. **The decision trail is real.** Every destructive action asks for a *reason*, not a "are you sure": revert a
   grade, close a term, strike a pupil from the register, invalidate a grade, block an account. The server
   refuses an excuse rejection without one (`400 reason_required`) instead of trusting the client. That is the
   single thing e-logbooks get wrong most often, and this one gets it right.
2. **Status is never colour alone.** `AttendanceChip` prints the code (`sp 6 min`) *and* a screen-reader word;
   `GradeCell` builds a full sentence for `aria-label` including category, weight, retake, comment and lock.
   The projector-and-daylight case is covered.
3. **Offline is designed, not bolted on.** Attendance and topics go through `{ queueable: true }` with a
   human label, the queue survives a reload in `localStorage`, `SyncStatus` states it plainly, and the toast
   after a queued write says "we'll send it when the network is back" rather than pretending it saved.
4. **The `aria-live` narration on `/oceny`** is genuinely useful even with sight: every action leaves a plain
   sentence ("Zapisano 4 dla Kowalczyk Anna — 18/25, 72 %, średnia 4,10"), which doubles as the undo evidence.
5. **Keyboard grammar in the roster.** Arrow keys walk the column, letter keys set the status, and pressing
   `s` jumps straight into the minutes box. That is exactly the right affordance for the 30-second case.
6. **Error copy.** Server messages are specific and actionable — *"Liczba punktów (40) przekracza maksimum
   (25)"*, *"Publikacja będzie możliwa po obsadzeniu wszystkich lekcji — bez obsady: 5"*, *"Ta opłata została
   już opłacona — potwierdzenie nr 2026-1042"*. No "an error occurred".
7. **Consistent verb+object button labels.** "Zapisz frekwencję", "Zapisz temat", "Zapisz ocenę", "Opublikuj
   zadanie" — never a bare "Zapisz" that leaves you guessing which of four cards on the screen it belongs to.
8. **i18n discipline.** 2 231 keys, full pl/en parity, correct Polish plural families, subject names resolved
   through `A.subjectName`, and every Polish string left in code carries a comment explaining that it is
   legally Polish. Only one genuine leftover in the whole app (m1).
9. **`npm run smoke`** — 32 screen/language pairs, console + CSP + server-4xx + DOM sanity, non-zero exit.
   It caught nothing this round, which is the point.

---

## Patches proposed for `shell.js` / `core.js` / the design-system bundle

These are outside `public/app/screens/` and `public/app/app.css`, so they are written out rather than applied.

### P1 — `public/app/shell.js` (B3): the announcement dialog must not be able to trap anyone

```js
  function Announcement(p) {
    var st = React.useState({ busy: false, error: null }); var f = st[0], set = st[1];
    var ack = function () {
      set({ busy: true, error: null });
      A.api.post('/api/announcements/' + p.a.id + '/ack')
        .then(function () { A.loadSession(); })
        .catch(function (e) { set({ busy: false, error: e.message || t('common.error') }); });
    };
    return h(E.Dialog, {
      title: p.a.title || t('shell.announcement'), blocking: true,
      actions: [
        f.error && h(E.Button, { key: 'later', onClick: function () { A.setState({ pendingAnnouncement: null }); } }, t('shell.ackLater')),
        h(E.Button, { key: 'ack', variant: 'primary', loading: f.busy, onClick: ack }, t('shell.ack'))
      ].filter(Boolean)
    },
      h('p', null, p.a.body),
      f.error && h(E.Alert, { tone: 'danger' }, f.error),
      h('p', { className: 'muted' }, t('shell.announcementNote')));
  }
```
plus in `i18n.js`: `'shell.ackLater': 'Spróbuj później'` / `'shell.ackLater': 'Try again later'`.
The escape hatch only appears after a failed ack, so the "must confirm" rule still holds on the happy path.

### P2 — `public/app/shell.js` (M8, m4): stop remounting the whole shell on a language change

`App()` returns `h(React.Fragment, { key: s.locale }, …)` **and** `Frame()` already passes `key: s.locale`
to the screen component (the documented mechanism). The outer key is redundant and additionally throws away
the top bar, the toast stack and the open dialog. Remove it:

```js
-    return h(React.Fragment, { key: s.locale }, h(E.SkipLink, { href: '#main' }), body,
+    return h(React.Fragment, null, h(E.SkipLink, { href: '#main' }), body,
```

For `m4`, carry the reason onto the login card instead of relying on the toast:

```js
   if (r.status === 401 && … r.data.code === 'session_expired') { … A.setState({ signedOutReason: t('shell.loggedOut') }); }
   // Login(): f.error || app.signedOutReason ? h(E.Alert, { tone: 'warning' }, …) : null
```

### P3 — `public/app/core.js` (M4): one shared date helper so every screen labels dates the same way

```js
  /** Locale-correct hint for a native date input, whose own rendering follows the *browser* locale. */
  function dateHint(iso) {
    var mask = I && I.get() === 'en' ? 'DD/MM/YYYY' : 'DD.MM.RRRR';
    return iso ? mask + ' · ' + fmtDate(iso) : mask;
  }
```
exported on `window.EdApp` next to `fmtDate`. The screens patched in this pass inline the same string; once
`dateHint` exists they should all call it, and the remaining date fields (`/sekretariat`, `/pomoc`,
`/administracja`, `/moduly`, `/kursy`, `/spotkania`) should be swept in one pass.

### P4 — `public/app/shell.js` (m5): `setupDismissed` is dead code

`shell.js:123` gates the forced wizard on `!s.setupDismissed`, which nothing sets. Either wire it —

```js
   // inside SetupWizard's header, when p.status.needed === false:
   h(E.Button, { variant: 'quiet', onClick: function () { A.setState({ setupDismissed: true }); } }, t('sw.later'))
```
— or drop the clause. Leaving a half-built escape hatch in the shell is worse than either.

### P5 — `public/edmat/bundle.js` (m6): two hardcoded Polish strings

```js
-  'aria-label': s.name + ', ' + (c.categoryName || CATN[c.category] || c.title) + ', ' + ATT[s.absentStatus || 'nb'] + ', brak oceny',
+  'aria-label': s.name + ', ' + (c.categoryName || CATN[c.category] || c.title) + ', ' + ATT[s.absentStatus || 'nb'] + ', ' + T('noGrade'),
…
-  h('span', { className: 'ed-sr' }, d.dir === 'up' ? 'wzrost ' : d.dir === 'down' ? 'spadek ' : ''),
+  h('span', { className: 'ed-sr' }, d.dir === 'up' ? T('deltaUp') : d.dir === 'down' ? T('deltaDown') : ''),
```
with `deltaUp` / `deltaDown` added to both `STR.pl` and `STR.en`.

### P6 — `public/edmat/bundle.js` (M1): the roster's own "all present" reads as a save

```js
-  h(Button, { variant: 'primary', size: 'sm', icon: 'check-all', onClick: allPresent, accessKey: 'a' }, T('allPresent'))
+  h(Button, { variant: 'secondary', size: 'sm', icon: 'check-all', onClick: allPresent, accessKey: 'a' }, T('markAllPresent'))
```
with `markAllPresent` = "Zaznacz wszystkich obecnych" / "Mark everyone present" — a *selection* verb, visually
subordinate to the screen's primary "Zapisz frekwencję". The screen-side dirty warning shipped in this pass
is a mitigation, not a substitute.

### P7 — `public/edmat/bundle.js` (keyboard, journey 9): roving tabindex in the roster

Every one of the 7 status chips of every pupil is tabbable: a 13-pupil roster is **91 tab stops** between the
top of the card and "Zapisz frekwencję". The arrow-key handler is already there, so the chips should form a
single composite widget:

```js
  // on each chip, inside AttendanceRoster's row map:
  tabIndex: (i === 0 && k === (s.status || 'ob')) || (s.status === k) ? 0 : -1
```
i.e. one tab stop per row (the pressed chip), arrows to move within and between rows — the standard radiogroup
pattern the component's own `role="group"` + `aria-pressed` markup already implies. `Ctrl+S` is documented
on-screen and is the current workaround, which is why this is a keyboard-efficiency finding and not a blocker.

### P8 — `server/routes/setup.js` (M16): remaining server-side gap

`dryRun`, `warnings`, `importId` and `POST /api/setup/imports/:id/undo` all landed server-side during this
review, and the wizard now drives them. One gap is left: `parseCsv` still maps a row with the wrong number of
columns without complaint (a shifted student row imported 20 pupils whose first name was a birth date, with
`errors: []`). A column-count check would catch the whole class of paste errors in one line:

```js
  if (cells.length !== header.length)
    errors.push({ line: n, error: `Oczekiwano ${header.length} kolumn, znaleziono ${cells.length}.` });
```

---

## Still open after this pass

* **B3** and the rest of the proposed patches (`P1`–`P7`, and the column-count check in `P8`) — they live in
  `shell.js`, `core.js`, the design-system bundle and `server/routes/setup.js`, outside the brief's edit scope.
* **M4** is mitigated, not solved, on the six screens listed in `P3`; the remaining date fields still show the
  browser's format with no hint.
* **m2** (dead video control), **m7**, **m8**, **m9** (payment receipt in a toast only), **m10** (category
  weight changes with no confirmation), **m11**, **m12**, **m13** — small, all noted above with the fix.
* **Demo data**: `/api/parent/overview` returns `absenceAlerts: []` for Anna on the demo "today", so journey 4
  step 1 (the first-period absence alert) has nothing to show; and only 3 excuses are pending, so journey 3's
  "approve five" cannot be demonstrated. Both are seed gaps, not UI defects, but they matter for evaluators.
* **Server-side leniency worth a second look**: a grade can be dated `2027-06-01` (accepted, `200`); an excuse
  that has already been decided can be re-decided silently.


---

## Verification

* `node --test tests/39-nonfunctional.test.js` — **9 / 9 pass**. This is the only test that reads the files
  this review changed (it scans `public/app/screens/*.js` and `public/app/app.css` statically): one `<h1>` and
  ARIA labels per screen, responsive layout classes, no fixed `width: <n>px` and no `min-width` above 320 px
  outside a media query, plus the shortcut and video assertions.
* `node --test tests/` — green on this work. The suite was being edited concurrently while the review ran
  (the test count moved between 200, 219 and 226 across consecutive runs), and the failures that appeared
  (`[3.3.12]`, `[3.5.1]`, `[3.5.5]`, `[3.7.2]`, `[setup.3]`) are all server-side; none of those files reads
  anything under `public/app/`. Each was re-run in isolation to confirm it is untouched by this pass.
* `npm run smoke` — **32 / 32 pairs clean**: no console/CSP error, no server response ≥ 400, one `<h1>` per
  screen, and no literal `undefined` / `NaN` / `[object Object]` in either language.
* Re-screenshotted at 390 px after the fixes: the top bar now carries a full navigation row, all seven
  attendance statuses are reachable, the parent dashboard shows its jump chips, and no screen scrolls
  horizontally.
* Deep link `#/oceny?klasa=7b|mat&lekcja=…&student=…` verified in the browser: the right grade book opens,
  the pupil is preselected and "← Wróć do lekcji" is present.
* `#/wychowawca?tab=uspr` verified: the tab now survives a reload, a bookmark and a language switch, and
  "Zaznacz wszystkie oczekujące" is in place.
* Setup wizard dry run / undo verified against a blank install: a trial run of three teacher rows reported the
  bad `homeroomOf` and wrote **nothing** (0 users, 0 classes); a committed batch was rolled back cleanly
  (2 accounts and 1 class removed).

*Note on the test suite:* while this review was in progress `tests/44-setup.test.js` `[setup.3]` was failing on
an assertion (`gen.body.created > 60`) that predates this work — `/api/admin/timetable/import` had gained its
own lesson-horizon regeneration, so `/api/setup/lessons/generate` afterwards had almost nothing left to
create. Nothing in this review touches `server/` or the files that test reads; it has since gone green on its
own in the working tree.
