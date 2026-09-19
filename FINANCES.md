# EdMat — money

Two separate subjects that both get called "finances", kept apart here because they have almost
nothing to do with each other:

1. **What the software does about money** — which is, deliberately, nothing. Prices are text.
2. **How the project itself is funded** — grant applications, the foundation, hosting.

Split out of `CLAUDE.md` on 2026-09-19.

---

## 1. The product takes no money, anywhere

**There is no payment processing in this codebase.** No provider, no webhook, no order, no
invoice, no refund, no escrow. This is a standing decision, not an unbuilt feature — `AUDIENCE-BRIEF.md`
§10 records it as "no payments — prices stay display-only everywhere, as they are today", and it has
survived every feature that looked like it wanted one.

What exists instead:

| Field | What it is | What it is not |
|---|---|---|
| `Service.hourly_rate` + `currency` | A number a tutor types onto their listing so a student knows roughly what to expect | A charge. Booking an hour moves no money; a completed session is connected to nothing |
| `Material.price_amount` + `price_currency` | The same, on a teaching material | Same |
| `courses.Course` price | The same, on a user-run course. The form says so on screen | Same |

`price_currency` is a curated four-value `choices=` field — **PLN / EUR / USD / GBP** — mirrored by
hand in `frontend/src/lib/utils/labels.ts` as `MATERIAL_CURRENCIES`. The tradeoff was named when it
was made rather than discovered later: a governor who wants to price something in a currency outside
those four cannot, without a backend change. Four covers a Polish university with a realistic
international audience; it is not an attempt at a general currency picker.

### Donation links — the one money-adjacent feature that is real

`accounts.DonationLink` lets an account publish where people can send it money: a curated `platform`
choice (PayPal, PayU, BLIK, card, Apple Pay, Google Pay, Buy Me a Coffee, Ko-fi, Patreon, GitHub
Sponsors, bank transfer, other) plus an optional custom label. **EdMat never touches the money** — it
renders a link and the visitor leaves.

One deliberate privacy interaction worth knowing before changing it: donation links are shown
**regardless of `show_profile_publicly`**. That flag withholds identity and activity information a
visitor never asked this account to publish; a donation link is the opposite — something the account
holder actively added *so that it would be shown*. Adding one is itself the opt-in.

### The paid fast-track that was asked for and dropped

Asked for in §17AY: an optional fee to have a governor application read sooner, the money funding
scholarships and volunteer stipends. **Piotr dropped it on 2026-09-18** after the objection was put
to him, and the objection is the reason it should stay dropped:

> The thing being sold would be **priority for an application to gain authority over content other
> people wrote.** Every złoty going to scholarships does not change how that reads, and it would give
> the queue an incentive to stay slow.

Selling priority for a volunteer's paid time on something neutral — a transcription, a translation —
does not have that problem. Selling it on moderation applications does. The reasoning is carried in
`moderation/models.py`'s own docstring, where the hook would have gone, so that a future reader finds
it in the code rather than only here.

The governor queue is therefore **first come, first served, with no priority column and no hook for
one**. What an applicant gets instead is the truth about where they stand: a `queue_position`, shown
next to a sentence saying nobody can be read sooner.

### If payments ever are built

They would be a genuinely new surface, not a field: a provider integration, webhooks (there is a
`webhooks-design.md` at the repo root, unimplemented), refunds, a dispute path, invoices under Polish
law, and a moderation/reporting story for every one of them. Nothing in the current model is shaped
to be extended into it — `hourly_rate` is a display string on a listing, not the price of anything.

---

## 2. Funding the project

### ING "W rytmie pokoleń" (2026)

EdMat applied to ING Bank Śląski's grant programme (9th edition), Liga Seed, as *Młody Naukowiec +
Zespół*, submitted 2026-09-17 by Piotr Putyło. The kit lives in **`grant/ING-2026/`** — a rules
digest and checklist (`README.md`), the Polish form answers (`formularz.md`), the deck
(`.drawio` → PDF via `build_deck.py` / `finish_deck.py` / `render_deck.mjs`), and
`fundacja.md`. `grant/CLAUDE.md` is the guide for working on any deck in this repo.

Timeline: finalists announced 2026-10-14; a mandatory individual pitch workshop between 26.10 and
6.11; the final on 2026-11-25 in Warsaw (a 5-minute pitch plus about 3 minutes of questions). Prizes
are paid to team members' personal accounts, with ING covering the 10% tax — the foundation below
cannot be the applicant under the programme's own rules.

**Two rules for anyone touching that folder:**

- **The deck is hand-edited on another machine.** Piotr keeps it open in draw.io and a `.$….dtmp`
  autosave syncs into the folder. Never re-run `build_deck.py` against a deck he has touched — check
  `git status` and modification times first. `finish_deck.py` only renumbers by default; its
  `--regen-core` / `--rebuild-team` flags overwrite hand edits on the pages they touch.
- **The kit is never published.** `origin/main` carries no `grant/` directory: the repository is
  public and the deck's money slides are inside. Since 2026-09-19 the arrangement is explicit rather
  than a matter of remembering — the ordinary code and docs commits are replayed onto `origin/main`
  without the `grant/` (and `deploy/`) paths, the commits that add the kit stay on the local branch
  `grant-kit-local`, and local `main` is expected to diverge from `origin/main` permanently.
  **Never force-push `main`**, and ask before any push.

### The foundation

Decided on submission day (2026-09-17) to be founded **immediately** rather than in Q1 2027: notarial
act in September, KRS filing in October, entry by the end of 2026, first fiscal year closed
31.12.2026. Details and the founding checklist are in `grant/ING-2026/fundacja.md`.

### Post-grant model

The deck's own money map (slide 18) is the current thinking: patronage and CSR, institutional grants,
and a freemium test generator — explicitly **not** school hosting fees and **not** a commission on
tutoring. One thing in the deck is still unreconciled and worth settling before the pitch: slide 7
treats promoting your own tutoring offer as an engagement reward, while slide 10 says tutoring is
frozen for the duration of the grant.

### Hosting

The service runs on faculty infrastructure (webek4, `edmat.net`) administered by Ośrodek Komputerowy
Wydziału Fizyki UW — see `deploy/` and `LEGAL.md` §1. No commercial hosting bill sits inside this
repository, and no third-party paid service is a runtime dependency: Nominatim and the OSM tile
servers are free public instances (with the policy obligations `LEGAL.md` §2 records), and the pieces
that would cost money — an email provider, a CDN, a managed Redis — are precisely the ones still
listed as unbuilt.
