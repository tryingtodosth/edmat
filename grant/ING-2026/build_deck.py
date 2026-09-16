#!/usr/bin/env python3
"""Builds EdMat-ING-2026.drawio — the pitch deck for the ING "W rytmie pokoleń" application,
one draw.io page per slide, 1920x1080. Standard library only; screenshots come from img/.

    python3 build_deck.py                 -> EdMat-ING-2026.drawio
    node render_deck.mjs                  -> slides/NN.png + EdMat-ING-2026.pdf (needs the draw.io
                                             web build served on 127.0.0.1:8765, see README)

The team slide (last) is a placeholder on purpose — it is filled by Piotr last.
"""
import argparse, base64, datetime, html, pathlib

HERE = pathlib.Path(__file__).resolve().parent
W, H, M = 1920, 1080, 100
INK, BODY, MUTED = "#1B2430", "#2B3440", "#5B6470"
TEAL, TEAL_LIGHT, CARD, LINE = "#1F7A78", "#E6F1F0", "#F3F6F6", "#D5DBE0"
WARM, WARM_LIGHT, GREEN, GREEN_LIGHT, RED_LIGHT = "#B4530A", "#FBF1E6", "#146E3B", "#E5F6EC", "#FCEBE9"
_args = argparse.ArgumentParser(description=__doc__)
_args.add_argument("--font", default="Helvetica", help="font family written into the file (stress-test with 'DejaVu Sans')")
_args.add_argument("--out", default=None, help="output .drawio path (default: EdMat-ING-2026.drawio next to this script)")
ARGS = _args.parse_args()
FONT = ARGS.font
FOOTER = "EdMat.net · Program Grantowy ING „W rytmie pokoleń” · Liga Seed · wrzesień 2026"

_uid = [0]
def uid():
    _uid[0] += 1
    return f"c{_uid[0]}"

class Page:
    def __init__(self, name):
        self.name, self.cells = name, []
    def cell(self, x, y, w, h, style, value=""):
        cid = uid()
        self.cells.append(
            f'<mxCell id="{cid}" value="{html.escape(value, quote=True)}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return cid
    def edge(self, src, dst, color=TEAL):
        cid = uid()
        self.cells.append(
            f'<mxCell id="{cid}" style="edgeStyle=none;rounded=0;html=1;endArrow=block;endFill=1;strokeColor={color};strokeWidth=2.5;" '
            f'edge="1" parent="1" source="{src}" target="{dst}"><mxGeometry relative="1" as="geometry"/></mxCell>')
        return cid
    def xml(self):
        body = "".join(self.cells)
        return (f'<diagram id="{uid()}" name="{html.escape(self.name, quote=True)}">'
                f'<mxGraphModel dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" '
                f'page="1" pageScale="1" pageWidth="{W}" pageHeight="{H}" background="#ffffff" math="0" shadow="0">'
                f'<root><mxCell id="0"/><mxCell id="1" parent="0"/>{body}</root></mxGraphModel></diagram>')

def tstyle(size=26, color=BODY, align="left", valign="top", bold=False):
    return (f"text;html=1;strokeColor=none;fillColor=none;align={align};verticalAlign={valign};whiteSpace=wrap;"
            f"overflow=visible;fontFamily={FONT};fontSize={size};fontColor={color};fontStyle={1 if bold else 0};"
            f"spacing=0;spacingTop=0;spacingLeft=0;spacingRight=0;spacingBottom=0;")

def rstyle(fill=CARD, stroke="none", radius=10, sw=1):
    return (f"rounded=1;arcSize={radius};whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};"
            f"strokeWidth={sw};fontFamily={FONT};")

def lh(s, factor=1.3):
    return f'<div style="line-height:{factor}">{s}</div>'

def ul(items, gap=10):
    return '<ul style="margin:0;padding-left:30px">' + "".join(
        f'<li style="margin:0 0 {gap}px 0">{i}</li>' for i in items) + "</ul>"

def b(s): return f"<b>{s}</b>"
def teal(s): return f'<span style="color:{TEAL}">{s}</span>'
def warm(s): return f'<span style="color:{WARM}">{s}</span>'
def muted(s): return f'<span style="color:{MUTED}">{s}</span>'

def frame(p, n, total):
    p.cell(0, 0, W, H, "rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=none;")
    p.cell(0, 0, 14, H, "rounded=0;whiteSpace=wrap;html=1;fillColor=" + TEAL + ";strokeColor=none;")
    p.cell(M, H - 58, 1300, 30, tstyle(17, MUTED), FOOTER)
    p.cell(W - M - 200, H - 58, 200, 30, tstyle(17, MUTED, align="right"), f"{n} / {total}")

def head(p, kicker, title, size=48):
    p.cell(M, 58, W - 2 * M, 34, tstyle(20, TEAL, bold=True), f'<span style="letter-spacing:2px">{kicker.upper()}</span>')
    p.cell(M, 96, W - 2 * M, 120, tstyle(size, INK, bold=True), lh(title, 1.15))

def text(p, x, y, w, h, value, size=26, color=BODY, bold=False, align="left", valign="top", factor=1.3):
    return p.cell(x, y, w, h, tstyle(size, color, align, valign, bold), lh(value, factor))

def card(p, x, y, w, h, fill=CARD, stroke="none", radius=10):
    return p.cell(x, y, w, h, rstyle(fill, stroke, radius))

def image(p, x, y, w, path, frame_color=LINE):
    data = base64.b64encode((HERE / "img" / path).read_bytes()).decode()
    # keep aspect: read PNG size from the IHDR chunk
    raw = (HERE / "img" / path).read_bytes()
    iw, ih = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    h = round(w * ih / iw)
    p.cell(x - 8, y - 8, w + 16, h + 16, rstyle("#ffffff", frame_color, 6))
    p.cell(x, y, w, h, f"shape=image;imageAspect=0;aspect=fixed;verticalAlign=top;image=data:image/png,{data};")
    return h

def stat(p, x, y, w, h, number, caption, fill=TEAL_LIGHT, color=TEAL):
    card(p, x, y, w, h, fill)
    text(p, x + 24, y + 22, w - 48, 80, number, 54, color, bold=True, factor=1.05)
    text(p, x + 24, y + 96, w - 48, h - 106, caption, 21, BODY, factor=1.25)

def bar(p, x, y, w_full, label, pct, amount, pct_max=35, fill=TEAL):
    text(p, x, y - 6, 620, 84, label, 20, BODY, factor=1.22)
    bw = round(w_full * pct / pct_max)
    p.cell(x + 660, y + 4, w_full, 30, rstyle("#EEF1F3", "none", 6))
    p.cell(x + 660, y + 4, bw, 30, rstyle(fill, "none", 6))
    text(p, x + 660 + w_full + 20, y, 240, 40, f"{b(str(pct) + '%')} &nbsp;{muted(amount)}", 24, BODY, factor=1.15)

# ----------------------------------------------------------------------------- slides
pages = []
SLIDE_KEYS = {}
def slide(name, key=None):
    p = Page(name); pages.append(p)
    if key: SLIDE_KEYS[key] = len(pages)
    return p
def ref(key): return f"@@{key}@@"

# 1 — title
p = slide("1 Tytuł")
p.cell(M, 200, 1000, 40, tstyle(19, TEAL, bold=True), '<span style="letter-spacing:2px">PROGRAM GRANTOWY ING „W RYTMIE POKOLEŃ” · 9. EDYCJA · LIGA SEED</span>')
p.cell(M, 250, 900, 130, tstyle(96, INK, bold=True), "EdMat.net")
text(p, M, 392, 880, 160, "Zadania z rozwiązaniami, które sprawdzają ludzie —<br>od matury do emerytury.", 40, INK, bold=True, factor=1.2)
text(p, M, 570, 860, 130, "Otwarta baza zadań i społeczność uczących się w każdym wieku. "
     f"Działa pod {b('edmat.net')}, kod otwarty (MIT), 745 zadań ze zweryfikowanymi rozwiązaniami.", 27, BODY)
text(p, M, 760, 860, 120, f"{b('Zespół młodych naukowców')}<br>Wydział Fizyki Uniwersytetu Warszawskiego · wrzesień 2026", 24, MUTED)
image(p, 1040, 236, 800, "home.png")
text(p, 1040, 760, 800, 40, muted("Strona główna edmat.net, 16 września 2026 — pasma wiekowe od najmłodszych po seniorów."), 18)

# 2 — problem
p = slide("2 Problem")
head(p, "Problem", "Dobra edukacja ścisła nie ma dziś w Polsce miejsca,<br>w którym jest sprawdzana, otwarta i trwała")
cols = [
    ("Student przed egzaminem", "Zadania i rozwiązania są rozproszone po PDF-ach, stronach kursów i grupach na czacie. "
     "Strona przedmiotu znika po semestrze. Nikt nie odpowiada nazwiskiem za to, czy rozwiązanie jest poprawne."),
    ("Uczeń i rodzic", "Brainly i ChatGPT dają odpowiedź w sekundę — często błędną, bez wyjaśnienia i bez nikogo, kto by ją sprawdził. "
     "Uczeń uczy się sam przed ekranem; rodzic nie ma bezpiecznego miejsca dla dziecka poniżej 16 lat."),
    ("Emerytowany nauczyciel", "Trzydzieści lat rozwiązanych zadań w szufladzie i nikt, kto by o nie zapytał. "
     "Serwisy „dla seniorów” oferują gry na pamięć, nie rolę."),
]
cw = (W - 2 * M - 2 * 28) // 3
for i, (t, body) in enumerate(cols):
    x = M + i * (cw + 28)
    card(p, x, 260, cw, 470)
    text(p, x + 32, 290, cw - 64, 60, t, 30, INK, bold=True)
    text(p, x + 32, 360, cw - 64, 350, body, 25, BODY, factor=1.38)
card(p, M, 770, W - 2 * M, 150, TEAL_LIGHT)
text(p, M + 32, 796, W - 2 * M - 64, 110, f"{b('Wspólny mianownik:')} wiedza o tym, {b('jak')} rozwiązać zadanie, nie jest w Polsce zebrana w jednym miejscu, "
     "nie jest recenzowana i nie przechodzi między pokoleniami. To nie jest problem braku treści — jest problem braku mechanizmu.", 27, INK, factor=1.35)

# 3 — vision, start
p = slide("3 Wizja i start")
head(p, "Wizja — i gdzie zaczynamy", "Chcemy zmienić edukację ścisłą w Polsce.<br>Zaczynamy tu, i wiemy dlaczego.")
card(p, M, 262, 800, 640, TEAL_LIGHT)
text(p, M + 36, 296, 730, 60, "Chcemy", 22, TEAL, bold=True)
text(p, M + 36, 346, 730, 300, "Żeby każde zadanie ze szkoły i studiów miało w jednym otwartym miejscu rozwiązanie, "
     "za które ktoś ręczy nazwiskiem — i żeby ta wiedza przechodziła między pokoleniami: od doktoranta do maturzysty, "
     "od emerytowanej nauczycielki do wnuka.", 30, INK, factor=1.38)
text(p, M + 36, 700, 730, 170, muted("Ten sam mechanizm otwieramy kolejno: maturzyści (2027) → dorośli zmieniający zawód → seniorzy i finanse osobiste."), 24, factor=1.35)
card(p, 940, 262, 880, 640)
text(p, 976, 296, 800, 60, "Zaczynamy od", 22, WARM, bold=True)
text(p, 976, 346, 800, 110, "studentów kierunków ścisłych UW<br>przed egzaminem", 32, INK, bold=True, factor=1.2)
text(p, 976, 470, 800, 420, ul([
    f"{b('Mamy treści:')} 745 zadań z dwóch przedmiotów UW (Analiza Matematyczna II, Rachunek Prawdopodobieństwa I), 742 ze zweryfikowanym rozwiązaniem.",
    f"{b('Mamy ludzi:')} kadrę i doktorantów Wydziału Fizyki, którzy recenzują — opieka naukowa prof. Katarzyny Grabowskiej (KMMF).",
    f"{b('Mamy pierwszy mierzalny test:')} sesja zimowa 2026/27 — cel: 300 aktywnych studentów.",
    f"{b('Najwęższy klin z realnym dostępem')} — a nie „miliard użytkowników”.",
], 14), 25, BODY, factor=1.35)

# 4 — use case 1
p = slide("4 Przypadek 1: Ola")
head(p, "Przypadek użycia 1 — działa dziś", "Ola, II rok fizyki, pięć dni do kolokwium z Analizy II")
steps = [
    "Wchodzi na edmat.net → Matematyka → Analiza matematyczna; filtruje dział „całki” i poziom „trudne”.",
    "Próbuje sama. Treść jest widoczna, rozwiązanie nie — odsłania się stopniowo.",
    "Utknęła: odsłania wskazówkę, potem odpowiedź, na końcu rozwiązanie ze znakiem ✓ zweryfikowane i głosami innych.",
    "Nie rozumie kroku 3 — pyta w dyskusji pod rozwiązaniem. Odpowiada doktorant albo emerytowana nauczycielka.",
    "Dodaje 12 zadań do „Mój zestaw” i drukuje arkusz do PDF.",
    "Po kolokwium dodaje własne, krótsze rozwiązanie — trafia do recenzji, po akceptacji do puli.",
]
y = 250
for i, s in enumerate(steps, 1):
    p.cell(M, y + 2, 46, 46, "ellipse;whiteSpace=wrap;html=1;fillColor=" + TEAL + ";strokeColor=none;fontFamily=" + FONT + ";fontSize=22;fontStyle=1;fontColor=#ffffff;", str(i))
    text(p, M + 66, y, 690, 100, s, 24, BODY, factor=1.33)
    y += 108
image(p, 900, 250, 920, "exercise-revealed.png")
card(p, 900, 850, 920, 96, GREEN_LIGHT)
text(p, 924, 866, 876, 76, f'<span style="color:{GREEN}">{b("Wszystko na tym slajdzie działa dziś na edmat.net")} — zrzut z 16 września 2026: wskazówka i odpowiedź odsłonięte, matematyka renderowana (KaTeX).</span>', 19, factor=1.3)

# 5 — seniors in three roles (the review's first red flag: retired maths teachers are a sliver of seniors)
p = slide("5 Seniorzy w trzech rolach")
head(p, "Przypadek użycia 2 — dla tej edycji najważniejszy", "Seniorzy w trzech rolach — nie tylko „pani Halina”")
card(p, M, 250, W - 2 * M, 92, WARM_LIGHT)
text(p, M + 32, 266, W - 2 * M - 64, 70, f"{b('Seniorzy nie chcą „korzystać z innowacji”. Chcą roli i powodu.')} Dajemy im obie rzeczy — i przeglądarkę, nic więcej. "
     "Trzy role, bo emerytowani matematycy to promil seniorów, a doświadczenie życiowe mają wszyscy.", 24, INK, factor=1.3)
roles = [
    ("Recenzent zadań", "emerytowani nauczyciele i wykładowcy przedmiotów ścisłych — nieliczni, ale wiemy, gdzie są",
     ["pani Halina, 68 lat, emerytowana nauczycielka matematyki: recenzuje rozwiązania z matury i I roku — jej nazwisko stoi za każdym",
      "odpowiada uczniom w dyskusjach; po miesiącu opiekunka działu „matura”",
      "sama rozwiązuje trudne zadania — sprawność umysłu w rygorze, nie w „grach na pamięć”"]),
    ("Czytelnik-tester", "każdy senior: słuchacze UTW, bywalcy bibliotek — bez wiedzy wyższej",
     ["czy wskazówka jest zrozumiała? czy tłumaczenie brzmi po polsku? czy zadanie z podstawówki ma sens?",
      "recenzuje treści dla najmłodszych i pasma „szkoła podstawowa”",
      "uczy się sam: kurs „matura od nowa”, zadania w swoim tempie, duża czcionka"]),
    ("Współautor finansów osobistych", "każdy senior z doświadczeniem życiowym — czyli każdy",
     ["współtworzy i recenzuje moduł finansów: budżet domowy, bezpieczne oszczędzanie, oszustwa „na wnuczka” i na BLIK",
      "uczy się od młodych ekonomistów o emeryturze, IKE/IKZE, inflacji — wymiana w obie strony",
      "dzieli się historią, której nie ma w żadnym podręczniku"]),
]
cw = (W - 2 * M - 2 * 24) // 3
for i, (t, who, items) in enumerate(roles):
    x = M + i * (cw + 24)
    card(p, x, 368, cw, 470)
    text(p, x + 28, 392, cw - 56, 44, t, 26, TEAL, bold=True)
    text(p, x + 28, 438, cw - 56, 80, muted(who), 19, factor=1.3)
    text(p, x + 28, 522, cw - 56, 310, ul(items, 8), 20, BODY, factor=1.3)
text(p, M, 858, W - 2 * M, 120, f"{b('Lejek, uczciwie:')} 125,9 tys. słuchaczy UTW to nie recenzenci analizy. Recenzentów szukamy tam, gdzie są: emerytowana kadra Wydziału Fizyki i MIM UW, "
     "sekcje emerytów ZNP w 3 miastach, licea partnerskie. Cel pilotażu: 30 seniorów, w tym co najmniej 10 recenzentów zadań; jeśli po 3 miesiącach jest ich mniej, "
     "role 2 i 3 niosą pilotaż dalej. 20% grantu, w tym animator społeczności seniorów (½ etatu).", 20, MUTED, factor=1.3)

# 6 — what exists, and the focus declaration (the review's third red flag: feature creep)
p = slide("6 Co już działa")
head(p, "Stan dziś", "To nie pomysł — produkt. Działa pod edmat.net od lipca 2026")
tiles = [
    ("745", "zadań z pełnymi rozwiązaniami — Analiza Matematyczna II i Rachunek Prawdopodobieństwa I (UW)"),
    ("742", "ze zweryfikowanym rozwiązaniem; każde zadanie ma pulę rozwiązań i wskazówek, głosy i dyskusję"),
    ("2", "języki interfejsu (PL / EN), 2 094 komunikaty w każdym; wersje językowe treści recenzowane osobno"),
    ("1 441", "testów automatycznych backendu — wszystkie zielone (uruchomione 16.09.2026)"),
    ("1 314", "sprawdzeń w prawdziwej przeglądarce, 46 scenariuszy od rejestracji po moderację"),
    ("22", "strony audytu dostępności (axe): 0 naruszeń; trzy rozmiary tekstu, wysoki kontrast"),
    ("18", "modułów zbudowanych: zadania, materiały, kursy, wydarzenia, korepetycje z mapą, wiadomości, moderacja, konta opiekuna"),
    ("MIT", "kod otwarty; szkoła lub uczelnia może uruchomić własną kopię; zero reklam, zero śledzenia"),
]
tw = (W - 2 * M - 3 * 24) // 4
for i, (n, c) in enumerate(tiles):
    x = M + (i % 4) * (tw + 24); y = 250 + (i // 4) * 240
    stat(p, x, y, tw, 224, n, c)
text(p, M, 740, W - 2 * M, 60, "Liga Seed, uczciwie: mamy działający produkt i pierwszych użytkowników, nie mamy jeszcze przychodów ani skali. "
     "Zbudowane w osiem tygodni przez zespół studencki, z testem regresji dla każdego znalezionego błędu.", 22, MUTED, factor=1.3)
card(p, M, 814, W - 2 * M, 140, GREEN_LIGHT)
text(p, M + 32, 834, W - 2 * M - 64, 110, f'<span style="color:{GREEN}">{b("Żelazne skupienie:")} fundamenty pod 18 modułów są zbudowane, ale w grancie 100% energii idzie w trzy rzeczy — '
     f'{b("bazę recenzowanych zadań")}, {b("pilotaż międzypokoleniowy z seniorami")} i {b("moduł edukacji finansowej")}. '
     "Korepetycje z mapą, wiadomości i wydarzenia zostają zamrożone do czasu walidacji rdzenia.</span>", 24, factor=1.35)

# 7 — mechanism
p = slide("7 Mechanika jakości")
head(p, "Co jest nowe", "Skąd bierze się jakość: mechanizm, nie obietnica")
boxes = [
    ("Zgłoszenie", "każdy zalogowany: nowe zadanie, rozwiązanie, wskazówka, tłumaczenie"),
    ("Recenzja", "zweryfikowani współtwórcy i opiekunowie działów; odmowa zawsze z uzasadnieniem"),
    ("Pula rozwiązań", "wiele rozwiązań na zadanie; historia edycji; propozycje poprawek decyduje autor"),
    ("Głosy", "ważone reputacją — głos zweryfikowanego liczy się podwójnie"),
    ("✓ Zweryfikowane", "znak wyliczany z faktów: istnieje rozwiązanie, które przeszło recenzję"),
]
bw, gap = 300, 55
ids = []
for i, (t, d) in enumerate(boxes):
    x = M + i * (bw + gap)
    ids.append(card(p, x, 262, bw, 250, TEAL_LIGHT if i < 4 else GREEN_LIGHT))
    text(p, x + 20, 282, bw - 40, 50, t, 26, TEAL if i < 4 else GREEN, bold=True)
    text(p, x + 20, 336, bw - 40, 170, d, 21, BODY, factor=1.33)
for a, b_ in zip(ids, ids[1:]):
    p.edge(a, b_)
notes = [
    ("Zgłoś i auto-ukrycie", "treść zgłoszona przez 20% czytających (min. 3 osoby) znika do decyzji moderatora; moderator może przywrócić"),
    ("Reputacja ma zakres", "opiekun działu „całki” nie moderuje „genetyki”; uprawnienia rosną z zasługami, nigdy z samego stażu"),
    ("Zaufany publikuje od razu", "nowe zadanie od zweryfikowanego współtwórcy nie czeka w kolejce; zmiana cudzej pracy czeka zawsze"),
]
nw = (W - 2 * M - 2 * 28) // 3
for i, (t, d) in enumerate(notes):
    x = M + i * (nw + 28)
    card(p, x, 560, nw, 200)
    text(p, x + 28, 582, nw - 56, 44, t, 24, INK, bold=True)
    text(p, x + 28, 628, nw - 56, 130, d, 21, BODY, factor=1.33)
card(p, M, 796, W - 2 * M, 120, WARM_LIGHT)
text(p, M + 32, 816, W - 2 * M - 64, 90, f"{b('Dlaczego to nowe:')} Stack Overflow zbudował taki mechanizm dla programistów. Nikt nie zbudował go dla zadań z matury i studiów, po polsku, "
     "z mapowaniem na program i z rolą dla nauczyciela, który już nie pracuje.", 25, INK, factor=1.35)

# --- architecture 1/2: the stack, as it runs today
p = slide("Architektura", key="arch")
head(p, "Architektura 1/2", "Jak to jest zbudowane")
stack = [
    ("Przeglądarka", TEAL_LIGHT, TEAL, [
        "SvelteKit + Svelte 5: aplikacja jednostronicowa, statyczny build — działa na zwykłym serwerze WWW",
        "interfejs PL / EN (Paraglide), 2 094 komunikaty w każdym języku",
        "matematyka: KaTeX; treść: Markdown + HTML czyszczone przez DOMPurify",
        "edytor Tiptap z paletą wzorów; mapa Leaflet + OpenStreetMap; podgląd PDF w przeglądarce",
        "dostępność: rozmiar tekstu, wysoki kontrast, cele 44 px, audyt axe"]),
    ("API", CARD, INK, [
        "Django 5 + Django REST Framework — 18 modułów w jednej bazie kodu",
        "zadania i pula rozwiązań · materiały i pliki · taksonomia · społeczność: dyskusje, oceny, głosy",
        "moderacja: opiekunowie działów, auto-ukrycie, historia edycji · powiadomienia na żywo (SSE)",
        "konta, opiekunowie, tożsamość · kursy · wydarzenia · rezerwacje · korepetycje · wiadomości",
        "aktywność · zgłoszenia błędów · telemetria · zestawy do druku"]),
    ("Dane i usługi", WARM_LIGHT, WARM, [
        "SQLite w pilotażu → PostgreSQL w produkcji; pliki poza bazą",
        "pliki od użytkowników: typ sprawdzany po bajtach, skan ClamAV (gdy jest), obrazy zawsze re-enkodowane",
        "Redis (opcjonalnie): cache odpowiedzi, limity zapytań, pub/sub dla powiadomień",
        "Nominatim / OpenStreetMap przez własne proxy z limitem jednego zapytania na sekundę",
        "e-mail: jeszcze nie — jedyna brakująca usługa"]),
]
bw, gap = 540, 50
ids = []
for i, (t, fill, col, items) in enumerate(stack):
    x = M + i * (bw + gap)
    ids.append(card(p, x, 250, bw, 420, fill))
    text(p, x + 26, 272, bw - 52, 44, t, 26, col, bold=True)
    text(p, x + 26, 322, bw - 52, 340, ul(items, 7), 18, BODY, factor=1.3)
p.edge(ids[0], ids[1]); p.edge(ids[1], ids[2])
cw = (W - 2 * M - 28) // 2
card(p, M, 700, cw, 250)
text(p, M + 28, 722, cw - 56, 40, "Zasady przekrojowe", 22, TEAL, bold=True)
text(p, M + 28, 764, cw - 56, 180, "sanityzacja treści po obu stronach (bleach + DOMPurify) · limity zapytań na logowanie, rejestrację, uploady · wyłącznik każdej funkcji · "
     "konta dzieci przez opiekuna i minimalizacja danych (RODO art. 8) · brak reklam i śledzenia · dwie osie języka: interfejs osobno, wersje treści osobno · każda zmiana ma autora i historię", 19, BODY, factor=1.35)
x2 = M + cw + 28
card(p, x2, 700, cw, 250)
text(p, x2 + 28, 722, cw - 56, 40, "Jakość i wdrożenie", 22, TEAL, bold=True)
text(p, x2 + 28, 764, cw - 56, 180, "1 441 testów backendu · 46 scenariuszy w prawdziwej przeglądarce (1 314 sprawdzeń, Playwright) · audyt dostępności axe, 22 strony · "
     "wdrożenie: Apache + mod_wsgi na jednym serwerze, pakiet aktualizacji z runbookiem i testem dymnym · kod MIT — szkoła lub uczelnia uruchamia własną kopię", 19, BODY, factor=1.35)

# --- architecture 2/2: solved, hardening, in the grant, designed-not-built
p = slide("Wyzwania techniczne", key="arch2")
head(p, "Architektura 2/2", "Wyzwania techniczne: rozwiązane, do zrobienia, zaprojektowane")
cols = [
    ("Rozwiązane i sprawdzone", GREEN_LIGHT, GREEN, [
        "matematyka w treści: LaTeX przeżywa Markdown i sanityzację — sprawdzone mechanicznie na 2 241 polach, 0 błędów",
        "równoczesna moderacja na SQLite: wyścigi rozwiązane atomowymi aktualizacjami, nie blokadami",
        "powiadomienia na żywo bez zajmowania serwera: SSE + Redis pub/sub, limit dwóch połączeń na konto",
        "pliki od obcych: typ po bajtach, skan, obrazy nigdy nie są bajtami z uploadu; EXIF usuwany",
        "pierwsze malowanie strony bez czekania na aplikację: prerendering i szkielet ładowania"]),
    ("Do zrobienia przed skalą", WARM_LIGHT, WARM, [
        "PostgreSQL zamiast SQLite; Redis w produkcji, żeby limity liczyły się wspólnie",
        "prawdziwy e-mail: reset hasła, powiadomienia, potwierdzenie adresu uczelnianego",
        "CI: testy przy każdej zmianie; kopie zapasowe i monitoring",
        "blokada po nieudanych logowaniach; bilet do strumienia powiadomień zamiast tokenu w adresie",
        "ClamAV w produkcji — dziś skan jest uczciwie oznaczony jako „nie wykonano”"]),
    ("W grancie", TEAL_LIGHT, TEAL, [
        "podpowiedzi AI wybierane z rozwiązań zweryfikowanych przez ludzi",
        "ścieżka „wklej z czatu” z oznaczeniem „z pomocą AI, czeka na recenzję”",
        "generator sprawdzianów dla nauczycieli (freemium)",
        "prosta kolejka recenzji dla seniorów: jeden ekran, duża czcionka",
        "strefy czasowe w rezerwacjach; tłumaczenia maszynowe jako szkice do recenzji — faza 2"]),
    ("Zaprojektowane, jeszcze nie zbudowane", CARD, INK, [
        "system reputacji: dwie drabiny — co wolno robić i co wolno robić z cudzą pracą (opis publiczny na /levels)",
        "logowanie uczelniane: USOS (OAuth 1.0a, dane dostępowe od każdej uczelni osobno), Google, Apple, GitHub — dziś uczciwe atrapy",
        "wyszukiwarka ludzi i treści w kursach; edycja zaproszeń",
        "płatności — świadomie nie: ceny są informacyjne"]),
]
cw4 = (W - 2 * M - 3 * 24) // 4
for i, (t, fill, col, items) in enumerate(cols):
    x = M + i * (cw4 + 24)
    card(p, x, 250, cw4, 660, fill)
    text(p, x + 24, 272, cw4 - 48, 70, t, 22, col, bold=True, factor=1.15)
    text(p, x + 24, 344, cw4 - 48, 560, ul(items, 9), 18, BODY, factor=1.3)
text(p, M, 926, W - 2 * M, 60, "Każdy punkt z kolumn 2–4 ma miejsce w budżecie (slajd " + ref("budget") + ") albo jest świadomie odłożony. Nie obiecujemy rzeczy, których nie ma w planie.", 20, MUTED, factor=1.3)

# 8 — generations
p = slide("8 W rytmie pokoleń")
head(p, "W rytmie pokoleń", "Jedna baza, jeden mechanizm, cztery wejścia")
gens = [
    ("Uczeń 12–19", ["pasmo „szkoła średnia”", "konto zakłada opiekun (poniżej 16 lat); widzi i może usunąć wszystko, co dziecko napisało",
                     "komentarze i obrazki dzieci zawsze czekają na moderatora"],
     ["500 zadań maturalnych z rozwiązaniami (lato 2027)", "pierwsza szkoła partnerska; generator sprawdzianów dla nauczyciela"]),
    ("Student", ["745 zadań UW, dyskusje, „Mój zestaw”", "kursy prowadzone przez użytkowników, wydarzenia z programem",
                 "korepetycje z mapą — zbudowane, zamrożone na czas grantu"],
     ["300 aktywnych w sesji zimowej", "3 uczelnie do końca 2027"]),
    ("Dorosły", ["pasmo „dorośli”; kursy prowadzone przez użytkowników", "dział „Finanse osobiste” — już istnieje",
                 "przebranżowienie: matematyka dla programistów, statystyka"],
     ["moduł finansów: pierwsza praca, kredyt, podatki"]),
    ("Senior", ["pasmo „seniorzy”; „Aa” i wysoki kontrast", "trzy role: recenzent, czytelnik-tester, współautor finansów",
                "zero reklam, nic do instalowania"],
     ["pilotaż w 3 miastach: 30 seniorów, animator społeczności", "moduł finansów 60+: emerytura, oszczędzanie, oszustwa"]),
]
gw = (W - 2 * M - 3 * 24) // 4
for i, (t, now, later) in enumerate(gens):
    x = M + i * (gw + 24)
    card(p, x, 250, gw, 640)
    text(p, x + 26, 272, gw - 52, 50, t, 28, INK, bold=True)
    text(p, x + 26, 326, gw - 52, 30, teal(b("DZIŚ")), 18)
    text(p, x + 26, 356, gw - 52, 300, ul(now, 8), 20, BODY, factor=1.3)
    text(p, x + 26, 640, gw - 52, 30, warm(b("Z GRANTEM")), 18)
    text(p, x + 26, 670, gw - 52, 210, ul(later, 8), 20, BODY, factor=1.3)
text(p, M, 912, W - 2 * M, 60, "Pasmo wiekowe to pole na każdej treści i filtr na każdej liście: dziesięciolatek i emerytka nie widzą tego samego ekranu — "
     "ale wnuk i babcia pracują na tym samym zadaniu.", 22, MUTED, factor=1.3)

# 9 — finance + AI
p = slide("9 Finanse i AI")
head(p, "Dwa obszary edycji — konkretnie, nie jako hasło", "Edukacja finansowa i sztuczna inteligencja")
cw = (W - 2 * M - 28) // 2
card(p, M, 250, cw, 680, WARM_LIGHT)
text(p, M + 32, 278, cw - 64, 50, "Finanse osobiste w rytmie pokoleń", 28, WARM, bold=True)
text(p, M + 32, 340, cw - 64, 580, ul([
    "Dział „Finanse osobiste” już istnieje na edmat.net.",
    f"Kurs autorski młodych ekonomistów (Natalia Prus): budżet, procent składany, kredyt, IKE/IKZE, inflacja, podatki — jako {b('zadania z rozwiązaniami')} sprawdzanymi tak samo jak zadania z analizy.",
    "Seniorzy współtworzą i recenzują: budżet domowy, bezpieczne oszczędzanie, oszustwa „na wnuczka” i na BLIK — doświadczenie, którego nie ma w podręczniku.",
    "Materiały polecane, np. blog Marcina Iwucia — prosty język, bez sprzedaży produktów.",
    "Moduł dla maturzystów (pierwsze własne pieniądze) i dla seniorów (emerytura, oszczędzanie, cyberoszustwa) — prowadzony przez ludzi, którym ufają.",
], 12), 22, BODY, factor=1.33)
x2 = M + cw + 28
card(p, x2, 250, cw, 680, TEAL_LIGHT)
text(p, x2 + 32, 278, cw - 64, 50, "AI ugruntowane w tym, co sprawdzili ludzie", 28, TEAL, bold=True)
text(p, x2 + 32, 340, cw - 64, 580, ul([
    f"{b('Nie budujemy własnego modelu.')} Budujemy warstwę, której modelom brakuje: weryfikację.",
    "Podpowiedzi sokratejskie: AI wybiera wskazówkę z rozwiązań zweryfikowanych przez ludzi — nigdy nie generuje rozwiązania „z głowy”. To jedyna praca nad AI w grancie.",
    "Generator sprawdzianów dla nauczyciela: unikalne zestawy z bazy, z rozwiązaniami sprawdzonymi przez ludzi — funkcja, za którą szkoła lub rada rodziców zapłaci symboliczny abonament.",
    "Wstępne sortowanie kolejki moderacji: duplikaty, brakujące kroki, podejrzane obrazki.",
    "Szkice tłumaczeń PL / EN / UK z zachowaniem LaTeX: model danych gotowy — faza 2, po walidacji rdzenia.",
    "Sami budujemy z agentami AI — wiemy, co potrafią i gdzie kłamią.",
], 12), 22, BODY, factor=1.33)

# 10 — competition, and the moat question the review predicts
p = slide("10 Konkurencja")
head(p, "Konkurencja", "Znamy ją, bo z niej korzystaliśmy przed każdym egzaminem")
rows = [
    ("Brainly, Zadane.pl", "odpowiedź do pracy domowej w sekundę", "weryfikacji; jest za to reklama; poziom szkolny"),
    ("ChatGPT i podobne", "dostępność od ręki, każdy temat", "pewności — w zadaniach ścisłych regularnie błędne, bez znajomości programu; podaje wynik zamiast prowadzić"),
    ("Khan Academy", "świetne wideo na poziomie szkolnym", "polskich zadań uczelnianych, społeczności, języka polskiego"),
    ("Kampus (Moodle), LMS", "materiały prowadzącego dla jego kursu", "otwartości — zamknięte per kurs, znikają po semestrze; bez puli rozwiązań"),
    ("Librus, Vulcan", "dziennik i komunikacja ze szkołą", "treści do nauki — to nie jest ich zadanie"),
    ("Math StackExchange", "wysoka jakość odpowiedzi", "języka polskiego, mapowania na program, formy do nauki przed egzaminem"),
    ("e-korepetycje.net, Preply", "rynek korepetytorów", "treści — korepetycje bez zadań, które można razem przerobić"),
]
c1, c2, c3 = 330, 600, 790
y = 244
p.cell(M, y, c1, 40, tstyle(18, MUTED, bold=True), "KTO")
p.cell(M + c1, y, c2, 40, tstyle(18, MUTED, bold=True), "CO DAJE")
p.cell(M + c1 + c2, y, c3, 40, tstyle(18, MUTED, bold=True), "CZEGO NIE DAJE")
y += 42
for i, (a, b_, c) in enumerate(rows):
    if i % 2 == 0:
        p.cell(M - 12, y - 6, c1 + c2 + c3 + 24, 66, rstyle(CARD, "none", 4))
    text(p, M, y, c1 - 16, 60, b(a), 20, INK, factor=1.25)
    text(p, M + c1, y, c2 - 16, 60, b_, 20, BODY, factor=1.25)
    text(p, M + c1 + c2, y, c3 - 16, 60, c, 20, BODY, factor=1.25)
    y += 70
card(p, M, 770, W - 2 * M, 176, GREEN_LIGHT)
text(p, M + 32, 786, W - 2 * M - 64, 150,
     f'<span style="color:{GREEN}">{b("Tylko EdMat — i to już działa:")}</span> ✓ zweryfikowane rozwiązania jako mechanizm &nbsp; ✓ treść zmapowana na program &nbsp; '
     "✓ wersje językowe treści recenzowane osobno &nbsp; ✓ wszystkie pokolenia z bezpiecznymi ustawieniami domyślnymi &nbsp; ✓ kod otwarty, bez reklam<br>"
     f"{b('Fosa to nie kod (MIT).')} To zweryfikowana baza zmapowana na polski program, reputacja recenzentów i społeczność, która ją tworzy. "
     "Brainly czy OpenAI mogą dodać przycisk „zweryfikowane” w rok; nie mają ludzi, którzy ręczą za rozwiązanie nazwiskiem — a tych się nie kupuje, tych się buduje.", 21, BODY, factor=1.38)

# 11 — audience size
p = slide("11 Odbiorcy")
head(p, "Odbiorcy i skala", "Dla kogo — i jak wielu")
stats = [
    ("1,32 mln", "studentów w Polsce (GUS, rok akademicki 2025/26) — pierwszy krąg: kierunki ścisłe UW"),
    ("321 tys.", "zdających maturę w 2026 r. (CKE) — i tyle samo rodziców, którzy szukają czegoś lepszego niż Brainly"),
    ("10 mln", "osób w wieku 60+, 26,6% ludności (GUS 2024) — w tym emerytowani nauczyciele i wykładowcy"),
    ("125,9 tys.", "słuchaczy 747 uniwersytetów trzeciego wieku (GUS 2024/25) — nasze wejście do seniorów"),
]
sw = (W - 2 * M - 3 * 24) // 4
for i, (n, c) in enumerate(stats):
    stat(p, M + i * (sw + 24), 250, sw, 260, n, c)
rings = [
    ("Pierwszy krąg — 2026/27", "Wydział Fizyki UW i kierunki matematyczne: kilka tysięcy studentów, do których docieramy przez prowadzących zajęcia, nie przez reklamę."),
    ("Drugi krąg — 2027", "Licea w Warszawie (matura rozszerzona z matematyki i fizyki), uniwersytety trzeciego wieku w trzech miastach, studenci z Ukrainy przez wersje językowe treści."),
    ("Trzeci krąg — 2028", "Każda szkoła, w której nauczyciel generuje sprawdziany z bazy, i każda uczelnia, która uruchomi własną, bezpłatną kopię — to zasięg. Skąd pieniądze na utrzymanie: slajd " + ref("ask") + "."),
]
rw = (W - 2 * M - 2 * 28) // 3
for i, (t, d) in enumerate(rings):
    x = M + i * (rw + 28)
    card(p, x, 550, rw, 250)
    text(p, x + 28, 574, rw - 56, 44, t, 24, TEAL, bold=True)
    text(p, x + 28, 622, rw - 56, 170, d, 22, BODY, factor=1.35)
text(p, M, 830, W - 2 * M, 90, "Wiemy, kogo nie obsługujemy w 2027: dzieci poniżej 12 lat inaczej niż przez konto opiekuna i treści dobrane przez dorosłego. "
     "Pasmo „najmłodsi” istnieje w modelu, ale nie obiecujemy dla niego produktu w tym grancie.", 22, MUTED, factor=1.3)

# 12 — milestones
p = slide("Kamienie milowe", key="milestones")
head(p, "Kamienie milowe", "Krótkie horyzonty, sprawdzalne liczby")
ms = [
    ("Koniec 2026", ["300 aktywnych studentów UW w sesji zimowej; 30 z nich dodało rozwiązanie (także z pomocą AI)", "pierwsze 30 wywiadów i testów z użytkownikami", "kurs „Finanse osobiste” v1",
                     "zespół recenzentów: 6 doktorantów i asystentów, pierwsi emerytowani wykładowcy"]),
    ("Lato 2027", ["500 zadań maturalnych ze zweryfikowanymi rozwiązaniami", "pilotaż seniorów w pierwszym mieście: 10 osób w trzech rolach",
                   "podpowiedzi AI ugruntowane w puli — wersja testowa", "generator sprawdzianów w 2 liceach — wersja testowa"]),
    ("Koniec 2027", ["5 000 zarejestrowanych, 3 000 zadań, 3 uczelnie", "30 seniorów w 3 miastach; utrzymanie po 3 miesiącach co najmniej 60%",
                     "fundacja zarejestrowana; pierwszy wniosek o grant instytucjonalny (FERS) złożony", "10 szkół z generatorem sprawdzianów; pierwszy partner CSR ścieżki finansowej"]),
]
mw = (W - 2 * M - 2 * 40) // 3
p.cell(M + 30, 300, W - 2 * M - 60, 4, "rounded=0;whiteSpace=wrap;html=1;fillColor=" + LINE + ";strokeColor=none;")
for i, (t, items) in enumerate(ms):
    x = M + i * (mw + 40)
    p.cell(x + 30 - 14, 290, 28, 28, "ellipse;whiteSpace=wrap;html=1;fillColor=" + TEAL + ";strokeColor=#ffffff;strokeWidth=3;")
    text(p, x + 60, 274, mw - 60, 60, t, 30, INK, bold=True)
    card(p, x, 350, mw, 410)
    text(p, x + 28, 376, mw - 56, 370, ul(items, 12), 22, BODY, factor=1.33)
card(p, M, 790, W - 2 * M, 140, TEAL_LIGHT)
text(p, M + 32, 808, W - 2 * M - 64, 110, f"{b('Jak mierzymy:')} aktywni użytkownicy w sesji egzaminacyjnej · liczba zrecenzowanych rozwiązań i czas do recenzji · odsetek zadań ze znakiem ✓ · "
     "utrzymanie seniorów po 3 miesiącach · szkoły z generatorem sprawdzianów. Wyniki publikujemy co kwartał, publicznie.", 23, INK, factor=1.35)

# 12b — risks, named by us (the two the founders name first: reaching a busy student, and getting the AI work out of the notebook)
p = slide("Ryzyka", key="risks")
head(p, "Ryzyka, uczciwie", "Co może pójść nie tak — i co z tym robimy")
risks = [
    ("Dotarcie do zajętego studenta",
     "Student przed sesją nie szuka nowego portalu — ma PDF-y, grupę na czacie i ChatGPT.",
     "Wchodzimy przez prowadzących zajęcia (zestaw na kolokwium jest linkiem do EdMat), w sesji, kiedy potrzeba jest największa, i przez prof. Dragana. Do czytania nie trzeba konta ani instalacji; „Mój zestaw” daje arkusz do wydruku od razu.",
     "300 aktywnych w sesji zimowej; odsetek, który wraca w sesji letniej."),
    ("Przekonanie studenta, żeby oddał to, co robi z AI",
     "Rozwiązanie z ChatGPT ląduje w zeszycie i ginie — razem z błędem, którego nikt nie wyłapał.",
     "Ścieżka „wklej rozwiązanie z czatu”: prompt i odpowiedź trafiają do puli z oznaczeniem „z pomocą AI, czeka na recenzję”. Recenzent sprawdza, student dostaje reputację i znak przy nazwisku, prowadzący może przyznać punkty za zweryfikowany wkład. Student dostaje weryfikację, której AI mu nie daje — a my zamieniamy konkurenta w źródło treści.",
     "10% aktywnych z co najmniej jednym dodanym rozwiązaniem (30 osób w sesji zimowej); czas do recenzji poniżej 7 dni."),
    ("Recenzentów-seniorów za mało lub za wolno",
     "Emerytowani matematycy to promil seniorów; recenzja może stanąć w kolejce.",
     "Trzy role zamiast jednej, rekrutacja poza UTW (emerytowana kadra UW, sekcje emerytów ZNP), animator społeczności na pół etatu; doktoranci jako rezerwa recenzji; status „czeka na recenzję” widoczny, nie ukryty.",
     "co najmniej 10 recenzentów zadań po 3 miesiącach; utrzymanie 60%; kolejka recenzji poniżej 7 dni."),
    ("Jakość przy wzroście: śmieci i błędne rozwiązania",
     "Więcej zgłoszeń to więcej błędów i spamu — w matematyce błąd w rozwiązaniu jest gorszy niż jego brak.",
     "Auto-ukrycie po zgłoszeniach 20% czytających (min. 3), reputacja z zakresem działu, historia edycji, treści dzieci zawsze czekają na moderatora, AI sortuje kolejkę. Znak ✓ wyliczany z faktów, nie przyznawany ręcznie.",
     "odsetek zadań ze znakiem ✓; zgłoszenia na 1 000 wyświetleń; czas od zgłoszenia do decyzji."),
]
rw = (W - 2 * M - 24) // 2
for i, (t, what, how, metric) in enumerate(risks):
    x = M + (i % 2) * (rw + 24); y = 250 + (i // 2) * 330
    card(p, x, y, rw, 306)
    text(p, x + 28, y + 22, rw - 56, 44, t, 23, INK, bold=True, factor=1.15)
    text(p, x + 28, y + 68, rw - 56, 230, f"{warm(b('Ryzyko.'))} {what}<br>{teal(b('Co robimy.'))} {how}<br>{muted(b('Miernik.') + ' ' + metric)}", 18, BODY, factor=1.32)
text(p, M, 916, W - 2 * M, 70, f"{b('Największe ryzyko nazwaliśmy sami:')} jeśli w sesji zimowej nie będzie 300 aktywnych i 30 osób, które dodały rozwiązanie, wiemy to w lutym 2027 — i piszemy o tym w pierwszym raporcie kwartalnym, publicznie.", 21, MUTED, factor=1.3)

# 13 — budget
p = slide("Budżet", key="budget")
head(p, "Na co przeznaczymy grant", "450 tys. zł na 15 miesięcy (grudzień 2026 – luty 2028)")
lines = [
    ("Treści i ich weryfikacja — 1 500 nowych zadań (matura, I rok), recenzenci, kurs finansów", 35, "157 tys. zł"),
    ("Rozwój produktu — podpowiedzi AI ugruntowane w puli, generator sprawdzianów dla nauczycieli, prosta kolejka recenzji dla seniorów", 25, "112 tys. zł"),
    ("Pilotaż międzypokoleniowy — 3 miasta, 30 seniorów w 3 rolach, animator społeczności (½ etatu), rekrutacja przez ZNP, UTW i emerytowaną kadrę UW", 20, "90 tys. zł"),
    ("Infrastruktura, bezpieczeństwo, prawo — serwery, audyt, fundacja, RODO dla kont dzieci, wnioski grantowe", 10, "45 tys. zł"),
    ("Badania z użytkownikami — 60 wywiadów i testów, dwie rundy przed każdym wdrożeniem", 5, "23 tys. zł"),
    ("Promocja i społeczność — kampania z prof. Andrzejem Draganem, wydarzenia na UW i w szkołach", 5, "23 tys. zł"),
]
y = 256
for label, pct, amount in lines:
    bar(p, M, y, 560, label, pct, amount, fill=WARM if "międzypokoleniowy" in label else TEAL)
    y += 92
card(p, M, 820, W - 2 * M, 120, CARD)
text(p, M + 32, 838, W - 2 * M - 64, 90, f"Przy nagrodzie 300 lub 200 tys. zł skalujemy proporcjonalnie — {b('20% na pilotaż z seniorami zostaje')}. "
     "Treści, kursy otwarte i cała baza pozostają bezpłatne; grant nie kupuje reklam i nie buduje modułów spoza trzech priorytetów.", 23, BODY, factor=1.35)

# 14 — ask, and the post-grant model (the review's second red flag: no school hosting, no tutoring commissions)
p = slide("Czego potrzebujemy", key="ask")
head(p, "ING i EdMat", "Czego potrzebujemy — i co z tego ma ING")
cw = (W - 2 * M - 28) // 2
card(p, M, 250, cw, 500)
text(p, M + 32, 276, cw - 64, 50, "Potrzebujemy", 28, TEAL, bold=True)
text(p, M + 32, 334, cw - 64, 410, ul([
    f"{b('Wsparcia finansowego')} — grant wg budżetu ze slajdu " + ref("budget") + ".",
    f"{b('Wsparcia merytorycznego')} — warsztaty i mentoring: model organizacji (fundacja z działalnością gospodarczą), wycena abonamentu generatora sprawdzianów, umowy o treści.",
    f"{b('Kontaktów')} — szkoły i uczelnie, sekcje emerytów ZNP i UTW, firmy z portfolio ING, które szkolą pracowników z matematyki i statystyki.",
    f"{b('Promocji')} — finał, kanały ING; po naszej stronie: prof. Andrzej Dragan, Wydział Fizyki UW.",
], 12), 22, BODY, factor=1.33)
x2 = M + cw + 28
card(p, x2, 250, cw, 500, TEAL_LIGHT)
text(p, x2 + 32, 276, cw - 64, 50, "Co z tego ma ING", 28, TEAL, bold=True)
text(p, x2 + 32, 334, cw - 64, 410, ul([
    f"{b('Edukację finansową, która nie jest reklamą')} — zadania i kurs sprawdzane jak matematyka, przez młodych ekonomistów i seniorów-recenzentów.",
    f"{b('Zasięg międzypokoleniowy')} w jednym produkcie: uczeń, rodzic (także pracownik ING), dziadek.",
    f"{b('Mierzalne, publiczne rezultaty')} — liczby ze slajdu " + ref("milestones") + " publikujemy co kwartał.",
    f"{b('Rolę partnera strategicznego ścieżki finansowej')} — mecenat, nie reklama: z nazwiskiem recenzenta, nie z logo produktu.",
], 12), 22, BODY, factor=1.33)
card(p, M, 776, W - 2 * M, 176, WARM_LIGHT)
text(p, M + 32, 792, W - 2 * M - 64, 150, f"{b('Utrzymanie po grancie, realistycznie:')} treści zawsze bezpłatne. Nie liczymy na hosting dla szkół ani na prowizje od korepetycji. Trzy źródła: "
     f"{b('(1)')} mecenat i CSR partnerów ścieżki finansowej i technologicznej; {b('(2)')} granty instytucjonalne na edukację cyfrową i integrację międzypokoleniową — FERS, NCBR, programy MEN; "
     f"{b('(3)')} freemium: generator unikalnych sprawdzianów i kartkówek z bazy, z rozwiązaniami sprawdzonymi przez ludzi, za symboliczny abonament szkoły lub rady rodziców.", 22, INK, factor=1.36)

# 15 — team (four founding members; Andrzej Dragan as supporter; Natalia Prus as collaborator)
p = slide("16 Zespół")
head(p, "Zespół", "Kto to robi — członkowie założyciele")
people = [
    ("Piotr Putyło", "PP", "lider projektu; architektura i większość kodu; prowadzi projekt od lipca 2026", "student Wydziału Fizyki UW"),
    ("Marysia Nazarczuk", "MN", "treści matematyczne: zgłoszenie, korekta i recenzja całej bazy 745 zadań", "matematyka — licencjat, II rok studiów magisterskich; studia licencjackie z fizyki i informatyki"),
    ("Marc Ploeg", "MP", "strategia, model organizacji i finansowania; głos rynku w zespole", "wieloletnie doświadczenie w innowacjach w biznesie; zasiadał w jury konkursów dla start-upów, także dla ING"),
    ("prof. Katarzyna Grabowska", "KG", "opieka naukowa; kierownictwo badawcze projektu", "Katedra Metod Matematycznych Fizyki, Wydział Fizyki UW"),
]
pw = (W - 2 * M - 3 * 24) // 4
for i, (n, ini, r, a) in enumerate(people):
    x = M + i * (pw + 24)
    card(p, x, 250, pw, 410)
    p.cell(x + 28, 278, 96, 96, "ellipse;whiteSpace=wrap;html=1;fillColor=" + TEAL_LIGHT + ";strokeColor=none;fontFamily=" + FONT + ";fontSize=34;fontStyle=1;fontColor=" + TEAL + ";", ini)
    text(p, x + 28, 390, pw - 56, 64, b(n), 22, INK, factor=1.15)
    text(p, x + 28, 452, pw - 56, 96, r, 19, BODY, factor=1.3)
    text(p, x + 28, 552, pw - 56, 100, muted(a), 17, factor=1.3)
text(p, M, 690, W - 2 * M, 40, teal(b("WSPARCIE I WSPÓŁPRACA")), 18)
sup = [
    ("prof. Andrzej Dragan", "wsparcie w mediach społecznościowych (potwierdzone) — fizyk, Wydział Fizyki UW, jeden z najbardziej rozpoznawalnych popularyzatorów fizyki w Polsce"),
    ("Natalia Prus", "współpraca: kurs finansów osobistych i przedsiębiorczości; prowadzi dział „Finanse osobiste”"),
]
sw_ = (W - 2 * M - 28) // 2
for i, (n, d) in enumerate(sup):
    x = M + i * (sw_ + 28)
    card(p, x, 728, sw_, 120, TEAL_LIGHT)
    text(p, x + 28, 746, sw_ - 56, 40, b(n), 22, INK)
    text(p, x + 28, 782, sw_ - 56, 62, d, 18, BODY, factor=1.3)
text(p, M, 866, W - 2 * M, 110, "Zespół łączy matematykę i fizykę na poziomie uniwersyteckim (treści i ich weryfikacja), inżynierię oprogramowania (działający, testowany serwis) "
     "oraz doświadczenie biznesowe i ekonomiczne (model organizacji, edukacja finansowa). Brakujące ogniwo nazywamy wprost i finansujemy z grantu: "
     "animator społeczności seniorów (½ etatu, pilotaż). Zgłoszenie składa Piotr Putyło jako Młody Naukowiec — reprezentant Zespołu.", 20, MUTED, factor=1.33)

# --- call to action, and sources (Claude first, then every number's origin)
p = slide("Zaproszenie", key="cta")
head(p, "Zaproszenie", "Co możesz zrobić dziś — zanim ktokolwiek przyzna grant")
ctas = [
    ("Studencie", "Rozwiąż zadanie na edmat.net. Utknąłeś? Zapytaj w dyskusji. Rozwiązałeś z czatem? Wklej — recenzent sprawdzi, Ty dostaniesz znak przy nazwisku.", "edmat.net"),
    ("Prowadzący, doktorancie", "Zostań opiekunem działu, który prowadzisz: zestaw na kolokwium jako link, recenzja rozwiązań Twoich studentów.", "jedna wiadomość do nas"),
    ("Emerytowany nauczycielu, seniorze", "Recenzuj, testuj zrozumiałość, współtwórz dział finansów. Duża czcionka, zero reklam, nic do instalowania.", "warsztat w UTW albo kontakt"),
    ("Szkoło", "Pilotaż generatora sprawdzianów z rozwiązaniami sprawdzonymi przez ludzi (2027) — szukamy pierwszych dwóch liceów.", "zgłoś szkołę"),
    ("Uczelnio", "Własna kopia na licencji MIT; logowanie przez USOS potrzebuje tylko danych dostępowych od uczelni.", "dane dostępowe USOS"),
    ("Partnerze, ING", "Mecenat ścieżki finansowej: zadania i kurs sprawdzane jak matematyka, z nazwiskiem recenzenta, nie z logo produktu.", "porozmawiajmy"),
]
cw3 = (W - 2 * M - 2 * 24) // 3
for i, (who, what, act) in enumerate(ctas):
    x = M + (i % 3) * (cw3 + 24); y = 250 + (i // 3) * 300
    card(p, x, y, cw3, 276)
    text(p, x + 28, y + 22, cw3 - 56, 44, who, 24, TEAL, bold=True)
    text(p, x + 28, y + 70, cw3 - 56, 150, what, 20, BODY, factor=1.35)
    text(p, x + 28, y + 224, cw3 - 56, 40, warm(b("→ " + act)), 20)
card(p, M, 862, W - 2 * M, 96, TEAL_LIGHT)
text(p, M + 32, 878, W - 2 * M - 64, 70, f"{b('Kontakt:')} Piotr Putyło · p.putylo@student.uw.edu.pl · edmat.net · kod: github.com/tryingtodosth/edmat (MIT) — programisto, pull request mile widziany.", 21, INK, factor=1.3)

p = slide("Źródła i narzędzia", key="sources")
head(p, "Źródła i narzędzia", "Skąd wzięły się liczby — i z czym to zbudowaliśmy")
lw = 820
card(p, M, 250, lw, 300, TEAL_LIGHT)
text(p, M + 28, 270, lw - 56, 40, "1. Claude (Anthropic)", 24, TEAL, bold=True)
text(p, M + 28, 314, lw - 56, 230, "Serwis zbudował zespół razem z agentami Claude Code: równoległe gałęzie, wspólne tablice zadań i „żywy plan” projektu; "
     "każda funkcja przechodzi test regresji i przejście w prawdziwej przeglądarce. Ta prezentacja i odpowiedzi w formularzu powstały z pomocą Claude — "
     "każdą liczbę sprawdził człowiek w źródłach obok. AI pisze, człowiek i testy weryfikują: ta sama zasada, co w produkcie.", 19, BODY, factor=1.35)
card(p, M, 574, lw, 190)
text(p, M + 28, 594, lw - 56, 40, "2. Otwarte oprogramowanie", 22, INK, bold=True)
text(p, M + 28, 636, lw - 56, 120, "Django + Django REST Framework, SvelteKit + Svelte 5, KaTeX, Paraglide, Tiptap, Leaflet + OpenStreetMap / Nominatim, DOMPurify + bleach, "
     "Playwright, ClamAV, Redis, django-postman, PDF.js — na licencjach otwartych; nasz kod: MIT.", 18, BODY, factor=1.35)
card(p, M, 788, lw, 160)
text(p, M + 28, 808, lw - 56, 40, "3. Recenzje robocze", 22, INK, bold=True)
text(p, M + 28, 850, lw - 56, 90, "Przegląd „w roli kapituły” wykonany z użyciem Gemini (Google), 16.09.2026 — na jego trzy uwagi odpowiadamy na slajdzie " + ref("risks") + "; "
     "uwagi Marca Ploega z 11.09.2026.", 18, BODY, factor=1.35)
rx = M + lw + 28; rw = W - M - rx
card(p, rx, 250, rw, 698)
text(p, rx + 28, 270, rw - 56, 40, "Dane", 24, TEAL, bold=True)
text(p, rx + 28, 318, rw - 56, 620, ul([
    f"{b('GUS')}, Szkolnictwo wyższe w roku akademickim 2025/2026 — 1 322,8 tys. studentów (stat.gov.pl).",
    f"{b('CKE')}, wyniki egzaminu maturalnego 2026 — 321 314 zdających.",
    f"{b('GUS')}, Informacja o sytuacji osób starszych w Polsce za 2024 r. — blisko 10 mln osób 60+, 26,6% ludności.",
    f"{b('GUS')}, Uniwersytety trzeciego wieku w roku akademickim 2024/2025 — 747 placówek, 125,9 tys. słuchaczy.",
    f"{b('ING Bank Śląski')}, Regulamin konkursu w ramach Programu Grantowego ING, 9. edycja, obowiązuje od 8.07.2026 — kryteria oceny i harmonogram.",
    f"{b('edmat.net')}, publiczne API i repozytorium, stan na 16.09.2026 — 745 zadań, 742 zweryfikowane, 9 materiałów; 1 441 testów backendu uruchomionych tego dnia, "
    "46 scenariuszy e2e (1 314 sprawdzeń), 2 094 komunikaty w każdym z 2 języków.",
], 12), 18, BODY, factor=1.35)

# ----------------------------------------------------------------------------- write
total = len(pages)
for i, pg in enumerate(pages, 1):
    frame(pg, i, total)
    # frame() appends after content; move the background rect to the front of the cell list so it sits behind everything
    bg = pg.cells.pop(len(pg.cells) - 4)
    pg.cells.insert(0, bg)
    bar_ = pg.cells.pop(len(pg.cells) - 3)
    pg.cells.insert(1, bar_)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
out = (f'<mxfile host="drawio-lasso" modified="{stamp}" agent="build_deck.py" version="31.3.2" type="device" pages="{total}">'
       + "".join(pg.xml() for pg in pages) + "</mxfile>")
for _k, _n in SLIDE_KEYS.items():
    out = out.replace(f"@@{_k}@@", str(_n))
dest = pathlib.Path(ARGS.out) if ARGS.out else HERE / "EdMat-ING-2026.drawio"
dest.write_text(out, encoding="utf-8")
print(f"wrote {dest}: {total} pages, {len(out)//1024} KB, font {FONT}")
