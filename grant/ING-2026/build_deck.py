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
    text(p, x + 24, y + 96, w - 48, h - 106, caption, 19, BODY, factor=1.25)

def bar(p, x, y, w_full, label, pct, amount, pct_max=35, fill=TEAL):
    text(p, x, y - 6, 620, 84, label, 20, BODY, factor=1.22)
    bw = round(w_full * pct / pct_max)
    p.cell(x + 660, y + 4, w_full, 30, rstyle("#EEF1F3", "none", 6))
    p.cell(x + 660, y + 4, bw, 30, rstyle(fill, "none", 6))
    text(p, x + 660 + w_full + 20, y, 240, 40, f"{b(str(pct) + '%')} &nbsp;{muted(amount)}", 24, BODY, factor=1.15)

# ----------------------------------------------------------------------------- slides
# Text: the Gemini rewrite of 16.09 (gemini/text.txt) with corrections — no claim of an existing
# reviewer team (the MIM/FUW vice-deans' mailing is the channel), "Marc Ploeg" (the rewrite invented
# "van der"), a few colloquialisms toned down — plus the funding, school-procurement and senior-
# retention research from the same folder where it changes a number or a mechanism.
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
text(p, M, 392, 880, 160, "Zadania z rozwiązaniami sprawdzanymi przez ludzi:<br>od matury do emerytury.", 40, INK, bold=True, factor=1.2)
text(p, M, 570, 860, 150, "Otwarta baza wiedzy ścisłej i społeczność uczących się w każdym wieku. Działa pod adresem " + b("edmat.net") +
     ", kod jest całkowicie otwarty (licencja MIT), w bazie mamy 745 zadań ze zweryfikowanymi rozwiązaniami.", 27, BODY)
text(p, M, 760, 860, 120, b("Zespół młodych naukowców") + "<br>Wydział Fizyki Uniwersytetu Warszawskiego, wrzesień 2026", 24, MUTED)
image(p, 1040, 236, 800, "home.png")
text(p, 1040, 760, 800, 40, muted("Strona główna edmat.net (stan na 16 września 2026): pasma wiekowe od najmłodszych po seniorów."), 18)

# 2 — problem
p = slide("2 Problem")
head(p, "Problem", "Dobra edukacja ścisła w Polsce nie ma dziś miejsca,<br>które byłoby rzetelnie sprawdzone, otwarte i trwałe")
cols = [
    ("Student przed egzaminem", "Zadania i rozwiązania są rozproszone po przypadkowych PDF-ach, zamkniętych stronach przedmiotów i zrzutach ekranu na Messengerze. "
     "Strona kursu znika zaraz po sesji. Nikt nie podpisuje się nazwiskiem pod tym, czy w trzeciej linijce wyprowadzenia nie ma błędu w znaku."),
    ("Uczeń i rodzic", "Brainly czy ChatGPT wyrzucają odpowiedź w ułamku sekundy, często z poważnym błędem, zerowym wyjaśnieniem i bez żywego człowieka, który by to skorygował. "
     "Algorytm halucynuje z kamienną twarzą, uczeń zostaje sam przed monitorem, a rodzic nie ma pojęcia, czy dziecko uczy się prawdy, czy cyfrowego bełkotu."),
    ("Emerytowany nauczyciel", "Trzy dekady dydaktycznego złota schowane w szufladzie i brak kogoś, kto by o nie zapytał. "
     "Współczesny internet oferuje seniorom co najwyżej proste gierki na ćwiczenie pamięci, zamiast dać im realną, potrzebną rolę społeczną."),
]
cw = (W - 2 * M - 2 * 28) // 3
for i, (t, body) in enumerate(cols):
    x = M + i * (cw + 28)
    card(p, x, 260, cw, 480)
    text(p, x + 32, 290, cw - 64, 60, t, 30, INK, bold=True)
    text(p, x + 32, 356, cw - 64, 370, body, 23, BODY, factor=1.38)
card(p, M, 776, W - 2 * M, 150, TEAL_LIGHT)
text(p, M + 32, 800, W - 2 * M - 64, 110, b("Wspólny mianownik:") + " wiedza o tym, jak poprawnie przejść od założeń do wyniku, jest dziś w Polsce rozproszona, pozbawiona recenzji "
     "i nie przepływa między pokoleniami. Nie brakuje nam treści w sieci. Brakuje mechanizmu, który odsiewa szum od sygnału.", 26, INK, factor=1.35)

# 3 — vision, start
p = slide("3 Wizja i start")
head(p, "Wizja i punkt startu", "Chcemy trwale uporządkować edukację ścisłą w Polsce.<br>Zaczynamy lokalnie, bo znamy warunki brzegowe.")
card(p, M, 262, 800, 676, TEAL_LIGHT)
text(p, M + 36, 296, 730, 60, "Nasz cel", 22, TEAL, bold=True)
text(p, M + 36, 346, 730, 330, "Doprowadzić do stanu, w którym każde typowe zadanie ze szkoły i studiów ma jedno otwarte, publiczne rozwiązanie, za które konkretny człowiek ręczy nazwiskiem. "
     "I do tego, żeby ta wiedza krążyła między pokoleniami: od doktoranta do maturzysty i od emerytowanej nauczycielki do jej wnuka.", 28, INK, factor=1.38)
text(p, M + 36, 720, 730, 190, muted("Ten sam sprawdzony schemat otwieramy krok po kroku: maturzyści (2027), dorośli w trakcie przebranżowienia oraz seniorzy w tematyce finansów osobistych."), 23, factor=1.35)
card(p, 940, 262, 880, 676)
text(p, 976, 296, 800, 60, "Punkt wyjścia", 22, WARM, bold=True)
text(p, 976, 346, 800, 110, "Studenci kierunków ścisłych UW,<br>postawieni w stan wyższej konieczności: tuż przed sesją", 30, INK, bold=True, factor=1.2)
text(p, 976, 470, 800, 456, ul([
    b("Mamy konkretną bazę:") + " 745 zadań z dwóch twardych przedmiotów na UW (Analiza Matematyczna II oraz Rachunek Prawdopodobieństwa I), z czego 742 mają kompletne, zweryfikowane rozwiązania.",
    b("Mamy kanał dotarcia:") + " prodziekani ds. studenckich MIM i FUW roześlą informację o EdMat mailem do pracowników i studentów; stamtąd rekrutujemy pierwszych recenzentów. Opieka naukowa: dr hab. Katarzyna Grabowska (KMMF).",
    b("Mamy twardy eksperyment weryfikacyjny:") + " sesja zimowa 2026/27 z celem minimum 300 aktywnych studentów.",
    b("Znamy realia:") + " zamiast krzywych wzrostu do miliarda użytkowników, wąski, dobrze zdefiniowany odcinek z pełną kontrolą nad jakością.",
], 12), 23, BODY, factor=1.33)

# 4 — use case 1
p = slide("4 Przypadek 1: Ola")
head(p, "Przypadek użycia 1: działa w tej chwili", "Ola, II rok fizyki, pięć dni do kolokwium z Analizy II")
steps = [
    "Wchodzi na edmat.net, wybiera Matematyka → Analiza matematyczna, po czym filtruje dział „całki” i poziom trudności „trudne”.",
    "Próbuje zmierzyć się z problemem sama. Widzi samą treść, bo rozwiązanie jest domyślnie ukryte i odsłania się krok po kroku, tak jak powinno przebiegać myślenie.",
    "Jeśli utknie: odsłania pierwszą wskazówkę. Jeśli to za mało, sprawdza sam wynik końcowy. Dopiero na końcu odkrywa pełne rozwiązanie opatrzone symbolem weryfikacji i ocenione przez społeczność.",
    "Nie rozumie przejścia w kroku trzecim? Pyta w dyskusji pod zadaniem. Odpowiada ktoś, kto już to przeszedł: starszy rok, doktorant, emerytowana nauczycielka.",
    "Zaznacza 12 kluczowych zadań, klika „Mój zestaw” i generuje czysty arkusz do wydruku w PDF.",
    "Gdy po kolokwium wpadnie na bardziej elegancki dowód, wrzuca własne rozwiązanie. Trafia ono do recenzji i po zatwierdzeniu zasila bazę dla młodszych roczników.",
]
y = 244
for i, s_ in enumerate(steps, 1):
    p.cell(M, y + 2, 46, 46, "ellipse;whiteSpace=wrap;html=1;fillColor=" + TEAL + ";strokeColor=none;fontFamily=" + FONT + ";fontSize=22;fontStyle=1;fontColor=#ffffff;", str(i))
    text(p, M + 66, y, 700, 116, s_, 22, BODY, factor=1.3)
    y += 118
image(p, 900, 250, 920, "exercise-revealed.png")
card(p, 900, 850, 920, 96, GREEN_LIGHT)
text(p, 924, 866, 876, 76, '<span style="color:' + GREEN + '">' + b("Wszystko na tym slajdzie jest wdrożone i przetestowane na edmat.net.") +
     " Stan na 16 września 2026: renderowanie formuł przez KaTeX, odsłanianie podpowiedzi, eksport do PDF.</span>", 19, factor=1.3)

# 5 — seniors in three roles
p = slide("5 Seniorzy w trzech rolach")
head(p, "Przypadek użycia 2: kluczowy dla tej edycji", "Seniorzy w trzech konkretnych rolach: nie tylko „pani Halina”")
card(p, M, 250, W - 2 * M, 112, WARM_LIGHT)
text(p, M + 32, 264, W - 2 * M - 64, 90, b("Seniorzy nie potrzebują kolejnej kolorowej aplikacji stworzonej po to, żeby „oswajać ich z technologią”.") +
     " Potrzebują sprawczości, szacunku i sensownego powodu, by usiąść do komputera. Dajemy im ten powód, wymagając jedynie zwykłej przeglądarki. "
     "Ponieważ emerytowani fizycy i matematycy to ułamek procenta populacji, a doświadczenie życiowe ma każdy, zdefiniowaliśmy trzy niezależne ścieżki.", 22, INK, factor=1.3)
roles = [
    ("Recenzent merytoryczny", "emerytowani nauczyciele i wykładowcy przedmiotów ścisłych; wiemy, w których pokojach i strukturach ich szukać",
     ["pani Halina, 68 lat, była nauczycielka licealna: sprawdza rozwiązania zadań maturalnych i z pierwszego roku, a pod każdym zatwierdzonym wpisem widnieje jej nazwisko",
      "pomaga młodszym w komentarzach, a po pewnym czasie zostaje opiekunką całego działu maturalnego",
      "sama rozwiązuje trudniejsze zagadnienia, utrzymując intelektualny rygor zamiast schematycznych łamigłówek"]),
    ("Czytelnik i tester zrozumiałości", "dowolny senior: słuchacze UTW, bywalcy bibliotek, osoby bez wykształcenia ścisłego",
     ["weryfikuje stronę pedagogiczną: czy wskazówka naprowadza na trop? czy tekst brzmi naturalnie po polsku? czy polecenie z podstawówki jest jednoznaczne?",
      "testuje treści dla najmłodszych uczniów",
      "może uczyć się sam w formule „matura po latach”, w swoim tempie, przy dużej czcionce i wysokim kontraście"]),
    ("Współtwórca modułu finansów", "każdy starszy człowiek z bagażem doświadczeń życiowych, czyli każdy",
     ["współtworzy i ocenia sekcję finansową: domowy budżet, bezpieczne oszczędzanie, mechanizmy oszustw „na wnuczka” i wyłudzeń na BLIK",
      "dowiaduje się od młodych ekonomistów, jak działają IKE/IKZE czy realna ochrona przed inflacją; korzyść działa w obie strony",
      "wnosi perspektywę praktyczną, której próżno szukać w akademickich podręcznikach"]),
]
cw = (W - 2 * M - 2 * 24) // 3
for i, (t, who, items) in enumerate(roles):
    x = M + i * (cw + 24)
    card(p, x, 384, cw, 440)
    text(p, x + 28, 404, cw - 56, 44, t, 25, TEAL, bold=True)
    text(p, x + 28, 446, cw - 56, 80, muted(who), 18, factor=1.3)
    text(p, x + 28, 526, cw - 56, 290, ul(items, 6), 18, BODY, factor=1.3)
text(p, M, 842, W - 2 * M, 150, b("Trzeźwe spojrzenie na liczby:") + " 125,9 tys. słuchaczy UTW nie rzuci się nagle do sprawdzania całek. Recenzentów szukamy tam, gdzie są: emerytowana kadra "
     "Wydziału Fizyki i MIM UW, sekcje emerytów ZNP w trzech miastach oraz zaprzyjaźnione licea. Cel: 30 seniorów (rekrutujemy 35), w tym minimum 10 recenzentów merytorycznych; "
     "jeśli zgłosi się ich mniej, ciężar biorą role czytelników i ekspertów od finansów. Kotwicą pilotażu jest biblioteka publiczna, zadania mają do 20 minut i przechodzą przez kilka par oczu, "
     "a 5 dni ciszy uruchamia telefon animatora w ciągu doby. 20% grantu, w tym pół etatu animatora społeczności.", 19, MUTED, factor=1.3)

# 6 — what exists, and the focus declaration
p = slide("6 Co już działa")
head(p, "Stan obecny", "To nie makieta z Figmy. To działający system, dostępny pod edmat.net od lipca 2026")
tiles = [
    ("745", "zadań z pełnymi rozwiązaniami krok po kroku (Analiza Matematyczna II i Rachunek Prawdopodobieństwa I na poziomie uniwersyteckim)"),
    ("742", "zadania ze zweryfikowanym tokiem rozumowania; każde ma pulę alternatywnych rozwiązań, wskazówek, ocenę społeczności i otwartą dyskusję"),
    ("2", "pełne wersje językowe interfejsu (polski i angielski), po 2 094 komunikaty każda; wersje językowe samych zadań recenzowane niezależnie"),
    ("1 441", "automatycznych testów backendu, stan na 16 września 2026: wszystkie wykonane pomyślnie"),
    ("1 314", "sprawdzeń zachowania interfejsu w realnej przeglądarce, 46 scenariuszy: od rejestracji konta po moderację"),
    ("22", "podstrony po audycie dostępności (silnik axe): zero błędów; powiększanie tekstu i wysoki kontrast w standardzie"),
    ("18", "ukończonych modułów: zadania, materiały, kursy, wydarzenia, korepetycje z geolokalizacją, wiadomości, moderacja, konta rodzicielskie"),
    ("MIT", "w pełni otwarty kod źródłowy: dowolna szkoła lub uczelnia może postawić własną instancję; zero reklam, zero skryptów śledzących"),
]
tw = (W - 2 * M - 3 * 24) // 4
for i, (n, c) in enumerate(tiles):
    x = M + (i % 4) * (tw + 24); y = 250 + (i // 4) * 244
    stat(p, x, y, tw, 228, n, c)
text(p, M, 748, W - 2 * M, 60, "Liga Seed wymaga szczerości: mamy gotowy, stabilny produkt i pierwszych użytkowników, natomiast nie generujemy jeszcze przychodów ani dużych zasięgów. "
     "Zbudowaliśmy to w osiem tygodni intensywnej pracy zespołowej, pisząc test regresyjny dla każdego napotkanego błędu.", 21, MUTED, factor=1.3)
card(p, M, 822, W - 2 * M, 136, GREEN_LIGHT)
text(p, M + 32, 840, W - 2 * M - 64, 110, '<span style="color:' + GREEN + '">' + b("Konsekwentny wybór priorytetów:") + " choć architektura pod 18 modułów jest gotowa, cały grant skupiamy w 100% na trzech filarach: " +
     b("otwartej bazie zrecenzowanych zadań") + ", " + b("międzypokoleniowym pilotażu z seniorami") + " oraz " + b("praktycznej edukacji finansowej") +
     ". Korepetycje na mapie, komunikator i moduł wydarzeń zostają zamrożone do pełnej walidacji rdzenia.</span>", 23, factor=1.35)

# 7 — mechanism
p = slide("7 Mechanika jakości")
head(p, "Innowacja procesowa", "Skąd bierze się jakość: rygorystyczny mechanizm zamiast deklaracji")
boxes = [
    ("Nowe zgłoszenie", "Każdy zalogowany użytkownik może zaproponować treść zadania, alternatywne rozwiązanie, nową wskazówkę lub tłumaczenie."),
    ("Rzetelna recenzja", "Akceptują wyłącznie zweryfikowani współtwórcy i opiekunowie merytoryczni działów. Odrzucenie zawsze wymaga uzasadnienia w komentarzu."),
    ("Pula rozwiązań", "Jedno zadanie może mieć kilka dróg do wyniku (algebraicznie, geometrycznie). System rejestruje historię edycji; autor decyduje o dołączeniu poprawek."),
    ("Reputacja i waga głosu", "Głosy są ważone dorobkiem w portalu. Ocena zweryfikowanego recenzenta ma podwójną wagę statystyczną."),
    ("✓ Certyfikat weryfikacji", "Znaczek nie jest nadawany uznaniowo. To stan logiczny: zadanie ma go tylko wtedy, gdy przynajmniej jedno rozwiązanie przeszło udokumentowaną recenzję."),
]
bw, gap = 300, 55
ids = []
for i, (t, d) in enumerate(boxes):
    x = M + i * (bw + gap)
    ids.append(card(p, x, 262, bw, 296, TEAL_LIGHT if i < 4 else GREEN_LIGHT))
    text(p, x + 20, 280, bw - 40, 64, t, 23, TEAL if i < 4 else GREEN, bold=True, factor=1.15)
    text(p, x + 20, 344, bw - 40, 210, d, 18, BODY, factor=1.32)
for a, b_ in zip(ids, ids[1:]):
    p.edge(a, b_)
notes = [
    ("Auto-kwarantanna", "Treść oflagowana jako błędna lub szkodliwa przez 20% czytelników (minimum 3 zgłoszenia) jest automatycznie ukrywana do rozstrzygnięcia przez moderatora."),
    ("Ściśle zdefiniowany zasięg uprawnień", "Opiekun sekcji rachunku różniczkowego nie moderuje działu genetyki. Poziom zaufania rośnie z udokumentowanym wkładem, nigdy z samego upływu czasu."),
    ("Szybka publikacja dla zaufanych", "Uznany autor publikuje nowe zadania od razu, z pominięciem kolejki. Każda ingerencja w cudzą pracę zawsze wymaga zatwierdzenia."),
]
nw = (W - 2 * M - 2 * 28) // 3
for i, (t, d) in enumerate(notes):
    x = M + i * (nw + 28)
    card(p, x, 586, nw, 200)
    text(p, x + 28, 604, nw - 56, 44, t, 23, INK, bold=True, factor=1.15)
    text(p, x + 28, 650, nw - 56, 130, d, 19, BODY, factor=1.32)
card(p, M, 814, W - 2 * M, 120, WARM_LIGHT)
text(p, M + 32, 832, W - 2 * M - 64, 90, b("Dlaczego to unikalne:") + " Stack Overflow udowodnił skuteczność takiego podejścia w inżynierii oprogramowania. Nikt dotąd nie przeniósł tego rygoru "
     "na grunt polskiej edukacji szkolnej i akademickiej, dbając o zgodność z podstawą programową i zapraszając do stołu nauczycieli na emeryturze.", 24, INK, factor=1.35)

# 8 — architecture 1/2
p = slide("8 Architektura", key="arch")
head(p, "Architektura 1/2", "Architektura techniczna: prostota i stabilność")
stack = [
    ("Warstwa klienta", TEAL_LIGHT, TEAL, [
        "SvelteKit ze Svelte 5: statyczny build bez ciężkiego środowiska Node.js na produkcji, serwowany wprost z serwera WWW",
        "pełna dwujęzyczność PL/EN (Paraglide), 2 094 przetłumaczone frazy systemowe",
        "matematyka renderowana przez KaTeX; Markdown i HTML rygorystycznie czyszczone przez DOMPurify",
        "edytor Tiptap z wprowadzaniem formuł, podgląd PDF, mapy Leaflet i OpenStreetMap",
        "dostępność: skalowanie tekstu, wysoki kontrast, cele dotykowe od 44 px, audyt axe"]),
    ("Warstwa serwerowa (API)", CARD, INK, [
        "Python z Django 5 i Django REST Framework: 18 modułów w jednej, spójnej bazie kodu",
        "treści: zadania, pule rozwiązań, materiały pomocnicze, taksonomia pojęć",
        "społeczność: dyskusje, oceny ważone reputacją, moderacja rozproszona, powiadomienia w czasie rzeczywistym (SSE)",
        "tożsamość i konta rodzicielskie, kursy, wydarzenia, rezerwacje, korepetycje, wiadomości",
        "aktywność, zgłoszenia błędów, telemetria, generator arkuszy PDF"]),
    ("Dane i integracje", WARM_LIGHT, WARM, [
        "prototyp i pilotaż: SQLite; produkcja: PostgreSQL, pliki użytkowników poza bazą",
        "pliki: sprawdzanie sygnatur binarnych, skan ClamAV (gdy jest), rekompresja obrazów i usunięcie metadanych EXIF",
        "Redis (opcjonalnie): pamięć podręczna, limity zapytań, pub/sub dla powiadomień",
        "własne proxy do geokodowania OpenStreetMap z limitem jednego zapytania na sekundę",
        "e-mail: jeszcze nie, jedyna brakująca usługa"]),
]
bw, gap = 540, 50
ids = []
for i, (t, fill, col, items) in enumerate(stack):
    x = M + i * (bw + gap)
    ids.append(card(p, x, 250, bw, 460, fill))
    text(p, x + 26, 272, bw - 52, 44, t, 25, col, bold=True)
    text(p, x + 26, 322, bw - 52, 380, ul(items, 6), 17, BODY, factor=1.3)
p.edge(ids[0], ids[1]); p.edge(ids[1], ids[2])
cw = (W - 2 * M - 28) // 2
card(p, M, 736, cw, 216)
text(p, M + 28, 756, cw - 56, 40, "Bezpieczeństwo i standardy", 22, TEAL, bold=True)
text(p, M + 28, 798, cw - 56, 150, "Podwójna sanityzacja danych wejściowych (bleach na serwerze, DOMPurify w przeglądarce). Limity zapytań na wrażliwych punktach: logowanie, rejestracja, upload. "
     "Wyłącznik każdej funkcji. Ochrona prywatności nieletnich zgodnie z art. 8 RODO. Brak reklam i ciasteczek analitycznych firm trzecich.", 18, BODY, factor=1.35)
x2 = M + cw + 28
card(p, x2, 736, cw, 216)
text(p, x2 + 28, 756, cw - 56, 40, "Jakość i wdrożenie", 22, TEAL, bold=True)
text(p, x2 + 28, 798, cw - 56, 150, "1 441 testów backendu, 46 scenariuszy przeglądarkowych Playwright (1 314 sprawdzeń), audyt dostępności axe na 22 stronach. "
     "Wdrożenie na pojedynczej maszynie z Apache i mod_wsgi, skrypt aktualizacyjny z testem dymnym. Kod na licencji MIT: szkoła lub uczelnia uruchamia własną kopię.", 18, BODY, factor=1.35)

# 9 — architecture 2/2
p = slide("9 Wyzwania techniczne", key="arch2")
head(p, "Architektura 2/2", "Wyzwania inżynierskie: co rozwiązaliśmy, a co planujemy")
cols = [
    ("Rozwiązane i przetestowane w boju", GREEN_LIGHT, GREEN, [
        "zapis LaTeX przechodzi bez strat przez Markdown i sanityzację HTML; sprawdzone automatycznie na 2 241 polach, zero błędów",
        "spójność danych przy równoczesnej moderacji na SQLite: operacje atomowe w bazie zamiast ciężkich blokad",
        "powiadomienia push o minimalnym narzucie: SSE z Redis pub/sub, twardy limit dwóch połączeń na konto",
        "treści od użytkowników: format sprawdzany po bajtach, obrazy re-enkodowane, metadane lokalizacji usuwane",
        "szybki pierwszy widok: prerendering i szkielet strony wyświetlany przed załadowaniem aplikacji"]),
    ("Do zrobienia przed wejściem na skalę", WARM_LIGHT, WARM, [
        "migracja do PostgreSQL; Redis w produkcji, żeby limity liczyły się wspólnie dla wszystkich procesów",
        "produkcyjna poczta: reset hasła, powiadomienia, walidacja adresów w domenach akademickich",
        "CI: pełna pula testów przy każdej zmianie; kopie zapasowe poza serwerem; monitoring",
        "blokada po nieudanych logowaniach; jednorazowe bilety do strumienia powiadomień zamiast tokenu w adresie",
        "ClamAV w trybie ciągłym (dziś status skanu jest uczciwie raportowany jako nieaktywny)"]),
    ("W ramach grantu", TEAL_LIGHT, TEAL, [
        "podpowiedzi AI wyłącznie jako selektor wskazówek ze zweryfikowanej bazy, bez prawa do generowania treści",
        "ścieżka „wklej rozwiązanie z czatu” z oznaczeniem: wygenerowane z pomocą AI, oczekuje na człowieka",
        "generator unikalnych sprawdzianów z kluczem odpowiedzi dla nauczycieli",
        "panel recenzencki dla seniorów: jeden ekran, duża typografia, logowanie linkiem bez hasła, stały przycisk „poproś o telefon”",
        "strefy czasowe w rezerwacjach; szkice tłumaczeń maszynowych do ludzkiej korekty jako faza 2"]),
    ("Zaprojektowane, czeka na realizację", CARD, INK, [
        "dwuosiowy system reputacji: prawo do tworzenia osobno od prawa do zmiany cudzej pracy (specyfikacja na /levels)",
        "logowanie uczelniane USOS (OAuth 1.0a, klucze od każdej uczelni osobno) oraz Google, Apple, GitHub: dziś uczciwe atrapy",
        "wyszukiwanie ludzi i treści wewnątrz kursów",
        "świadoma rezygnacja z bramek płatniczych: podawane kwoty są wyłącznie orientacyjne"]),
]
cw4 = (W - 2 * M - 3 * 24) // 4
for i, (t, fill, col, items) in enumerate(cols):
    x = M + i * (cw4 + 24)
    card(p, x, 250, cw4, 660, fill)
    text(p, x + 24, 272, cw4 - 48, 70, t, 22, col, bold=True, factor=1.15)
    text(p, x + 24, 344, cw4 - 48, 560, ul(items, 8), 17, BODY, factor=1.3)
text(p, M, 926, W - 2 * M, 60, "Każdy z powyższych punktów ma odzwierciedlenie w budżecie (slajd " + ref("budget") + ") albo został świadomie odłożony w czasie. Nie składamy obietnic bez pokrycia w kodzie.", 20, MUTED, factor=1.3)

# 10 — generations
p = slide("10 W rytmie pokoleń")
head(p, "W rytmie pokoleń", "Jedna baza, jeden mechanizm, cztery grupy odbiorców")
gens = [
    ("Uczeń (12–19 lat)", ["dostęp do pasma szkoły średniej", "konto poniżej 16. roku życia zakłada opiekun: ma wgląd we wszystkie wpisy i prawo ich usunięcia",
                          "moderacja uprzednia grafik i komentarzy tworzonych przez dzieci"],
     ["500 zadań maturalnych z drobiazgowymi rozwiązaniami (lato 2027)", "pierwsza szkoła partnerska; generator kartkówek dla kadry"]),
    ("Student", ["745 zadań akademickich z UW, forum dyskusyjne, eksport zestawów do PDF", "kursy tworzone oddolnie, wydarzenia z programem i rejestracją",
                 "korepetycje na mapie: gotowe, zamrożone na czas grantu"],
     ["300 aktywnych studentów w najbliższej sesji zimowej", "3 kolejne uczelnie do końca 2027"]),
    ("Dorosły, przebranżowienie", ["pasmo dla dorosłych; kursy prowadzone przez użytkowników", "dział „Finanse osobiste” już istnieje",
                                    "podstawy matematyki dla programistów i analityków, statystyka"],
     ["kurs finansowy: pierwsza umowa, podatki, mechanika kredytu i stóp procentowych"]),
    ("Senior", ["dedykowane pasmo; skalowanie czcionki, maksymalny kontrast", "obsługa w oknie przeglądarki, zero instalacji, zero reklam",
                "trzy precyzyjne role: recenzent, tester, współtwórca finansów"],
     ["pilotaż w trzech miastach: 30 seniorów, koordynator społeczności", "moduł finansowy 60+: bezpieczne zarządzanie kapitałem, obrona przed oszustwami"]),
]
gw = (W - 2 * M - 3 * 24) // 4
for i, (t, now, later) in enumerate(gens):
    x = M + i * (gw + 24)
    card(p, x, 250, gw, 640)
    text(p, x + 26, 272, gw - 52, 50, t, 24, INK, bold=True, factor=1.15)
    text(p, x + 26, 326, gw - 52, 30, teal(b("STAN OBECNY")), 18)
    text(p, x + 26, 356, gw - 52, 300, ul(now, 8), 19, BODY, factor=1.3)
    text(p, x + 26, 640, gw - 52, 30, warm(b("Z GRANTEM")), 18)
    text(p, x + 26, 670, gw - 52, 210, ul(later, 8), 19, BODY, factor=1.3)
text(p, M, 912, W - 2 * M, 60, "Wiek użytkownika to w naszym systemie zwykły parametr filtrowania treści: dziesięciolatek i emerytowany profesor fizyki korzystają z odmiennych widoków, "
     "ale w warstwie danych mogą współpracować nad tym samym zadaniem.", 22, MUTED, factor=1.3)

# 11 — finance + AI
p = slide("11 Finanse i AI")
head(p, "Dwa obszary konkursowe: czyste fakty, zero modnych słów", "Edukacja finansowa i sztuczna inteligencja")
cw = (W - 2 * M - 28) // 2
card(p, M, 250, cw, 690, WARM_LIGHT)
text(p, M + 32, 272, cw - 64, 70, "Finanse osobiste oparte na międzypokoleniowym transferze wiedzy", 24, WARM, bold=True, factor=1.15)
text(p, M + 32, 348, cw - 64, 586, ul([
    "Struktura pod dział finansów osobistych jest już zaimplementowana w serwisie.",
    "Autorski program przygotowany przez ekonomistkę Natalię Prus: matematyka budżetu domowego, procent składany, koszt pieniądza w czasie, obsługa zadłużenia, IKE/IKZE, realna stopa zwrotu po inflacji. Wszystko jako " + b("zadania obliczeniowe") + " weryfikowane z tym samym rygorem, co zadania z analizy.",
    "Aktywny udział seniorów: recenzja życiowej użyteczności materiałów, moduły o oszustwach socjotechnicznych (metody „na wnuczka”, fałszywe potwierdzenia BLIK, manipulacje telefoniczne). Wiedza z praktyki, nie z teorii.",
    "Rzetelne źródła zewnętrzne bez lokowania produktów finansowych i bez ukrytej sprzedaży.",
    "Bezpośrednie połączenie pokoleń: młodzi uczą się gospodarowania pierwszymi zarobkami, starsi zyskują tarczę przed wyłudzeniami, pracując z ludźmi, którzy nie chcą im niczego sprzedać.",
], 10), 21, BODY, factor=1.33)
x2 = M + cw + 28
card(p, x2, 250, cw, 690, TEAL_LIGHT)
text(p, x2 + 32, 272, cw - 64, 70, "Sztuczna inteligencja osadzona na fundamencie ludzkiej wiedzy", 24, TEAL, bold=True, factor=1.15)
text(p, x2 + 32, 348, cw - 64, 586, ul([
    b("Nie trenujemy własnego dużego modelu językowego.") + " Budujemy coś bardziej potrzebnego: filtr weryfikacyjny, którego modelom komercyjnym dramatycznie brakuje.",
    "Metoda sokratejska z bezpiecznikiem: model dobiera podpowiedzi wyłącznie ze zbioru rozwiązań, które wcześniej zatwierdził człowiek. AI ma u nas zakaz wymyślania rozwiązań z głowy. To jedyne zadanie algorytmów generatywnych finansowane z tego grantu.",
    "Narzędzie dla nauczyciela: generowanie unikalnych zestawów sprawdzających opartych na sprawdzonych schematach, za które placówka może uiścić niewielką opłatę abonamentową.",
    "Sortowanie kolejki moderacyjnej: wyłapywanie zduplikowanych zgłoszeń, brakujących kroków w obliczeniach czy wątpliwych załączników graficznych.",
    "Tłumaczenia wspomagane maszynowo z kontrolą składni LaTeX: wyłącznie jako wersje robocze wymagające podpisu ludzkiego tłumacza.",
    "Sami na co dzień programujemy w asyście agentów AI: znamy ich mocne strony, ale przede wszystkim wiemy, w których miejscach zmyślają.",
], 10), 21, BODY, factor=1.33)

# 12 — competition
p = slide("12 Konkurencja")
head(p, "Zderzenie z rynkiem", "Znamy konkurencję od podszewki, bo sami zarywaliśmy przy niej noce")
rows = [
    ("Brainly, Zadane.pl", "szybka, gotowa odpowiedź do pracy domowej", "gwarancji poprawności; za to agresywne reklamy i skupienie na szkole"),
    ("ChatGPT i inne LLM", "natychmiastowa dostępność, każdy temat", "pewności: halucynacje w naukach ścisłych, brak znajomości programu, gotowy wynik zamiast toku rozumowania"),
    ("Khan Academy", "znakomite wideo na poziomie szkolnym", "zadań z polskich uczelni, lokalnej społeczności, polskiego programu"),
    ("Kampus (Moodle), LMS uczelni", "materiały prowadzącego dla jego kursu", "otwartości: silosy kasowane po semestrze, bez wieloautorskich rozwiązań i recenzji"),
    ("Librus, Vulcan", "sprawny dziennik i komunikacja ze szkołą", "jakichkolwiek ambicji, by tworzyć przestrzeń do samej nauki"),
    ("Math StackExchange", "bezdyskusyjnie wysoki poziom", "polskiego języka i realiów egzaminacyjnych; forma nie służy nauce przed egzaminem"),
    ("e-korepetycje.net, Preply", "rynek korepetytorów", "zintegrowanej bazy zadań, na której można wspólnie pracować"),
]
c1, c2, c3 = 330, 600, 790
y = 244
p.cell(M, y, c1, 40, tstyle(18, MUTED, bold=True), "KTO")
p.cell(M + c1, y, c2, 40, tstyle(18, MUTED, bold=True), "CO DAJE")
p.cell(M + c1 + c2, y, c3, 40, tstyle(18, MUTED, bold=True), "CZEGO NIE DAJE")
y += 42
for i, (a, b_, c) in enumerate(rows):
    if i % 2 == 0:
        p.cell(M - 12, y - 6, c1 + c2 + c3 + 24, 68, rstyle(CARD, "none", 4))
    text(p, M, y, c1 - 16, 60, b(a), 19, INK, factor=1.25)
    text(p, M + c1, y, c2 - 16, 60, b_, 19, BODY, factor=1.25)
    text(p, M + c1 + c2, y, c3 - 16, 60, c, 19, BODY, factor=1.25)
    y += 72
card(p, M, 784, W - 2 * M, 170, GREEN_LIGHT)
text(p, M + 32, 798, W - 2 * M - 64, 150,
     '<span style="color:' + GREEN + '">' + b("Unikalna wartość EdMat, działająca w kodzie:") + "</span> weryfikacja oparta na faktach, nie deklaracjach · mapowanie na polski program nauczania · "
     "niezależna recenzja każdej wersji językowej · bezpieczne ustawienia domyślne dla każdego wieku · licencja MIT, zero reklam.<br>" +
     b("Przewagą nie jest sam kod.") + " Jest nią zweryfikowana baza zmapowana na polski system edukacji i społeczność recenzentów ręczących za rozwiązania własnym nazwiskiem. "
     "Giganci mogą dopisać plakietkę „sprawdzone” w jeden sprint, ale nie kupią ludzi z dorobkiem, którzy firmują treści własną twarzą. Zaufanie buduje się pracą u podstaw.", 20, BODY, factor=1.38)

# 13 — audience
p = slide("13 Odbiorcy")
head(p, "Odbiorcy i potencjał", "Do kogo kierujemy projekt i jaka jest skala")
stats = [
    ("1,32 mln", "studentów w Polsce (GUS, rok akademicki 2025/26). Nasz pierwszy krok: kierunki ścisłe Uniwersytetu Warszawskiego"),
    ("321 tys.", "zdających maturę w 2026 r. (CKE) oraz ich rodzice, szukający czegoś bardziej wiarygodnego niż przypadkowe fora"),
    ("10 mln", "osób w wieku 60+, 26,6% społeczeństwa (GUS 2024). W tej grupie są tysiące emerytowanych nauczycieli fizyki i matematyki"),
    ("125,9 tys.", "słuchaczy w 747 uniwersytetach trzeciego wieku (GUS 2024/25): naturalna brama do środowiska seniorów"),
]
sw = (W - 2 * M - 3 * 24) // 4
for i, (n, c) in enumerate(stats):
    stat(p, M + i * (sw + 24), 250, sw, 264, n, c)
rings = [
    ("Faza pierwsza (2026/27)", "Wydział Fizyki i MIM UW: kilka tysięcy studentów i pracowników, do których docieramy mailingiem prodziekanów ds. studenckich obu wydziałów i przez prowadzących zajęcia, a nie przez płatne kampanie."),
    ("Faza druga (2027)", "Warszawskie licea (klasy z rozszerzoną matematyką i fizyką), słuchacze UTW w trzech wybranych miastach oraz studenci z Ukrainy dzięki ukraińskiej wersji językowej treści."),
    ("Faza trzecia (2028)", "Szerokie wdrożenie: każda szkoła korzystająca z generatora sprawdzianów i każda uczelnia stawiająca własną instancję na kodzie MIT. Skąd na to pieniądze: slajd " + ref("money") + "."),
]
rw = (W - 2 * M - 2 * 28) // 3
for i, (t, d) in enumerate(rings):
    x = M + i * (rw + 28)
    card(p, x, 554, rw, 260)
    text(p, x + 28, 576, rw - 56, 44, t, 24, TEAL, bold=True)
    text(p, x + 28, 624, rw - 56, 180, d, 21, BODY, factor=1.35)
text(p, M, 840, W - 2 * M, 90, "Jasne granice: w 2027 nie obsługujemy dzieci poniżej 12. roku życia inaczej niż przez zweryfikowane konto rodzica. Odpowiednie pasmo istnieje w bazie, "
     "ale w tym wniosku nie obiecujemy dedykowanego produktu dla najmłodszych.", 21, MUTED, factor=1.3)

# 14 — milestones
p = slide("14 Kamienie milowe", key="milestones")
head(p, "Harmonogram i wskaźniki sukcesu", "Twarde kamienie milowe, zero mydlenia oczu")
ms = [
    ("Koniec 2026", ["300 aktywnych studentów UW w sesji zimowej, w tym 30 z własnym rozwiązaniem w bazie (także wypracowanym z AI)",
                     "30 pogłębionych wywiadów i testów użyteczności", "pierwsza wersja kursu finansów osobistych",
                     "zrekrutowany trzon zespołu recenzentów: 6 doktorantów i asystentów, pierwsi emerytowani wykładowcy",
                     "fundacja wpisana do KRS (akt notarialny we wrześniu, wniosek w październiku 2026); pierwszy rok obrotowy zamknięty 31.12.2026"]),
    ("Lato 2027", ["500 w pełni rozwiązanych zadań z matury rozszerzonej", "pilotaż seniorów w pierwszym mieście: 10 uczestników w trzech rolach",
                   "sprawozdanie fundacji za 2026 zatwierdzone; pierwsze wnioski o mikrogranty (FERS 05.01, Fundacja PFR) złożone",
                   "wersja testowa podpowiedzi AI i generatora sprawdzianów w 2 liceach"]),
    ("Koniec 2027", ["5 000 zarejestrowanych kont, 3 000 opracowanych zadań, 3 uczelnie", "30 aktywnych seniorów w 3 miastach, retencja po 3 miesiącach co najmniej 60%",
                     "pierwszy mikrogrant w realizacji; pierwszy partner CSR modułu finansowego",
                     "10 szkół aktywnie korzystających z generatora sprawdzianów"]),
]
mw = (W - 2 * M - 2 * 40) // 3
p.cell(M + 30, 300, W - 2 * M - 60, 4, "rounded=0;whiteSpace=wrap;html=1;fillColor=" + LINE + ";strokeColor=none;")
for i, (t, items) in enumerate(ms):
    x = M + i * (mw + 40)
    p.cell(x + 30 - 14, 290, 28, 28, "ellipse;whiteSpace=wrap;html=1;fillColor=" + TEAL + ";strokeColor=#ffffff;strokeWidth=3;")
    text(p, x + 60, 274, mw - 60, 60, t, 30, INK, bold=True)
    card(p, x, 350, mw, 456)
    text(p, x + 28, 374, mw - 56, 420, ul(items, 9), 20, BODY, factor=1.32)
card(p, M, 826, W - 2 * M, 124, TEAL_LIGHT)
text(p, M + 32, 842, W - 2 * M - 64, 100, b("Mierniki efektywności:") + " liczba unikalnych użytkowników w sesji, średni czas recenzji nowego rozwiązania, odsetek zadań z certyfikatem weryfikacji (✓), "
     "retencja w grupie seniorów oraz liczba szkół partnerskich. Wszystkie parametry publikujemy co kwartał w ogólnodostępnym raporcie.", 22, INK, factor=1.35)

# 15 — risks
p = slide("15 Ryzyka", key="risks")
head(p, "Zarządzanie ryzykiem", "Co może pójść nie tak: analiza ryzyk bez lukrowania rzeczywistości")
risks = [
    ("Student w ferworze sesji nie ma ochoty na nowy serwis",
     "Przeciętny student w styczniu szuka drogi na skróty: gotowe PDF-y i czaty grupowe.",
     "Wchodzimy mailingiem prodziekanów ds. studenckich MIM i FUW do pracowników i studentów oraz przez osoby prowadzące ćwiczenia, które wstawiają odnośniki do konkretnych zadań. "
     "Pomaga prof. Andrzej Dragan. Dostęp do treści nie wymaga logowania, a „Mój zestaw” daje gotowy arkusz jednym kliknięciem.",
     "300 aktywnych kont w sesji zimowej oraz odsetek powracających w sesji letniej."),
    ("Student woli zostawić rozwiązanie z AI dla siebie",
     "Gotowiec z ChatGPT ląduje na dysku i tam przepada, często razem z ukrytym błędem logicznym.",
     "Prosta ścieżka „wklej rozwiązanie z czatu”: prompt i wynik trafiają do kolejki ze statusem „wspomagane przez AI, oczekuje na człowieka”. Recenzent sprawdza tok rozumowania, autor buduje reputację, "
     "prowadzący może nagrodzić wkład punktami. Student dostaje weryfikację, której bot mu nie da, a my przekształcamy halucynacje AI w sprawdzoną wiedzę.",
     "10% aktywnych zgłasza co najmniej jedno rozwiązanie (minimum 30 osób w pierwszej sesji); czas recenzji poniżej 7 dni."),
    ("Za mało chętnych seniorów lub zatory w recenzji",
     "Emerytowanych matematyków i fizyków jest niewielu, a długie oczekiwanie na akceptację zniechęca młodych.",
     "Trzy role zamiast jednej, rekrutacja poza UTW (ZNP, wydziały, licea), animator na pół etatu z telefonem w ciągu doby po 5 dniach ciszy, zadania do 20 minut, "
     "doktoranci i starsze roczniki z mailingu dziekanów jako bezpiecznik czasowy; status „czeka na recenzję” widoczny, nie ukryty.",
     "minimum 10 recenzentów merytorycznych po 3 miesiącach; retencja 60% po roku; kolejka recenzji poniżej 7 dni."),
    ("Spadek jakości i zalew błędnych rozwiązań przy wzroście skali",
     "Większy ruch to większa entropia, a w matematyce błąd w obliczeniach jest gorszy niż brak odpowiedzi.",
     "Automatyczna kwarantanna po zgłoszeniu przez 20% czytających (minimum 3 głosy), uprawnienia ograniczone do dziedzin, pełna historia zmian, premoderacja treści dziecięcych, "
     "algorytmiczne odsiewanie spamu. Znak weryfikacji pozostaje wynikiem twardych warunków logicznych.",
     "odsetek zadań ze statusem weryfikacji; zgłoszenia na 1 000 odsłon; mediana czasu reakcji moderatora."),
]
rw = (W - 2 * M - 24) // 2
for i, (t, what, how, metric) in enumerate(risks):
    x = M + (i % 2) * (rw + 24); y = 246 + (i // 2) * 336
    card(p, x, y, rw, 314)
    text(p, x + 28, y + 20, rw - 56, 44, t, 22, INK, bold=True, factor=1.15)
    text(p, x + 28, y + 64, rw - 56, 244, warm(b("Diagnoza.")) + " " + what + "<br>" + teal(b("Środki zaradcze.")) + " " + how + "<br>" + muted(b("Wskaźnik.") + " " + metric), 17, BODY, factor=1.32)
text(p, M, 920, W - 2 * M, 70, b("Najtwardszy warunek brzegowy:") + " jeśli podczas sesji zimowej nie osiągniemy progu 300 aktywnych studentów i 30 osób współtworzących bazę, nie będziemy pudrować rzeczywistości: "
     "napiszemy o tym otwarcie w publicznym raporcie w lutym 2027 r.", 20, MUTED, factor=1.3)

# 16 — budget
p = slide("16 Budżet", key="budget")
head(p, "Alokacja środków", "Struktura budżetu: 450 tys. zł na 15 miesięcy (grudzień 2026 – luty 2028)")
lines = [
    ("Rozbudowa i weryfikacja bazy merytorycznej: 1 500 nowych zadań (matura, I rok), wynagrodzenia recenzentów, kurs finansowy", 35, "157 tys. zł"),
    ("Prace programistyczne: podpowiedzi AI na zweryfikowanych danych, generator sprawdzianów, panel recenzencki dla seniorów", 25, "112 tys. zł"),
    ("Pilotaż międzypokoleniowy: 3 miasta, 30 seniorów, koordynator społeczności (½ etatu), rekrutacja z ZNP, UTW i uczelnią", 20, "90 tys. zł"),
    ("Zaplecze serwerowe, bezpieczeństwo i obsługa prawna: audyt kodu, księgowość i obsługa prawna fundacji, procedury RODO dla dzieci, wnioski grantowe", 10, "45 tys. zł"),
    ("Badania z użytkownikami: 60 wywiadów i testów w podziale na grupy wiekowe, dwie tury przed każdą większą publikacją", 5, "23 tys. zł"),
    ("Komunikacja i społeczność: wspólne działania z prof. Andrzejem Draganem, warsztaty na UW i w liceach partnerskich", 5, "23 tys. zł"),
]
y = 256
for label, pct, amount in lines:
    bar(p, M, y, 560, label, pct, amount, fill=WARM if "międzypokoleniowy" in label else TEAL)
    y += 92
card(p, M, 820, W - 2 * M, 130, CARD)
text(p, M + 32, 836, W - 2 * M - 64, 100, "Przy nagrodzie 300 lub 200 tys. zł skalujemy wydatki proporcjonalnie, ale " + b("nienaruszalną zasadą pozostaje 20% budżetu na działania z seniorami") +
     ". Dostęp do bazy zadań i kursów pozostaje bezwarunkowo darmowy. Nie wydajemy ani grosza z grantu na płatne reklamy ani na funkcje spoza trzech wyznaczonych celów.", 22, BODY, factor=1.35)

# 17 — ask
p = slide("17 Czego potrzebujemy", key="ask")
head(p, "Synergia i samowystarczalność", "Czego oczekujemy od ING i co ING zyskuje dzięki nam")
cw = (W - 2 * M - 28) // 2
card(p, M, 250, cw, 500)
text(p, M + 32, 274, cw - 64, 50, "Czego potrzebujemy", 27, TEAL, bold=True)
text(p, M + 32, 330, cw - 64, 410, ul([
    b("Wsparcia finansowego:") + " grant na realizację przedstawionego harmonogramu.",
    b("Wsparcia merytorycznego:") + " konsultacje w zakresie wyceny modelu abonamentowego dla szkół, strukturyzacji fundacji z działalnością gospodarczą oraz umów prawnoautorskich.",
    b("Dojścia do sieci kontaktów:") + " placówki edukacyjne, struktury UTW i ZNP, firmy z portfela grupy ING szukające rzetelnych szkoleń analitycznych dla kadr.",
    b("Nagłośnienia projektu:") + " obecność w kanałach komunikacji ING. Z naszej strony: Wydział Fizyki UW i prof. Andrzej Dragan.",
], 10), 21, BODY, factor=1.33)
x2 = M + cw + 28
card(p, x2, 250, cw, 500, TEAL_LIGHT)
text(p, x2 + 32, 274, cw - 64, 50, "Co zyskuje ING", 27, TEAL, bold=True)
text(p, x2 + 32, 330, cw - 64, 410, ul([
    b("Prawdziwą edukację finansową bez posmaku marketingu:") + " rzetelny kurs i zbiór zadań obliczeniowych, współtworzony przez młodych ekonomistów i seniorów.",
    b("Realną integrację międzypokoleniową:") + " jedno narzędzie łączące ucznia, rodzica (w tym pracownika banku) i dziadka we wspólnej, pożytecznej aktywności.",
    b("Twarde, weryfikowalne rezultaty:") + " kwartalne, jawne raportowanie wskaźników ze slajdu " + ref("milestones") + ".",
    b("Rolę partnera strategicznego ścieżki finansowej:") + " mecenat merytoryczny oparty na zaufaniu i nazwisku recenzenta, a nie ekspozycja logotypu.",
], 10), 21, BODY, factor=1.33)
card(p, M, 776, W - 2 * M, 176, WARM_LIGHT)
text(p, M + 32, 792, W - 2 * M - 64, 150, b("Model finansowy po wygaśnięciu grantu:") + " dostęp do wiedzy pozostanie bezpłatny. Nie planujemy zarabiać na hostingu dla szkół ani pobierać prowizji od korepetycji. "
     "Trzy filary, z kwotami na następnym slajdzie: " + b("(1)") + " mecenat i programy CSR partnerów technologicznych i finansowych; " + b("(2)") + " granty publiczne na kompetencje cyfrowe i integrację "
     "międzypokoleniową, w kolejności, w jakiej młoda fundacja może po nie sięgać; " + b("(3)") + " generator sprawdzianów w modelu freemium, wyceniony tak, by mieścił się w zakupie bezpośrednim dyrektora szkoły.", 21, INK, factor=1.36)

# 18 — post-grant money, in numbers (from the funding, EdTech-procurement and senior research of 16.09)
p = slide("18 Skąd pieniądze", key="money")
head(p, "Utrzymanie, w liczbach", "Skąd pieniądze po grancie: mapa, nie życzenie")
money = [
    ("Granty publiczne, w kolejności dostępności", TEAL_LIGHT, TEAL, [
        "inkubatory innowacji społecznych FERS 05.01: mikrogranty 50–120 tys. zł (do 300 tys. na skalowanie), 100% finansowania, bez wymogu historii obrotów; pierwszy krok młodej fundacji, nabory 2026–2027",
        "programy MEN (np. „Odkrywcy”): 50 tys.–1 mln zł, 100% finansowania, nabory wiosną",
        "NIW: NOWEFIO do 200 tys. zł; Erasmus+ KA210: 30 lub 60 tys. EUR bez wymogu stażu",
        "duże nabory FERS 01.04/01.08 i NCBR (1,5–6 mln zł): tylko w konsorcjum z UW jako liderem (art. 39 ustawy wdrożeniowej), bo młoda fundacja nie wykaże obrotu"]),
    ("Darowizny, mecenat, fundacje korporacyjne", WARM_LIGHT, WARM, [
        "darowizny od osób i firm od dnia wpisu fundacji do KRS: darczyńca odlicza je od dochodu (do 6% w PIT, do 10% w CIT); status OPP nie jest do tego potrzebny",
        "Fundacja PFR: 15–50 tys. zł na edukację ekonomiczną i włączenie cyfrowe, bez wkładu własnego",
        "Fundacja Empiria i Wiedza (BGK): 20–100 tys. zł na STEAM i narzędzia dydaktyczne",
        "Fundacja Orange: mikrogranty na higienę cyfrową i AI w szkole; mPotęga Fundacji mBanku: narzędzia do nauki matematyki",
        "ING jako partner strategiczny ścieżki finansowej: mecenat, nie reklama"]),
    ("Freemium dla szkół, wyceniony pod realia zakupów", CARD, INK, [
        "licencja dla nauczyciela 80–250 zł rocznie: płaci szkoła z bieżących środków albo nauczyciel sam",
        "licencja szkolna 3–8 tys. zł rocznie: poniżej progu 20 tys. zł netto, więc dyrektor kupuje z wolnej ręki (§ 4300, wydatek bieżący)",
        "rada rodziców nie podpisuje umów: może sfinansować licencję darowizną celową na rachunek szkoły; umowę i powierzenie danych (RODO) podpisuje dyrektor",
        "„Cyfrowy Uczeń 2025–2029”: moduł narzędziowy finansuje licencje w 80% z budżetu państwa; warunki: zgodność z ZPE i gotowa umowa powierzenia danych"]),
]
cw3 = (W - 2 * M - 2 * 24) // 3
for i, (t, fill, col, items) in enumerate(money):
    x = M + i * (cw3 + 24)
    card(p, x, 250, cw3, 580, fill)
    text(p, x + 26, 272, cw3 - 52, 70, t, 22, col, bold=True, factor=1.15)
    text(p, x + 26, 344, cw3 - 52, 480, ul(items, 8), 17, BODY, factor=1.3)
text(p, M, 848, W - 2 * M, 130, b("Warunki brzegowe:") + " fundację zakładamy od razu, nie po grancie: akt notarialny we wrześniu 2026, wniosek do KRS w październiku, pierwszy rok obrotowy zamknięty 31.12.2026. "
     "Od dnia wpisu przyjmuje darowizny i składa wnioski o mikrogranty; dwuletni staż potrzebny do statusu OPP (1,5% podatku) i do koordynacji Erasmus+ KA220 biegnie od wpisu, więc liczy się każdy miesiąc. "
     "Materiały metodyczne na CC BY-SA, kod na MIT, WCAG 2.1 AA: kryteria punktowane w FERS, które spełniamy albo spełnimy w grancie.", 19, MUTED, factor=1.3)

# 19 — team
p = slide("19 Zespół")
head(p, "Ludzie projektu", "Kto za tym stoi: zespół założycielski")
people = [
    ("Piotr Putyło", "PP", "lider projektu, twórca architektury i autor większości kodu; koordynuje prace od lipca 2026 r.", "student Wydziału Fizyki Uniwersytetu Warszawskiego"),
    ("Marysia Nazarczuk", "MN", "warstwa matematyczna: wprowadzenie, korekta formalna i recenzja całego zbioru 745 zadań", "matematyka: licencjat, II rok studiów magisterskich; studia licencjackie z fizyki i informatyki"),
    ("Marc Ploeg", "MP", "strategia rozwoju, modele organizacyjne i finansowe, łącznik ze światem biznesu", "wieloletnie doświadczenie we wdrażaniu innowacji; były juror konkursów start-upowych, w tym w programach ING"),
    ("dr hab. Katarzyna Grabowska", "KG", "naukowa opieka merytoryczna i kierownictwo badawcze projektu", "Katedra Metod Matematycznych Fizyki, Wydział Fizyki UW"),
]
pw = (W - 2 * M - 3 * 24) // 4
for i, (n, ini, r, a) in enumerate(people):
    x = M + i * (pw + 24)
    card(p, x, 250, pw, 440)
    p.cell(x + 28, 278, 96, 96, "ellipse;whiteSpace=wrap;html=1;fillColor=" + TEAL_LIGHT + ";strokeColor=none;fontFamily=" + FONT + ";fontSize=34;fontStyle=1;fontColor=" + TEAL + ";", ini)
    text(p, x + 28, 390, pw - 56, 64, b(n), 22, INK, factor=1.15)
    text(p, x + 28, 454, pw - 56, 112, r, 18, BODY, factor=1.3)
    text(p, x + 28, 570, pw - 56, 110, muted(a), 17, factor=1.3)
text(p, M, 712, W - 2 * M, 40, teal(b("WSPÓŁPRACA I WSPARCIE MERYTORYCZNE")), 18)
sup = [
    ("prof. Andrzej Dragan", "potwierdzone wsparcie komunikacyjne w mediach społecznościowych; fizyk teoretyk z Wydziału Fizyki UW, czołowy polski popularyzator nauki"),
    ("Natalia Prus", "opracowanie ścieżki finansowej i przedsiębiorczości; koordynacja merytoryczna sekcji „Finanse osobiste”"),
]
sw_ = (W - 2 * M - 28) // 2
for i, (n, d) in enumerate(sup):
    x = M + i * (sw_ + 28)
    card(p, x, 750, sw_, 118, TEAL_LIGHT)
    text(p, x + 28, 766, sw_ - 56, 40, b(n), 22, INK)
    text(p, x + 28, 802, sw_ - 56, 62, d, 18, BODY, factor=1.3)
text(p, M, 886, W - 2 * M, 110, "Zespół łączy akademicki rygor matematyczno-fizyczny (odpowiedzialność za treści), solidne rzemiosło programistyczne (działający serwis z testami) "
     "oraz pragmatyczny zmysł biznesowy. Brakujące ogniwo, animatora osób starszych, nazywamy otwarcie i zabezpieczamy na nie środki w budżecie. "
     "Formalnym wnioskodawcą jest Piotr Putyło jako Młody Naukowiec reprezentujący cały zespół.", 20, MUTED, factor=1.33)

# 20 — call to action
p = slide("20 Zaproszenie", key="cta")
head(p, "Otwarte zaproszenie", "Co możesz zrobić już dziś, zanim zapadną jakiekolwiek decyzje grantowe")
ctas = [
    ("Studencie", "Wejdź na edmat.net i spróbuj rozwiązać dowolne zadanie. Jeśli polegniesz, napisz w dyskusji. Jeśli pomógł ci bot, wklej ten dialog: człowiek sprawdzi rachunki, a ty dostaniesz potwierdzenie wkładu.", "edmat.net"),
    ("Prowadzący i doktorancie", "Obejmij opieką swój przedmiot. Zamień PDF z zadaniami na kolokwium w interaktywny zestaw i recenzuj rozwiązania swoich studentów w cywilizowanych warunkach.", "jedna krótka wiadomość do nas"),
    ("Emerytowany nauczycielu, seniorze", "Pomóż nam weryfikować zadania, sprawdzaj, czy teksty są zrozumiałe dla laika, współtwórz dział bezpieczeństwa finansowego. Duża czcionka, zero instalowania, zero reklam.", "warsztat w UTW albo kontakt"),
    ("Dyrektorze szkoły", "Dołącz do pilotażu generatora sprawdzianów ze zweryfikowanym kluczem odpowiedzi (start w 2027 r.). Szukamy pierwszych dwóch odważnych liceów.", "zgłoś swoją placówkę"),
    ("Przedstawicielu uczelni", "Pobierz kod na licencji MIT i uruchom własne środowisko. Integracja z uczelnianym USOS wymaga jedynie konfiguracji kluczy dostępowych.", "udostępnij nam dane testowe USOS"),
    ("Partnerze biznesowy, zespole ING", "Obejmijcie mecenatem ścieżkę edukacji finansowej: przestrzeń wiedzy weryfikowanej z matematyczną precyzją, podpisanej autorytetem recenzentów, a nie sloganami.", "porozmawiajmy o konkretach"),
]
cw3 = (W - 2 * M - 2 * 24) // 3
for i, (who, what, act) in enumerate(ctas):
    x = M + (i % 3) * (cw3 + 24); y = 250 + (i // 3) * 300
    card(p, x, y, cw3, 276)
    text(p, x + 28, y + 22, cw3 - 56, 44, who, 24, TEAL, bold=True)
    text(p, x + 28, y + 70, cw3 - 56, 156, what, 19, BODY, factor=1.35)
    text(p, x + 28, y + 226, cw3 - 56, 40, warm(b("→ " + act)), 20)
card(p, M, 862, W - 2 * M, 96, TEAL_LIGHT)
text(p, M + 32, 878, W - 2 * M - 64, 70, b("Kontakt bezpośredni:") + " Piotr Putyło · p.putylo@student.uw.edu.pl · edmat.net · kod źródłowy: github.com/tryingtodosth/edmat (licencja MIT); każdy wartościowy pull request jest mile widziany.", 21, INK, factor=1.3)

# 21 — sources and tools (Claude first)
p = slide("21 Źródła i narzędzia", key="sources")
head(p, "Transparentność i metodologia", "Źródła danych i warsztat narzędziowy")
lw = 820
card(p, M, 250, lw, 286, TEAL_LIGHT)
text(p, M + 28, 268, lw - 56, 40, "1. Asysta sztucznej inteligencji: Claude (Anthropic)", 23, TEAL, bold=True)
text(p, M + 28, 310, lw - 56, 220, "Platforma powstała przy aktywnym udziale agentów Claude Code: równoległa praca na gałęziach repozytorium, przejrzyste tablice zadań i dynamiczny plan rozwoju. "
     "Każda nowa funkcja musiała przejść test regresji oraz weryfikację zachowania w przeglądarce. Ta prezentacja i odpowiedzi do formularza powstały przy wsparciu Claude, "
     "natomiast każdą podaną liczbę zweryfikował w źródłach człowiek. Zasada jest prosta: algorytm szkicuje, człowiek i testy automatyczne weryfikują. Tę samą regułę stosujemy w produkcie.", 18, BODY, factor=1.35)
card(p, M, 552, lw, 160)
text(p, M + 28, 570, lw - 56, 40, "2. Otwarte technologie", 22, INK, bold=True)
text(p, M + 28, 610, lw - 56, 96, "Django i Django REST Framework, SvelteKit ze Svelte 5, KaTeX, Paraglide, Tiptap, Leaflet, OpenStreetMap i Nominatim, DOMPurify, bleach, Playwright, ClamAV, Redis, "
     "django-postman, PDF.js. Całość na sprawdzonych licencjach open source; nasz kod udostępniamy na licencji MIT.", 17, BODY, factor=1.35)
card(p, M, 728, lw, 220)
text(p, M + 28, 746, lw - 56, 40, "3. Niezależne recenzje i raporty robocze", 22, INK, bold=True)
text(p, M + 28, 786, lw - 56, 156, "Przegląd krytyczny w roli kapituły konkursowej wykonany z użyciem modelu Gemini (Google), 16.09.2026; odpowiedzi na jego uwagi na slajdzie " + ref("risks") + ". "
     "Trzy raporty robocze przygotowane z użyciem Gemini tego samego dnia: finansowanie edukacji 2026–2028, zakupy oprogramowania w szkołach publicznych, retencja seniorów w wolontariacie cyfrowym. "
     "Konsultacje strategiczne z Markiem Ploegiem, 11.09.2026.", 17, BODY, factor=1.35)
rx = M + lw + 28; rw = W - M - rx
card(p, rx, 250, rw, 698)
text(p, rx + 28, 270, rw - 56, 40, "Baza danych statystycznych i regulacyjnych", 23, TEAL, bold=True)
text(p, rx + 28, 318, rw - 56, 620, ul([
    b("Główny Urząd Statystyczny:") + " Szkolnictwo wyższe w roku akademickim 2025/2026 (1 322,8 tys. studentów).",
    b("Centralna Komisja Egzaminacyjna:") + " podsumowanie egzaminu maturalnego 2026 (321 314 zdających).",
    b("Główny Urząd Statystyczny:") + " Informacja o sytuacji osób starszych w Polsce za 2024 r. (blisko 10 mln osób 60+, 26,6% społeczeństwa).",
    b("Główny Urząd Statystyczny:") + " Uniwersytety trzeciego wieku w roku akademickim 2024/2025 (747 jednostek, 125,9 tys. słuchaczy).",
    b("ING Bank Śląski:") + " Regulamin 9. edycji Programu Grantowego ING (obowiązujący od 8 lipca 2026 r.).",
    b("Rada Ministrów:") + " rozporządzenie z 17.09.2025 w sprawie programu „Cyfrowy Uczeń 2025–2029”; dokumentacja programu FERS 2021–2027 (Działania 01.04, 01.08, 05.01): kwoty na slajdzie " + ref("money") + ".",
    b("Repozytorium i API produkcyjne edmat.net") + " (16.09.2026): 745 zadań, 742 zweryfikowane, 9 materiałów; 1 441 testów backendu, 46 scenariuszy e2e (1 314 sprawdzeń), 2 094 komunikaty w dwóch językach.",
], 10), 17, BODY, factor=1.35)

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
