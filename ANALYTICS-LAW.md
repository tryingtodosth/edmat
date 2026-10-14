# Analytics without consent, the terms of use, the privacy policy and third-party sign-in — research brief

Researched 2026-10-14 for the owner's question: *"What kind of analytics can we get from users with
our functional cookies etc. WITHOUT asking for their consent — the goal is to analyse the data we
collect in order to improve the service; no Google Analytics, no ads, no selling data."* It also
covers the two things that question pulls in with it: the terms of use (*regulamin*) and privacy
policy have to match the law as it stands today, and the service has to be ready for "Sign in with
Google, Apple, Microsoft".

> **None of this has been reviewed by a lawyer, or by the University's data protection officer
> (IOD UW).** This note is research for engineering. It builds on `LEGAL.md`, corrects it where it
> has gone stale (§6.3), and says plainly where a source could not be opened. Nothing here may be
> quoted to a user, a data subject or the Faculty as advice until somebody qualified has read §4
> and §8.

Markers, as in `CONTESTS-LAW.md`:
**[VERIFIED]** — the primary text was opened and the quote comes from it.
**[SECONDARY]** — an authoritative restatement (a regulator's working paper, a law-firm note, a
DPA's own site practice), not the primary text.
**[UNVERIFIED]** — from memory or from a source that could not be opened. Check before relying on it.
**[DISPUTED]** — the law is genuinely open, and a lawyer has to choose a side.

Some primary sites could not be reached during the research: EUR-Lex returned empty pages, cnil.fr
was in maintenance, and Apple's developer documentation would not render. Where that matters, the
marker says so.

---

## 1. The short answer

1. **Polish law has no "analytics" exemption from the cookie rule.** The rule is **art. 399 Prawa
   komunikacji elektronicznej** (PKE, in force since 10 Nov 2024). It has exactly two exemptions:
   transmission, and storage or access that is *necessary* to supply a service the user requested.
   France's audience-measurement exemption is the CNIL's own reading of "strictly necessary", and no
   Polish authority has adopted it. The EU **Digital Omnibus** would create such an exemption
   (proposed GDPR art. 88a(3)(c)), but as of October 2026 it is **not adopted**: there is no
   Parliament position and no trilogue. Do not build on it.
2. **So the line is the device, not the cookie.** Under the EDPB's Guidelines 2/2023, anything the
   site *instructs the browser* to store or send — a cookie, a localStorage id, a pixel, a
   JavaScript beacon carrying Web Vitals or screen size — is "storage" or "gaining access" under
   ePrivacy art. 5(3), and therefore under PKE art. 399. Without an exemption, that needs consent.
   What the server writes down from requests the browser makes anyway (path, status, timing,
   User-Agent, referrer, the account behind an already-required token) is ordinary GDPR processing.
3. **That still leaves a useful analytics product, built entirely from server logs and the database:**
   - traffic and views per route and per piece of content
   - referring sites, reduced to the domain
   - browser, OS and device class
   - latency and error rates
   - zero-result search counts, without the search term
   - aggregate activity and retention cohorts for signed-in users

   All of these are **class A** or **class B** in §3.
4. **What needs consent today (class C):** any persistent visitor id on the device; a Web Vitals or
   device-property beacon; and, as this project reads the law, a hashed IP+User-Agent daily id (the
   "Plausible" method). A client-side JavaScript error beacon is **class B**: defensible under PKE's
   word "konieczne" if it is strictly limited, but not settled.
5. **The legal basis is probably not legitimate interest.** The operator is a unit of a **public
   university**. GDPR art. 6(1) says, in its last sentence, that point (f) "shall not apply to
   processing carried out by public authorities in the performance of their tasks", and the EDPB
   reads that strictly. The recommended basis is **art. 6(1)(e)** (public task), anchored in
   art. 11 ust. 1 of the Prawo o szkolnictwie wyższym i nauce. The current privacy policy's
   art. 6(1)(f) wording for the request log has the same problem. See §4. **This is the first
   question for IOD UW.**
6. **The terms of use do not exist, and from 6 November 2026 Poland's DSA act is in force.** §5 is the
   checklist of mandatory sections. **The privacy policy is out of date in at least five ways**: it
   says nobody outside the Faculty receives data, but OVH now does; there is no IOD contact; there is
   no legal basis per purpose; it does not mention mail, the geolocation lookup or the per-user view
   tables; and its claim that deletion runs daily cannot be confirmed. See §6.
7. **Sign-in providers: the code is the small part.** The owner has to register three apps, verify
   `edmat.net` with Google, enrol in Apple's paid developer programme and register the mail domain
   with Apple's relay (otherwise mail to Apple relay addresses bounces), and ask UW IT about
   Microsoft tenant consent. The to-do list is §7.4.

---

## 2. The legal framework

### 2.1 The cookie rule in Poland: PKE art. 399

Prawo komunikacji elektronicznej, Dz.U. 2024 poz. 1221. **[VERIFIED]**, ISAP consolidated text:
<https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20240001221/T/D20241221L.pdf>

- **ust. 1**: *"Przechowywanie informacji lub uzyskiwanie dostępu do informacji już przechowywanej w
  telekomunikacyjnym urządzeniu końcowym abonenta lub użytkownika końcowego jest dozwolone, pod
  warunkiem że:"* the user (pkt 1) is first told the purpose clearly, (pkt 2) *"wyrazi na to zgodę"*,
  and (pkt 3) the terminal's configuration is not changed.
- **ust. 2**: consent may be given through browser or software settings.
- **ust. 3**, the only exemptions: *"Warunków, o których mowa w ust. 1, nie stosuje się, jeżeli
  przechowywanie lub uzyskanie dostępu do informacji … jest konieczne do: 1) wykonania transmisji
  komunikatu elektronicznego za pośrednictwem publicznej sieci telekomunikacyjnej lub 2) dostarczania
  usługi telekomunikacyjnej lub usługi świadczonej drogą elektroniczną, żądanej przez abonenta lub
  użytkownika końcowego."*
- **art. 400**: consent is governed by the data-protection rules, i.e. GDPR-grade consent.

Two observations:

- The Polish text says *konieczne* ("necessary") and *żądanej* ("requested"). It does not say
  "strictly necessary" or "explicitly requested", as Directive 2002/58 art. 5(3) does. Read
  literally, that is a little looser. **[UNVERIFIED]**: no commentary or case law was found that
  relies on the difference, and a court would read the provision in line with the Directive.
- ust. 3 lifts *all* the ust. 1 conditions, including the duty to inform. GDPR art. 13 still
  requires the disclosure, so the privacy policy keeps its storage table regardless.

No amendment to art. 399 since 10 Nov 2024 was found. The full amendment history was not checked
**[UNVERIFIED]**.

### 2.2 What counts as "access": EDPB Guidelines 2/2023

Guidelines 2/2023 on the technical scope of art. 5(3) ePD, v2.0, adopted 7 Oct 2024. **[VERIFIED]**:
<https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf>

- **para 32**: "Whenever an entity takes steps towards gaining access to information stored in the
  terminal equipment, Article 5(3) ePD would apply."
- **para 33, JavaScript**: "JavaScript code, where the accessing entity instructs the browser of the
  user to send asynchronous requests with the targeted information. Such access clearly falls within
  the scope of Article 5(3) ePD." **This is what puts a Web Vitals beacon and an error beacon in
  scope.**
- **paras 42–43, protocol data**: the IP address, HTTP headers ("accept", user agent) and ETag are
  named. "Relying on those mechanisms to collect information (for example in the context of
  fingerprinting or the tracking of resource identifiers) can lead to the application of
  Article 5(3) ePD."
- **paras 44 and 53**: computing something inside the device is not access, but "when this
  information or any derivation of this information is accessed, Article 5(3) ePD would apply." A
  performance score computed in the browser and posted to the server is access.
- **paras 50–51, pixels**: distributing a tracking pixel is storage, at least through the cache.
  "The collection of identifiers provided through such tracking mechanisms constitutes a 'gaining of
  access'".
- **paras 54–55, IP-only tracking**: "Unless the entity can ensure that the IP address does not
  originate from the terminal equipment of a user or subscriber, it has to take all the steps
  pursuant to the Article 5(3) ePD."
- **paras 40 and 56**: being in scope "does not systematically mean that consent needs to be
  collected". The exemptions still apply.

**The residual risk in plain logs.** Nowhere do the Guidelines say that passively logging the
headers of a request the user made is *outside* art. 5(3). Paras 42–43 and 55 bring protocol data
back in when it is *relied on to collect information* or to track. The project's position (stated
in the `backend/telemetry/models.py` docstring) is that a server-side log of requests is not access,
because the site sends the browser no instruction and the browser sends what it always sends. That
position is the mainstream reading, and the German DSK names "log files without personal data" and
"a simple counting pixel of the service itself" as plain counting (below). But it is **not
confirmed by any authority for Poland [DISPUTED, low]**. The safest form of it is the one §3
prescribes: aggregate, coarse, and never stitched into a per-visitor identity.

**German DSK, Orientierungshilfe Digitale Dienste v1.2 (Nov 2024).** **[VERIFIED]**:
<https://datenschutzkonferenz-online.de/media/oh/OH_Digitale_Dienste.pdf>

- paras 23–24: fingerprinting is access "wenn aktiv – beispielsweise mittels JavaScript-Code –
  Eigenschaften eines Endgerätes ausgelesen … und … an einen Server übermittelt werden", with
  screen resolution named as an example.
- paras 88–90: the DSK separates "eine reine Zählung" (a page-impression counter, log files without
  personal data, a simple counting pixel of the service itself that collects no further user data)
  from analytics. Even simple visitor counting is "nicht per se" part of the basic service, and
  "abhängig vom jeweils konkret verfolgten Zweck".
- para 26: the art. 5(3) requirement applies "unabhängig von einem Personenbezug".

It is persuasive authority only, and the closest any regulator comes to describing the minimal
design in §3.

### 2.3 The French benchmark: CNIL's audience-measurement exemption

Persuasive only. It is a French reading of the French transposition.

- Lignes directrices of 17 Sept 2020 (délibération 2020-091), paras 50–52. **[VERIFIED]** from the
  PDF: <https://www.cnil.fr/sites/cnil/files/atoms/files/lignes_directrices_de_la_cnil_sur_les_cookies_et_autres_traceurs.pdf>
  - Tracers whose purpose is limited to audience measurement are "strictement nécessaires au
    fonctionnement et aux opérations d'administration courante", provided that:
    - the purpose is "strictement limitée à la seule mesure de l'audience … pour le compte exclusif
      de l'éditeur";
    - there is no cross-site tracking;
    - they produce "uniquement … des données statistiques anonymes";
    - the data are not combined with other processing and not passed to third parties.
  - The GDPR still applies in full (para 52).
- Consolidated recommendation (Jan 2026). **[VERIFIED]**:
  <https://www.cnil.fr/sites/default/files/2026-01/recommandation_cookies_consolidee.pdf>
  - Inform users, for example in the privacy policy.
  - Tracer lifetime of the order of **13 months**, not extended on each visit.
  - Data kept at most **25 months**.
- CNIL "Fiche 16" adds an objection mechanism and truncation of the last IP byte **[SECONDARY]**,
  because cnil.fr was down and the text was not opened.

Every exempt-by-CNIL technique that touches the device still sits in **class C** in Poland until a
Polish authority, or the EU, says otherwise. Its conditions are nonetheless the right design bar for
class A and B (§3).

### 2.4 The EU direction: the Digital Omnibus, and the withdrawn ePrivacy Regulation

- **Digital Omnibus (data track)**: COM(2025) 837, procedure 2025/0360(COD), 19 Nov 2025. It moves the
  device-access rule into the GDPR as art. 88a, with exemptions in para 3, and adds art. 88b
  (machine-readable consent and objection signals). The exemption's wording is known only through
  Council papers, because EUR-Lex was unreachable. **[SECONDARY]** The Latvian delegation's note, WK
  3736/2026 ADD 6 (8 Apr 2026): "The proposed exception in Article 88a(3)(c) for audience measurement
  without the need for consent is formulated narrowly, only for aggregated information on the use of
  an online service, where the data controller makes the measurements 'solely for its own purposes'."
  <https://data.consilium.europa.eu/doc/document/WK-3736-2026-ADD-6/en/pdf>. The Presidency paper WK
  2802/2026 (20 Feb 2026) records "broader support" for that exemption and "serious concerns" from
  some Member States about moving the rule into the GDPR:
  <https://data.consilium.europa.eu/doc/document/WK-2802-2026-INIT/en/pdf>
- **Status in October 2026: not adopted.** **[SECONDARY]**, from two mid-September 2026 trackers:
  - the joint LIBE–ITRE draft report appeared on 22 June 2026, and more than 1,750 amendments were
    tabled;
  - Parliament has had no committee vote;
  - a COREPER mandate vote was cancelled, and whether a vote expected around 11 Oct 2026 took place
    could not be confirmed;
  - competing Council texts keep or delete art. 88a.
  - Sources: <https://acompli.ie/news/digital-omnibus-gdpr-cookies-status-september-2026/>,
    <https://www.praxikon.com/en/avg/digital-omnibus>. Realistic adoption is 2027 or later.

  **If it is adopted roughly as proposed**, a first-party, aggregate-only, own-purposes visitor
  counter would move from class C to class A. The design in §3 is the shape that would qualify.
- **ePrivacy Regulation**: the Commission announced its withdrawal on 11 Feb 2025 (2025 Work
  Programme) **[SECONDARY]**:
  <https://www.lewissilkin.com/en/insights/2025/02/19/long-awaited-eprivacy-regulation-is-finally-dead-102k0fn>.
  The Directive and PKE remain the law.

### 2.5 UODO

No UODO guideline or decision on analytics cookies, or on legitimate interest for analytics, was
found **[UNVERIFIED — absence]**. Commentary says UODO in practice points to the EDPB and the CNIL
**[SECONDARY]**.

One fact worth knowing: **uodo.gov.pl itself loads a self-hosted Plausible script**
(`stat.uodo.gov.pl`, the page source carries the comment "Privacy-friendly analytics by Plausible").
This was seen in the page source today **[VERIFIED as practice]**. It is evidence of what the
regulator does, not a ruling on what the law requires. Whether UODO shows a banner for it, and what
legal basis it states, was not checked.

### 2.6 GDPR rules that apply to every technique

- **Art. 5(1)(b) and art. 89(1)**: further processing for statistical purposes is "not considered
  incompatible" with the original purpose, subject to art. 89 safeguards (minimisation,
  pseudonymisation where possible). This is what lets the security log also feed aggregate
  statistics, **provided the privacy policy names the purpose** **[UNVERIFIED as to the exact
  wording of art. 89(1); the rule is standard]**.
- **Art. 21(1)**: whether the basis is (e) or (f), a person may object, and processing must stop
  unless there are compelling grounds. **Art. 21(5)**: the objection may be made "by automated means
  using technical specifications". The EDPB's December 2023 letter on Do Not Track says art. 21(5)
  "should not be read as imposing a general requirement that website operator respect a user's Do
  Not Track settings", while noting that some authorities encourage it and that the EDPS requires it
  of EU institutions. **[VERIFIED]**:
  <https://www.edpb.europa.eu/system/files/2023-12/edpb_letter_out2023-0099_donottrack_en.pdf>.
  No authority has addressed Sec-GPC in the EU **[UNVERIFIED — absence]**.
- **Pseudonymised data is personal data.** EDPB Guidelines 01/2025 on pseudonymisation, para 22, from
  the consultation version of 16 Jan 2025 (the final version was not confirmed) **[VERIFIED]**:
  <https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf>.
  A salted hash is personal data while the salt, or anything else that could re-link it, exists.
- **Children**: art. 6(1)(f) names children explicitly as weighing against the controller's
  interest, and recital 38 asks for specific protection. Art. 12(1) requires information addressed
  to a child to be in language a child can understand.

---

## 3. Classification of the candidate techniques

**A** — consent-free and safe, under the conditions given.
**B** — consent-free, but arguable: it needs the stated conditions and a documented assessment.
**C** — needs consent under PKE art. 399 today.

These conditions apply to every row and are not repeated in each one:

- **Purpose limitation**: improving the service, its security and its operation, for EdMat only.
  Never shared, never combined with another dataset, never used to make a decision about a person.
- **Aggregation before anyone looks**: the dashboard shows counts. A raw `RequestLog` row is never an
  analytics surface.
- **A suppression threshold**: no cell under **k = 10**. A bucket of a group with fewer than 10
  distinct users or sessions is shown as "<10". That matters most for small branches, a niche
  exercise, or a signup week with three sign-ups.
- **Retention**: raw rows follow the existing log retention (full IP 30 days, row 90 days).
  Aggregates contain no identifiers and may be kept longer; 25 months is the CNIL benchmark and a
  reasonable default.
- **Disclosure**: a named purpose and basis in the privacy policy, in both languages.
- **An objection route** under art. 21: a settings switch for signed-in users, plus honouring
  Sec-GPC (last row).

| # | Technique | Class | Why | Conditions specific to it |
|---|---|---|---|---|
| 1 | **Server access-log aggregation by route** (requests per route per day, status mix) | **A** | No instruction to the device; data the server already receives and already logs for security (art. 6(1)(e)/(f) plus recital 49). Statistics are a compatible further purpose (art. 5(1)(b), art. 89). | Aggregate by route *template* (`/exercises/:id`), not the raw path, for the dashboard. The query string stays redacted as now (`telemetry/middleware.py`). |
| 2 | **Per-content view counts from logs** | **A** | Same as 1, keyed by content id. | Count requests or distinct-per-day user ids **without storing who**. ⚠ The project already keeps **per-user** view tables, `moderation.ContentView` and `materials.MaterialView`, indefinitely. They serve auto-hide and recommendations rather than analytics, but they are personal data, they are not in the privacy policy, and they have no retention rule. See §6. |
| 3 | **Referrer domain aggregation** | **A** | The referrer header is sent by the browser unprompted. | Reduce to the host (`google.com`, `usosweb.uw.edu.pl`) before aggregating. Drop the path and query: a referrer path can carry a search term or an identifier from the other site. Suppress hosts under k. |
| 4 | **User-Agent → browser / OS / device class** | **A** | Passive header. Coarse classes are not fingerprinting. | Parse into at most about 3 coarse fields (family, major version, mobile/desktop/tablet). **Never combine with IP or `Accept-Language` into a key** (EDPB 2/2023 paras 42–43; the existing `test_no_visitor_fingerprint`). Discard the raw string at aggregation; the log row keeps it only for its 90 days. |
| 5 | **Distinct signed-in user counts (DAU/WAU/MAU) and signup-week retention cohorts** | **B** | No new device access: the token is read from localStorage and sent because the user asked to be signed in, which is exempt under art. 399 ust. 3 pkt 2. Reusing the resulting `user_id` for statistics is a GDPR question, not a PKE one, but it is **analysis of identified people's behaviour**. It is defensible as statistics (art. 89), not as profiling, *if* nobody ever looks at a person. Some readers would argue that information obtained under an exemption may only serve that exemption's purpose; no authority states this for server-side reuse **[DISPUTED, low]**. | Compute in a batch job into a table keyed by `(cohort week, weeks since signup) → count`, never `user_id → activity`. **k ≥ 10** per cell. **Exclude minors' accounts** (`Profile.is_minor`), or merge them into the adult cells only above k; the balancing for children is heavier and there is little to gain. Honour the art. 21 objection by excluding objecting users from the input. Use only the 90-day log window and `date_joined`; do not add a "last seen" history table for this. |
| 6 | **Latency and error-rate monitoring** | **A** | Security and correct operation are named in recital 49; `duration_ms` and `status_code` are already logged. | None beyond the defaults. p50/p95 per route template, 5xx rate, 429 rate. |
| 7 | **Counting searches and zero-result searches, without the term** | **A** | Server-side; the term never stored (as now). | Count `(endpoint, results==0)` per day, server-side in the view, not in the log. **Do not** start storing zero-result *terms*, even aggregated, without a separate review: a term on a study site can reveal a person's difficulties, and a rare term identifies its searcher. If wanted later: only terms that ≥ k distinct users searched, normalised, reviewed by a human before display. That would be **B**. |
| 8 | **Client-side JavaScript error beacon** (`window.onerror` → POST) | **B** | The script instructs the browser to send information, so it is "access" (EDPB para 33). The exemption argument is that reporting the app's own crash is *konieczne* to supply the requested service (PKE's wording, §2.1). Plausible, but no authority has said so. | Send **only**: error message, stack, route template, app build id, timestamp. **No** screen size, viewport, device memory, language list, timezone, plugin list, or user id in the body (the server already knows the token if one is sent). Only on an actual error, rate-limited per page load. Strip URLs and query strings from stack frames down to the path. Raw reports kept 30 days. Disclosed in the storage/access table. If IOD UW is uncomfortable, fall back to server-side 5xx logging only (row 6). |
| 9 | **Web Vitals performance beacon** (LCP, INP, CLS posted from the browser) | **C** | Measurements derived on the device and sent at the script's instruction (EDPB paras 33, 53). Polish law has no performance or audience exemption. Performance improvement is not *necessary* to supply the page the user asked for. | Alternatives: server timing (row 6), lab measurements (Lighthouse in CI or by a developer), or opt-in field measurement. Would become **A**-like under Omnibus art. 88a(3)(c) if adopted, and is consent-free in France under CNIL conditions. |
| 10 | **First-party analytics cookie or localStorage visitor id** | **C** | Storage on the device for a purpose that is not the requested service. This is precisely the case the CNIL had to *create* an exemption for, and Poland has none. | If ever wanted: a real opt-in at the point of use (the existing privacy text already promises "we will ask you … in the place it applies"), a 13-month non-renewing lifetime, a separate consent cookie, withdrawal as easy as consent (art. 7(3)). |
| 11 | **Hashed IP + User-Agent into a rotating daily visitor id** (the Plausible / Fathom method) | **C** as this project reads it; arguably **B** | No device storage, and no script if done purely on the server. But EDPB 2/2023 paras 42–43 and 54–55 bring IP and header data back inside art. 5(3) when relied on to *track* — and a daily unique-visitor id is a tracking identifier by design. Under the GDPR the hash is pseudonymous personal data while the salt lives (EDPB 01/2025 para 22). Practice is split: UODO's own site runs Plausible (§2.5); the DSK declines to call visitor counting per se exempt (paras 88–90). No authority has ruled on the method **[DISPUTED]**. | **Not recommended.** It contradicts the project's own published promise ("no identifier that would let us recognise you as a returning visitor") and the `test_no_visitor_fingerprint` test, and it buys little: anonymous unique visitors per day. Row 1's request counts plus row 5's signed-in counts answer almost every improvement question. Revisit if the Omnibus is adopted or UODO publishes a position. |
| 12 | **Honour Sec-GPC and DNT as an art. 21 objection signal** | **A** (do it) | Art. 21(5) permits objection by automated means. Honouring the signal is not a verified legal duty (EDPB DNT letter), but it is cheap, the EDPS does it, and Omnibus art. 88b would make browser signals mandatory if adopted. | On `Sec-GPC: 1` or `DNT: 1`, flag the log row `analytics_excluded=True` (or route it to a security-only shard), and exclude it from every row above. **Keep** the row for security (rows 1 and 6 as security logging), because the objection yields to "compelling legitimate grounds" there. Say both things in the policy. A signed-in user's "exclude me from statistics" setting has the same effect. |

**Data already on the device** (the inventory the brief asked for, from a grep of `frontend/src`).
Every item is user-requested functionality and exempt under art. 399 ust. 3 pkt 2. Nothing is an
analytics identifier.

| Key | Where | Purpose |
|---|---|---|
| `PARAGLIDE_LOCALE` (cookie) | Paraglide | interface language for the next paint |
| `edmat-auth-token` | localStorage | the sign-in token |
| `edmat.localeChoice`, `edmat.localeGuess` | localStorage | a language the visitor chose; that they were once offered English (the result of the IP-country hint) |
| `edmat-theme`, `edmat.textSize`, `edmat.highContrast` | localStorage | appearance and accessibility |
| `edmat.audienceFilter`, `edmat.contentLocales` | localStorage | content filters the reader set |
| `edmat.editorMode`, `edmat.coopLayout`, `edmat-materials-ui-mode`, `edmat-open-sections`, `edmat.exerciseSort.*` | localStorage | interface preferences |
| `edmat-guest-set` | localStorage | "My Set" for a signed-out visitor |
| `edmat-browsing-history` | localStorage | recently viewed exercises, for the random picker; never sent |
| `edmat-cache:*` | localStorage | offline copy of some lists |
| `edmat.returnTo` | sessionStorage | where to go back to after signing in |
| scanner queue | IndexedDB | the door scanner's offline queue (events) |

The privacy policy's table lists six of these; §6 has the gap.

---

## 4. The public-authority question and the legal basis

### 4.1 Does the last sentence of art. 6(1) bite?

GDPR art. 6(1), final subparagraph: *"Point (f) of the first subparagraph shall not apply to
processing carried out by public authorities in the performance of their tasks."* **[UNVERIFIED
verbatim; quoted from the Regulation's text without reopening EUR-Lex. The wording is well known.]**

EDPB Guidelines 1/2024 on legitimate interest, v1.0 for consultation, 8 Oct 2024; whether a final
version exists was not confirmed. **[VERIFIED]**:
<https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf>

- **para 98**: recital 47, "it is for the legislator to provide by law for the legal basis for public
  authorities to process personal data".
- **para 99**: public authorities may rely on (f) only "in exceptional and limited cases … when the
  processing is not linked to or does not relate to the performance of their specific tasks …
  Relying on Article 6(1)(f) GDPR in such exceptional cases should be documented internally. In no
  circumstances, public authorities may rely on Article 6(1)(f) for processing activities falling
  within the scope of the performance of their tasks."

**Is Uniwersytet Warszawski a "public authority" here?** The GDPR does not define the term. Three
facts point towards yes:

1. A *uczelnia publiczna* is a jednostka sektora finansów publicznych (ustawa o finansach publicznych
   art. 9 — **[UNVERIFIED]** which point).
2. The Polish GDPR-implementing act (ustawa o ochronie danych osobowych 2018, art. 9) uses that
   category for "podmioty publiczne" **[UNVERIFIED]**.
3. Polish universities' own privacy notices routinely cite art. 6(1)(e) with the PSWiN
   **[SECONDARY]**.

No Polish authority or case was found that answers the question directly **[DISPUTED]**.

**Is running EdMat "the performance of its tasks"?** PSWiN (ustawa z 20 lipca 2018 r.) art. 11
ust. 1 **[VERIFIED]** from a consolidated print dated 2026-08-03: "Podstawowymi zadaniami uczelni są:
1) prowadzenie kształcenia na studiach; … 9) upowszechnianie i pomnażanie osiągnięć nauki i kultury,
w tym przez gromadzenie i udostępnianie zbiorów bibliotecznych, informacyjnych i archiwalnych". A
study resource for the University's own students, run on University infrastructure by its computer
centre, sits naturally under pkt 1 and pkt 9. Improving that resource is part of performing the
task.

**Conclusion.** The conservative reading — and the one IOD UW is likely to take — is that the last
sentence **does bite**. Art. 6(1)(f) is then unavailable for EdMat's ordinary processing, analytics
included. **That also affects text already published**: `privacy.ts` grounds the request log on
art. 6(1)(f) and recital 49.

### 4.2 What instead

| Processing | Recommended basis | Note |
|---|---|---|
| Account, content, messages, courses, events, contests (the service itself) | **art. 6(1)(b)** (contract — the regulamin, §5) and, for the University's task, **(e)** | (b) needs the regulamin to exist. Today it does not, which weakens (b) until it does. |
| Security request log (`RequestLog`, `AuditEvent`) | **art. 6(1)(e)** + PSWiN art. 11 ust. 1; for the security purpose also **(c)** with art. 32 GDPR (the duty to secure processing) **[UNVERIFIED that (c) + art. 32 suffices; it is a common reading]** | Rewrite the privacy text's "(f) + recital 49" sentence. Recital 49 stays as a supporting reference. |
| Service-improvement statistics (§3 rows 1–8) | **art. 6(1)(e)**, with art. 5(1)(b) and art. 89(1) statistical compatibility | Document the necessity and proportionality test: the same points a (f) balancing would cover (expectations, minors, aggregation, k, retention, objection). If IOD UW concludes that EdMat is *not* a University task (for example because students run it), the fallback is (f) under EDPB para 99, "documented internally", and the same document serves. |
| Guardian consent, publishing a contest winner's name, any future class-C analytics | **art. 6(1)(a)** consent | With withdrawal as easy as giving consent. |
| Mail: confirmation and reset | (b) | Digest: (b) — it is an opt-in feature setting, not consent to marketing. |
| Sign-in providers | (b), the person chose the method | |

**Art. 6(3) is the weak point of (e).** The task must be laid down in law, and the processing
must be necessary for it. Art. 11 PSWiN is a general task clause. Whether it is "clear and precise"
enough for website statistics is not settled **[DISPUTED]**. Art. 21(1) objection applies under (e)
exactly as under (f), so row 12 of §3 is needed either way.

**Who is the controller.** The Ośrodek Komputerowy WF UW is an organisational unit without legal
personality. The *administrator danych* is almost certainly **Uniwersytet Warszawski** acting through
the Rector, with IOD UW as its DPO **[UNVERIFIED — standard for Polish universities, confirm with IOD
UW]**. `privacy.ts` names the Ośrodek as the party "responsible". That should become "Administrator:
Uniwersytet Warszawski, ul. Krakowskie Przedmieście 26/28, 00-927 Warszawa; the service is run by
Ośrodek Komputerowy WF; IOD: [address]" **[UNVERIFIED address; get it from IOD UW]**.

### 4.3 Recommendation

Build rows 1–7 and 12 of §3 now. Build row 8 only after IOD UW agrees. Do not build rows 9–11.
Ground the processing on **(e)**, with a written necessity and proportionality note that also covers
the (f) fallback. Rewrite the request-log basis in `privacy.ts` in the same change.

---

## 5. Terms of use (*regulamin*): mandatory checklist

The research notes for this section are in the hand-back of the terms-of-use research. The sources
are cited inline.

### 5.1 The statutes in force

- **u.ś.u.d.e.** (ustawa o świadczeniu usług drogą elektroniczną), consolidated text **Dz.U. 2024
  poz. 1513**, which supersedes 2020/344 **[VERIFIED]**:
  <https://api.sejm.gov.pl/eli/acts/DU/2024/1513/text.html>
- **Poland's DSA act**: *Ustawa z dnia 4 września 2026 r. o zmianie ustawy o świadczeniu usług drogą
  elektroniczną oraz niektórych innych ustaw*, **Dz.U. 2026 poz. 1296**, published 6 Oct 2026, in
  force **6 Nov 2026**. **[VERIFIED]** from the Sejm ELI metadata:
  <https://api.sejm.gov.pl/eli/acts/DU/2026/1296>
  - The Prezes UKE becomes the Digital Services Coordinator (KRRiT for video platforms, UOKiK for
    consumer interests) and takes user complaints.
  - It also amends the copyright act and the Civil Code; what it changes there was not read
    **[UNVERIFIED]**.
  - The second act, on blocking orders (Sejm print 2693), is **still in the Sejm**
    **[SECONDARY]**: <https://cyberdefence24.pl/polityka-i-prawo/polska/prezydent-podjal-decyzje-ws-pierwszej-ustawy-wdrazajacej-dsa>
  - This agrees with `LEGAL.md` §9, which had the signature date (25 Sept 2026) and the start date
    from secondary sources. The publication is now verified.
- **DSA, Regulation (EU) 2022/2065.** EdMat stores user content and disseminates it to the public, so
  it is a **hosting service** and almost certainly an **online platform** **[UNVERIFIED as to the
  art. 3 text; the conclusion is standard]**.

### 5.2 The art. 19 question, which decides how much of the DSA applies

Art. 19(1): Section 3 of Chapter III (**arts 19–28**: internal complaints, out-of-court settlement,
trusted flaggers, misuse, platform transparency, dark patterns, recommender systems, **minors art.
28**) "shall not apply to providers of online platforms that qualify as micro or small enterprises"
under Recommendation 2003/361/EC. The exception is art. 24(3), the duty to publish average monthly
active recipients, which applies anyway. **[SECONDARY]** via eu-digital-services-act.com; the
official text is <https://eur-lex.europa.eu/eli/reg/2022/2065/oj>.

**Whether the exemption applies to EdMat is genuinely open [DISPUTED].**

- Recommendation 2003/361 measures the *enterprise*. If the University is the enterprise, it is far
  above 50 staff, and the exemption fails.
- If a free, non-commercial service is not "economic activity" at all, the platform rules arguably
  still apply because the DSA does not require remuneration in the same way, but the size test then
  has no subject.

**Recommendation:** draft as if arts 20, 23 and 28 apply. They are cheap, and EdMat already has
most of the machinery (moderation appeals, minors rules, no profiling ads). Leave out only art. 21's
duty to *engage* with certified out-of-court bodies; mention them as information.

### 5.3 The checklist

Each item below gives its source and whether EdMat has it today.

**u.ś.u.d.e. art. 8 — the statutory minimum** **[VERIFIED]**

- [ ] **Provided free of charge before the contract** (registration), in a form that can be
  downloaded, reproduced and stored (art. 8 ust. 1 pkt 2). A user is **not bound** by anything not
  made available that way (ust. 2). Today: no regulamin.
- [ ] **Types and scope of the services** (ust. 3 pkt 1). List them: the exercise and material
  database, submissions and translations, comments and reviews, courses, tutoring listings and
  booking, events and registration, contests hosting, messaging, flashcards, the learning record,
  organisations and the management layer, mail notifications.
- [ ] **Technical requirements** (ust. 3 pkt 2 lit. a): a current browser with JavaScript; an email
  address for registration; nothing installed.
- [ ] **A ban on supplying unlawful content** (ust. 3 pkt 2 lit. b).
- [ ] **Conclusion and termination** (ust. 3 pkt 3):
  - registration with acceptance creates the contract;
  - browsing without an account is a separate, contract-free use, which should still be governed by
    the regulamin's content rules;
  - the user may terminate at any time. **Self-service deletion does not exist** (`LEGAL.md` §5), so
    termination is "write to …" until it is built;
  - EdMat may terminate only for stated reasons, with notice and an art. 17 DSA statement.
- [ ] **Complaint procedure** (ust. 3 pkt 4): to whom, how (electronic), the time limit for an answer
  (14 or 30 days is common practice **[UNVERIFIED as a legal requirement]**), and how the answer is
  delivered.
- [ ] **Identity of the service provider** (u.ś.u.d.e. art. 5): name, address, electronic contact
  **[UNVERIFIED article number in the 2024 text]**. Reuse the operator identity, corrected as in
  §4.2: the University, with the Ośrodek as the unit running it.

**DSA**

- [ ] **Art. 14(1): restrictions and moderation.** State everything EdMat restricts and how,
  "including algorithmic decision-making and human review", and the rules of the internal complaint
  system. That covers:
  - pre-moderation of submissions;
  - auto-hide on a report ratio (`check_auto_hide`), which **is an automated decision and must be
    named**;
  - feature-specific holds for minors;
  - what a node governor can do.

  The text must be in clear, plain, unambiguous language and publicly available in a
  machine-readable format (HTML is fine).
- [ ] **Art. 14(2): notice of significant changes** — see the amendment clause below.
- [ ] **Art. 14(3): minors.** The service is not *primarily* directed at minors, so this arguably
  does not bind. But users can be under 16, so add a short **plain-language version for young users
  and guardians**. That also serves GDPR art. 12(1).
- [ ] **Art. 14(4)**: apply the restrictions diligently, objectively and proportionately, with regard
  to fundamental rights. One sentence of commitment.
- [ ] **Arts 11 and 12: points of contact.** `/legal` exists. The regulamin must link it and state the
  languages (Polish and English).
- [ ] **Art. 16: notice and action.** It exists (`/legal/notice`). The regulamin describes it.
- [ ] **Art. 17: statement of reasons**, for removal, demotion, suspension or account termination,
  with the six elements of para 3. The required content (a–f) is already built for notices (§4 of
  `LEGAL.md`). The regulamin must promise it for **every** restriction, including a moderator's
  removal and account suspension, not only for notice outcomes.
- [ ] **Art. 20: internal complaints**, at least 6 months after the decision, free, electronic, not
  decided by automation alone, with a reasoned answer. The appeal path exists only partially
  (`LEGAL.md` §4 "Open").
- [ ] **Art. 21: out-of-court settlement.** Inform users that certified bodies exist. None certified
  in Poland was found **[UNVERIFIED]**.
- [ ] **Art. 23: misuse.** After a prior warning, suspend accounts that frequently post manifestly
  illegal content, and suspend the notice-processing of people who frequently file manifestly
  unfounded notices. State the policy and the criteria.
- [ ] **Art. 24(3)**: publish average monthly active recipients when asked. Note that the §3 row 5
  statistics can produce this number.
- [ ] **Art. 28: minors.** No profiling-based advertising (there is none), and a high level of
  privacy and safety by default (the `accounts/minors.py` rules). Describe them. The Commission's
  Art. 28 guidelines of 14 July 2025 are a benchmark **[SECONDARY]**.
- [ ] **The national authority**: from 6 Nov 2026 a user may complain to the **Prezes UKE** as the
  Digital Services Coordinator. Name it.

**Contract law and consumers**

- [ ] **Consumer status.** Ustawa o prawach konsumenta (Dz.U. 2024 poz. 1796), art. 3 ust. 1 pkt 11
  excludes from the whole act a contract where the consumer provides only personal data, "a dane te
  są przetwarzane przez przedsiębiorcę wyłącznie w celu wykonania umowy lub obowiązku ustawowego"
  **[VERIFIED]**: <https://api.sejm.gov.pl/eli/acts/DU/2024/1796/text.html>. This is the Polish
  form of Directive 2019/770 art. 3(1) second subparagraph **[UNVERIFIED verbatim; EUR-Lex
  unreachable]**.
  - **Analytics touches this.** Aggregate service-improvement statistics are arguably part of
    supplying the service. Anything beyond that (sharing, marketing) would bring the digital-content
    chapter (rozdział 5b) into play. That is one more reason to keep §3's purpose limitation strict.
  - Whether the University is a *przedsiębiorca* here at all is a separate open question
    **[DISPUTED]**. **Draft as if the user is a consumer anyway**: it costs nothing and avoids the
    abusive-clause trap.
- [ ] **No abusive clauses** (art. 385¹ KC; UOKiK decision-based control since 17 April 2016,
  <https://uokik.gov.pl/en/abusive-clauses> **[SECONDARY]**). Avoid:
  - blanket exclusion of liability (keep the statutory limits; disclaim only what is lawful, e.g. no
    warranty that solutions are correct, which is a fact about community content);
  - unilateral change without stated reasons and without an exit;
  - a court other than the one the general rules give;
  - "we may delete your account at any time for any reason".
- [ ] **Amendment clause** (KC art. 384¹; DSA art. 14(2)):
  - a closed list of reasons (a change in law, a security need, a new or withdrawn feature, a
    regulator's decision);
  - notice by email **to confirmed addresses** (the mail app now makes this possible) and on the
    site, at least **14 days** before the change (30 is safer) **[UNVERIFIED as a legal minimum —
    common practice]**;
  - the right to terminate free of charge before the change takes effect;
  - the old version archived and linked.

**Content and licensing**

- [ ] **The content licence grant.** `LEGAL.md` §2 and §3 say the recommended outbound licence is
  **CC BY-SA 4.0**, plus a contributor clause, and that **neither may be switched on before a lawyer
  has read §3 of `LEGAL.md`**. The regulamin is where it lands. Requirements found:
  - name the **pola eksploatacji** expressly: utrwalanie, zwielokrotnianie, wprowadzanie do pamięci
    komputera, publiczne udostępnianie w miejscu i czasie wybranym, tłumaczenie i opracowanie
    (pr. aut. art. 41 ust. 2, art. 50) **[SECONDARY]**;
  - non-exclusive, free, unlimited in time and territory (a non-exclusive licence needs no written
    form, art. 67 ust. 5 *a contrario* **[SECONDARY]**);
  - a moral-rights clause: an undertaking not to exercise the rights, not a waiver (art. 16;
    `LEGAL.md` §3 item 4);
  - the attribution mechanism, decoupled from consent so that erasure anonymises the byline;
  - a warranty that the contributor holds the rights. This is where the corpus question and
    co-authoring meet.
- [ ] **Minors and the licence.** KC art. 15 gives persons aged 13–17 limited capacity; art. 17 says
  an act that disposes of a right needs the representative's consent; art. 20 permits only "drobne
  bieżące sprawy życia codziennego" **[SECONDARY]**. A licence over one's work is arguably not that.
  So:
  - the **guardian's acceptance must expressly cover the child's contributions**;
  - for 16–17-year-olds, who register themselves, GDPR art. 8 is satisfied but civil capacity is
    still limited. The regulamin needs a **guardian-consent statement for 13–17** on the licence
    grant, or contributions by 16–17-year-olds held until a guardian confirms (KC art. 18)
    **[DISPUTED]**;
  - under 13, the guardian acts (KC art. 12).
- [ ] **GDPR art. 8 age.** Poland kept **16**. The 2018 draft's 13 was dropped **[SECONDARY]**. This
  matches `LEGAL.md` §6.

**Feature-specific clauses**

- [ ] **Contests clause** (`LEGAL.md` §9, `CONTESTS-LAW.md`), in summary:
  - the user named as organiser is the sole *przyrzekający* under KC art. 919–921, the sole
    controller of entrants' data and the sole PIT *płatnik*;
  - EdMat provides technical means only, is not a party, and does not warrant prizes;
  - EdMat processes entrants' data as a processor under a DPA (art. 28(3)), which **does not exist
    yet**;
  - EdMat may remove a contest with an art. 17 statement and an appeal;
  - organisers warrant rights and consents, including guardians';
  - no prize funds, no entry fee, no chance element.
- [ ] **Tutoring, booking, events, messaging, courses.**
  - EdMat is a medium, not a party to a tutoring arrangement, and takes no money (`FINANCES.md`).
  - An organiser is responsible for their own event's data (the `LEGAL.md` §8 role table).
  - Private messages are encrypted at rest and moderators may read reported ones. State it truly
    **[check the code for what moderators can see]**.
- [ ] **Sign-in providers**: signing in with a provider is subject to that provider's terms; the
  EdMat account is EdMat's; how to unlink a provider; what happens if the provider account is lost.
- [ ] **Mail**: which messages are sent (confirmation, reset, opt-in digest, and amendment notices).
  Not marketing.
- [ ] **Governing law and jurisdiction**: Polish law; the courts competent under the general rules.
  No clause that removes the consumer's own court.
- [ ] **Languages**: Polish and English, and which one governs if they differ. Note that `privacy.ts`
  says both are equally authoritative; pick one rule for both documents.

---

## 6. Privacy policy: checklist and the gaps in `privacy.ts`

### 6.1 GDPR art. 13 (and art. 14 where data comes from someone else)

| Required item | Article | In `privacy.ts` today? |
|---|---|---|
| Controller identity and contact details | 13(1)(a) | **Partial.** It names the Ośrodek, not the legal person (see §4.2), and gives **no address or email**, only "contact Dziekanat Studencki". |
| DPO contact | 13(1)(b) | **Missing.** UW has an IOD. Its contact must be stated. |
| Purposes **and legal basis for each** | 13(1)(c) | **Mostly missing.** Only the request log is covered, and on art. 6(1)(f), which §4 says is probably unavailable. Missing purposes: account and authentication; publishing contributions; messaging; courses, events and contests; guardianship and minors; the education record (`identity` app); mail (confirmation, reset, digest, the inbound-mail copy); notifications; the moderation and audit record; per-user view tables (`ContentView`, `MaterialView`); the IP → country language hint; service statistics (new); sign-in providers (new). |
| The legitimate interests, where (f) is used | 13(1)(d) | Only "security and correct operation". |
| Recipients or categories | 13(1)(e) | **Wrong since today.** "Nobody outside the Faculty" is no longer true. **OVH** (MX Plan) is a **processor** for every outgoing and incoming mail, which needs an art. 28 DPA: OVH's standard DPA, accepted in the OVH account **[UNVERIFIED that it has been accepted]**. OpenStreetMap/Nominatim are listed. Missing: sign-in providers (independent controllers, §7); other users and organisers, where content or registrations are shared with them; public authorities on lawful request. |
| Transfers outside the EEA | 13(1)(f) | **Missing.** OSMF is a UK entity (the UK adequacy decision — current status **[UNVERIFIED]**). Google, Apple and Microsoft are US companies (EU–US Data Privacy Framework, if they are certified — **[UNVERIFIED]**; all three are believed to be). OVH processes in the EU **[UNVERIFIED which datacentre]**. |
| Retention per category | 13(2)(a) | **Partial.** Logs, audit, and "account until you ask". Missing: mail logs (`OutboundEmail`, `InboundEmail` — no retention rule exists at all), messages, event data (30-day purge, `LEGAL.md` §8 — but not scheduled), view tables (none), contest data, statistics aggregates (proposed 25 months). |
| Rights: access, rectification, erasure, **restriction, portability, objection, withdrawing consent** | 13(2)(b)–(c) | **Partial.** Restriction (art. 18), portability (art. 20), and consent withdrawal (art. 7(3)) for guardian consent and a contest winner's name are missing. Objection is present, but tied to (f). It must cover (e) too, and say how statistics objection works (the Sec-GPC/DNT signal and the settings switch). |
| Right to complain to PUODO | 13(2)(d) | Present. |
| Whether data is a statutory or contractual requirement, and the consequence of not providing it | 13(2)(e) | **Missing.** For example: an email is required to register; the birth year is asked only to branch. |
| Automated decision-making | 13(2)(f) | **Missing.** Auto-hide on a report ratio is automated, but it is not an art. 22 decision about a person **[UNVERIFIED that it falls outside art. 22]**. Say "no decisions with legal or similarly significant effects are made solely automatically", then describe auto-hide anyway (it is also a DSA art. 14 item). |
| Source of data not collected from the person | 14(2)(f) | **Missing.** A child's data entered by a guardian; data from a sign-in provider; registrations managed by an organiser; things other users write about a person. |
| Language a child understands | 12(1) | **Missing.** There is no section for minors and guardians. |

### 6.2 Concrete inaccuracies in the current text

1. **"Nobody outside the Faculty … no data to … any other third party"** is false since the mail app
   went live today (OVH). It becomes more false with sign-in providers.
2. **"Deletion is automatic and runs daily"** cannot be confirmed. `enforce_log_retention` says it
   should run daily from cron and points to `deploy/DEPLOYMENT.md`, but neither `deploy/cron/` (which
   holds only `edmat-mail`) nor anything else in the repository schedules it. Whether webek4's
   crontab runs it was not checked **[UNVERIFIED]**. House rule 10: confirm on the server, or change
   the sentence.
3. **"Record of moderation decisions — as long as the account exists, plus one year"** does not match
   the code, as far as was read. `AuditEvent` is pseudonymised on deletion and kept, and no
   deletion-after-a-year was found **[UNVERIFIED — `enforce_log_retention.py` was read only in
   part]**.
4. **The device table lists 6 of about 17 keys** (§3 inventory). Missing:
   - the offline cache (`edmat-cache:*`);
   - the locale guess (which stores the *outcome* of an IP-country lookup on the device);
   - the return-to key;
   - the content and audience filters;
   - the scanner's IndexedDB queue;
   - the accessibility settings.
5. **The IP → country lookup** (`config/geo.py`, optional MaxMind database, nothing stored) is not
   mentioned at all. It is processing of personal data, even if transient.
6. **The basis sentence for the request log** (art. 6(1)(f)) — see §4.
7. **"No analytics"** will become untrue the day §3 is built. Replace it with an honest description:
   aggregate statistics from server logs, no tracking identifiers, how to object.

### 6.3 `LEGAL.md` has gone stale in two places

- **§5 "Cookies"** describes a consent banner that discloses `PARAGLIDE_LOCALE`, with an "analytics &
  non-essential" category. The live code has **no banner**: `privacy.ts` says so, and `Footer.svelte`
  carries the comment "With no consent banner, this link is the site's standing disclosure". One of
  the two is wrong, and the code is the present.
- **§5 "Third parties"** and **§10 "No email backend"** both predate the `mail/` app.

This note does not edit `LEGAL.md`. Whoever writes the policy should.

---

## 7. Sign in with Google, Apple and Microsoft

The research notes for this section are in the hand-back of the sign-in research. The sources are
cited inline. Apple's API documentation did not render, so most Apple API detail is marked.

### 7.1 Requirements per provider

**Google**

- **Branding and verification** **[VERIFIED]**:
  <https://support.google.com/cloud/answer/13464321>
  - "The homepage must be hosted on a verified domain you own."
  - "Your homepage can not be only a login page."
  - The homepage must link the privacy policy.
  - The privacy policy must be "hosted within the domain that hosts your homepage", and it must be
    the same policy as the one linked on the consent screen.
  - All authorised domains are verified through **Google Search Console**.
- **Publishing status** **[VERIFIED]**: <https://support.google.com/cloud/answer/15549945>
  - "Testing" caps the app at 100 listed test users, and authorisations expire after 7 days. It must
    be switched to **In production**.
  - Name and logo display "may be subject to verification".
- **Scopes**: `openid email profile` are the basic set. Sensitive or restricted scope verification
  (and the CASA security assessment) does not apply **[UNVERIFIED as an explicit statement; inferred
  from Google's pages]**.
- **API Services User Data Policy** **[VERIFIED]**:
  <https://developers.google.com/terms/api-services-user-data-policy>
  - The privacy policy must "fully document how your application interacts with user data".
  - The data may be used only for user-facing features (Limited Use).
  - **"Child-directed" apps may not use Google Sign-In.** EdMat is not child-directed, but the
    guardian-created child accounts should **not** be offered Google sign-in. Keep provider sign-in
    to accounts that pass EdMat's own age branch.
- **Controller relationship** **[VERIFIED by reference]**: the Google API Terms §2.i incorporate the
  **Google Controller-Controller Data Protection Terms**, so Google is an **independent controller**.
- **Claims** **[VERIFIED]**:
  <https://developers.google.com/identity/openid-connect/openid-connect>
  - Key the account on `sub`. "Don't use the `email` field as a unique identifier."
  - `email_verified` tells you whether Google has verified the address.
  - `hd` is present for Workspace accounts.
- **Age** **[VERIFIED]**: <https://support.google.com/accounts/answer/1350409>. The minimum age for
  a Google account in **Poland is 16**. Supervised (Family Link) accounts exist below it and may be
  allowed into third-party apps by a parent **[SECONDARY]**. A Google sign-in therefore proves
  nothing about age, and **EdMat's own age branch must run for provider sign-ups too.**

**Apple**

- **Web setup** **[VERIFIED]**:
  <https://developer.apple.com/help/account/configure-app-capabilities/configure-sign-in-with-apple-for-the-web>
  - A **Services ID** associated with a **primary App ID** that has Sign in with Apple enabled. A
    web-only service still needs an App ID.
  - Register domains and return URLs. **No domain-association file is needed any more**: "You don't
    need to upload a file on your server".
  - **A paid Apple Developer Program membership is needed** **[UNVERIFIED — believed true]**. An
    *organisation* enrolment needs a **D-U-N-S number** for the University **[UNVERIFIED]**.
- **Private Email Relay — the part that touches the mail app** **[VERIFIED]**:
  <https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service>
  - "you'll need to register your outbound email domains. All registered domains must create Sender
    Policy Framework (SPF) DNS TXT records in order to transit Apple's private mail relay."
  - Mail must pass SPF and/or DKIM; Apple recommends both.
  - The registered domain must **match the envelope sender (Return-Path) exactly**, or the DKIM
    `d=` domain must match the From domain.
  - "If you don't register all the source domains or emails that you use, email sent to the private
    relay service will result in a bounce message."
  - So `edmat.net`, or `no-reply@edmat.net` as an individual address, must be registered under "Sign
    in with Apple for Email Communication". Check which Return-Path OVH MX Plan actually sets.
    `deploy/UPDATE-2026-10-14.md` already says SPF/DKIM is unchecked DNS work.
  - Without this, a user who chose "Hide My Email" never receives a confirmation, reset or digest
    mail.
- **Behaviour** **[UNVERIFIED — Apple docs did not render]**:
  - name and email are delivered **only on the first authorisation**, in a `user` field posted to
    the callback with `response_mode=form_post`. Store them then, or they are gone;
  - the callback is a cross-site POST, so it must be handled by the backend, not the SPA;
  - `is_private_email` is a claim;
  - the client secret is an ES256 JWT valid for at most about **6 months**. It needs a rotation job,
    which can sit beside the mail cron;
  - the token revocation endpoint is `/auth/revoke`;
  - server-to-server notifications (`email-disabled`, `consent-revoked`, `account-delete`).
- **Account deletion and revocation** **[VERIFIED]**:
  <https://developer.apple.com/support/offering-account-deletion-in-your-app/>
  - Account deletion in-app is an **App Store** requirement.
  - "Apps that support Sign in with Apple should use the Sign in with Apple REST API to revoke user
    tokens."
  - For a web-only service this is good practice, not a store gate. That is a reading, not Apple's
    statement. It does tie into EdMat's own gap: **there is no self-service account deletion**
    (`LEGAL.md` §5).
- **Controller relationship and age**: not verified **[UNVERIFIED]**. Treat Apple as an independent
  controller, and do not rely on Apple's age gate.

**Microsoft Entra ID**

- **Account types** **[VERIFIED]**:
  <https://learn.microsoft.com/en-us/entra/identity-platform/supported-accounts-validation>
  - Single tenant, multitenant (`organizations`), multitenant plus personal accounts (`common`), or
    personal only (`consumers`).
  - For UW people plus everybody else, use **`common`** (`AzureADandPersonalMicrosoftAccount`).
- **Publisher verification** **[VERIFIED]**:
  <https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview>
  - Needs a Microsoft AI Cloud Partner Program (Partner One) ID belonging to a verified
    organisation, a DNS-verified publisher domain, and an app registered with a **work or school
    account**, not a personal one. It is free.
  - Unverified multitenant apps are blocked from user consent under risk-based step-up only for
    permissions *beyond* basic sign-in and profile.
- **Tenant consent** **[VERIFIED]**:
  <https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent>
  - Each tenant decides. Microsoft recommends allowing user consent only for verified publishers
    (`microsoft-user-default-low`).
  - **Whether a UW student can consent cannot be known from outside.** Only faculty-level tenants
    were found (for example WNE and WZ), and no university-wide student tenant **[SECONDARY]**. Ask
    UW IT.
  - Without publisher verification, a student in a strict tenant sees "Need admin approval".
- **Scopes**: `openid profile email` only. **Do not** request `offline_access` or Graph scopes;
  they are not needed for sign-in **[VERIFIED]**:
  <https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc>
- **Identifiers** **[VERIFIED]**:
  <https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference>
  - The email claim "isn't guaranteed to be correct and is mutable over time. Never use it for
    authorization".
  - Key on `(tid, oid)` or `(iss, sub)`.
  - The nOAuth class of account-takeover bugs comes from keying on email **[SECONDARY]**. Whether
    unverified-domain email claims are stripped by default (`removeUnverifiedEmailClaim`,
    `xms_edov`) is reported inconsistently **[UNVERIFIED]**.

### 7.2 Engineering rules that follow (for whoever builds it)

1. **The identity key is `(provider, issuer/tenant, subject)`**, never the email. Store it in a
   separate table (`SocialIdentity`), one row per linked provider.
2. **Never auto-link to an existing account by email.**
   - Link only when the user is *signed in* and explicitly connects a provider.
   - Alternatively, link when the provider asserts a verified email (Google `email_verified`;
     Microsoft only with a verified-domain signal; Apple's address is verified, but it may be a
     relay) **and** the user proves control of the EdMat account (password, or a link sent to its
     confirmed address).
   - Otherwise create a new account, or ask the user to sign in first.
3. **A provider sign-up still runs the age branch** (`accounts/minors.py`). An under-16 cannot
   self-register with a provider; guardian-created child accounts get no provider sign-in.
4. **Minimal scopes, minimal storage.** Keep `sub`, issuer and tenant, the email (as a confirmed
   address only where the provider verified it — this can mark it confirmed in `mail/`), and the
   display name. No avatar fetch unless the user asks. No provider access token is stored after
   sign-in.
5. **Apple specifics**: a backend `form_post` callback; capture the name on the first authorisation;
   a secret rotation job; process `account-delete` and `email-disabled` notifications; revoke the
   token on EdMat account deletion.
6. **A kill switch** (`FeatureFlag`, for example `social_login`, the three-file change), and the
   buttons disappear with it (house rule 3).

### 7.3 GDPR and disclosure

The providers are **independent controllers** for their sign-in. EdMat is the controller for what it
receives. The privacy policy needs a paragraph per provider covering:

- what EdMat receives: an identifier, a name, an email (possibly a relay address);
- the basis (art. 6(1)(b), since the person chose the method);
- that the provider learns the person used EdMat (it is the provider's own processing, under its own
  policy — link it);
- transfers: US companies, the DPF;
- how to unlink.

### 7.4 Operator to-do list — things only the owner, or the University, can do

1. **Decide the legal entity** that registers developer accounts. Apple and Microsoft publisher
   verification both want an *organisation* (the University), not a person. Ask the Ośrodek and UW
   IT who holds UW's Apple Developer, D-U-N-S and Microsoft Partner identities, if anyone does.
2. **Google**:
   - verify `edmat.net` in Search Console;
   - create the Google Cloud project and OAuth client (web; redirect URI on the API origin);
   - fill the consent screen (app name, support email, homepage `https://edmat.net`, privacy policy
     `https://edmat.net/privacy`, authorised domain `edmat.net`);
   - submit for **branding verification**;
   - set **In production**.

   The homepage must not be just a login page, and it must link `/privacy`. Both already hold.
3. **Apple**:
   - enrol in the **paid** Apple Developer Program as an organisation;
   - create an App ID with Sign in with Apple, a **Services ID**, the domain `edmat.net` and the
     return URL, and a **Sign in with Apple private key** (.p8);
   - note the Team ID and Key ID;
   - under **Sign in with Apple for Email Communication**, register `edmat.net`, or the exact
     Return-Path domain OVH uses, and/or `no-reply@edmat.net`;
   - **publish SPF for edmat.net including OVH, and turn on DKIM in the OVH MX Plan panel**;
   - register a server-to-server notification URL;
   - put a calendar reminder to rotate the client secret within 6 months, unless it is automated.
4. **Microsoft**:
   - register the app in an Entra tenant using a **work or school account** (ideally a UW one);
   - set account type **multitenant + personal**;
   - add the redirect URI;
   - set the publisher domain to `edmat.net` (DNS verification);
   - apply for **publisher verification** with a Partner One ID;
   - **ask UW IT** whether the student tenant(s) allow user consent for verified publishers, or
     whether an admin consent is needed, and request it if so.
5. **Secrets on webek4**: store the Google client secret, the Apple .p8 key and the Microsoft client
   secret the way the mail password is stored (a file under `/etc/edmat/`, 0640).
6. **Before switching any provider on**:
   - publish the privacy policy update (§6, §7.3);
   - publish the regulamin (§5), because the provider consoles link to both;
   - have IOD UW sign off on the controller identity in both.

---

## 8. Ranked open questions for a lawyer, or for IOD UW

Ranked by how much the answer changes what is built or published.

1. **Is EdMat's processing the University's "public task", and is UW a "public authority" for
   art. 6(1) last sentence?** This decides between (e) and (f) for the request log, for statistics
   and for half the privacy policy (§4). Ask IOD UW first; it also decides who the controller is and
   what the policy names.
2. **Who is the controller**: Uniwersytet Warszawski, or the Ośrodek? And what are IOD UW's contact
   details for the policy? Without this, the privacy policy and every provider console carry the
   wrong name.
3. **Is passive server-side logging outside PKE art. 399** — so that §3 rows 1–7 are safe — given
   EDPB 2/2023 paras 42–43 and 55? The mainstream answer is yes. A written yes from IOD UW makes the
   analytics plan safe to publish.
4. **Is a minimal JavaScript error beacon "konieczne do dostarczania usługi … żądanej"** under
   art. 399 ust. 3 pkt 2 (§3 row 8)?
5. **DSA art. 19: is EdMat, as part of UW, a micro or small enterprise?** This decides whether arts
   20, 21, 23 and 28 are obligations or good practice (§5.2). And what does Dz.U. 2026 poz. 1296 add
   for a small hosting provider from 6 Nov 2026?
6. **The content licence**: CC BY-SA 4.0 via the regulamin, with pola eksploatacji, a moral-rights
   undertaking and an erasure-safe attribution (`LEGAL.md` §3). And whether a 16–17-year-old can
   grant it without a guardian (KC art. 17 vs art. 20).
7. **Is the University a *przedsiębiorca* for consumer law**, and does service-improvement analytics
   keep the ustawa o prawach konsumenta art. 3 ust. 1 pkt 11 exclusion intact?
8. **An art. 28 DPA with OVH** for mail (accepted in the OVH panel?), and the contest-organiser DPA
   (`LEGAL.md` §9–10).
9. **A hashed IP+UA daily id** (§3 row 11): would IOD UW accept it under (e) with a daily salt? UODO
   runs Plausible on its own site. Low priority; only relevant if signed-in-only statistics prove
   insufficient.
10. **Apple, Microsoft and Google as independent controllers**: confirm from Apple's and Microsoft's
    terms, which were not read, and whether the DPF certifications are current.

---

## Sources that could not be opened (check before relying on the items that cite them)

- EUR-Lex: GDPR, DSA, Directive 2019/770, and the Omnibus proposal COM(2025) 837 — all quoted from
  secondary or Council texts.
- CNIL Fiche 16 (cnil.fr was in maintenance).
- Apple developer documentation for Sign in with Apple JS and REST (name and email on first
  authorisation, `form_post`, the client-secret JWT, revocation, notifications).
- Microsoft's page on `removeUnverifiedEmailClaim` and `xms_edov`.
- Final versions of EDPB Guidelines 1/2024 and 01/2025 (only the consultation versions were read).
- Whether the Council's Omnibus mandate vote expected around 11 Oct 2026 took place.
- webek4's crontab, for whether `enforce_log_retention` actually runs.
