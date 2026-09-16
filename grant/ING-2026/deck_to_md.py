#!/usr/bin/env python3
"""Exports every slide's text from EdMat-ING-2026.drawio to Markdown (plus the form answers), so the
whole application can be pasted into another model for review.

    python3 deck_to_md.py            -> EdMat-ING-2026-tekst.md

Reads the .drawio, not build_deck.py, so it reflects edits made by hand in draw.io too.
"""
import html, pathlib, re, sys
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).resolve().parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "EdMat-ING-2026.drawio"
dst = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "EdMat-ING-2026-tekst.md"

FOOTER = re.compile(r"^EdMat\.net · Program Grantowy|^\d+ / \d+$")

def to_md(value: str) -> str:
    s = value
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<li[^>]*>", "\n- ", s, flags=re.I)
    s = re.sub(r"</li>", "", s, flags=re.I)
    s = re.sub(r"</?ul[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"</?b>", "**", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

root = ET.parse(src).getroot()
out = ["# EdMat.net — zgłoszenie do Programu Grantowego ING „W rytmie pokoleń” (9. edycja, Liga Seed)",
       "", f"Tekst wszystkich slajdów wyeksportowany z `{src.name}`, a po nim odpowiedzi z formularza. "
       "Wygenerowane przez `deck_to_md.py`.", "", "---", "", "# Część 1 — prezentacja", ""]
pages = root.findall("diagram")
for n, diagram in enumerate(pages, 1):
    name = diagram.get("name", f"{n}")
    cells = []
    for cell in diagram.iter("mxCell"):
        v = cell.get("value") or ""
        style = cell.get("style") or ""
        if not v.strip() or "ellipse" in style or "shape=image" in style:
            continue
        t = to_md(v)
        if not t or FOOTER.match(t):
            continue
        cells.append((t, style))
    if not cells:
        continue
    texts = [t for t, _ in cells]
    kicker = texts[0] if texts and texts[0].isupper() else None
    title_idx = 1 if kicker else 0
    title = texts[title_idx].replace("\n", " ") if len(texts) > title_idx else name
    body = texts[title_idx + 1:]
    out.append(f"## Slajd {n} — {title}")
    if kicker:
        out.append(f"*{kicker}*")
    out.append("")
    # the competition table: header cells KTO / CO DAJE / CZEGO NIE DAJE followed by rows of three
    if "KTO" in body and "CO DAJE" in body:
        i = body.index("KTO")
        pre, rest = body[:i], body[i + 3:]
        rows, tail = [], []
        while len(rest) >= 3 and not rest[0].startswith("**Tylko EdMat"):
            rows.append(rest[:3]); rest = rest[3:]
        tail = rest
        for t in pre:
            out.append(t); out.append("")
        out.append("| Kto | Co daje | Czego nie daje |"); out.append("|---|---|---|")
        for a, b, c in rows:
            out.append(f"| {a} | {b} | {c} |")
        out.append("")
        body = tail
    for t in body:
        out.append(t)
        out.append("")
    out.append("---")
    out.append("")

form = (HERE / "formularz.md").read_text(encoding="utf-8")
out.append("# Część 2 — odpowiedzi w formularzu zgłoszeniowym")
out.append("")
out.append(form.split("\n", 1)[1].strip() if form.startswith("# ") else form.strip())
dst.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
print(f"wrote {dst.name}: {len(pages)} slides, {dst.stat().st_size // 1024} KB")
