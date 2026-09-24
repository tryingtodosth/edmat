# Round 3 — usability and accessibility of the UI added today

Lens: can a teacher, a secretary, a head teacher and a parent actually finish the new work, with a
keyboard, on a phone, in both languages, in all three themes — and does the wording say what to do next.

Scope: the **import card** and the **retention card** in `public/app/screens/admin.js`, the **archive
card** in `public/app/screens/principal.js`, the **guardian card and student identity fields** in
`public/app/screens/registrar.js`, the **compliance screen** `public/app/screens/compliance.js`, the
**formal-message composer and banner** in `public/app/screens/messages.js`, the **login footer link**
in `public/app/shell.js`, and **`PUSH_FALLBACK`** in `public/sw.js`.

Not repeated here: B1–B5, M1–M16 and m1–m13 from `docs/review/usability.md` — closed, and none of them
are re-raised below. I did not re-audit them as a set; the measurements that would have caught the ones
touching these screens (page-level reflow at 390 px, the focus ring in all three themes, the native
date-field hints) were run and are reported under Method, and only the new code failed them.

## Method and what it can and cannot prove

Everything below was run against a live `EDMAT_DEV=1` server, in the same headless Chromium
`scripts/smoke.js` and `tests/39-nonfunctional.test.js` use. Scripts in `docs/review/round3/repro/usability/`:

| script | what it does |
| --- | --- |
| `lib.js` | the screen matrix, the Chromium calls, and the "dump the live DOM, strip the scripts, add `<base>`, force `data-theme`" trick `measureScreen` in `tests/39-nonfunctional.test.js` uses |
| `shots.js` | 96 screenshots: 8 screens × pl/en × 1440×900 and 390×844 × light/dark/hc |
| `live-shots.js` | 32 tall screenshots of the *running* app (see the caveat below) |
| `card-shots.js` | 72 close-ups: one card lifted out of the DOM and rendered alone |
| `formal-message.js` | sends a `kind: decision` letter (the seed has none) and shoots the banner in place — 12 shots |
| `axe.js` | the axe pass (see next paragraph) — `axe-report.json` |
| `keyboard.js` | the real tab order, focus ring per theme, viewport escapes and in-card horizontal scrollers — `keyboard-report.json` |

**On "run the axe check".** `tests/39-nonfunctional.test.js` does not use axe-core and cannot: the
project forbids npm dependencies, and `server/lib/compliance.js` says so in the accessibility statement
itself ("brak axe-core przy zasadzie zera zależności"). `axe.js` is the stand-in: axe's rules for these
screens, implemented in-page and run on the DOM the live app rendered with the real `tokens.css` /
`bundle.css` applied, so contrast, hit-target size and heading order are **measured**. Rule ids are
axe's, so any finding can be looked up. Rules implemented: `html-has-lang`, `html-lang-valid`,
`document-title`, `meta-viewport`, `page-has-heading-one`, `heading-order`, `empty-heading`,
`landmark-one-main`, `label`, `select-name`, `button-name`, `link-name`, `form-field-multiple-labels`,
`label-content-name-mismatch`, `duplicate-id`, `aria-valid-attr-value`, `aria-required-attr`,
`th-has-data-cells`, `empty-table-header`, `table-caption`, `list`, `nested-interactive`,
`target-size`, `color-contrast`, `non-text-contrast`.

**Caveat that matters for reading the screenshots.** The themed matrix re-themes a dumped DOM. That is
faithful for layout, colour and contrast, but React sets `<select>`/`<input>` *values* as DOM
properties and `--dump-dom` only serialises attributes — so in `shots/<screen>-*.png` every select
shows its **first** option. Anything about a control's current value is read from `shots/live-*.png`,
which are real browser renders. Example: `shots/admin-retention-pl-desktop-light.png` shows
"2 lata"; `shots/live-admin-retention-pl-desktop.png` shows the true "5 lat".

**What was not driven.** Interaction states that need a click and cannot be reached from a URL — the
import mapping tables after a dry run, the conflict table, the retention proposal/approve/run chain,
the archive card once a package exists, the compose dialog — were read from source and from the API,
not screenshotted. They are marked *(source + API, not screenshotted)* in the table.

---

## Findings

| id | sev | screen | viewport / theme / locale | what happens | what should happen | smallest fix (file) | shot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **U3-01** | blocker | `/sekretariat` guardian card | 1440×900, all themes, pl+en | The guardians table needs **1048 px** and gets **532 px** — it sits in a `grid-2` half column. `Zapisz zakres` is laid out at x = 1098–1194 while the visible area ends at x = 695: the card's only action is **403 px outside the viewport**, behind an in-card horizontal scroller with no visible affordance. 516 px of the table is hidden, including the whole "Podstawa prawna" column the Save button depends on. | The card that grants or withdraws a guardian's access to a child's record must show its Save button without a horizontal swipe. Take `Opiekunowie` out of the `grid-2` (give it the full width like `Ksiega`), or move the per-row action to its own line above the table. | `public/app/screens/registrar.js` — the `grid-2` at the `ksiega` tab body wrapping `Opiekunowie`/`Flagi` | `shots/live-registrar-guardian-pl-desktop.png`, `shots/card-opiekunowie-pl-desktop-light.png` |
| **U3-02** | blocker | `/dostepnosc` compliance | 390×844, all themes, **pl only** | The document table in `PackCard` is a raw `<table className='ed-table'>`, not `E.Table`, so it gets no `ed-table-wrap` scroller and no stacking. In Polish it is 390 px wide inside a 324 px card and pushes the whole document to **423 px in a 390 px viewport**: the page scrolls sideways, the `h1` "Zgodność i dostępność" and the top nav are cut off. `keyboard.js` reports 10 escaping elements with no scrolling ancestor; `body.scrollWidth` 423 vs `innerWidth` 390. WCAG 1.4.10 Reflow. English happens to fit (383 px), so the bug is invisible in the en build. | Use `E.Table` (it brings the scroller, the stacked phone layout and `scope`), or stack the actions under the document name below 720 px. | `public/app/screens/compliance.js` `PackCard` | `shots/compliance-pl-phone-light.png` |
| **U3-03** | blocker (screen reader) | `/dostepnosc` in-app renderer | all viewports/themes/locales | The renderer sits in `h('div', { className:'mt-4', 'aria-live':'polite' }, DocView)`. Measured content: **8 483 characters** of legal document inside one polite live region. Every tab change, every PL/EN toggle and the first load re-announce the whole declaration/DPIA/DPA. The screen becomes unusable with a screen reader — you cannot reach the tabs without the document being read at you again. | Announce the *change*, not the document: put `aria-live="polite"` on a short status line ("Wczytano: Deklaracja dostępności, PL"), leave the article out of the live region, and move focus to the document's `h2` (`tabIndex -1`) after a tab switch. | `public/app/screens/compliance.js` `Screen` | `shots/live-compliance-pl-desktop.png`; measured in `repro/usability/keyboard-report.json` → `compliance-pl-desktop-light.live` |
| **U3-04** | major | `/administracja` retention card | all | `Wykonaj brakowanie` calls `POST /api/admin/retention/run { confirm: true }` **on the first click**. The action permanently destroys school records. The button is `h(E.Button, { icon:'trash' })` — default (secondary) variant, no `variant:'danger'`, no confirm dialog. The `Anonimizacja` card next to it, which destroys nothing, *does* open a confirm dialog. *(source + API, not screenshotted)* | Same pattern as `Anonimizacja`: `variant:'danger'` plus an `E.Dialog` restating the count, the classes and the consent reference, with the confirm button disabled until the head teacher's name or the proposal number is retyped. | `public/app/screens/admin.js` `KlasyDokumentacji.execute` | — |
| **U3-05** | major | `/administracja` retention card | all | `reason: reason \|\| A.t('ad.ret.brak.title')` — leave "Uzasadnienie do protokołu" empty and the disposal protocol's justification in the append-only audit log becomes the literal card heading, "Brakowanie akt" / "Records disposal (brakowanie)". The field is not marked required and nothing says it ends up in a legal record. | Make it `required`, disable the run button until it has content, and say in the hint that the text goes into the protocol verbatim. | `public/app/screens/admin.js` `KlasyDokumentacji.execute` | — |
| **U3-06** | major | `/dyrekcja?tab=audyt` archive card | all | Two lines under the heading contradict each other: *"Termin § 22: 05.07.2027 · **zostało dni: 255**"* and *"Termin ustawowy: 25.06.2027 – 05.07.2027 · **poza terminem** — generowanie tylko w trybie demonstracyjnym"*. The window has not opened yet; `pr.au.windowClosed` says "past the deadline". The English string is correct ("outside the window"), so only Polish readers get the wrong message. | Two states, not one: `pr.au.windowNotYet` = "termin jeszcze się nie otworzył" and `pr.au.windowOver` = "po terminie", chosen from `W.daysLeft`. | `public/app/screens/principal.js` `pr.au.windowClosed` | `shots/card-arch-pl-desktop-light.png` |
| **U3-07** | major | `/dyrekcja?tab=audyt` archive card | all | The three-step signing instruction is always rendered. Step 1 says *"Pobierz pakiet (.zip) i zapisz go na informatycznym nośniku danych"* — but `Pobierz pakiet (.zip)`, `Zweryfikuj pieczęć`, `Wydruk pakietu`, the two signature selects, the file input and `Dołącz podpis` are all gated on `last` and are **absent in the default state**. The head teacher reads an instruction for controls that are not on the screen; the tab walk confirms only one button on the card. | Gate the `<ol>` on `last`, and before that show one line: "Najpierw wygeneruj pakiet — podpis dołączysz w trzech krokach, które pojawią się tutaj." | `public/app/screens/principal.js`, the archive card IIFE | `shots/card-arch-pl-desktop-light.png` |
| **U3-08** | major | `/dyrekcja?tab=audyt` archive card | all | `verify()` writes its result into `said`, and the only `Live` in the whole `Audyt` component is the `role=status` paragraph inside the **"Rejestr zdarzeń" card, roughly 1 200 px further up the page**. There is no toast. A sighted head teacher presses `Zweryfikuj pieczęć` and nothing visible happens. `verify()` also has no `.catch`, so a failed request is silent too. | Put an `E.Alert` (or a `Live`) inside the archive card and set it from `verify`, and add `.catch(e => A.toast(e.message,'danger'))`. | `public/app/screens/principal.js` `verify` | `shots/live-principal-archive-pl-desktop.png` |
| **U3-09** | major | `/dyrekcja?tab=audyt` archive card | all | `onClick: makeArchive(!(W && W.open))` — when the statutory window is shut the same button silently sends `force: true` with a canned reason ("Pokaz działania pakietu poza terminem ustawowym") and writes an audit row. The label never changes and nothing is confirmed. | Outside the window, change the label (`Generuj mimo terminu (wpis do rejestru)`) and confirm in a dialog that states the audit entry. | `public/app/screens/principal.js`, archive card | `shots/card-arch-pl-desktop-light.png` |
| **U3-10** | major | `/sekretariat` guardian card | all | `Zapisz zakres` is `disabled: !entry(r).legalBasis.trim()`, and `blank()` always initialises `legalBasis: ''` — it never reads `r.legalBasis`. So (a) the button starts dead for every guardian and nothing says why, (b) it is **absent from the tab order entirely** (`keyboard-report.json`, registrar walk jumps from stop 65 straight to the next card), and (c) a previously saved legal basis is shown only as the field's `hint`, so changing a status means retyping it from the hint. | Seed `legalBasis` from `g.legalBasis`, and when the button is disabled print the reason the way `rg.new.notReady` already does on the same screen. | `public/app/screens/registrar.js` `blank()` and the `akcje` column | `shots/card-opiekunowie-pl-desktop-light.png` |
| **U3-11** | major | `/sekretariat` guardian card | all | The same fact is collected twice in two adjacent columns: "Władza rodzicielska i podstawa" holds *Rodzaj podstawy* (postanowienie sądu / oświadczenie), *Sygnatura albo numer pisma* (`np. III Nsm 88/26`) and *Data podstawy*; the next column, "Podstawa prawna", is free text with the placeholder *"np. postanowienie sądu III Nsm 88/26"* — literally the two structured fields concatenated. The free-text one is the one that gates saving. | Drop the free-text column and build `legalBasis` on the client from kind + reference + date, or keep it and relabel it "Uwaga do wpisu (opcjonalnie)" and gate Save on the structured fields instead. | `public/app/screens/registrar.js`, `basis` column | `shots/card-opiekunowie-pl-desktop-light.png` |
| **U3-12** | major | `/sekretariat` guardian card | all | Four controls in the "Władza rodzicielska i podstawa" cell are created with `label: ''` plus an `aria-label`. A screen reader is fine; a sighted secretary sees a stack of four boxes with no visible label — an unlabelled `mm/dd/yyyy` date box among them — identified only by a column header three rows up. | Give each control its real `label` and hide the visible text only where the column header genuinely repeats it (`E.Table` already renders `data-label` on phones). | `public/app/screens/registrar.js`, `status` column | `shots/card-opiekunowie-pl-desktop-light.png`, `shots/card-opiekunowie-pl-phone-light.png` |
| **U3-13** | major | `/sekretariat` guardian card | all | `rg.gu.basisDate` is the only date field added today that does **not** spread `A.dateInputProps()` and does not carry `A.dateHint(...)`. Every other new date field (year structure, audit filters, acting homeroom, birth date) does. The field therefore shows the browser's format with no in-app statement of what that format is — the exact problem `dateHint` exists to solve. | `h(E.TextField, Object.assign({ label: …, type:'date', value: e.basisDate, hint: A.dateHint(e.basisDate), … }, A.dateInputProps()))`. | `public/app/screens/registrar.js`, `status` column | `shots/card-opiekunowie-pl-desktop-light.png` |
| **U3-14** | major | `/wiadomosci` | all, **en build** | Two server-supplied strings are hardcoded Polish and rendered verbatim: `policy.note` in the screen subtitle and `m.note` in the open letter. In English the subtitle reads *"Correspondence inside the logbook. **Dane kontaktowe (telefon, e-mail) nie są udostępniane w wiadomościach.**"*, and the open letter carries the "not a delivery" sentence **twice on one card — once in English in the banner and once in Polish in the footer**. The server already exposes `FORMAL_NOTICE_EN`; it is simply never used. | Return `note`/`noteEn` (or take a `locale` query the way `/api/compliance` does) and pick with `app.locale` on the client. | `server/routes/messages.js` lines 110–111 and 135 + `public/app/screens/messages.js` | `shots/formal-en-desktop-light.png` |
| **U3-15** | major | `/wiadomosci` formal letter | all | One open letter states "this is not a delivery" **three times**: the `Nie jest doręczeniem` badge, the alert (title *"To nie jest doręczenie"* immediately followed by *"To nie jest doręczenie administracyjne (e-Doręczenia)…"* — near-identical), and again in the footer note. None of them tells the recipient **what will happen instead** (where the real decision arrives, by when, how to appeal), and "KPA" is never expanded. | Say it once, in the alert, and make it actionable: title "Pismo doręczone osobno", body "Decyzję otrzymasz na piśmie albo przez e-Doręczenia. Ta wiadomość jest wyłącznie informacją — bieg terminów liczy się od doręczenia w trybie Kodeksu postępowania administracyjnego (KPA)." Drop the badge/footer duplication. | `public/app/screens/messages.js` `ms.formal.*`, `Detail`; `server/routes/messages.js` `FORMAL_NOTICE` | `shots/formal-pl-phone-light.png` |
| **U3-16** | major | `/dostepnosc` pack card | all | Three buttons with the accessible name **"Pokaż" / "Show"** and nothing else (tab stops 14, 19, 24). The Markdown and Print buttons in the same rows all got per-document `aria-label`s (`cp.mdAria`, `cp.printAria`); `Pokaż` was forgotten. Tabbing through the card gives "Pokaż, Pokaż, Pokaż". | `'aria-label': t('cp.showAria', { doc: title })` — one key, mirroring `cp.mdAria`. | `public/app/screens/compliance.js` `PackCard` | `shots/live-compliance-pl-desktop.png` |
| **U3-17** | major | `/dostepnosc`, `/wiadomosci` | all | Both screens render `E.Tabs` **without children**, so no `tabpanel` is created, yet every tab still carries `aria-controls="ed-1-p-<id>"`. On these two screens even the **selected** tab points at an id that is not in the DOM (axe `aria-valid-attr-value`, 24 occurrences). A screen-reader user moving to the controlled element goes nowhere and the tab is associated with nothing. | Either pass the panel as `E.Tabs` children (the pattern `admin.js`/`registrar.js` use), or give the sibling container `role="tabpanel" id={…} aria-labelledby={…}`. | `public/app/screens/compliance.js`, `public/app/screens/messages.js` | `repro/usability/axe-report.json` |
| **U3-18** | major | `/dostepnosc` | all | The card `cp.gap` tells the DPO: *"Powłoka aplikacji nie ma dziś miejsca na odnośnik pod formularzem logowania, więc deklarację publikuje się z tej strony…"*. That link **shipped** — `shell.js` renders `t('shell.accessibility')` under the login form. The one person whose job is to keep the declaration reachable is told the opposite of what is true. | Replace `cp.gapText` with what now holds: "Deklaracja jest dostępna bez logowania — odnośnik pod formularzem logowania. Opublikuj ją też na stronie szkoły i w BIP (przycisk „Druk" albo „Markdown")." | `public/app/screens/compliance.js` `cp.gapText` (pl+en) | `shots/live-compliance-pl-desktop.png`, `shots/login-pl-phone-dark.png` |
| **U3-19** | major | login page footer link | **dark theme**, both locales, both viewports | `h('a', { href: '…/api/compliance/accessibility?format=html' })` is a bare anchor with no class, so it inherits the UA default `rgb(0,0,238)`. On the dark card that measures **1.67 : 1** (needs 4.5 : 1) — the accessibility-statement link is the only unreadable thing on the page. Light and hc pass. | Give it the design system's link treatment (`className: 'ed-link'` or wrap in `E.Button variant:'quiet'`), so it takes `--link`/`--ink` from the theme tokens. | `public/app/shell.js` `Login` | `shots/login-pl-phone-dark.png`, `shots/login-en-desktop-dark.png` |
| **U3-20** | major | login page | all | The login page renders no `<main>` (axe `landmark-one-main`: 0 landmarks), but `App` still renders `E.SkipLink href="#main"` as the very first tab stop. Pressing it on the login page does nothing — the first thing a keyboard user meets is a dead control. The same link also measures **141 × 18 px**, under the 24 × 24 px of WCAG 2.5.8. | Wrap the login card in `<main id="main">` (the shell already does this for signed-in screens) and give the footer link `display:inline-block; padding-block: 4px`. | `public/app/shell.js` `Login` / `App` | `shots/login-pl-desktop-light.png` |
| **U3-21** | major | `/administracja` import card | all | The data textarea is pre-filled with `fmt.data.example` as its **value**, not as a placeholder, and the example is indistinguishable from real data. The very next button is `Sprawdź (import próbny)` and the one after it is `Zaimportuj i zastąp plan`, which **replaces the school's whole timetable**. An admin who opens the card, presses Check, sees "3 lekcje gotowe do zapisu" and presses Import has just wiped the timetable with three sample rows. | Keep the example out of the value: `placeholder: fmt.data.example` plus a `Wstaw przykład` button, or leave the value but disable the apply button until the text has been edited. | `public/app/screens/admin.js` `ImportPlanu`, the `useEffect` that calls `setCsv(fmt.data.example)` | `shots/card-import-pl-phone-light.png` |
| **U3-22** | major | `/administracja` import card | 390×844, both locales | `ad.import.sub` interpolates the raw CSV header `class;weekday;lessonNo;subject;teacherLogin;room;group` — one unbreakable token. At 390 px it runs past the card, is clipped mid-word ("room;group" is cut), and takes the document to `scrollWidth` 396 in a 390 px viewport. | Put the format on its own line as `<code>` with `overflow-wrap:anywhere`, or drop it from the sentence and leave it as the textarea's hint (where `ad.import.dataHint` already lives). | `public/app/screens/admin.js` `ad.import.sub` | `shots/card-import-pl-phone-light.png` |
| **U3-23** | major | `/administracja` retention card | 1440×900, all themes | The documentation-classes table needs **840 px** (pl; 747 en) and gets **532 px** because `Retencja` shares a `grid-2` with `Anonimizacja`. The two columns a head of administration actually acts on — **"Najbliższy termin"** and **"Weryfikacja"** — are off-screen behind an in-card horizontal scroll, on a 1440 px desktop. The "Reguła" column of Polish legal prose wraps to ~10 lines per row, making the table ~2 000 px tall. | Render `Retencja` full width in the `dane` tab and leave `Anonimizacja` alone above it. | `public/app/screens/admin.js` `Screen`, the `dane` tab body | `shots/live-admin-retention-pl-desktop.png` |
| **U3-24** | major | `/sekretariat` student identity fields | all | In `Flagi`, changing "Dokument tożsamości" from PESEL to the document option sends `PATCH …/flags {identityKind:'passport'}` on change — and the server answers **`400 "Uczeń nie ma zapisanego dokumentu tożsamości — księga wymaga rodzaju, numeru i kodu kraju wydania."`** (reproduced). The card offers **no field for the type, number or country**, so the option can never succeed from this screen; the secretary gets a red toast and a dead end. `PATCH` does accept `identityDocument`, so only the UI is missing. | Reveal type / number / country fields when `passport` is chosen (the same three `NowyUczen` already renders) and send them together, or disable the option with a hint pointing at the book entry. | `public/app/screens/registrar.js` `Flagi` | `shots/card-flagi-pl-desktop-light.png` |
| **U3-25** | major | `/wiadomosci` detail pane | all | The whole right-hand pane is `h('div', { 'aria-live':'polite', 'aria-label': … })`, **and** `Detail` calls `ref.current.focus()` on every `m.id` change. Opening a message therefore announces it twice — once because focus lands on a labelled container, once because a polite region changed — and the second announcement is the entire message card (subject, sender, badges, banner, body, receipts table). | Keep the focus move (it is right), drop `aria-live` from the pane, and if a status is wanted add a short `role="status"` line ("Otwarto: <temat>"). | `public/app/screens/messages.js` `MessagesScreen` | `shots/formal-pl-desktop-light.png` |
| **U3-26** | major | `/wiadomosci` compose dialog | 390×844 especially | "Rodzaj pisma" is the second-to-last control in the dialog; choosing a decision kind inserts `FormalBanner` at the **top** of the dialog, above the recipient select — off-screen on a phone in a scrolled dialog. The banner is `E.Alert tone:'warning'`, which renders `role="status"`; because the region and its content are inserted together, the announcement is unreliable across screen readers. *(source, not screenshotted — the dialog cannot be opened from a URL)* | Render the banner **next to the kind select**, keep a `role="status"` container mounted permanently and fill it, and scroll it into view on change. | `public/app/screens/messages.js` `Compose` | — |
| **U3-27** | major | `public/sw.js` `PUSH_FALLBACK` | phone notifications | The server's `notificationTitle` appends the urgency marker (`' · pilne'` / `' · urgent'`); `buildNotification`'s fallback path uses `table.kinds[d.kind]` and drops it. When `GET /api/notifications/:id/render` fails — expired session, no network, the exact moment a first-lesson absence matters most — the parent gets a notification that still vibrates, still sticks (`requireInteraction`), but reads as ordinary. The fallback body is also the generic "Masz nowe powiadomienie w dzienniku", so nothing says it is about their child's absence. | Mirror the server: append the marker when `d.crisis` is set, and add a `crisisBody` to `PUSH_FALLBACK` ("Pilna sprawa w dzienniku — otwórz, żeby sprawdzić frekwencję."). | `public/sw.js` `PUSH_FALLBACK` / `buildNotification` | — |
| **U3-28** | major | `/administracja`, `/dyrekcja`, `/sekretariat` | all | Every card on these three screens is titled with `h3` while the only other heading is the screen `h1` — **there is no `h2` anywhere** (counted in the dumped DOM: 12 / 7 / 7 `h3`, 0 `h2`). axe `heading-order`, 12 occurrences. Heading navigation on these screens skips a level on every card. `/dostepnosc` and `/wiadomosci` get this right. | Change the local `Card` helper's `h3` to `h2` in the three files (`h4` inside then becomes `h3`). | `public/app/screens/admin.js`, `principal.js`, `registrar.js` — the local `Card` | `repro/usability/axe-report.json` |
| **U3-29** | minor | every signed-in screen | all | Two identical "Przejdź do treści" / "Skip to content" links are the first two tab stops: `App` renders `E.SkipLink` and `E.TopBar` renders one of its own. | Drop the one in `shell.js` `App` (the TopBar's is in the right place). | `public/app/shell.js` | `repro/usability/keyboard-report.json` |
| **U3-30** | minor | all new screens | all | `E.Table` wraps every table in `role="region" tabIndex=0` and `E.Tabs` gives the panel `tabIndex=0`, even when they contain focusable children. Extra stops with no purpose: registrar +3, admin +2, principal +2, and axe `nested-interactive` ×6. | Make the wrapper focusable only when it actually scrolls (`tabIndex: scrolls ? 0 : undefined`), and drop `tabIndex` on a panel that has focusable content. | `public/edmat/bundle.js` `Table` / `Tabs` | `repro/usability/axe-report.json` |
| **U3-31** | minor | `/sekretariat` | all | 30 "Przenieś do innej szkoły" buttons (tab stops 28–57) sit between the new-student form and the guardian card: **57 Tab presses** to reach the first guardian control. | The register is the last thing a secretary tabs through — put `Opiekunowie`/`Flagi` above `Ksiega`, or give the register table a "skip this table" link. | `public/app/screens/registrar.js` `Screen`, `ksiega` tab body | `repro/usability/keyboard-report.json` |
| **U3-32** | minor | `/administracja` retention card | all | The select offers "2 lata (poniżej minimum ustawowego)"; choosing it always fails server-side and shows a red toast. An option that can never be chosen should not be choosable. | `options: [… { value:'2', disabled: true } …]` — `E.Select` already honours `o.disabled`. | `public/app/screens/admin.js` `Retencja` | `shots/live-admin-retention-pl-desktop.png` |
| **U3-33** | minor | `/administracja` retention card | all | Column "Po terminie" shows `0` or `nie usuwamy`. "Po terminie: 0" reads as a yes/no answer, not as a count of records. | "Wpisów po terminie" / "Entries past due". | `public/app/screens/admin.js` `ad.ret.colDue` | `shots/card-retencja-pl-desktop-hc.png` |
| **U3-34** | minor | `/administracja` retention card | all | **brakowanie** is used as a heading and eight more times without ever being defined ("usunięcie akt, którym minął okres przechowywania, za zgodą Archiwum Państwowego"); the **en** build uses the bare Polish word inside an English sentence (`ad.ret.opsText`: "removed through brakowanie"); **JRWA** appears in a badge ("do sprawdzenia z JRWA") with the expansion only in a different paragraph; category codes **B5 / B20 / B25 / B50 / BC / A** have no legend — only `A` is explained, in a table cell. | Define each term once, at first use: `brakowanie akt (usunięcie dokumentacji, której minął okres przechowywania, za zgodą Archiwum Państwowego)`, `jednolity rzeczowy wykaz akt (JRWA)`, and a one-line legend under the table for B*n* / BC / A. | `public/app/screens/admin.js` `ad.ret.*` | `shots/card-retencja-pl-desktop-hc.png` |
| **U3-35** | minor | `/sekretariat` identity fields | all | The field is labelled "Dokument tożsamości" and one of its two options is also "Dokument tożsamości" — in `Flagi` and again as the radio legend/option pair in `NowyUczen`. | Keep the group name and rename the option: "Inny dokument (paszport, karta pobytu)". | `public/app/screens/registrar.js` `rg.flags.ident.passport`, `rg.new.passportOpt` | `shots/live-registrar-guardian-pl-phone.png` |
| **U3-36** | minor | `/sekretariat` new student | all | "Matka lub opiekun prawny" carries `required: true` (asterisk + `aria-required`), "Ojciec lub opiekun prawny" does not — but `ready` accepts **either**. A single father filling the form is told the mother field is required. | Drop `required` from both and let `rg.new.notReady` carry the rule, or wrap both in a fieldset legend "Co najmniej jeden opiekun". | `public/app/screens/registrar.js` `NowyUczen` | `shots/live-registrar-guardian-pl-phone.png` |
| **U3-37** | minor | `/sekretariat` new student | all | "Dane rodziców i opiekunów prawnych" is `h('p', { className:'body-strong' })` — it looks like a heading, is styled like a heading, but is neither a heading nor a fieldset legend, so it does not exist for heading navigation. | `h('h4' …)` (or `h3` once U3-28 lands), or a real `<fieldset><legend>`. | `public/app/screens/registrar.js` `NowyUczen` | `shots/card-nowy-uczen-pl-desktop-light.png` |
| **U3-38** | minor | `/administracja` import card | all | The two file inputs are the only raw, unstyled controls on the screen: they render the browser's own "Choose Files / No file chosen" — **English text inside a Polish card** on an en-locale machine (and the reverse on a pl-locale one), with the browser's focus ring instead of `--focus-ring`. | Hide the native input (`.ed-sr`) and trigger it from an `E.Button`, showing the chosen file name in a `E.Badge` the way the archive card already does for the signature. | `public/app/screens/admin.js` `ImportPlanu` | `shots/card-import-pl-phone-light.png` |
| **U3-39** | minor | `/administracja` import card | 390×844 | The drop zone is a plain `div` with `onDragOver`/`onDrop`, no `role`, not focusable, and the hint's first sentence — "Przeciągnij tu plik…" — is the first thing a phone admin reads, where dragging a file is not a thing. Its only state change is a dashed outline. | Lead with "Wskaż plik poniżej" and keep the drag sentence for wide viewports; give the zone `role="group"` with an `aria-label` and announce a drop through the existing `Live`. | `public/app/screens/admin.js` `ad.import.dropHint` | `shots/card-import-pl-phone-light.png` |
| **U3-40** | minor | `/administracja` import card | all | `Zaimportuj i zastąp plan` is disabled until `report && report.ok` and nothing says so — it is simply absent from the tab order. The same screen's `rg.new.notReady` pattern (a line under a disabled button explaining the precondition) already exists one screen over and is the right answer. | Add `ad.import.applyBlocked`: "Przycisk odblokuje się po imporcie próbnym bez konfliktów." | `public/app/screens/admin.js` `ImportPlanu` | `shots/card-import-pl-phone-light.png` |
| **U3-41** | minor | `/administracja` import mapping | after a dry run | `Przyjmij wszystkie dokładne dopasowania` reports "Przyjęto N dopasowań. **Uruchom import próbny ponownie.**" while the button immediately next to it is called **"Przelicz z tym dopasowaniem"** and a third button further up is "Sprawdź (import próbny)". Three names, two buttons, one action. *(source, not screenshotted)* | Use one name everywhere: "Sprawdź ponownie z tym dopasowaniem", and make `ad.import.acceptedExact` point at it by that name. | `public/app/screens/admin.js` `ad.import.acceptedExact` / `ad.import.recheck` | — |
| **U3-42** | minor | `/dyrekcja?tab=audyt` archive card | all | "Termin § 22" and "nie podpis z § 22" name a paragraph but never the act it belongs to; `Generuj pakiet XML + wydruk` does not print anything (printing is the separate `Wydruk pakietu` button). | "Termin z § 22 rozporządzenia o dokumentacji przebiegu nauczania: {d}" and `Generuj pakiet (XML + wydruk w pakiecie)`. | `public/app/screens/principal.js` `pr.au.deadline`, `pr.au.genArchive` | `shots/card-arch-pl-desktop-light.png` |
| **U3-43** | minor | `/wiadomosci` list | all | `subject: m.subject + ' · ' + t('ms.formal.badge') + t('ms.requiresAck')` — badge texts concatenated into the subject string, rendered in the same bold subject style, so the list reads "Decyzja nr 4/2026/2027 — odmowa zwolnienia z zajęć wychowania fizycznego · Nie jest doręczeniem · wymaga potwierdzenia". | Pass them to `E.MessageItem` as badges (it already renders `confidential` and `receipt` that way) instead of splicing them into the subject. | `public/app/screens/messages.js` `MessagesScreen` | `shots/formal-pl-phone-light.png` |
| **U3-44** | minor | `/wiadomosci` compose | all | `ms.kindHint` — "Rodzaj «decyzyjny» … może go wybrać wyłącznie dyrektor" — is shown to every staff member, but the decision kinds are filtered out of the list for everyone but the head teacher. Teachers are told a rule about options they will never see. | Show the sentence only when `principal`; for everyone else the hint can go. | `public/app/screens/messages.js` `Compose` | — |
| **U3-45** | minor | `PUSH_FALLBACK` vs `/wiadomosci` | en | One concept, three English names: `PUSH_FALLBACK.en.kinds.ack` = "Delivery acknowledgement", `ms.ack` = "Confirmation", `ms.ackTitle` = "Confirmation of receipt required". A parent who gets the push and then opens the logbook sees three different words for the thing they must do. | Settle on "Confirmation of receipt" / "Potwierdzenie odbioru" everywhere. | `public/sw.js`, `server/routes/notifications.js`, `public/app/screens/messages.js` | — |
| **U3-46** | minor | `PUSH_FALLBACK`, `push.privacy` | phone | The fallback body says the same word twice — "Masz nowe powiadomienie **w dzienniku**. Szczegóły po otwarciu **dziennika**." Separately, `push.privacy` (pl+en) still promises "W powiadomieniu wysyłamy tylko tytuł, **treść** … i odnośnik", which stopped being true when the default payload became `{v, kind, id, ts}` and the wording moved to `GET …/render`. | Body: "Masz nowe powiadomienie. Otwórz dziennik, żeby zobaczyć szczegóły." Privacy: "Do usługi push wysyłamy wyłącznie zaszyfrowany identyfikator — treść pobiera Twoje urządzenie bezpośrednio ze szkoły." | `public/sw.js`, `public/app/i18n.js` `push.privacy` | — |
| **U3-47** | minor | top bar, every screen | 390×844 and 1440×900 | The main nav is a silent horizontal scroller: 1 225 px of links in 944 px for the head teacher **at 1440 px**, and 364–1 225 px in 358 px on a phone. Section tablists do the same (admin 487 px in 358 px — the third tab, "Dane i archiwum", is off-screen with no affordance). | Fade or chevron the overflow, or wrap the nav below 900 px; the tablist should at least show a scroll shadow. | `public/app/app.css` / `public/edmat/bundle.css` `.ed-topbar nav`, `.ed-tablist` | `shots/compliance-pl-phone-light.png` |

---

## axe summary per screen

Per screen, distinct issues (same rule + same element + same message counted once across all
6 locale × viewport × theme combinations). Full data: `repro/usability/axe-report.json` (96 rows).

| screen | rules fired | verdict |
| --- | --- | --- |
| `login` | `color-contrast` ×1, `landmark-one-main` ×1, `target-size` ×2 | all three are the new footer link and the missing `<main>` — U3-19, U3-20 |
| `admin-import` | `heading-order` ×1, `aria-valid-attr-value` ×2, `nested-interactive` ×1 | U3-28, U3-30; the `aria-controls` ones are the two *unselected* tabs, which is how `E.Tabs` works |
| `admin-retention` | `heading-order` ×1, `aria-valid-attr-value` ×2, `nested-interactive` ×1 | as above |
| `principal-archive` | `heading-order` ×1, `aria-valid-attr-value` ×3, `nested-interactive` ×1 | as above |
| `registrar-guardian` | `heading-order` ×1, `aria-valid-attr-value` ×2, `label-content-name-mismatch` ×1, `nested-interactive` ×3, `target-size` ×3 | U3-28, U3-30 and the **en** Save button (below); the 3 `target-size` are **false positives** — the radios/checkbox are 20 × 20 px but each is wrapped in a clickable `<label class="ed-check">` of 32–63 px, so WCAG 2.5.8 is met |
| `compliance` | `aria-valid-attr-value` ×4, `label-content-name-mismatch` ×24 | U3-17 (the **selected** tab points at a panel that does not exist) and the Markdown/Print buttons (below) |
| `messages-teacher` | `aria-valid-attr-value` ×3 | U3-17 |
| `messages-parent` | `aria-valid-attr-value` ×3, `label-content-name-mismatch` ×4 | U3-17 + `E.MessageItem` (bundle-level, pre-existing) |

Clean across every screen, locale, viewport and theme: `html-has-lang` (`i18n.js` sets
`document.documentElement.lang` on every switch), `document-title`, `meta-viewport`,
`page-has-heading-one` (exactly one `h1` everywhere), `empty-heading`, `label` / `select-name` /
`button-name` / `link-name` (**every** input added today has an accessible name, including both file
inputs and both mapping-table controls built with `label: ''`), `form-field-multiple-labels`,
`duplicate-id`, `th-has-data-cells` and `empty-table-header` (every `E.Table` header carries `scope`;
the hand-written tables in `compliance.js` set `scope` too), `table-caption`, `list`,
`non-text-contrast`, and — except for the one login link — `color-contrast`: **every text-bearing element on every
screen measured in light, dark and high contrast (72–441 elements per screen) with zero failures**. The design system
holds; the one contrast failure of the day is the one element that was added without it.

### WCAG 2.5.3 "Label in Name" — the two real ones

Both are new code, and both break voice control ("click Save the scope" matches nothing):

* `rg.gu.saveAria` (**en only**): visible **"Save the scope"**, accessible name "Save the access scope
  of Katarzyna Adamczyk". Polish is fine ("Zapisz zakres" ⊂ "Zapisz zakres dostępu opiekuna …").
  Fix: "Save the scope for {name}".
* `cp.mdAria` / `cp.printAria` (**pl and en**, 24 occurrences): visible **"Markdown PL"**, accessible
  name "Deklaracja dostępności — pobierz Markdown (PL)". Fix: "{doc} — Markdown PL" / "{doc} — Druk PL",
  so the visible text is a substring.

The four `messages-parent` hits are `E.MessageItem` in the bundle (the whole card is one link whose
`aria-label` is a summary) — pre-existing, out of today's scope, listed for completeness.

---

## Keyboard walks

Focus ring: **every** focusable element on every screen, in light, dark and high contrast, resolves a
non-`none` `box-shadow` — 0 elements without a visible ring across all runs. `E.Dialog` traps Tab,
restores focus on close, closes on Escape unless `blocking`/`timeout`, and uses `role="alertdialog"`
when it blocks. Full logs: `repro/usability/keyboard-report.json`.

**Login → accessibility statement** (8 stops)
`1 Przejdź do treści (dead — no #main, U3-20)` → `2 EdMat` → `3 PL` → `4 EN` → `5 Login` → `6 Hasło` →
`7 Zaloguj się (submit)` → `8 Deklaracja dostępności`. Enter works on 7 and 8; the language buttons
carry `aria-pressed`. Clean apart from U3-19/U3-20.

**Import a timetable** (`admin`, 44 stops)
`1–2 skip links (duplicated, U3-29)` → `3–12 nav + user menu + bell` → `13–15 tabs (arrows move, Home/End work)` →
`16 tabpanel (needless stop, U3-30)` → `17–37 year structure` → **`38 Format pliku`** → **`39 Plik planu (file)`** →
**`40 Katalog publikacji Optivum (file)`** → **`41 Dane z programu … (textarea, pre-filled with the example — U3-21)`** →
**`42 Sprawdź (import próbny)`** → `43–44 SIO`. The drop zone is not reachable at all (no role, no
tabindex — acceptable, the file inputs cover it, U3-39) and **`Zaimportuj i zastąp plan` never appears**
because it is disabled with no stated precondition (U3-40). The mapping tables, "Przyjmij wszystkie
dokładne dopasowania" and the conflict table only exist after a dry run and were read from source.

**Set a retention policy and start a disposal** (`admin`, 20 stops)
`…13–15 tabs` → `16 tabpanel` → `17 Uruchom anonimizację i pobierz` → **`18 Okres przechowywania logów systemowych`** →
**`19 table region (Okresy przechowywania … JRWA)`** → **`20 Przygotuj listę do brakowania`**. Changing 18
saves immediately (no explicit save) and reports into the card's `role=status` line — good. From 19 the
table's hidden 308 px (U3-23) are reachable only by scrolling the region, which the region being
focusable does at least allow. The approve → consent → run chain appears only after step 20 and was
read from source: `Zatwierdź brakowanie` is gated on ≥3 characters of consent reference (no reason
given when dead), and `Wykonaj brakowanie` fires straight away (U3-04).

**Generate and sign the annual archive** (`dyrektor`, 42 stops)
`…18–21 tabs` → `22 tabpanel` → `23–29 audit filters` → `30–33 grade invalidation` → `34 block account` →
`35–38 acting homeroom` → **`39 Generuj pakiet XML + wydruk`** → `40–42 visibility switches`. That is the
**whole** archive card: one button. Steps 1–3 of the printed instruction refer to controls that are not
in the walk (U3-07); `Zweryfikuj pieczęć` is not there either, and when it is, its result lands 1 200 px
up the page (U3-08). The three switches at 40–42 are `role="switch"` and toggle on Space and Enter.

**Record a guardian's parental authority** (`sekretariat`, 70 stops)
`…10–12 tabs` → `13 tabpanel` → `14–26 new-student form` → `27 register table region` → **`28–57 thirty
"Przenieś do innej szkoły" buttons (U3-31)`** → **`58 Uczeń`** → `59 guardians table region` →
**`60 Status władzy rodzicielskiej — Katarzyna Adamczyk`** → **`61 Rodzaj podstawy`** →
**`62 Sygnatura albo numer pisma`** → **`63 Data podstawy`** → **`64 Nadpisz zakres ręcznie (checkbox)`** →
**`65 Podstawa prawna`** → `66 next card`. The scope select is skipped because it is `disabled` until 64
is ticked (correct), but **`Zapisz zakres` is missing from the walk altogether** (U3-10): the flow has no
end. Every control 60–65 announces the guardian's name, which is the right call in a table.

**Read a formal letter** (`rodzic.zielinski`, 15 stops + the open letter)
`…10 Nowa wiadomość` → `11–12 Odebrane / Wysłane` → `13–14 message links` → `15 Potwierdzam odczyt`.
Opening a message moves focus to the card (`tabIndex -1`) and, below 720 px, scrolls it into view —
both right; the pane being a live region makes it announce twice (U3-25). `Wróć do listy` is the first
stop inside the open card. `E.Dialog` behaviour for the composer was verified in the bundle, not driven.

**Compliance pack** (`iod`, 29 stops)
`…10–24 pack card: Markdown PL / Markdown EN / Druk PL / Druk EN / Pokaż, ×3 documents` →
`25–27 tabs` → `28–29 PL / EN`. Three of those fifteen buttons are called just "Pokaż" (U3-16); the
selected tab controls nothing (U3-17); and the document itself holds no focusable element, so after
switching a tab a keyboard user has no way back into the content except Shift+Tab.

---

## Strings to reword

| key | current pl | current en | proposed |
| --- | --- | --- | --- |
| `pr.au.windowClosed` | poza terminem — generowanie tylko w trybie demonstracyjnym z wpisem do rejestru | outside the window — generation only in demo mode, with an audit entry | pl: **okno jeszcze się nie otworzyło** — teraz pakiet powstanie tylko pokazowo, z wpisem do rejestru (and a second key for genuinely past due). The en text is already right. |
| `pr.au.deadline` | Termin § 22: {d} | § 22 deadline: {d} | Termin z § 22 rozporządzenia o dokumentacji przebiegu nauczania: {d} / Deadline under § 22 of the school-records regulation: {d} |
| `pr.au.genArchive` | Generuj pakiet XML + wydruk | Generate XML package + printout | Generuj pakiet archiwalny / Generate the archive package (printing is a separate button) |
| `pr.au.step1` | Pobierz pakiet (.zip) i zapisz go na informatycznym nośniku danych. | Download the package (.zip) and write it to a data carrier. | prefix the list with "Po wygenerowaniu pakietu:" / "Once the package exists:" so step 1 stops pointing at a missing button |
| `pr.au.step2` | …podpisem zaufanym (gov.pl), e-Dowodem lub podpisem kwalifikowanym. | …with podpis zaufany (gov.pl), an e-ID card or a qualified signature. | en: "with a Trusted Profile signature (*podpis zaufany*, gov.pl), an e-ID card or a qualified signature" |
| `ad.ret.brak.title` | Brakowanie akt | Records disposal (brakowanie) | pl: Brakowanie akt — usunięcie dokumentacji, której minął okres przechowywania; en: Records disposal — removing documentation whose retention period has ended |
| `ad.ret.opsText` | …usuwa się wyłącznie przez brakowanie: lista → zatwierdzenie dyrektora… | …are only ever removed through **brakowanie**: a proposal, the principal's approval… | en: "…only ever removed through records disposal (*brakowanie*): a proposal…" — gloss it, do not leave a bare Polish noun in an English sentence |
| `ad.ret.verifiedNo` | do sprawdzenia z JRWA | check against the school JRWA | pl: do sprawdzenia z wykazem akt (JRWA); en: check against the school's records schedule (JRWA) |
| `ad.ret.colDue` | Po terminie | Past due | Wpisów po terminie / Entries past due |
| `ad.ret.opt2` | 2 lata (poniżej minimum ustawowego) | 2 years (below the statutory minimum) | keep the text, disable the option — it can never be saved |
| `ad.import.sub` | Wklej CSV/JSON ({format}) albo wgraj plik… | Paste CSV/JSON ({format}) or upload a file… | drop `{format}` from the sentence; it already lives in the textarea hint, and inline it overflows a phone card |
| `ad.import.acceptedExact` | Przyjęto {n} dokładnych dopasowań. Uruchom import próbny ponownie. | Accepted {n} exact matches. Run the dry run again. | …Naciśnij „Sprawdź ponownie z tym dopasowaniem". / …Press "Check again with this matching." — name the button that is actually there |
| `ad.import.dropHint` | Przeciągnij tu plik… albo wskaż go poniżej. | Drop a file… here or pick it below. | lead with "Wskaż plik poniżej" / "Pick a file below"; keep the drag sentence for wide viewports only |
| `rg.gu.basis` / `rg.gu.basisPh` | Podstawa prawna — {name} / np. postanowienie sądu III Nsm 88/26 | Legal basis — {name} / e.g. court order III Nsm 88/26 | either remove the column (U3-11) or rename it "Uwaga do wpisu" / "Note on this entry" so it stops competing with *Rodzaj podstawy* + *Sygnatura* |
| `rg.gu.saveAria` | Zapisz zakres dostępu opiekuna {name} | Save the access scope of {name} | en: **Save the scope** for {name} — the visible label must be inside the accessible name (WCAG 2.5.3) |
| `rg.gu.status.*` | pełna / ograniczona (prawo do informacji zostaje) / pozbawiony władzy rodzicielskiej / … | full / limited (the right to information remains) / … | add one sentence under the column header defining *władza rodzicielska* and saying that limiting it does not by itself cut off information; today the term is used 6× and explained 0× |
| `rg.flags.ident.passport` / `rg.new.passportOpt` | Dokument tożsamości | Identity document | Inny dokument (paszport, karta pobytu) / Other document (passport, residence card) — today the option repeats its own field label |
| `cp.show` | Pokaż | Show | keep the visible text, add `cp.showAria` = "{doc} — pokaż w aplikacji" / "{doc} — show in the app" |
| `cp.mdAria` / `cp.printAria` | {doc} — pobierz Markdown ({lang}) | {doc} — download Markdown ({lang}) | {doc} — Markdown {lang} / {doc} — Druk {lang}, so the visible text is a substring (WCAG 2.5.3) |
| `cp.gapText` | Powłoka aplikacji nie ma dziś miejsca na odnośnik pod formularzem logowania… | The application shell has no place for a link under the login form today… | Deklaracja jest dostępna bez logowania — odnośnik jest pod formularzem logowania. Opublikuj ją także na stronie szkoły i w BIP. (The statement is reachable without signing in — the link sits under the login form. Publish it on the school's site and in the BIP as well.) |
| `ms.formal.title` + `ms.formal.banner` | To nie jest doręczenie / To nie jest doręczenie administracyjne (e-Doręczenia). Decyzje formalne doręcza się w trybie KPA. | This is not a delivery / This is not an administrative delivery (e-Doręczenia). Formal decisions must be delivered under KPA. | Pismo doręczone osobno / Decyzję otrzymasz na piśmie albo przez e-Doręczenia. Ta wiadomość to wyłącznie informacja — terminy biegną od doręczenia w trybie Kodeksu postępowania administracyjnego (KPA). |
| `messages` `policy.note`, `m.note` (server) | Polish only | **rendered in Polish inside the en build** | add `noteEn` next to the existing `FORMAL_NOTICE_EN` in `server/routes/messages.js` and pick by locale |
| `ms.kindHint` | Rodzaj „decyzyjny" … może go wybrać wyłącznie dyrektor. | A decision-like kind … only the principal may pick one. | show only to the head teacher; for other staff the hint is about invisible options |
| `PUSH_FALLBACK.*.body` | Masz nowe powiadomienie w dzienniku. Szczegóły po otwarciu dziennika. | You have a new notification in the logbook. Open it for the details. | Masz nowe powiadomienie. Otwórz dziennik, żeby zobaczyć szczegóły. / You have a new notification. Open the logbook for the details. |
| `PUSH_FALLBACK.*.kinds.ack` | Potwierdzenie odbioru | Delivery acknowledgement | Confirmation of receipt — and use the same words in `ms.ack` / `ms.ackTitle` |
| `push.privacy` | W powiadomieniu wysyłamy tylko tytuł, treść widoczną też w dzienniku i odnośnik do ekranu. | A notification carries only a title, the text you also see in the logbook and a link… | no longer true with the `minimal` payload: "Do usługi push trafia wyłącznie zaszyfrowany identyfikator; treść pobiera Twoje urządzenie prosto ze szkoły." |
| `common.dateMask` (en) | DD.MM.RRRR | DD/MM/YYYY | the hint promises DD/MM/YYYY while an en-US browser renders the native picker as mm/dd/yyyy — say "kolejność zgodna z ustawieniami przeglądarki" / "order follows your browser settings" rather than asserting one |

**Polish literals found in the en build:** `policy.note` and `m.note` on `/wiadomosci` (U3-14, server);
"brakowanie" in `ad.ret.opsText`; "podpis zaufany" in `pr.au.step2`; "JRWA" in `ad.ret.verifiedNo`.
**English text in the pl build:** the two native file-input buttons on the import card (U3-38, browser
supplied). No other leakage found — every other new string has a real translation, not a paraphrase,
and the English reads as English (`ad.import.*`, `ad.ret.*`, `pr.au.*`, `rg.gu.*`, `cp.*` all check out).

---

## Counts

* **Findings: 47** — **3 blockers**, **25 majors**, **19 minors**.
* By screen: import card 6 (U3-21, 22, 38, 39, 40, 41) · retention card 6 (04, 05, 23, 32, 33, 34) ·
  archive card 5 (06, 07, 08, 09, 42) · guardian card + identity fields 10 (01, 10, 11, 12, 13, 24, 31, 35, 36, 37) ·
  compliance screen 4 (02, 03, 16, 18) · messages composer/banner/list 7 (14, 15, 17, 25, 26, 43, 44) ·
  login footer link 2 (19, 20) · `PUSH_FALLBACK` 3 (27, 45, 46) ·
  cross-screen headings / skip links / tab stops / nav overflow 4 (28, 29, 30, 47).
* **axe: 60 distinct issues across 96 runs** (8 screens × 2 locales × 2 viewports × 3 themes), in 7
  rules: `label-content-name-mismatch` 29, `aria-valid-attr-value` 15, `nested-interactive` 6,
  `heading-order` 4, `target-size` 4 (3 of them false positives — see the summary),
  `landmark-one-main` 1, `color-contrast` 1. Zero failures for labels, names, duplicate ids, table
  headers, lists, `lang`, viewport and non-text contrast.
* **Keyboard: 7 flows walked, 228 tab stops recorded**, 0 elements without a visible focus ring in any
  of the three themes; 2 flows end without their primary action being reachable (U3-10, U3-40).
* **Artefacts: 248 files** in `docs/review/round3/shots/` — **212 screenshots** (96 themed full screens,
  32 live full-page, 72 card close-ups, 12 formal-letter shots) plus the 36 dumped DOMs every
  measurement was taken from.
* Reproduce: `EDMAT_DEV=1 PORT=3977 EDMAT_DATA=/tmp/edmat-r3 node server/index.js`, then
  `node docs/review/round3/repro/usability/{shots,live-shots,card-shots,formal-message,axe,keyboard}.js`
  (set `EDMAT_BASE_URL` if the port differs).
