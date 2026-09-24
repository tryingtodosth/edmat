# Self-hosted video meetings for EdMat

**Scope.** Which open-source, self-hostable video-meeting stacks can a single Polish primary or secondary
school run on its own hardware (or its own VPS) instead of Zoom, Teams or Google Meet — and which one
EdMat should ship as the default for the `meetings` module.

**Why this matters more than the feature list.** A school that uses Zoom does not control who processes
its pupils' faces, voices and attendance metadata. The vendor is the data controller's processor at best,
and typically pushes the school into a contract it cannot negotiate. Every stack below keeps the media and
the metadata on hardware the school (or its local-government operator) administers. That is the point;
the whiteboard is secondary.

**Honesty about numbers.** Sizing figures in this document are *approximate*. Real capacity depends on
video resolution, how many cameras are on, whether simulcast is enabled, CPU generation, and kernel/NIC
tuning. Where a number is a rule of thumb from project documentation or community reports rather than a
measured benchmark on school hardware, it is marked "approx." Measure before you promise a headteacher
that one box will carry eight simultaneous classes.

---

## 1. What a school actually needs

Three scenarios drive every decision below.

| # | Scenario | Typical size | What it really needs |
|---|---|---|---|
| 1 | **Remote lesson for a class** (quarantine, teacher at home, smog alert, snow day) | 1 teacher + 15–30 pupils, mostly cameras off | Reliable audio, screen share, a moderator who can mute, a waiting room, attendance evidence |
| 2 | **Parent–teacher consultation** | 1 teacher + 1–2 guardians, 15–20 min | Absolute certainty that only the invited guardian enters; back-to-back slot booking; no recording by default |
| 3 | **Staff meeting / pedagogical council** | 15–60 staff | Stable large-audience audio, screen share, presence list; occasionally a vote or a poll |

Cross-cutting requirements for all three:

- **Identity comes from EdMat.** No separate accounts, no "click this Zoom link" e-mails. A pupil who is
  logged into the logbook is already authenticated; the meeting must trust that.
- **Minors' data.** No third-party telemetry, no analytics beacons, no Gravatar, no STUN server owned by
  Google. GDPR Art. 5(1)(c) — data minimisation — plus the higher bar Art. 8 sets for children's data.
- **Recording is an exception, not a default.** It needs a lawful basis, which for a lesson with minors
  in practice means guardians' consent, per child, revocable. Files land on the school's own storage.
- **Accessibility.** Keyboard operation, screen-reader-usable controls, live captions where possible
  (WCAG 2.1 AA is a legal requirement for Polish public-sector bodies under the 2019 accessibility act).
- **Maintenance realism.** The average Polish primary school has one part-time IT person. A stack that
  needs weekly hand-holding will be abandoned within a term.

---

## 2. The candidates

### 2.1 Jitsi Meet

**Licence.** Apache 2.0. Maintained by 8x8 with an active external community.

**Architecture.** Four cooperating services:

- `jitsi-meet` — the web front end (static JS + the `external_api.js` iframe embedding library), usually
  behind nginx.
- `prosody` — XMPP server; handles signalling, rooms, authentication (including JWT via the
  `mod_auth_token` / `token_verification` plugins) and the lobby.
- `jicofo` — conference focus; allocates a bridge to each conference and manages roles.
- `jvb` (Jitsi Videobridge) — the SFU that actually forwards RTP. Horizontally scalable: add bridges,
  jicofo load-balances across them (Octo for cascading across regions).
- Optional: `jibri` for recording/streaming, `jigasi` for SIP/telephone dial-in and for transcription.

**Sizing (approx.).** A single JVB on 4 vCPU / 8 GB RAM comfortably handles roughly 100–200 concurrent
video participants spread over several conferences, but the *bandwidth* is the real ceiling: budget
roughly 0.5–1.5 Mbit/s downstream per receiving participant at typical classroom resolutions. A class of
30 with cameras off and one teacher sharing a screen is cheap (a few Mbit/s total); 30 cameras on at
720p is roughly 30–60 Mbit/s of egress from the bridge. Prosody and jicofo are light (1–2 vCPU, 2 GB);
they become the bottleneck only in the low thousands of concurrent participants. For one school: **one
4–8 vCPU / 8–16 GB VM with 1 Gbit/s uplink is generous.**

**TURN / TLS / domains.** You need one DNS name (`meet.szkola.example.pl`), a TLS certificate
(Let's Encrypt works; the bundled installer automates it), UDP/10000 open for JVB media, and a TURN
server for participants behind restrictive NATs — `coturn` on TCP/TLS 443 is the standard fallback and
the Docker stack can run it. **Critically: replace the default `stun.l.google.com:19302` in
`config.js` with your own coturn.** Out of the box Jitsi leaks a STUN request to Google; for a school
processing children's data that is an avoidable third-country transfer.

**Auth integration.** Best-in-class for EdMat's purpose. With `JWT_APP_ID` / `JWT_APP_SECRET` set,
prosody only admits clients presenting an HS256-signed token with `iss`, `aud: "jitsi"`, `sub` (the
domain), `room` and a `context.user` object. EdMat mints that token itself (`server/lib/video.js`) — no
network call, no shared user database, no OIDC round trip. Moderator rights ride in the same token
(`context.user.moderator` / `moderator: true`), so "the teacher is the moderator" is enforced
cryptographically rather than by clicking a link first. Jitsi also supports Shibboleth and generic OIDC
via a separate `jitsi-keycloak-adapter`-style bridge, but for EdMat the JWT path is strictly simpler.

**Recording.** Jibri records by driving a headless Chrome instance and piping it to ffmpeg — which means
**one Jibri instance records exactly one conference at a time** and wants ~4 vCPU / 4 GB of its own,
plus an ALSA loopback module on the host. Files land as MP4 on the Jibri host's local disk (default
`/srv/recordings`), from which a `finalize` script moves them wherever the school wants — in EdMat's
model, onto the school server. Multi-class recording therefore means N Jibri instances; budget
accordingly, or (better) do not record lessons.

**GDPR / minors.** Good, once hardened: set `disableThirdPartyRequests: true` (stops Gravatar and
external avatar fetches), `analytics.disabled: true`, remove the Google STUN default, disable the
"deep-link to mobile app" promo, and turn off `callStatsID`. After that, a Jitsi meeting makes zero
requests outside the school's own domain. Jitsi does not require accounts, so no vendor profile of a
child is built anywhere.

**Accessibility.** Reasonable but not exemplary: keyboard shortcuts are documented and the toolbar is
reachable; screen-reader support for the participant list has improved but is still weaker than the
rest. Live captions/subtitles exist through Jigasi, but Jigasi's transcription historically depends on
**Google Cloud Speech**, which defeats the purpose — Vosk-based local transcription is possible and is
what a school with a privacy mandate should use, at the cost of noticeably lower accuracy for Polish.
Treat captions as a nice-to-have, not a solved problem.

**Mobile.** First-party Android and iOS apps (also on F-Droid), and the SDK can be pointed at the
school's own server. The mobile browser experience is usable but the apps are better.

**Maintenance burden.** *Low* by the standards of this list. The `docker-jitsi-meet` compose stack is
a genuinely turnkey five-container deployment; upgrades are image bumps. The classic Debian/Ubuntu
package install is also well-trodden.

**Fit.** Scenario 1: very good. Scenario 2: very good (lobby + JWT + per-room tokens is exactly a
consultation). Scenario 3: very good. Weakest at "classroom pedagogy" features — there is a whiteboard
(Excalidraw integration) and reactions and polls, but no breakout rooms with the depth BBB offers, and
no presentation-with-annotation workflow.

---

### 2.2 BigBlueButton

**Licence.** LGPL 3.0. Built specifically for teaching, by a company (Blindside Networks) plus a
foundation-style community; deeply integrated with Moodle and Canvas.

**Architecture.** The most opinionated stack here. A BBB server bundles: `bbb-web` (Java/Grails API),
`akka-apps` and `akka-fsesl` (Scala), `bbb-html5` (Meteor/Node client), FreeSWITCH (audio),
Kurento **or**, since 2.6+, `mediasoup` (video/screen-share SFU), Redis, and `bbb-webhooks`.
Recording is a separate batch pipeline (`bbb-record` → `presentation` publish format). The front end
users see is normally **Greenlight** (Ruby on Rails), a separate app for room creation and account
management, or a direct LMS integration.

**Classroom features — the reason it exists.** Multi-user whiteboard with annotation over uploaded
presentations (PDF/Office, converted server-side), breakout rooms with timers and automatic
redistribution, polls (including quick "yes/no" and typed-answer), shared notes (Etherpad), emoji
status/raise hand, per-user "lock settings" (e.g. pupils cannot unmute themselves or see each other's
cameras), and a learning-analytics dashboard giving the teacher per-pupil talk time, chat activity,
poll answers and join/leave times. Nothing else in this document comes close for scenario 1.

**Requirements — the reason it hurts.** BBB is effectively **Ubuntu-only bare metal**: 2.6/2.7 require
Ubuntu 20.04, 3.0 requires Ubuntu 22.04, and the project explicitly does not support running the whole
stack in Docker in production (community images exist; you are on your own). Recommended production
spec is roughly **8 vCPU / 16 GB RAM / 500 GB SSD / 1 Gbit/s** for around 150 concurrent users, and the
docs are clear that it wants a *dedicated* machine — it takes over ports, nginx and systemd units. It
also insists on a real TLS certificate and a real DNS name; it will not run on a self-signed cert.
There is no supported in-place "just apt upgrade" across Ubuntu majors — you rebuild the server.

**Auth integration.** Not JWT. Every API call is a URL signed with
`checksum = SHA1(callName + queryString + sharedSecret)` (SHA-256 is accepted from 2.6 onward if the
server is configured for it). EdMat's integration is therefore: call (or, in our offline-safe model,
*construct*) `create`, then redirect the user to a signed `join` URL carrying `fullName`, `meetingID`,
`role=MODERATOR|VIEWER` and the matching password. There is no per-user identity in BBB — the school's
app is the identity provider and BBB trusts the signed URL. That is simple and works, but it means the
join URL is a bearer credential: it must be short-lived and never shared. Greenlight adds OIDC/Google/
LDAP login for people who want BBB standalone; EdMat would bypass Greenlight entirely.

**Recording.** Excellent and the most school-appropriate of the lot: the default `presentation` format
is not a video file but a replayable composite (slides + annotations + audio + chat + cursor), stored
under `/var/bigbluebutton/published/` on the BBB server. It is dramatically smaller than video and far
more useful pedagogically. Post-processing is CPU-heavy and asynchronous — a one-hour session typically
takes a similar order of time to process (approx.; depends heavily on the machine). You can disable
recording per meeting (`record=false`) or globally.

**GDPR / minors.** Self-hosted BBB makes no outbound third-party calls in normal operation. Watch two
things: Greenlight's optional Google/Microsoft sign-in (do not enable it), and the fact that recordings
are served from the BBB host, which is a second place holding children's voices — it needs the same
retention policy and deletion routine as the logbook.

**Accessibility.** The strongest in this list. BBB has had a dedicated accessibility effort, ships a
documented screen-reader mode, keyboard shortcuts for every core action, and **live closed captions
that a human typist can write during the session** (and which are stored with the recording). For a
school with a pupil who has a hearing impairment, this alone can decide the choice.

**Mobile.** No first-party native app; the HTML5 client works in mobile Safari/Chrome and is officially
supported, though screen sharing is limited on mobile. Third-party apps exist and are not recommended.

**Maintenance burden.** *High.* A dedicated Ubuntu box, a stack of JVM/Scala/Node services, a
recording pipeline that fills disks, and OS-major upgrades that mean a rebuild. Realistic only if the
school's operator (a gmina IT department, a school consortium) runs it for several schools at once.

**Fit.** Scenario 1: excellent — it is the only one here designed for it. Scenario 2: workable but
heavy (a 15-minute parent chat does not need a whiteboard, and the "meeting must be created first"
API flow adds a step). Scenario 3: good.

---

### 2.3 Nextcloud Talk (with High Performance Backend)

**Licence.** AGPL 3.0 (the `spreed` app); the High Performance Backend (`nextcloud-spreed-signaling`)
is also AGPL 3.0 — it was relicensed from a proprietary offering and is now genuinely open source,
though Nextcloud GmbH sells support for it.

**Architecture.** Talk is an app inside a Nextcloud instance (PHP + database + the usual Nextcloud
stack). Out of the box it is **peer-to-peer**, which collapses past roughly 4–6 participants. For
anything classroom-sized you must deploy the HPB: a Go signaling server plus **Janus** as the SFU, plus
coturn, plus NATS. That is three more services and a reverse-proxy configuration on top of a Nextcloud
you are presumably already running.

**Sizing (approx.).** Nextcloud itself: 2–4 vCPU / 4–8 GB for a school. The HPB/Janus tier behaves like
any SFU — similar bandwidth arithmetic to Jitsi; 4 vCPU / 8 GB handles a few hundred streams.

**Auth integration.** Excellent *if the school already lives in Nextcloud*: users, groups and sharing
come free, and Nextcloud supports SAML/OIDC/LDAP, so an EdMat SSO hand-off is a standard OIDC client
setup rather than a token-minting exercise. The Talk API also has bot/webhook support. But EdMat would
then depend on a whole groupware platform to place a video call.

**Recording.** Server-side recording exists (a separate `nextcloud-talk-recording` Python service driving
headless Chrome — the same architectural pattern, and the same one-conference-per-worker limitation).
Files land in the organiser's Nextcloud Files, which is genuinely convenient: retention and sharing use
the machinery the school already governs.

**GDPR / minors.** Very good. Nextcloud's whole selling point is data sovereignty; there is no telemetry
to disable. Default STUN is `stun.nextcloud.com` — point it at your own coturn.

**Accessibility.** Adequate; Nextcloud does accessibility work across the suite, but Talk's call UI is
less mature here than BBB's. Captions are not a built-in feature.

**Mobile.** Good first-party Android/iOS Talk apps, pointable at the school's server; push notifications
go through Nextcloud's proxy unless you self-host that too (a real consideration for a privacy audit).

**Maintenance burden.** *Medium* if Nextcloud is already there and someone maintains it; *high* if it is
being introduced just for video — you would be adopting a groupware platform as a side effect.

**Fit.** Scenario 2 and 3: good. Scenario 1: acceptable up to ~30 with the HPB, but no teaching
features. **Recommended only for schools that already run Nextcloud as their file platform.**

---

### 2.4 Element Call / Matrix (LiveKit SFU)

**Licence.** Element Call: AGPL 3.0. LiveKit server: Apache 2.0. Synapse (the reference Matrix homeserver):
AGPL 3.0 since 2023 (Dendrite likewise). Note the licence change — a school does not care, but a vendor
building on it should.

**Architecture.** The modern shape is: a Matrix homeserver (Synapse or Dendrite) for identity, rooms and
signalling; **LiveKit** as the SFU carrying the media; `lk-jwt-service` issuing LiveKit tokens against
Matrix identity ("MatrixRTC"). Element Call is the web client, and it is embeddable. This replaced the
older full-mesh Element Call, which did not scale past a handful of participants.

**Sizing (approx.).** LiveKit is Go, efficient, and designed for horizontal scale; a single node on
4–8 vCPU handles hundreds of tracks. Synapse is the heavier, fussier component for a small deployment
(Python, Postgres, memory-hungry with federation enabled — turn federation **off** for a school).

**Auth integration.** Matrix supports OIDC (and is migrating to OIDC-native auth, MAS), so EdMat SSO
maps cleanly. Tokens to LiveKit are JWTs — architecturally similar to the Jitsi path.

**Recording.** LiveKit Egress: a separate service (Docker, needs Redis) producing MP4/HLS to local disk
or S3-compatible storage — so "school-owned MinIO bucket" is a first-class option, which is architecturally
the cleanest recording story here.

**GDPR / minors.** Good in principle, with one caveat: a Matrix homeserver is built to federate, and a
misconfigured school server that federates to matrix.org leaks room metadata. Disable federation
explicitly. Also disable the default identity server and the integration manager (both point at
Element's hosted services by default).

**Accessibility / mobile.** Element's mobile apps are mature; Element Call's own UI is newer and its
accessibility is less battle-tested than BBB's. Captions are not built in.

**Maintenance burden.** *Medium-high today.* Three or four moving parts, a component (MatrixRTC) still
evolving fast, and documentation that assumes more platform literacy than a school has.

**Fit.** Not the right default for a school **today**, but the right thing to watch: it is the only
candidate that also gives the school a sovereign messaging layer, and LiveKit is becoming the de facto
open SFU. Reassess in 12–18 months.

---

### 2.5 Galène

**Licence.** MIT. Written and maintained largely by one academic (Juliusz Chroboczek, Université Paris
Cité) explicitly for university teaching.

**Architecture.** A **single Go binary** plus a directory of JSON group definitions. That is the entire
server. It is an SFU with a small built-in web client; groups are configured as files, users as entries
in those files (or via a small token/auth-server hook).

**Sizing (approx.).** Remarkably light — the project reports a modest VPS carrying a few hundred
simultaneous streams. For a school, a 2 vCPU / 2 GB VM is plausible for several simultaneous classes,
which is an order of magnitude less than BBB.

**Auth integration.** Simple: per-group passwords, or a stateless **authorisation server** that issues
signed tokens — conceptually close to the Jitsi JWT model and easy to bolt onto EdMat. Less documented
and less battle-tested than Jitsi's.

**Recording.** Built in, server-side, to per-group directories on the server's disk. Simple and
sovereign, though the output is raw per-participant recording rather than a composed classroom replay.

**Features.** Screen sharing, chat, raise hand, basic moderation, file transfer. **No whiteboard, no
breakout rooms, no polls.**

**Accessibility / mobile.** Minimal. The client is deliberately plain; there are no native apps and
accessibility has not been a project focus.

**Maintenance burden.** *Lowest of everything here* — one binary, one config directory, no database.

**Fit.** An excellent choice for a technically confident school (or a computing teacher) that wants
something it can fully understand and that will still work in five years. Not a product a
non-technical school will adopt on its own, and not something EdMat should ship as a default, because
there is no ecosystem behind it if the maintainer stops.

---

### 2.6 MiroTalk (SFU / P2P)

**Licence.** MiroTalk SFU and MiroTalk P2P are **AGPL-3.0 with a commercial licence offered for
non-AGPL use** — read the licence before embedding in anything the school redistributes. Single-author
project (miroslavpejic85).

**Architecture.** Node.js. `mirotalk-p2p` is pure WebRTC mesh (fine to ~6–8 people);
`mirotalk-sfu` uses **mediasoup** and scales to classroom size. Docker images are provided and the
whole thing starts from one compose file.

**Sizing (approx.).** mediasoup is efficient C++ under a Node supervisor; 4 vCPU / 4 GB handles a
classroom comfortably. Needs a wide UDP port range open (typically 40000–40100+).

**Auth integration.** JWT-based room tokens and a simple host-protection scheme; there is an API for
creating rooms and join tokens. Adequate, less formalised than Jitsi's prosody token module.

**Recording.** Client-side (browser `MediaRecorder`) by default — the file lands in the *recorder's*
Downloads folder, which is exactly the wrong place for a school's retention policy. Server-side
recording is not the primary path.

**GDPR / minors.** Self-hosted it is clean, but check the defaults: the sample configs reference public
STUN servers and, in some builds, optional integrations (chat AI, analytics) that must be switched off.

**Accessibility / mobile.** Browser-based, responsive, no native apps; accessibility is not a stated
project goal.

**Maintenance burden.** *Low to run, medium to trust.* It is a fast-moving single-maintainer project; a
school should pin a version and read the changelog rather than track `latest`.

**Fit.** A pragmatic option for a small school that wants something lighter than Jitsi and does not need
recording. Not recommended as EdMat's default: governance risk (one maintainer, dual licence) and the
client-side recording model conflict with the data-flow guarantees EdMat is selling.

---

### 2.7 OpenVidu and LiveKit (building blocks, not products)

Both are **SFU platforms you build a product on**, not meeting apps.

- **LiveKit** — Apache 2.0, Go, extremely good horizontal scaling, first-class SDKs (JS, Swift, Kotlin,
  Flutter, React Native), Egress for recording to S3-compatible storage, Ingress for RTMP.
  Self-hosting is a single binary plus Redis. This is what you choose if you are *writing* the meeting
  UI yourself.
- **OpenVidu** — Apache 2.0. Historically its own Kurento-based stack; **OpenVidu 3 is built on
  LiveKit**, which is a strong signal about where the ecosystem is heading. Adds deployment tooling,
  recording, and an "OpenVidu Call" reference app; the polished operations tooling sits in the
  commercial PRO/ENTERPRISE editions.

**Fit for a school:** neither, directly. **Fit for EdMat as a product:** LiveKit is the obvious
foundation the day EdMat wants its own in-app meeting UI (custom layouts for a class roster, attendance
wired into the video layer rather than inferred, a pinned teacher tile). That is a product decision,
not a school's decision.

---

### 2.8 Apache OpenMeetings

**Licence.** Apache 2.0, an Apache Software Foundation project — the strongest governance story here
(no single vendor, no relicensing risk).

**Architecture.** Java (Wicket + Red5/Kurento lineage), with a database (MySQL/PostgreSQL) and
optional LDAP. Ships whiteboard, polls, recording, file library, a calendar with invitations, and
moderation — a genuine feature set for teaching.

**Reality check.** The project is *stable* but not *lively*: releases are infrequent, the UI shows its
age, WebRTC support has lagged the field, and community answers are thin. Sizing is heavier than its
feature set suggests (JVM + media server + DB; approx. 4 vCPU / 8 GB minimum for a school).

**Fit.** Worth knowing about because of the ASF governance and the built-in calendar/whiteboard combo,
particularly for institutions with a Java-operations culture. Not competitive with Jitsi or BBB for a
2026 school deployment.

---

## 3. Comparison at a glance

| | Jitsi Meet | BigBlueButton | NC Talk + HPB | Element Call/Matrix | Galène | MiroTalk SFU | OpenMeetings |
|---|---|---|---|---|---|---|---|
| Licence | Apache 2.0 | LGPL 3.0 | AGPL 3.0 | AGPL 3.0 / Apache 2.0 | MIT | AGPL 3.0 (dual) | Apache 2.0 |
| Deploy | Docker compose or deb | **Ubuntu bare metal only** | Nextcloud + 3 services | 3–4 services | 1 binary | Docker | JVM + DB |
| Approx. spec, one school | 4–8 vCPU / 8–16 GB | 8 vCPU / 16 GB, dedicated | +4 vCPU / 8 GB over NC | 4–8 vCPU / 8 GB | 2 vCPU / 2 GB | 4 vCPU / 4 GB | 4 vCPU / 8 GB |
| Auth for EdMat | **JWT HS256 (ideal)** | Signed-URL checksum | OIDC via Nextcloud | OIDC + LiveKit JWT | Token/group pass | JWT | LDAP/DB |
| Recording | Jibri, 1 per conf, MP4 | **Composed replay, best-in-class** | Chrome worker → NC Files | LiveKit Egress → S3 | Built in, raw | Client-side (browser) | Built in |
| Whiteboard / breakouts / polls | Basic / limited / yes | **Yes / yes / yes** | No / no / minimal | No / no / no | No / no / no | Whiteboard / no / no | Yes / no / yes |
| Captions | Jigasi (Google or Vosk) | **Human live captions** | No | No | No | No | No |
| Mobile apps | **Yes (F-Droid too)** | Browser only | Yes | Yes | Browser only | Browser only | Browser only |
| TURN needed | Yes (coturn) | Yes (bundled) | Yes (coturn) | Yes | Yes | Yes | Yes |
| Maintenance | **Low** | High | Medium/High | Medium/High | **Lowest** | Low | Medium |
| Scenario 1 (lesson) | Good | **Excellent** | OK | OK | OK | OK | Good |
| Scenario 2 (consultation) | **Excellent** | Heavy | Good | Good | Good | Good | OK |
| Scenario 3 (staff) | **Excellent** | Good | Good | Good | Good | Good | OK |

---

## 4. Recommendation

**Default: Jitsi Meet.** It is the only candidate that is simultaneously (a) trivially deployable per
school as a Docker compose stack, (b) natively integrable with EdMat's existing session model through a
JWT that EdMat can mint with `node:crypto` and no network call, (c) covered by first-party mobile apps,
and (d) cheap enough that a single school VM is not a joke. Scenarios 2 and 3 are fully solved; scenario
1 is solved for the common case (teacher talks, pupils listen and ask).

**Add BigBlueButton when the school teaches *through* the meeting.** If the school genuinely needs
breakout groups, annotated presentations, in-lesson polls and a per-pupil engagement dashboard —
typically a secondary school, or a school running a serious remote-learning programme — BBB is worth its
much higher operating cost. The realistic deployment is one BBB per *gmina* or per school consortium,
shared by several schools, with EdMat pointing at it via the API secret. Do not ask a single primary
school's part-time admin to run BBB.

**Watch LiveKit / Element Call.** LiveKit is where the open SFU ecosystem is consolidating (OpenVidu 3
rebuilt on it; Matrix adopted it for MatrixRTC). When EdMat wants a meeting UI of its own — class roster
as the layout, attendance captured at the media layer, a "raise hand" that writes to the logbook — LiveKit
is the foundation to build on, and Element Call is the reference for how Matrix-identity-plus-LiveKit fits
together. This is a 2027 conversation, not a 2026 one.

**Do not** put children on `meet.jit.si`, `8x8.vc` or any other public instance "just to try it". The
example domain shipped in EdMat's seed is deliberately invalid so that nobody does this by accident.

---

## 5. Deploying Jitsi next to EdMat

### 5.1 Minimal docker-compose sketch

This is the upstream `docker-jitsi-meet` stack, trimmed, with the school's existing reverse proxy
terminating TLS for **both** EdMat and Jitsi. Put it in its own directory with its own `.env`
(upstream ships `gen-passwords.sh` — run it; never hand-write the internal passwords).

```yaml
# docker-compose.jitsi.yml — school's own Jitsi, behind the school's reverse proxy.
# Media (UDP/10000) must reach the JVB container directly; only the web UI goes through the proxy.
services:
  jitsi-web:
    image: jitsi/web:stable
    restart: unless-stopped
    ports: ["127.0.0.1:8000:80"]          # reverse proxy terminates TLS and proxies to this
    environment:
      PUBLIC_URL: "https://meet.sp12.krakow.pl"
      XMPP_DOMAIN: meet.jitsi
      XMPP_MUC_DOMAIN: muc.meet.jitsi
      XMPP_BOSH_URL_BASE: http://prosody:5280
      JICOFO_AUTH_USER: focus
      ENABLE_AUTH: 1
      ENABLE_GUESTS: 0                    # no anonymous entry: EdMat's JWT is the only way in
      AUTH_TYPE: jwt
      JWT_APP_ID: ${JWT_APP_ID}
      JWT_APP_SECRET: ${JWT_APP_SECRET}
      JWT_ACCEPTED_ISSUERS: ${JWT_APP_ID}
      JWT_ACCEPTED_AUDIENCES: jitsi
      ENABLE_LOBBY: 1
      DISABLE_THIRD_PARTY_REQUESTS: 1     # no Gravatar, no external avatars
      ENABLE_STATS_ID: 0
      DISABLE_DEEP_LINKING: 1
      # Point STUN at our own coturn. The upstream default includes stun.l.google.com — remove it.
      JVB_STUN_SERVERS: "turn.sp12.krakow.pl:3478"
    volumes: ["./data/web:/config:Z"]
    networks: { meet.jitsi: {} }

  prosody:
    image: jitsi/prosody:stable
    restart: unless-stopped
    environment:
      XMPP_DOMAIN: meet.jitsi
      XMPP_AUTH_DOMAIN: auth.meet.jitsi
      XMPP_MUC_DOMAIN: muc.meet.jitsi
      XMPP_INTERNAL_MUC_DOMAIN: internal-muc.meet.jitsi
      AUTH_TYPE: jwt
      ENABLE_AUTH: 1
      ENABLE_GUESTS: 0
      JWT_APP_ID: ${JWT_APP_ID}
      JWT_APP_SECRET: ${JWT_APP_SECRET}
      JWT_ACCEPTED_ISSUERS: ${JWT_APP_ID}
      JWT_ACCEPTED_AUDIENCES: jitsi
      JWT_ALLOW_EMPTY: 0
      JICOFO_AUTH_PASSWORD: ${JICOFO_AUTH_PASSWORD}
      JVB_AUTH_PASSWORD: ${JVB_AUTH_PASSWORD}
    volumes: ["./data/prosody/config:/config:Z"]
    networks:
      meet.jitsi:
        aliases: [xmpp.meet.jitsi]

  jicofo:
    image: jitsi/jicofo:stable
    restart: unless-stopped
    depends_on: [prosody]
    environment:
      XMPP_DOMAIN: meet.jitsi
      XMPP_AUTH_DOMAIN: auth.meet.jitsi
      XMPP_SERVER: xmpp.meet.jitsi
      JICOFO_AUTH_USER: focus
      JICOFO_AUTH_PASSWORD: ${JICOFO_AUTH_PASSWORD}
      ENABLE_AUTH: 1
    volumes: ["./data/jicofo:/config:Z"]
    networks: { meet.jitsi: {} }

  jvb:
    image: jitsi/jvb:stable
    restart: unless-stopped
    depends_on: [prosody]
    ports:
      - "10000:10000/udp"                 # media — must be reachable from the internet
      - "127.0.0.1:8080:8080"             # colibri stats, local only
    environment:
      XMPP_AUTH_DOMAIN: auth.meet.jitsi
      XMPP_INTERNAL_MUC_DOMAIN: internal-muc.meet.jitsi
      XMPP_SERVER: xmpp.meet.jitsi
      JVB_AUTH_USER: jvb
      JVB_AUTH_PASSWORD: ${JVB_AUTH_PASSWORD}
      JVB_ADVERTISE_IPS: ${PUBLIC_IP}
      JVB_STUN_SERVERS: "turn.sp12.krakow.pl:3478"
    volumes: ["./data/jvb:/config:Z"]
    networks: { meet.jitsi: {} }

  # Optional: TURN relay for pupils behind restrictive networks. Run it on 443/TCP+TLS.
  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host
    command: >
      -n --realm=turn.sp12.krakow.pl --use-auth-secret
      --static-auth-secret=${TURN_SECRET} --no-cli --no-multicast-peers
      --min-port=49152 --max-port=65535
      --cert=/certs/fullchain.pem --pkey=/certs/privkey.pem
    volumes: ["/etc/letsencrypt/live/turn.sp12.krakow.pl:/certs:ro"]

networks:
  meet.jitsi: {}
```

**Reverse proxy.** `meet.sp12.krakow.pl` → `127.0.0.1:8000`, with WebSocket upgrade enabled
(`/xmpp-websocket` and `/colibri-ws/` must pass through). EdMat itself stays on its own hostname.

**Firewall.** Open `443/tcp` (proxy), `10000/udp` (JVB media), and `3478/udp` + `443/tcp` if coturn is
on its own host. Nothing else.

**Hardening checklist before letting pupils in:**

- [ ] `ENABLE_GUESTS: 0` — a room URL alone must not admit anyone.
- [ ] Google STUN removed from `JVB_STUN_SERVERS` and from `data/web/custom-config.js`.
- [ ] `DISABLE_THIRD_PARTY_REQUESTS: 1` (Gravatar off).
- [ ] `analytics.disabled: true` and no `callStatsID` in `custom-config.js`.
- [ ] `ENABLE_LOBBY: 1`, and EdMat sets `waitingRoom: true` on consultations.
- [ ] `DISABLE_DEEP_LINKING: 1` so the mobile browser does not nag about installing an app.
- [ ] Certificate auto-renewal tested (`certbot renew --dry-run`).
- [ ] The JWT secret is ≥ 32 random bytes, stored only in the environment, and rotated if it leaks.

### 5.2 Environment variables EdMat needs

| Variable | Where | Meaning |
|---|---|---|
| `EDMAT_JITSI_DOMAIN` | EdMat container | The school's Jitsi hostname, e.g. `meet.sp12.krakow.pl`. Overrides `config.video.jitsi.domain`. Leave empty to configure from the admin screen instead. |
| `EDMAT_JITSI_APP_ID` | EdMat container | Must equal Jitsi's `JWT_APP_ID`. Empty ⇒ EdMat builds plain room URLs with no token (lobby + passcode become the only protection). |
| `EDMAT_JITSI_APP_SECRET` | EdMat container | Must equal Jitsi's `JWT_APP_SECRET`. Never returned by any API. |
| `EDMAT_VIDEO_EVENT_SECRET` | EdMat container | Shared secret for `POST /api/meetings/:id/events` (`X-EdMat-Video-Secret`, or an HMAC-SHA256 body signature in `X-EdMat-Video-Signature`). |
| `JWT_APP_ID` / `JWT_APP_SECRET` | Jitsi stack | The other side of the same pair. |
| `JVB_ADVERTISE_IPS` | Jitsi stack | The server's public IP; without it media fails behind NAT. |
| `TURN_SECRET` | coturn | Shared secret for time-limited TURN credentials. |

BigBlueButton instead needs only `config.video.bbb.url` (e.g.
`https://bbb.powiat.example.pl/bigbluebutton`) and `config.video.bbb.secret` (from
`bbb-conf --secret` on the BBB host), both set through `PATCH /api/admin/video`.

### 5.3 Content-Security-Policy

EdMat's CSP is `default-src 'self'` with no exceptions — which is why, with a real Jitsi domain
configured, five directives (`img-src`, `script-src`, `connect-src`, `media-src`, `frame-src`, plus the
`wss:` form of the host in `connect-src`) must be widened to that **one** host and nothing else.
`object-src 'none'` and `frame-ancestors 'none'` are never widened. The exact patch is in
§5.4. Note that `frame-ancestors 'none'` and `X-Frame-Options: DENY` stay as they are: EdMat embeds
Jitsi, not the other way round. `object-src 'none'` (added by the security review as S-19) closes
`<object>`/`<embed>`, which `default-src` alone does not cover in every browser.

If the school prefers not to touch the CSP at all, the `meetings` screen degrades gracefully: when the
`external_api.js` script fails to load, it falls back to an "open in a new tab" link, and the meeting
still works — it simply opens on the Jitsi domain instead of inside the logbook.

### 5.4 The CSP patch (applied — this is what `server/index.js` now does)

This is no longer a proposal: the patch below is live in `server/index.js`, which derives the header from
`config.video` instead of using a fixed string. It is kept here as the record of what changed and why.

```diff
--- a/server/index.js
+++ b/server/index.js
@@
-  const secHeaders = (res, isSecure) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Permissions-Policy', 'camera=(self), geolocation=()'); res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"); if (isSecure) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'); };
+  /* The school's own video host is the single allowed external origin, and only when it is really
+     configured (the seed ships an example domain on purpose). See docs/VIDEO.md. */
+  const videoOrigin = () => {
+    const v = (db.data.config && db.data.config.video) || {};
+    const d = String((process.env.EDMAT_JITSI_DOMAIN || (v.jitsi && v.jitsi.domain) || '')).trim();
+    if (v.provider && v.provider !== 'jitsi') return '';
+    if (!d || !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(d)) return '';
+    return 'https://' + d;
+  };
+  const secHeaders = (res, isSecure) => {
+    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
+    res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
+    const v = videoOrigin(); const w = v ? ' ' + v : ''; const ws = v ? ' ' + v.replace(/^https:/, 'wss:') : '';
+    res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data: blob:${w}; style-src 'self' 'unsafe-inline'; script-src 'self'${w}; connect-src 'self'${w}${ws}; media-src 'self' blob:${w}; frame-src 'self'${w}; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
+    if (isSecure) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
+  };
```

Notes on the patch:

- `wss://<domain>` is required as well as `https://` — the Jitsi client opens an XMPP WebSocket.
- `media-src blob:` is needed for local preview tracks; `img-src blob:` for the video thumbnails.
- `microphone=(self)` and `display-capture=(self)` must be added to `Permissions-Policy`, otherwise the
  embedded iframe cannot get a microphone or share a screen even though the CSP allows it.
- When `provider` is `bbb` or `none`, or the domain is still the example placeholder, `videoOrigin()`
  returns `''` and no external origin is granted at all — those providers open in a new tab and need no
  exception. The header then differs from today's only by two newly *explicit* directives,
  `media-src 'self' blob:` and `frame-src 'self'`, which previously inherited `default-src 'self'`; the
  only widening is `blob:` in `media-src`, needed for the local camera preview.
- Verified by simulation: with the example domain, with `provider: 'bbb'`, and with a malformed domain,
  the header grants nothing external; only a syntactically valid hostname (from config or
  `EDMAT_JITSI_DOMAIN`) is added, and it is added to exactly five directives plus its `wss://` form.

---

## 6. How EdMat's `meetings` module uses all this

- `server/lib/video.js` — pure URL/JWT/checksum construction and signature *verification*. **No network
  calls, ever**, which is what makes the module testable offline and keeps the logbook out of the media
  path.
- `server/routes/meetings.js` — scheduling, permissions (`joinPolicy`), join payloads, attendance,
  recording consent, provider events, admin configuration.
- `public/app/screens/meetings.js` — the only place in EdMat that loads an external script, and only
  `https://<school-domain>/external_api.js`, lazily, when a real domain is configured and a user opens a
  meeting. Any failure falls back to a plain link.
- Recording stays `enabled: false` until every affected pupil has a guardian's consent recorded on the
  meeting; withdrawing consent switches it straight back off.
- Every join is written to the audit log and to `meetingAttendance`.

---

## 7. Podsumowanie (PL)

**Problem.** Szkoła korzystająca z Zooma czy Teamsów oddaje zewnętrznej firmie twarze, głosy i metadane
swoich uczniów. EdMat ma to odwrócić: spotkania wideo mają się odbywać na serwerze, którym szkoła (albo
jej organ prowadzący) faktycznie administruje.

**Porównane rozwiązania.** Jitsi Meet, BigBlueButton, Nextcloud Talk z High Performance Backend,
Element Call na Matriksie z SFU LiveKit, Galène, MiroTalk SFU/P2P, OpenVidu i LiveKit jako klocki do
budowy własnego produktu oraz Apache OpenMeetings.

**Rekomendacja.**

1. **Jitsi Meet jako domyślny wybór.** Jako jedyny łączy cztery rzeczy naraz: instalację jednym plikiem
   `docker compose` w skali pojedynczej szkoły, integrację z logowaniem EdMat przez token **JWT HS256**,
   który dziennik podpisuje sam (`node:crypto`, bez żadnego zapytania do sieci), własne aplikacje mobilne
   (także w F-Droid) oraz niskie wymagania sprzętowe — orientacyjnie 4–8 vCPU i 8–16 GB RAM na szkołę.
   Do lekcji zdalnej, konsultacji z rodzicem i rady pedagogicznej w zupełności wystarcza.
2. **BigBlueButton wtedy, gdy potrzebne są funkcje klasowe.** Tablica z adnotacjami na wgranej
   prezentacji, pokoje grupowe (breakout rooms), ankiety, wspólne notatki, panel aktywności ucznia i —
   co ważne dla dostępności — **napisy na żywo pisane przez człowieka**. Cena: serwer **wyłącznie na
   Ubuntu, na gołym systemie**, orientacyjnie 8 vCPU / 16 GB / 500 GB SSD na ok. 150 użytkowników
   równocześnie, brak wsparcia dla Dockera w produkcji i przebudowa serwera przy zmianie wersji Ubuntu.
   Realny model: jeden BBB na gminę lub zespół szkół, a EdMat łączy się z nim przez sekret API
   (`checksum = SHA1(nazwa wywołania + query + sekret)`).
3. **LiveKit / Element Call — kierunek na przyszłość.** OpenVidu 3 przesiadło się na LiveKit, Matrix
   również (MatrixRTC). Gdy EdMat będzie chciał własny interfejs spotkania (układ według listy klasy,
   frekwencja zbierana wprost z warstwy medialnej), to będzie właściwa podstawa. Na dziś za dużo
   ruchomych części jak na jedną szkołę.

**Ochrona danych nieletnich — minimum, które trzeba zrobić po instalacji Jitsi.** Wyłączyć wejście
gości (`ENABLE_GUESTS: 0`, wchodzi się wyłącznie z tokenem z dziennika), **usunąć domyślny serwer STUN
Google** i wskazać własny coturn, ustawić `DISABLE_THIRD_PARTY_REQUESTS: 1` (koniec z Gravatarem),
wyłączyć analitykę i `callStatsID`, włączyć poczekalnię (lobby) oraz wyłączyć „deep linking" do aplikacji
mobilnej. Po takim ustawieniu spotkanie nie wykonuje ani jednego zapytania poza domenę szkoły.

**Nagrywanie.** Domyślnie wyłączone. W EdMacie włączenie nagrania wymaga zgody opiekunów **wszystkich**
uczniów niepełnoletnich objętych spotkaniem; zgodę można wycofać, co natychmiast wyłącza nagrywanie.
Pliki zostają na serwerze szkoły (`storedAt: 'school-server'`). W Jitsi nagrywa Jibri — **jedna instancja
obsługuje jedno spotkanie naraz** i potrzebuje własnych ~4 vCPU / 4 GB, więc nagrywanie wielu lekcji
jednocześnie jest kosztowne. W BBB nagranie to nie film, lecz odtwarzalna kompozycja slajdów, adnotacji,
dźwięku i czatu — znacznie mniejsza i dydaktycznie użyteczniejsza.

**Czego nie robić.** Nie wolno „na próbę" wpuszczać uczniów na publiczne `meet.jit.si` ani `8x8.vc`.
Domena w danych demonstracyjnych EdMat jest celowo nieprawidłowa (`meet.sp12.krakow.pl (przykład)`), żeby
nikt nie zrobił tego przypadkiem — dopóki administrator nie wpisze prawdziwego adresu, dziennik nie
ładuje żadnego skryptu z zewnątrz, a ekran spotkania pokazuje ostrzeżenie zamiast okna wideo.

**Nagłówek CSP.** Domyślna polityka EdMat to `default-src 'self'` bez wyjątków. Po wpisaniu prawdziwej
domeny wideo trzeba dopisać **ten jeden host** (i jego odpowiednik `wss://`) do `script-src`,
`frame-src`, `connect-src`, `media-src` oraz `img-src`, a do `Permissions-Policy` dodać `microphone=(self)`
i `display-capture=(self)`. Gotowa łatka: sekcja 5.4. Bez niej ekran spotkań nadal działa — po prostu
otwiera pokój w nowej karcie zamiast osadzać go w dzienniku.
