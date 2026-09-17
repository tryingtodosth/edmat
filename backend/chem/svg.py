"""Making an SVG safe enough to serve from `/media/`.

An SVG is a document, not a picture: it can carry `<script>`, event handlers, `<foreignObject>`
holding arbitrary HTML, and references (`href`, `<use>`, `<image>`, CSS `url()`) that reach out to
other origins or into the same one. Inside an `<img>` tag none of that runs, but a file under
`/media/` is also a URL somebody can open directly — same-origin with the app, where a script
could read the token in localStorage. The Apache hardening serves `/media/` as an attachment,
which closes that in production; the dev server does not, and a sanitizer that only mattered on
one of the two is not one. So every SVG is rebuilt from an allowlist before it is stored.

What is kept: geometry, text, grouping, gradients, clip paths and markers — everything Indigo's
renderer (behind Ketcher's `generateImage`) emits for a structure. What is dropped: any element
not on the list (so `script`, `foreignObject`, `image`, `a`, `use`, `animate*`, `set`), any
attribute starting with `on`, any `href`/`xlink:href` that is not a same-document `#fragment`,
and any `style` attribute or `<style>` element that mentions `url(`, `@import`, `expression(`
or `javascript:`. A DOCTYPE or an entity declaration is refused outright rather than parsed
(that is the billion-laughs shape, and a structure drawing never needs one).

`xml.etree` rather than a dependency: with entities refused up front, expat's remaining
surface is the document itself, and the output is rebuilt element by element, so nothing that
was not explicitly copied can survive.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from django.core.exceptions import ValidationError

SVG_NS = 'http://www.w3.org/2000/svg'
XLINK_NS = 'http://www.w3.org/1999/xlink'

MAX_SVG_BYTES = 2 * 1024 * 1024

ALLOWED_ELEMENTS = frozenset(
    {
        'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'marker', 'clipPath', 'mask',
        'linearGradient', 'radialGradient', 'stop', 'pattern',
        'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
        'text', 'tspan', 'textPath', 'style',
    }
)

# Attribute names allowed on any kept element. Presentation attributes are the bulk of it;
# `href` is handled separately (fragment-only), `style` and `class` are checked, `id` is kept
# so gradients and clip paths still resolve.
ALLOWED_ATTRIBUTES = frozenset(
    {
        'id', 'class', 'style', 'transform', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1',
        'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'rotate',
        'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
        'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
        'stroke-miterlimit', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
        'text-anchor', 'dominant-baseline', 'alignment-baseline', 'letter-spacing',
        'word-spacing', 'text-decoration', 'clip-path', 'clip-rule', 'mask', 'marker-start',
        'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
        'markerUnits', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'offset',
        'stop-color', 'stop-opacity', 'patternUnits', 'patternTransform', 'preserveAspectRatio',
        'overflow', 'visibility', 'display', 'vector-effect', 'shape-rendering', 'text-rendering',
        'xml:space', 'version', 'baseProfile', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
        'startOffset', 'lengthAdjust', 'textLength', 'paint-order', 'color',
    }
)

_DANGEROUS_CSS = re.compile(r'url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:', re.I)
_FORBIDDEN_PROLOGUE = re.compile(r'<!DOCTYPE|<!ENTITY', re.I)


def _local(tag: str) -> tuple[str, str]:
    """Split an ElementTree `{ns}name` tag into (namespace, name)."""
    if tag.startswith('{'):
        ns, _, name = tag[1:].partition('}')
        return ns, name
    return '', tag


def _safe_style(value: str) -> bool:
    return not _DANGEROUS_CSS.search(value or '')


def sanitize_svg(raw: str) -> str:
    """Return a rebuilt SVG document containing only allowlisted content, or raise
    ValidationError when the input is not an SVG at all."""
    if not raw or len(raw.encode('utf-8', 'ignore')) > MAX_SVG_BYTES:
        raise ValidationError('The SVG is missing or too large.')
    if _FORBIDDEN_PROLOGUE.search(raw):
        raise ValidationError('An SVG with a DOCTYPE or entity declaration is not accepted.')
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise ValidationError(f'Not a well-formed SVG: {e}') from e
    ns, name = _local(root.tag)
    if name != 'svg' or ns not in ('', SVG_NS):
        raise ValidationError('The root element is not <svg>.')

    ET.register_namespace('', SVG_NS)
    ET.register_namespace('xlink', XLINK_NS)
    clean_root = _rebuild(root)
    if clean_root is None:
        raise ValidationError('Nothing of the SVG survived sanitizing.')
    clean_root.set('xmlns', SVG_NS)
    return ET.tostring(clean_root, encoding='unicode')


def _rebuild(el: ET.Element) -> ET.Element | None:
    ns, name = _local(el.tag)
    if ns not in ('', SVG_NS) or name not in ALLOWED_ELEMENTS:
        return None
    out = ET.Element(name)
    for key, value in el.attrib.items():
        attr_ns, attr_name = _local(key)
        if attr_name.lower().startswith('on'):
            continue
        if attr_name == 'href':
            # Same-document references only (a gradient, a clip path, a text path).
            if attr_ns in ('', XLINK_NS) and value.startswith('#'):
                out.set('href', value)
            continue
        if attr_ns == 'http://www.w3.org/XML/1998/namespace' and attr_name == 'space':
            out.set('xml:space', value)
            continue
        if attr_ns not in ('', SVG_NS):
            continue
        if attr_name not in ALLOWED_ATTRIBUTES:
            continue
        if attr_name == 'style' and not _safe_style(value):
            continue
        out.set(attr_name, value)
    if name == 'style':
        if not _safe_style(el.text or ''):
            return None
        out.text = el.text
    elif el.text:
        out.text = el.text
    for child in el:
        rebuilt = _rebuild(child)
        if rebuilt is not None:
            out.append(rebuilt)
            rebuilt.tail = child.tail
    return out


def svg_size(svg: str) -> tuple[int, int]:
    """Best-effort intrinsic size from `width`/`height` or the viewBox — for the `width`/`height`
    columns a layout can reserve space with. 0 when unknown."""
    try:
        root = ET.fromstring(svg)
    except ET.ParseError:
        return 0, 0

    def num(value: str | None) -> int:
        if not value:
            return 0
        m = re.match(r'\s*([0-9]+(?:\.[0-9]+)?)', value)
        return int(float(m.group(1))) if m else 0

    w, h = num(root.get('width')), num(root.get('height'))
    if not (w and h):
        parts = (root.get('viewBox') or '').replace(',', ' ').split()
        if len(parts) == 4:
            w, h = num(parts[2]), num(parts[3])
    return w, h
