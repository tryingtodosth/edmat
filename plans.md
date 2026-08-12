# EdMat — next steps: four candidate plans

Written 2026-08-12, grounded in the current state: Redis + preload live on webek4, the extended
`preload_cache` on branch `worktree-preload-full-surface` (pushed, unmerged), UX quick-wins being
implemented on `ux-quick-wins` (4 surfaces × 3 fixes), and the four-agent UX review's findings.
Pick one plan as the spine; items from the others can be pulled in individually. Costs are rough
Claude-session estimates, since budget is the binding constraint.

---

## Plan A — Ship what exists (cheapest, ~2-3 short sessions)

The site works; the gap between "works" and "in front of users" is deployment chores, not features.

1. Merge `worktree-preload-full-surface` → main; deploy per `deploy/PRELOAD-DEPLOY.md`
   (paste-able commands, cron at the TTL cadence). *Half a session.*
2. Finish + merge `ux-quick-wins` (in flight now): verify with one full check/build pass,
   screenshot re-check of the 4 surfaces, merge, deploy. *Half a session.*
3. Seed real demo/tutoring data on webek4 (the UX review's own top tutoring finding — half that
   surface is invisible without it). `seed_demo_content` extension is part of ux-quick-wins.
4. Announce to the real users (todoonet, m.nazarczuk, jk.winiarczy, p.l.kasprzak) and collect
   actual feedback before building anything else. Free, and it decides Plan B vs C.

**Risk it accepts:** known gaps (email backend, per-worker throttles already fixed by Redis,
no CI) stay open. **Why it might be right:** real-user feedback is the cheapest prioritizer
that exists, and everything else below is a guess until someone uses the site.

## Plan B — Trust & launch-readiness (~4-6 sessions)

The UX review's cross-cutting theme was thin trust cues; LAUNCHCHECKLIST's open items point the
same direction. For a site asking students to trust solutions and strangers to meet tutors:

1. **Email backend** (one transactional provider or SMTP) — unblocks real password reset AND
   email-confirmation, which is what makes school-email verification worth anything (§17S's own
   sharpest argument). *1 session.*
2. **Trust surfacing** (frontend-only): verified-contributor badge visible on bylines, "who
   verified this and when" on the Verified badge, file size/date on materials, provenance line.
   *1 session.*
3. **Failed-attempt lockout** on login (counting failures, clearing on success — the real fix
   §17Q says DRF throttling can't express). Redis makes the shared counter trivial now. *1 session.*
4. **The copyright question (§18.2)** — not code: one real conversation with the course
   instructors whose material the corpus transcribes, before wider publicity. *Piotr's time.*
5. Moderation/reporting for the unreported surfaces (services, bookings, events, event posts —
   the gap §17P/17U/17V all name). *1-2 sessions.*

**Why it might be right:** these are the items that hurt most if the site gets real traffic
first and trust incidents second.

## Plan C — The REP/SKILL/ENERGY system (~8+ sessions, the big one)

`/levels` already promises it ("Designed, not built" on eight sections). USOS ground (§17S) and
`SkillEntry.evidence='registry'` are already waiting for it. Build order that pays as it goes:

1. REP events + a per-user ledger (earn on accepted submissions/reviews/translations — the
   events already exist as notification triggers, so the hook points are known). *2 sessions.*
2. Capability tiers computed from REP (the §3 ladder), replacing nothing — additive gates first
   (e.g. verified-contributor auto-grant at a tier). *2 sessions.*
3. Vote weight + energy costs on the surfaces that already vote (coverage claims). *2 sessions.*
4. `/levels` flips sections from "Designed" to "Live" one at a time — the page was built for
   exactly this. *Ongoing, cheap.*

**Risk:** biggest spend, and its value depends on having enough users for reputation to mean
anything — which argues for Plan A first. **Why it might be right eventually:** it's the
project's stated end-state and everything else already points at it.

## Plan D — Engineering debt & durability (~3-4 sessions)

The unglamorous list that makes every later session cheaper:

1. **CI** (GitHub Actions: backend test suite + `npm run check` + build + a clean-clone
   `pip install -r requirements.txt` — the exact check whose absence let requirements drift
   three times, §18.5). *1 session.*
2. **Frontend test runner**: promote the e2e scripts (300+ checks) from hand-run .mjs files to
   a single `npm run e2e` with the port/env pitfalls (E2E_API, register-throttle restart)
   scripted away. *1 session.*
3. **Postgres migration path** (§13's own note): a docker-compose or managed option, settings
   already env-driven; SQLite's single-writer workarounds (§17I/§17K) stop being needed. *1-2
   sessions, deploy-coupled.*
4. Backup/restore runbook for webek4 (the FUW rescue proved the cost of not having one).
   *Half a session, mostly writing.*

**Why it might be right:** every recurred bug in the project log (venv drift, stale dev DB,
throttle-exhausted e2e runs) is on this list's target.

---

## Recommendation

**A → B → (C or D by what feedback says).** A is nearly free and its step 4 (real users) is
the only source of truth about whether C's reputation system or B's trust polish matters more.
D's CI item is worth pulling forward into any plan — it's one session and it stops the class of
regressions that has already recurred three times.
