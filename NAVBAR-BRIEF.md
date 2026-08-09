# Brief: a navbar that collapses in stages instead of all at once

**Status: not started.** This is a specification handed over for a fresh session. Nothing in it is
built. It was dictated by the project owner in several messages; everything below marked **required**
came from them directly, and everything marked *judgement* is a gap I filled that they should be free
to overrule.

Read `CLAUDE.md` §17V.4 first — the navbar was rebuilt once already (three groups: browse, one
"Add…" menu, one account menu; plus a phone drawer), and this builds on that rather than replacing
it.

---

## 1. The problem

Today the bar has exactly two states: the full desktop row, and — below a single breakpoint — one row
plus a drawer behind a menu button. Between "everything fits comfortably" and "phone" there is a wide
band of real window sizes where the bar is cramped, wraps, or is already hiding things it did not
need to hide.

The ask is a **staged** collapse: as the window narrows, give up the cheapest thing first, and keep
going, so the bar degrades gracefully across that whole band instead of falling off a cliff.

---

## 2. The stages, in order

**Required, and the order is the specification.** Each stage happens at a narrower width than the one
before it.

| # | What happens |
|---|---|
| 1 | **Events** loses its label and becomes a calendar icon |
| 2 | **The user/account trigger** becomes an icon — their avatar if they have one |
| 3 | **Watchlists** becomes an eye icon |
| 4 | **Materials** becomes a book icon |
| 5 | **The "Add…" trigger** becomes a plus icon |
| 6 | **Disciplines/fields** merges into a **search icon**, placed immediately **left of the Add trigger** |
| 7 | **The logo disappears** |
| 8 | Once the user **has an account**, the **language picker moves into the user-actions submenu** |
| 9 | **Courses disappears** — it is reachable from the hero tabs on the homepage |
| 10 | Below some width, everything collapses into the **existing menu button and drawer** (already built, §17V.4) |

**Where the collapsed items go.** As each becomes an icon it **moves to the right**, joining the
existing icon controls (dice, notifications bell, messages envelope, theme, etc.), positioned **just
right of the dice**. Within that icon cluster they keep **the order they had in the main navbar** —
so the cluster reads as a continuation of the nav, not a random pile.

**Throughout all of it:** the navbar's **height shrinks as a linear function of window width**, and so
do its **padding, gaps between items, and border thicknesses**. Not stepped at breakpoints — linear.

---

## 3. What this needs that does not exist yet

- **A search page.** Stage 6 turns Disciplines into a search affordance, so there has to be something
  for it to open. Check first — `/search` may not exist. If it does not, it needs building, and its
  scope is a decision to take with the owner rather than assume: at minimum it should reach the things
  the nav currently reaches (disciplines, branches, materials, exercises, courses, events, tutoring).
  There is an existing in-course search (`e2e/course-search.mjs`, 24 checks) worth reading first — it
  may already have a backend endpoint that generalises.
- **Icons.** The nav currently uses a mix of emoji (🎲 for the dice) and inline SVG (the messages
  envelope). The owner said "emoji" for these. *Judgement:* inline SVG is the better choice for
  anything that needs to sit on a line with text and inherit colour, and the envelope already sets
  that precedent — but the owner asked for emoji specifically, so **ask before substituting SVG**.
- **Avatar in the nav.** `Profile.avatar` is real and has an upload flow (§17Q). Stage 2 needs a small
  avatar with a sensible fallback for accounts that have none — there is deliberately no identicon
  (§17Q "Left open"), so the fallback is a plain icon.

---

## 4. How to implement the linear part

CSS `clamp()` with a `vw`-based middle term is a linear interpolation between two widths, and is the
right tool for every "as a linear function of window width" in this brief — height, padding, gaps,
borders. Define the endpoints once as custom properties on the header and let everything read them,
so the bar cannot end up with a linear height and stepped padding.

Do **not** drive this from JavaScript measuring the window. It would run on every resize, it would be
wrong during SSR, and the whole thing is expressible in CSS.

**The staged label-hiding is a different matter** and container queries or plain media queries are
both defensible. *Judgement:* the stages are about the bar's own width, not the viewport's, so a
container query on the header is the more honest tool — but the app has no container-query precedent
yet, so check whether one is wanted before introducing it.

---

## 5. Things to get right

- **Every icon-only control needs a real accessible name.** The messages button already does this
  (`aria-label`, §17V.4) and is the pattern to copy. An emoji with no label is a control a screen
  reader announces as nothing, or as the emoji's own name, which is worse.
- **Do not let a collapsed item become unreachable.** Stage 9 removes Courses on the grounds that the
  hero tabs cover it — that is only true on the homepage. Confirm that is what the owner means, or put
  Courses in the account/drawer menu at that stage instead.
- **The item lists must stay single-sourced.** §17V.4 already renders the browse links, create actions
  and account items from snippets shared between the desktop popovers and the drawer, specifically so
  a feature flag cannot hide an entry in one place and leave it in the other. Any new icon rendering
  must read the same lists.
- **Feature flags still gate everything.** Events, tutoring and messaging all have kill switches; a
  collapsed icon for a killed feature must not appear.
- **Both locales, in the same change.** Every new string in `en.json` and `pl.json` — the standing
  rule, no exceptions.
- **The logo disappearing (stage 7) removes the only link home** from the bar. Check that the drawer
  or some other control still offers one before shipping that stage.

---

## 6. How to verify

The pre-existing `e2e/events-and-nav.mjs` (92 checks) already covers the navbar's current behaviour
including the phone drawer, focus return and scroll-hiding — **run it first, unchanged, to establish a
baseline**, and keep it passing.

Then a new script driving several viewport widths, asserting at each stage that the right things are
icons, that they are in the right order right of the dice, that each still has an accessible name, and
that nothing became unreachable. Take screenshots and **look at them** — every navbar bug in this
project's history was found that way rather than by an assertion.

Two traps this project has already paid for, both recorded in `test.md`:

- `page.mouse` uses **viewport** coordinates while `boundingBox()` does not, so set an explicit tall
  viewport in the browser context.
- `register` is throttled per IP in a **file-based** cache at `backend/cachedata/`, so it survives a
  backend restart. Sign in as seeded demo users rather than registering, and if you do exhaust it,
  delete that directory rather than restarting the server. (`CLAUDE.md` and an older memory both say
  restarting clears it — that is out of date since the cache moved to disk.)

---

## 7. Where things stand

The branch `worktree-booking-week-schedules` carries an unrelated, finished feature (the booking
schedule editor, `CLAUDE.md` §17Z). This brief is committed alongside it only so it is not lost; the
navbar work should start from a fresh branch off `main`.

Files this will touch, most likely: `frontend/src/lib/components/layout/Header.svelte` (the navbar),
its shared `Popover`, `frontend/messages/{en,pl}.json`, and a new route for search.
