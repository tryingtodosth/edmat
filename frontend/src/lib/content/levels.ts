/**
 * Levels and limits, in full, per locale — the reader-facing version of LAUNCHCHECKLIST.md's
 * "Trust system — REP, SKILL and ENERGY" design.
 *
 * **This widens the exception `content/privacy.ts` opened, and does so deliberately rather than by
 * drift.** That file argued legal text must be readable AS A DOCUMENT, not as ~50 keys interleaved
 * with button labels in `en.json`. The same argument applies here for the same reason: this page is
 * nine tables and forty paragraphs that only make sense read end to end, and split across the message
 * catalogue neither language version could be reviewed against the design it describes. The rule's
 * actual purpose — that no string is ever English-only — is still satisfied exactly, because both
 * locales live in this file and a third cannot be added without adding all of it.
 *
 * **Every number here is copied from the design, and the design says plainly that the numbers are a
 * starting proposal that needs real traffic to calibrate.** They are written down so they can be
 * argued with. If this file and LAUNCHCHECKLIST.md ever disagree, the checklist is the source and this
 * is the stale copy.
 *
 * The "what is enforced today" section at the end is the opposite: it is checked against the real
 * code — `REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']` in `config/settings.py`,
 * `Profile.is_verified_contributor`, and `moderation.NodeGovernor` — and must be updated when those
 * change, because it is the one part of this page that claims to describe the present.
 */

export interface LevelsTable {
	columns: string[];
	rows: string[][];
}

export interface LevelsSection {
	heading: string;
	/** Rendered as paragraphs above the table/bullets. */
	body?: string[];
	table?: LevelsTable;
	bullets?: string[];
	/** Rendered after the table, for the note a table needs rather than the lead it needs. */
	after?: string[];
	/**
	 * True only for the section describing what actually runs today. Everything else on this page is
	 * a design, and the two must never be told apart by tone of voice alone.
	 */
	live?: boolean;
}

export interface LevelsDoc {
	title: string;
	lead: string[];
	notice: string;
	plannedBadge: string;
	liveBadge: string;
	sections: LevelsSection[];
	sourceNote: string;
}

const EN: LevelsDoc = {
	title: 'Levels and limits',
	lead: [
		'EdMat is meant to be written by the people who use it. Levels are how it decides who may do what — and, just as importantly, what nobody may do alone.',
		'There are two ladders rather than one. What you may DO is a capability tier, and an institution can grant it outright. What you may do TO OTHER PEOPLE’S WORK is a mod level, and it can only ever be earned. Keeping them apart is the single most important decision on this page.'
	],
	notice:
		'None of this is switched on yet. Today EdMat has one staff flag and one contributor flag, and nothing described below is enforced. The numbers are a starting proposal that needs real traffic to calibrate — they are written down so they can be argued with, not because they are right. What IS enforced today is the last section on this page.',
	plannedBadge: 'Designed, not built',
	liveBadge: 'Live today',
	sections: [
		{
			heading: 'Three quantities, kept apart',
			body: [
				'They answer genuinely different questions, so collapsing them into a single score would throw away the distinction that makes any of it useful. Somebody can be trusted with the site and know nothing about topology; somebody can be excellent at topology and new here.'
			],
			table: {
				columns: ['Quantity', 'Scope', 'What it answers', 'What moves it'],
				rows: [
					[
						'REP',
						'one per person, global',
						'how far the platform trusts your judgement',
						'votes on your work, accepted contributions, and your moderation decisions being upheld or overturned'
					],
					[
						'SKILL',
						'one per person, per field',
						'whether you are competent in this subject',
						'votes and endorsements on your work in that field, weighted by how hard the material is'
					],
					[
						'ENERGY',
						'one per person, regenerating',
						'how much you may do right now — one energy is one comment',
						'spent per action; refills on a clock at a rate your tier sets'
					]
				]
			}
		},
		{
			heading: 'Why there are two ladders',
			body: [
				'An earlier sketch had a single ladder whose top rung was “your moderation takes effect immediately”. That does not survive connecting a university’s student register. Granting the top rung to every verified member would hand tens of thousands of people a one-click delete button, and an appeal panel of “peers at or above the person who acted” would then mean everybody — which is no panel at all.',
				'So the two were split. A university can vouch that you are a real, enrolled person; that is an identity claim. It is not evidence of judgement about somebody else’s work, and it is never treated as such.'
			]
		},
		{
			heading: 'Capability tier — what you may do',
			body: [
				'Cumulative: each tier keeps everything the ones below it grant. Reached either by earning REP or, for a member of a connected university, immediately.'
			],
			table: {
				columns: ['Tier', 'What it grants', 'REP', 'Energy cap', 'Refill'],
				rows: [
					['S', 'nothing further to unlock — full participation', '2500+', '300', '8/h'],
					['A', 'upload any accepted file format', '750–2499', '150', '4/h'],
					['B', 'share links', '200–749', '80', '2/h'],
					['C', 'write reviews', '50–199', '40', '1/h'],
					['D', 'comments and messages post directly', '10–49', '20', '1 per 2h'],
					['E', 'may comment, but each one waits for approval', '0–9', '5', '1 per 6h'],
					['F', 'suspended — read only', 'below 0', '0', '—']
				]
			}
		},
		{
			heading: 'Mod level — what you may do to other people’s work',
			body: [
				'Never granted by identity, never by a university connection, never by your capability tier. Only ever earned, and only ever granted by somebody already above you.'
			],
			table: {
				columns: ['Level', 'Authority', 'How it is reached', 'Exists today?'],
				rows: [
					[
						'M0',
						'none — you may report, nothing more',
						'everybody by default, including every verified university member',
						'—'
					],
					[
						'M1',
						'your reports carry real weight; you may send content to the queue, never remove it',
						'tier B or better, and no upheld complaint against you in 90 days',
						'not yet'
					],
					[
						'M2',
						'acts on the queue, but only in fields where your own SKILL is C or better; every decision can be appealed',
						'tier A or better, 30 days at M1, granted by an M3 or above',
						'not yet'
					],
					[
						'M3',
						'full authority within one field or course, including immediate effect',
						'granted by staff',
						'yes'
					],
					['M4', 'platform-wide', 'staff', 'yes']
				]
			},
			after: [
				'Immediate, unqueued effect belongs to M3 and above only. That one rule is what keeps appeals meaningful once a capability tier is being handed out in bulk.',
				'Authority is also capped by competence: an M2 may only act in fields where their own SKILL is C or better. Otherwise somebody with authority can delete specialist work they have no ability to judge, which is exactly the failure the skill axis exists to prevent.'
			]
		},
		{
			heading: 'What your vote weighs',
			body: [
				'Keyed to the REP you actually earned — not to the tier you hold. This is where the two ladders visibly pay off.'
			],
			table: {
				columns: ['REP', 'Weight'],
				rows: [
					['2500+', '16'],
					['750–2499', '8'],
					['200–749', '4'],
					['50–199', '2'],
					['10–49', '1'],
					['below 10', '0']
				]
			},
			after: [
				'A newly verified first-year holds the top capability tier — they may upload, link, review and comment freely, which is what trusting a real student ought to mean — while their vote still weighs nothing until they have a record. Without that split, one fresher could hide anything on the site on their first afternoon.',
				'Hiding content takes 16 points of weighted downvote, and the content must also have been put in the queue by somebody at M1 or above. It is a consensus of people who have built standing, not a single click.'
			]
		},
		{
			heading: 'How a tier is reached',
			body: [
				'Connecting a university account grants the top tier at once, because the university’s own register is a far stronger claim than anything the steps below approximate. Everybody else earns it. EdMat is a public study resource, not one university’s intranet: a graduate, a student somewhere else, or somebody revising alone must still have a real way in.'
			],
			table: {
				columns: ['Step', 'Raises your ceiling to'],
				rows: [
					['Connecting a university account', 'S, immediately'],
					['1. Email confirmed', 'E'],
					['2. Display name and declared field of study', 'D'],
					['3. Institutional email or student ID', 'C'],
					['4. Human check, and a cooling-off period since registering', 'B'],
					['5. Vouched for by two separate A or S contributors', 'A'],
					['6. Manual grant — recorded, and revocable', 'S']
				]
			},
			after: [
				'Affiliation lapses. Students graduate and staff leave, so a tier granted once and never re-checked becomes a permanent grant to somebody the university no longer knows. Re-verification runs on a schedule, and when it lapses you fall back to the tier you EARNED rather than dropping to read-only — somebody who contributed for three years should not be demoted for graduating.'
			]
		},
		{
			heading: 'What actions cost',
			body: [
				'Energy is the rate limit that scales with standing instead of with your IP address. Voting is free on purpose: making people pay to express an opinion would bias the vote toward whoever has energy to spare.'
			],
			table: {
				columns: ['Action', 'Energy'],
				rows: [
					['Comment or message', '1 — this is the unit'],
					['Vote', '0, but weighted'],
					['Share a link', '2'],
					['Write a review', '3'],
					['Endorse somebody’s skill in a field', '5'],
					['Upload a file', '10'],
					['Flag content', '1, refunded if the flag is upheld'],
					['Sit on an appeal panel', '0, and earns 2 REP']
				]
			}
		},
		{
			heading: 'What moves REP',
			table: {
				columns: ['Event', 'REP'],
				rows: [
					['Your comment is upvoted', '+2, multiplied by the material’s difficulty'],
					['Your comment is downvoted', '−2'],
					['A review of yours is accepted', '+10'],
					['A translation of yours is published', '+15'],
					['An exercise you submitted is accepted', '+25'],
					['A material you uploaded is accepted', '+25'],
					['Somebody endorses your skill', '+5'],
					['A flag you raised is upheld', '+3'],
					['A moderation decision of yours is upheld', '+15'],
					['A moderation decision of yours is overturned', '−(your vote weight × 10)'],
					['Your content is hidden by consensus', '−20']
				]
			},
			after: [
				'Votes alone can earn you at most 50 REP a day. Without that cap a coordinated group could farm somebody up the ladder in an afternoon.'
			]
		},
		{
			heading: 'Moving between levels',
			bullets: [
				'You promote at the threshold but only demote at 80% of it. Reach 200 for tier B and you keep B until you fall below 160 — otherwise anybody sitting on a boundary changes tier daily.',
				'Seven days minimum at a tier before you can promote again, so a single burst of activity cannot vault a new account to A. Moving from E to D is exempt: it should follow email confirmation straight away.',
				'Inactivity costs 2% of your REP a month, floored at the bottom of your current tier. It applies to REP only, never to SKILL — standing lapses, knowledge does not.',
				'Every change writes a record: who, from what, to what, why, and when. A level must never change silently.',
				'F is never automatic. Suspension takes a real moderation decision and never a REP threshold, because auto-suspending on negative REP is the easiest thing in this design to weaponise by brigading somebody.'
			]
		},
		{
			heading: 'Appeals, and what makes immediate authority safe to hand out',
			body: [
				'Immediate, unreviewable removal by one person is the most dangerous thing here. It is confined to M3 and above, but it still has to be answerable, so every hide and every immediate action writes an appealable record.'
			],
			bullets: [
				'An appeal convenes peers at or above the mod level the person actually used — not their capability tier, which after a university connection says nothing about judgement — excluding both the person who acted and the author. Three of them for an ordinary hide, five for an immediate action by an M3 or above.',
				'Upheld, and the person who acted gains 15 REP.',
				'Overturned, and they lose REP scaled by the authority they used: 20 at M1, 60 at M2, 160 at M3, 250 at M4. The more power you used, the more being wrong costs.',
				'Three overturns in 90 days costs one mod level. It can be earned back.',
				'Demotion never touches your capability tier. Being wrong about somebody else’s work is not evidence that you can no longer be trusted with your own, and conflating the two would make every moderator quietly reluctant to make a call.',
				'Panel members who vote against the panel’s own eventual conclusion take a small penalty, so sitting on a panel is not a free rubber stamp.'
			]
		},
		{
			heading: 'What is actually enforced today',
			live: true,
			body: [
				'Everything above is a design. This section describes the code as it stands, and is the only part of this page that claims to describe the present.'
			],
			bullets: [
				'Moderation is a single staff flag, plus field- and course-scoped governors. There is nothing between “nothing” and “everything”.',
				'One contributor flag stands in for the whole capability tier.',
				'There is no REP, no SKILL and no ENERGY. Nothing is metered per action, and no level exists to be shown to you.',
				'What does limit you is a plain rate limit on the address you are coming from, or on the account you are using.'
			],
			table: {
				columns: ['Limit', 'Rate'],
				rows: [
					['Registrations from one address', '10 an hour'],
					['Sign-in attempts from one address', '10 a minute'],
					['Sign-in attempts against one account', '30 an hour'],
					['Password reset requests', '5 an hour'],
					['Avatar uploads', '20 an hour'],
					['Address lookups', '60 an hour'],
					['Everything else, signed out', '600 an hour'],
					['Everything else, signed in', '3000 an hour']
				]
			},
			after: [
				'These are counted per server process, so on a multi-process deployment each worker keeps its own tally and the real limit is higher than the number above. Correct for the single-process prototype this currently is; a shared cache is needed before the figures mean exactly what they say.'
			]
		}
	],
	sourceNote:
		'The full design, including its open questions and the parts still being argued about, lives in LAUNCHCHECKLIST.md in the repository.'
};

const PL: LevelsDoc = {
	title: 'Poziomy i ograniczenia',
	lead: [
		'EdMat ma być pisany przez osoby, które z niego korzystają. Poziomy to sposób, w jaki serwis rozstrzyga, kto co może — i, co równie ważne, czego nie może nikt w pojedynkę.',
		'Drabiny są dwie, nie jedna. To, co wolno CI ROBIĆ, wyznacza poziom uprawnień i uczelnia może go przyznać od razu. To, co wolno Ci zrobić Z CUDZĄ PRACĄ, wyznacza poziom moderacji, a ten da się wyłącznie zapracować. Rozdzielenie ich to najważniejsza decyzja na tej stronie.'
	],
	notice:
		'Nic z tego nie jest jeszcze włączone. Dziś EdMat ma jedną flagę zespołu i jedną flagę współtwórcy, a nic z opisanych niżej zasad nie działa. Liczby są propozycją wyjściową, którą trzeba wykalibrować na prawdziwym ruchu — spisano je po to, żeby dało się z nimi dyskutować, a nie dlatego, że są trafione. To, co obowiązuje NAPRAWDĘ, znajdziesz w ostatniej sekcji.',
	plannedBadge: 'Zaprojektowane, niezbudowane',
	liveBadge: 'Działa dziś',
	sections: [
		{
			heading: 'Trzy wielkości, trzymane osobno',
			body: [
				'Odpowiadają na naprawdę różne pytania, więc sprowadzenie ich do jednego wyniku zgubiłoby rozróżnienie, które jest tu najcenniejsze. Można być godnym zaufania w serwisie i nie znać się na topologii; można świetnie znać topologię i być tu od wczoraj.'
			],
			table: {
				columns: ['Wielkość', 'Zasięg', 'Na co odpowiada', 'Co ją zmienia'],
				rows: [
					[
						'REP',
						'jedna na osobę, globalna',
						'na ile serwis ufa Twojemu osądowi',
						'głosy na Twoje treści, przyjęte zgłoszenia oraz to, czy Twoje decyzje moderacyjne się obroniły'
					],
					[
						'SKILL',
						'jedna na osobę i dziedzinę',
						'czy znasz się na tym konkretnym przedmiocie',
						'głosy i rekomendacje dotyczące Twoich treści w tej dziedzinie, ważone trudnością materiału'
					],
					[
						'ENERGY',
						'jedna na osobę, odnawialna',
						'ile możesz zrobić teraz — jedna energia to jeden komentarz',
						'wydawana przy każdej akcji, odnawia się w czasie w tempie zależnym od poziomu'
					]
				]
			}
		},
		{
			heading: 'Dlaczego drabiny są dwie',
			body: [
				'Wcześniejszy szkic miał jedną drabinę, której najwyższy szczebel brzmiał „Twoja moderacja działa natychmiast”. To nie wytrzymuje zderzenia z podłączeniem uczelnianego systemu studenckiego. Przyznanie najwyższego szczebla każdej zweryfikowanej osobie oznaczałoby wręczenie dziesiątkom tysięcy ludzi przycisku kasującego jednym kliknięciem, a panel odwoławczy złożony z „osób na poziomie tej, która działała, lub wyżej” oznaczałby wtedy wszystkich — czyli żaden panel.',
				'Dlatego jedno rozdzielono na dwa. Uczelnia może poświadczyć, że jesteś prawdziwą, zapisaną osobą; to potwierdzenie tożsamości. Nie jest dowodem na trafność Twoich sądów o cudzej pracy i nigdy nie jest tak traktowane.'
			]
		},
		{
			heading: 'Poziom uprawnień — co możesz robić',
			body: [
				'Kumulatywny: każdy poziom zachowuje wszystko, co dają niższe. Osiąga się go, zbierając REP albo — w przypadku osoby z podłączonej uczelni — od razu.'
			],
			table: {
				columns: ['Poziom', 'Co daje', 'REP', 'Limit energii', 'Odnawianie'],
				rows: [
					['S', 'nie ma już czego odblokowywać — pełny udział', '2500+', '300', '8/h'],
					['A', 'przesyłanie plików w każdym obsługiwanym formacie', '750–2499', '150', '4/h'],
					['B', 'udostępnianie linków', '200–749', '80', '2/h'],
					['C', 'pisanie recenzji', '50–199', '40', '1/h'],
					['D', 'komentarze i wiadomości publikują się od razu', '10–49', '20', '1 na 2h'],
					[
						'E',
						'możesz komentować, ale każdy komentarz czeka na zatwierdzenie',
						'0–9',
						'5',
						'1 na 6h'
					],
					['F', 'zawieszenie — tylko odczyt', 'poniżej 0', '0', '—']
				]
			}
		},
		{
			heading: 'Poziom moderacji — co możesz zrobić z cudzą pracą',
			body: [
				'Nigdy nie wynika z tożsamości, nigdy z podłączenia uczelni, nigdy z poziomu uprawnień. Wyłącznie zapracowany i wyłącznie nadany przez kogoś, kto jest już wyżej.'
			],
			table: {
				columns: ['Poziom', 'Uprawnienia', 'Jak się go osiąga', 'Czy istnieje dziś?'],
				rows: [
					[
						'M0',
						'żadne — możesz zgłaszać i nic ponadto',
						'każdy domyślnie, łącznie z każdą zweryfikowaną osobą z uczelni',
						'—'
					],
					[
						'M1',
						'Twoje zgłoszenia mają realną wagę; możesz skierować treść do kolejki, ale nigdy jej nie usuniesz',
						'poziom B lub wyżej i brak uznanej skargi na Ciebie przez 90 dni',
						'jeszcze nie'
					],
					[
						'M2',
						'działa na kolejce, ale tylko w dziedzinach, w których Twój SKILL to co najmniej C; od każdej decyzji przysługuje odwołanie',
						'poziom A lub wyżej, 30 dni na M1, nadanie przez M3 lub wyżej',
						'jeszcze nie'
					],
					[
						'M3',
						'pełne uprawnienia w obrębie jednej dziedziny lub kursu, ze skutkiem natychmiastowym',
						'nadaje zespół',
						'tak'
					],
					['M4', 'w całym serwisie', 'zespół', 'tak']
				]
			},
			after: [
				'Skutek natychmiastowy, z pominięciem kolejki, przysługuje wyłącznie od M3 wzwyż. Ta jedna zasada sprawia, że odwołania zachowują sens nawet wtedy, gdy poziom uprawnień rozdaje się masowo.',
				'Uprawnienia ogranicza też kompetencja: M2 może działać tylko w dziedzinach, w których jego własny SKILL to co najmniej C. Inaczej osoba z uprawnieniami może usunąć specjalistyczną treść, której nie jest w stanie ocenić — a to dokładnie ta porażka, której oś kompetencji ma zapobiegać.'
			]
		},
		{
			heading: 'Ile waży Twój głos',
			body: [
				'Zależy od REP, który faktycznie zdobyłeś — a nie od poziomu, który posiadasz. To tutaj rozdzielenie drabin widać najlepiej.'
			],
			table: {
				columns: ['REP', 'Waga'],
				rows: [
					['2500+', '16'],
					['750–2499', '8'],
					['200–749', '4'],
					['50–199', '2'],
					['10–49', '1'],
					['poniżej 10', '0']
				]
			},
			after: [
				'Świeżo zweryfikowana osoba z pierwszego roku ma najwyższy poziom uprawnień — może przesyłać pliki, dodawać linki, recenzować i komentować bez ograniczeń, bo właśnie to powinno oznaczać zaufanie do prawdziwego studenta — a mimo to jej głos waży zero, dopóki nie zbierze dorobku. Bez tego rozdzielenia jedna osoba z pierwszego roku mogłaby pierwszego popołudnia ukryć w serwisie cokolwiek.',
				'Ukrycie treści wymaga 16 punktów ważonych głosów przeciw, a do tego treść musi wcześniej trafić do kolejki od kogoś na poziomie M1 lub wyżej. To zgoda osób z realnym dorobkiem, a nie jedno kliknięcie.'
			]
		},
		{
			heading: 'Jak osiąga się poziom uprawnień',
			body: [
				'Podłączenie konta uczelnianego od razu daje najwyższy poziom, bo rejestr uczelni jest znacznie mocniejszym potwierdzeniem niż wszystko, co przybliżają poniższe kroki. Wszyscy pozostali zdobywają go sami. EdMat jest publicznym materiałem do nauki, a nie intranetem jednej uczelni: absolwent, student innej uczelni albo osoba ucząca się sama też muszą mieć realną drogę.'
			],
			table: {
				columns: ['Krok', 'Podnosi Twój pułap do'],
				rows: [
					['Podłączenie konta uczelnianego', 'S, natychmiast'],
					['1. Potwierdzony adres e-mail', 'E'],
					['2. Nazwa wyświetlana i zadeklarowany kierunek', 'D'],
					['3. Uczelniany e-mail albo numer albumu', 'C'],
					['4. Weryfikacja, że jesteś człowiekiem, plus karencja od rejestracji', 'B'],
					['5. Poręczenie dwóch różnych osób z poziomu A lub S', 'A'],
					['6. Nadanie ręczne — odnotowane i odwoływalne', 'S']
				]
			},
			after: [
				'Powiązanie z uczelnią wygasa. Studenci kończą studia, pracownicy odchodzą, więc poziom nadany raz i nigdy niesprawdzony staje się bezterminowym uprawnieniem dla kogoś, kogo uczelnia już nie zna. Weryfikacja powtarza się cyklicznie, a po wygaśnięciu wracasz do poziomu, który ZAPRACOWAŁEŚ, zamiast spaść do samego odczytu — ktoś, kto współtworzył serwis przez trzy lata, nie powinien tracić uprawnień za to, że się obronił.'
			]
		},
		{
			heading: 'Ile kosztują poszczególne akcje',
			body: [
				'Energia to ograniczenie tempa, które zależy od dorobku, a nie od adresu IP. Głosowanie jest bezpłatne celowo: kazanie ludziom płacić za wyrażenie zdania przechyliłoby wynik na korzyść tych, którym energii zbywa.'
			],
			table: {
				columns: ['Akcja', 'Energia'],
				rows: [
					['Komentarz lub wiadomość', '1 — to jest jednostka'],
					['Głos', '0, ale ważony'],
					['Udostępnienie linku', '2'],
					['Napisanie recenzji', '3'],
					['Rekomendacja czyichś kompetencji w dziedzinie', '5'],
					['Przesłanie pliku', '10'],
					['Zgłoszenie treści', '1, zwracane, jeśli zgłoszenie zostanie uznane'],
					['Udział w panelu odwoławczym', '0, i daje 2 REP']
				]
			}
		},
		{
			heading: 'Co zmienia REP',
			table: {
				columns: ['Zdarzenie', 'REP'],
				rows: [
					['Twój komentarz dostaje głos w górę', '+2, przemnożone przez trudność materiału'],
					['Twój komentarz dostaje głos w dół', '−2'],
					['Twoja recenzja zostaje przyjęta', '+10'],
					['Twoje tłumaczenie zostaje opublikowane', '+15'],
					['Przesłane przez Ciebie zadanie zostaje przyjęte', '+25'],
					['Przesłany przez Ciebie materiał zostaje przyjęty', '+25'],
					['Ktoś rekomenduje Twoje kompetencje', '+5'],
					['Twoje zgłoszenie zostaje uznane', '+3'],
					['Twoja decyzja moderacyjna się obroniła', '+15'],
					['Twoja decyzja moderacyjna została uchylona', '−(waga Twojego głosu × 10)'],
					['Twoja treść zostaje ukryta przez zgodę społeczności', '−20']
				]
			},
			after: [
				'Same głosy dają najwyżej 50 REP dziennie. Bez tego limitu zgrana grupa mogłaby w jedno popołudnie wywindować kogoś po drabinie.'
			]
		},
		{
			heading: 'Przechodzenie między poziomami',
			bullets: [
				'Awansujesz na progu, ale spadasz dopiero przy 80% progu. Zdobądź 200 na poziom B, a zostaniesz na B, dopóki nie spadniesz poniżej 160 — inaczej każdy, kto siedzi na granicy, zmieniałby poziom codziennie.',
				'Minimum siedem dni na poziomie przed kolejnym awansem, żeby jeden zryw aktywności nie wyniósł nowego konta prosto na A. Przejście z E na D jest wyjęte spod tej zasady: powinno następować od razu po potwierdzeniu adresu e-mail.',
				'Bezczynność kosztuje 2% REP miesięcznie, nie niżej niż dolna granica Twojego obecnego poziomu. Dotyczy wyłącznie REP, nigdy SKILL — dorobek się przedawnia, wiedza nie.',
				'Każda zmiana zostaje odnotowana: kto, z czego, na co, dlaczego i kiedy. Poziom nigdy nie może zmienić się po cichu.',
				'Poziom F nigdy nie nadaje się automatycznie. Zawieszenie wymaga prawdziwej decyzji moderacyjnej i nigdy nie wynika z progu REP, bo automatyczne zawieszanie przy ujemnym REP jest w tym projekcie najłatwiejsze do wykorzystania przeciw komuś przez nagonkę.'
			]
		},
		{
			heading:
				'Odwołania, czyli co sprawia, że natychmiastowe uprawnienia da się bezpiecznie nadać',
			body: [
				'Natychmiastowe usunięcie treści przez jedną osobę, bez niczyjej kontroli, jest tu najgroźniejszym mechanizmem. Przysługuje wyłącznie od M3 wzwyż, ale i tak musi być rozliczalne, więc każde ukrycie i każde natychmiastowe działanie zostawia ślad, od którego można się odwołać.'
			],
			bullets: [
				'Odwołanie zwołuje osoby na poziomie moderacji użytym przez działającego lub wyższym — nie na jego poziomie uprawnień, który po podłączeniu uczelni nie mówi nic o osądzie — z wyłączeniem samego działającego i autora treści. Trzy osoby przy zwykłym ukryciu, pięć przy natychmiastowym działaniu od M3 wzwyż.',
				'Decyzja utrzymana: działający zyskuje 15 REP.',
				'Decyzja uchylona: traci REP proporcjonalnie do użytych uprawnień — 20 na M1, 60 na M2, 160 na M3, 250 na M4. Im większej władzy użyłeś, tym drożej kosztuje pomyłka.',
				'Trzy uchylenia w ciągu 90 dni to spadek o jeden poziom moderacji. Da się go odzyskać.',
				'Degradacja nigdy nie rusza poziomu uprawnień. Pomyłka w ocenie cudzej pracy nie dowodzi, że nie można Ci już ufać przy własnej, a mieszanie tych dwóch rzeczy sprawiłoby, że każdy moderator po cichu unikałby podejmowania decyzji.',
				'Osoby w panelu, które głosują wbrew jego ostatecznemu rozstrzygnięciu, ponoszą niewielką karę — żeby zasiadanie w panelu nie było przystawianiem pieczątki bez kosztu.'
			]
		},
		{
			heading: 'Co obowiązuje naprawdę, dziś',
			live: true,
			body: [
				'Wszystko powyżej to projekt. Ta sekcja opisuje kod w obecnym kształcie i jako jedyna na tej stronie mówi o stanie faktycznym.'
			],
			bullets: [
				'Moderacja to pojedyncza flaga zespołu plus opiekunowie przypisani do dziedzin i kursów. Między „nic” a „wszystko” nie ma nic pośredniego.',
				'Całość poziomu uprawnień zastępuje jedna flaga współtwórcy.',
				'Nie ma REP, nie ma SKILL i nie ma ENERGY. Nic nie jest odmierzane na akcję i nie istnieje żaden poziom, który dałoby się Tobie pokazać.',
				'Ogranicza Cię natomiast zwykły limit tempa — liczony dla adresu, z którego się łączysz, albo dla konta, z którego korzystasz.'
			],
			table: {
				columns: ['Ograniczenie', 'Limit'],
				rows: [
					['Rejestracje z jednego adresu', '10 na godzinę'],
					['Próby logowania z jednego adresu', '10 na minutę'],
					['Próby logowania na jedno konto', '30 na godzinę'],
					['Prośby o reset hasła', '5 na godzinę'],
					['Przesłania awatara', '20 na godzinę'],
					['Wyszukiwania adresów', '60 na godzinę'],
					['Cała reszta, bez zalogowania', '600 na godzinę'],
					['Cała reszta, po zalogowaniu', '3000 na godzinę']
				]
			},
			after: [
				'Liczone są osobno w każdym procesie serwera, więc przy wielu procesach każdy z nich prowadzi własny licznik i faktyczny limit jest wyższy niż podany. Dla obecnego, jednoprocesowego prototypu to poprawne; zanim te liczby zaczną znaczyć dokładnie to, co mówią, potrzebna jest współdzielona pamięć podręczna.'
			]
		}
	],
	sourceNote:
		'Pełny projekt, razem z otwartymi pytaniami i tym, co wciąż jest przedmiotem sporu, znajduje się w pliku LAUNCHCHECKLIST.md w repozytorium.'
};

/** Polish for `pl`, English for everything else — the same fallback `privacyPolicyFor` uses, and for
 * the same reason: a reader on a locale nobody has written this for is better served by a complete
 * document in a language they may not prefer than by a partial one in the one they do. */
export function levelsDocFor(locale: string): LevelsDoc {
	return locale === 'pl' ? PL : EN;
}
