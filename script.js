/*
 * Philographics engine — v0.1
 * ---------------------------------------------------------------
 * The whole system rests on ONE idea: a "design spec" (plain JSON).
 *
 *   - Today: WE hand-write the spec.
 *   - Later: the AI writes the exact same spec.
 *   - Either way: renderSpec() below turns it into a poster.
 *
 * So this file has two parts:
 *   1) THE RENDERER  — reads a spec, draws SVG. Knows a CLOSED set
 *                      of shapes. If it's not here, it can't be drawn.
 *   2) THE SPECS     — hand-authored recreations of Carreras posters,
 *                      used to prove the grammar works.
 * =============================================================== */

/* ---------- 1) THE RENDERER ------------------------------------ */

// The poster's internal coordinate system: 100 wide, 133 tall (a 3:4 poster).
const VIEW_W = 100;
const VIEW_H = 133;

// Small helpers that each return an SVG element as a string.
const draw = {
  circle: (e) =>
    `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" fill="${e.fill}" opacity="${e.opacity ?? 1}"/>`,

  ring: (e) =>
    `<circle cx="${e.cx}" cy="${e.cy}" r="${e.r}" fill="none" stroke="${e.stroke}" stroke-width="${e.strokeWidth ?? 2}" opacity="${e.opacity ?? 1}"/>`,

  ellipse: (e) =>
    `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" fill="${e.fill}" opacity="${e.opacity ?? 1}" transform="rotate(${e.rotation ?? 0} ${e.cx} ${e.cy})"/>`,

  rect: (e) => {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    return `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="${e.fill}" opacity="${e.opacity ?? 1}" transform="rotate(${e.rotation ?? 0} ${cx} ${cy})"/>`;
  },

  line: (e) =>
    `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.stroke}" stroke-width="${e.strokeWidth ?? 2}" stroke-linecap="${e.cap ?? "butt"}" opacity="${e.opacity ?? 1}"/>`,

  // Equilateral triangle by center + size, pointing up at rotation 0.
  // rotation:180 flips it to point down (that's how meaning changes!).
  triangle: (e) => {
    const pts = [0, 1, 2]
      .map((k) => {
        const angle = ((-90 + k * 120 + (e.rotation ?? 0)) * Math.PI) / 180;
        const px = e.cx + e.size * Math.cos(angle);
        const py = e.cy + e.size * Math.sin(angle);
        return `${round(px)},${round(py)}`;
      })
      .join(" ");
    return `<polygon points="${pts}" fill="${e.fill}" opacity="${e.opacity ?? 1}"/>`;
  },

  // BOOLEAN SUBTRACT: a disc with a bite removed.
  // This is the "operation" behind Solipsism. It's impossible with the
  // shapes above, so it needs its own renderer entry.
  //
  // How it works: we draw ONE path made of two circles, and use
  // fill-rule "evenodd". That rule fills a region only if it's inside
  // an ODD number of subpaths. The outer disc (1 = odd) fills; the
  // overlap of both circles (2 = even) stays empty — so the inner
  // circle becomes a hole, and the background shows through it.
  // (Keep the cut circle fully inside the disc for a clean bite.)
  crescent: (e) => {
    const outer = circlePath(e.cx, e.cy, e.r);
    const cut = circlePath(e.cutCx, e.cutCy, e.cutR);
    return `<path d="${outer} ${cut}" fill-rule="evenodd" fill="${e.fill}" opacity="${e.opacity ?? 1}"/>`;
  },

  // A plus / cross drawn as ONE 12-point polygon, so it can take a
  // single clean outline (stroke). Built from a center, an arm length
  // (size = center to tip) and a half-thickness. Two crossing rects
  // can't do this — their overlap would show seams inside the outline.
  cross: (e) => {
    const { cx, cy, size: s, thickness: t } = e;
    const pts = [
      [cx - t, cy - s], [cx + t, cy - s], [cx + t, cy - t],
      [cx + s, cy - t], [cx + s, cy + t], [cx + t, cy + t],
      [cx + t, cy + s], [cx - t, cy + s], [cx - t, cy + t],
      [cx - s, cy + t], [cx - s, cy - t], [cx - t, cy - t],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(" ");
    const stroke = e.stroke
      ? ` stroke="${e.stroke}" stroke-width="${e.strokeWidth ?? 2}" stroke-linejoin="round"`
      : "";
    return `<polygon points="${pts}" fill="${e.fill}" opacity="${e.opacity ?? 1}"${stroke}/>`;
  },

  // Vesica piscis: the lens formed by two equal circles stacked
  // vertically (the Dualism overlap). cx + y1/y2 are the two centers.
  lens: (e) => {
    const d = e.y2 - e.y1;
    const h = Math.sqrt(Math.max(0, e.r * e.r - (d / 2) * (d / 2)));
    const mid = (e.y1 + e.y2) / 2;
    const x1 = e.cx - h;
    const x2 = e.cx + h;
    return `<path d="M ${round(x1)} ${round(mid)} A ${e.r} ${e.r} 0 0 1 ${round(x2)} ${round(mid)} A ${e.r} ${e.r} 0 0 1 ${round(x1)} ${round(mid)} Z" fill="${e.fill}" opacity="${e.opacity ?? 1}"/>`;
  },
};

// A full circle written as an SVG path (two half-arcs). We need the path
// form so several circles can share one <path> for boolean operations.
function circlePath(cx, cy, r) {
  return `M ${round(cx - r)} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// Title + description are an HTML overlay. Nothing in the SVG may
// paint there — black-on-black (or any low contrast) makes the words
// unreadable. The band is measured from the real overlay; this is
// only the fallback before the page has a size.
const TITLE_SAFE_FALLBACK = 44;
const ART_PAD_X = 2;
const ART_PAD_BOTTOM = 3;

function box(x, y, w, h) {
  return { x, y, w, h };
}

function rotatedRectBox(cx, cy, w, h, deg) {
  const rad = ((deg ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const nw = w * cos + h * sin;
  const nh = w * sin + h * cos;
  return box(cx - nw / 2, cy - nh / 2, nw, nh);
}

function elementBounds(e) {
  switch (e.shape) {
    case "circle":
      return box(e.cx - e.r, e.cy - e.r, e.r * 2, e.r * 2);
    case "ring": {
      const r = e.r + (e.strokeWidth ?? 2) / 2;
      return box(e.cx - r, e.cy - r, r * 2, r * 2);
    }
    case "ellipse":
      return rotatedRectBox(e.cx, e.cy, e.rx * 2, e.ry * 2, e.rotation);
    case "rect":
      return rotatedRectBox(e.x + e.w / 2, e.y + e.h / 2, e.w, e.h, e.rotation);
    case "line": {
      const pad = (e.strokeWidth ?? 2) / 2;
      return box(
        Math.min(e.x1, e.x2) - pad,
        Math.min(e.y1, e.y2) - pad,
        Math.abs(e.x2 - e.x1) + pad * 2,
        Math.abs(e.y2 - e.y1) + pad * 2
      );
    }
    case "triangle": {
      const pts = [0, 1, 2].map((k) => {
        const a = ((-90 + k * 120 + (e.rotation ?? 0)) * Math.PI) / 180;
        return [e.cx + e.size * Math.cos(a), e.cy + e.size * Math.sin(a)];
      });
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return box(
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys)
      );
    }
    case "crescent":
      return box(e.cx - e.r, e.cy - e.r, e.r * 2, e.r * 2);
    case "cross":
      return box(e.cx - e.size, e.cy - e.size, e.size * 2, e.size * 2);
    case "lens": {
      const h = Math.sqrt(
        Math.max(0, e.r * e.r - ((e.y2 - e.y1) / 2) ** 2)
      );
      return box(e.cx - h, Math.min(e.y1, e.y2), h * 2, Math.abs(e.y2 - e.y1));
    }
    default:
      return null;
  }
}

function unionBox(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const b of valid) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// If art enters the title band (or runs off the page), scale it down
// and sit it in the open field. Posters that already respect the band
// are left alone.
function artFitTransform(elements, safeTop) {
  const bbox = unionBox((elements ?? []).map(elementBounds));
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return "";
  const safe = {
    x: ART_PAD_X,
    y: safeTop,
    w: VIEW_W - ART_PAD_X * 2,
    h: VIEW_H - safeTop - ART_PAD_BOTTOM,
  };
  if (safe.h < 16) return "";
  const overflows =
    bbox.y < safe.y - 0.5 ||
    bbox.y + bbox.h > safe.y + safe.h + 0.5 ||
    bbox.x < -0.5 ||
    bbox.x + bbox.w > VIEW_W + 0.5;
  if (!overflows) return "";
  const scale = Math.min(1, safe.w / bbox.w, safe.h / bbox.h);
  const ox = safe.x + (safe.w - bbox.w * scale) / 2;
  const oy = safe.y + (safe.h - bbox.h * scale) / 2;
  return `transform="translate(${round(ox)} ${round(oy)}) scale(${round(scale)}) translate(${round(-bbox.x)} ${round(-bbox.y)})"`;
}

function measureTitleSafeY() {
  const poster = document.querySelector(".poster");
  const text = document.querySelector(".poster-text");
  if (!poster || !text) return TITLE_SAFE_FALLBACK;
  const p = poster.getBoundingClientRect();
  const t = text.getBoundingClientRect();
  if (p.height < 8) return TITLE_SAFE_FALLBACK;
  const y = ((t.bottom - p.top + 12) / p.height) * VIEW_H;
  return Math.min(72, Math.max(36, y));
}

// Turn a whole spec into an <svg> string.
function renderSpec(spec, safeTop = TITLE_SAFE_FALLBACK) {
  const bg = spec.canvas?.background ?? "#ffffff";
  const shapes = (spec.elements ?? [])
    .map((el) => {
      const fn = draw[el.shape];
      if (!fn) {
        console.warn(`Unknown shape "${el.shape}" — the renderer can't draw it.`);
        return "";
      }
      return fn(el);
    })
    .join("");

  const fit = artFitTransform(spec.elements, safeTop);

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="title-safe">
          <rect x="0" y="${round(safeTop)}" width="${VIEW_W}" height="${round(VIEW_H - safeTop)}"/>
        </clipPath>
      </defs>
      <rect x="0" y="0" width="${VIEW_W}" height="${VIEW_H}" fill="${bg}"/>
      <g clip-path="url(#title-safe)">
        <g ${fit}>
          ${shapes}
        </g>
      </g>
    </svg>`;
}

/* ---------- 2) THE SPECS (hand-authored Carreras posters) ------ */
/*
 * Each of these is exactly the shape of JSON the AI will one day
 * produce. Notice how little it takes to describe each poster —
 * that's the point of the grammar.
 */
const SPECS = {
  authoritarianism: {
    concept: "Authoritarianism",
    description:
      "Submission to authority and opposed to individualism. Power is concentrated in a single leader who possesses exclusive, unaccountable, and arbitrary power.",
    interpretation: "Power concentrated in one, rising above all.",
    canvas: { background: "#2e2c2a" },
    palette: { ink: "#ece6da" },
    elements: [
      { shape: "triangle", cx: 50, cy: 95, size: 47, rotation: 0, fill: "#b3922f" },
    ],
    rationale:
      "One upward triangle — a wide base narrowing to a single apex. Hierarchy, and power gathered at the top.",
    colorNote:
      "A heavy dark background for oppression; a cold, hard gold for power that sits above everyone.",
  },

  absolutism: {
    concept: "Absolutism",
    description:
      "An absolute truth is always correct under any condition. Universal facts can be discovered. It is opposed to relativism.",
    interpretation: "One truth, whole and complete in itself.",
    canvas: { background: "#f4f2ee" },
    palette: { ink: "#211f1d" },
    elements: [{ shape: "circle", cx: 50, cy: 80, r: 20, fill: "#211f1d" }],
    rationale:
      "A single solid circle, centered and self-contained. One absolute truth, needing nothing outside itself.",
    colorNote:
      "Black on near-white — the starkest contrast there is, for a truth that is total and beyond doubt.",
  },

  dualism: {
    concept: "Dualism",
    description:
      "The conviction that all concepts within the world fundamentally consist of two contrasting qualities, such as good and evil, or body and mind.",
    interpretation: "Two wholes meeting; a third nature only where they overlap.",
    canvas: { background: "#e6e9e0" },
    palette: { ink: "#161616" },
    elements: [
      { shape: "circle", cx: 50, cy: 61, r: 30, fill: "#3dc8c4" },
      { shape: "circle", cx: 50, cy: 99, r: 30, fill: "#e85a28" },
      { shape: "lens", cx: 50, y1: 61, y2: 99, r: 30, fill: "#6b38a8" },
    ],
    rationale:
      "Two equal circles — two complete, contrasting natures. They only mix in the lens between them: dualism is the world as a pair, and a third thing born at the meeting.",
    colorNote:
      "Cool teal against warm orange — opposite temperatures for opposite natures. The overlap turns purple, a colour that belongs to neither side alone.",
  },

  absurdism: {
    concept: "Absurdism",
    description:
      "The view that the human search for meaning will fail, because the universe has none to give.",
    interpretation: "A loop that never finds a centre — the search closes on emptiness.",
    canvas: { background: "#2b2624" },
    palette: { ink: "#f0ebe3" },
    elements: [
      { shape: "ring", cx: 50, cy: 86, r: 22, stroke: "#e2c48a", strokeWidth: 12 },
    ],
    rationale:
      "One open ring, nothing inside. The hunt for meaning goes around and around; the middle stays empty because there is nothing there to find.",
    colorNote:
      "A dark, quiet ground like an unanswering sky; a single warm gold ring — the human search still lit, still going, still hollow.",
  },

  nihilism: {
    concept: "Nihilism",
    description:
      "The rejection of inherent meaning, value, or purpose — nothing is grounded, so nothing is owed.",
    interpretation: "No form, because nothing holds.",
    canvas: { background: "#1a1918" },
    palette: { ink: "#c8c2b8" },
    elements: [],
    rationale:
      "The field is empty. Not a hidden symbol — the claim is that there is nothing to draw.",
    colorNote:
      "Near-black, slightly warm — a used-up dark, not a dramatic void. Quiet absence, not theatre.",
  },

  existentialism: {
    concept: "Existentialism",
    description:
      "Existence precedes essence: there is no given meaning, so a person must make their own.",
    interpretation: "One mark you place yourself — meaning as a choice, not a discovery.",
    canvas: { background: "#1e3a36" },
    palette: { ink: "#e8efe8" },
    elements: [
      { shape: "circle", cx: 50, cy: 90, r: 7, fill: "#e8efe8" },
    ],
    rationale:
      "A small solid circle in a large open field. Nothing else is given — that one mark is the meaning you put there.",
    colorNote:
      "Deep green-dark like a space you have to enter; the circle is pale and definite, a choice that shows up.",
  },

  stoicism: {
    concept: "Stoicism",
    description:
      "Virtue is the only good; what you cannot control is to be met with composure, not complaint.",
    interpretation: "Unmoved. A form that does not lean.",
    canvas: { background: "#e6dfd2" },
    palette: { ink: "#3a342c" },
    elements: [
      { shape: "rect", x: 35, y: 72, w: 30, h: 30, fill: "#4a453c" },
    ],
    rationale:
      "One square, level, centered. No direction, no break, no flourish — composure as a shape that will not tip.",
    colorNote:
      "Dry stone on warm paper — earth and self-command, not drama.",
  },

  aestheticism: {
    concept: "Aestheticism",
    description:
      "The belief that our main efforts in life should be focused on creating and enjoying beauty, in all its forms.",
    interpretation: "Beauty as the point — a centre, with forms blooming from it.",
    canvas: { background: "#7b6cf0" },
    palette: { ink: "#ffffff" },
    elements: [
      { shape: "circle", cx: 50, cy: 86, r: 20, fill: "#ffffff" },
      { shape: "ellipse", cx: 50, cy: 86, rx: 5.2, ry: 22, rotation: 0, fill: "#4a2eb8", opacity: 0.3 },
      { shape: "ellipse", cx: 50, cy: 86, rx: 5.2, ry: 22, rotation: 30, fill: "#4a2eb8", opacity: 0.3 },
      { shape: "ellipse", cx: 50, cy: 86, rx: 5.2, ry: 22, rotation: 60, fill: "#4a2eb8", opacity: 0.3 },
      { shape: "ellipse", cx: 50, cy: 86, rx: 5.2, ry: 22, rotation: 90, fill: "#4a2eb8", opacity: 0.3 },
      { shape: "ellipse", cx: 50, cy: 86, rx: 5.2, ry: 22, rotation: 120, fill: "#4a2eb8", opacity: 0.3 },
      { shape: "ellipse", cx: 50, cy: 86, rx: 5.2, ry: 22, rotation: 150, fill: "#4a2eb8", opacity: 0.3 },
      { shape: "ring", cx: 50, cy: 86, r: 24, stroke: "#7b6cf0", strokeWidth: 8 },
    ],
    rationale:
      "The white circle stays the centre. Translucent petals run from the middle to the rim — beauty layered on the simple form, not replacing it.",
    colorNote:
      "Violet ground for artifice and delight; white for the clear centre; the petals are the same violet, see-through, so they feel like colour blooming rather than a new object.",
  },

  constructivism: {
    concept: "Constructivism",
    description:
      "The viewpoint that reality, and the methods we use to understand it, are man-made, subjective constructions rather than an objective reading of events.",
    interpretation: "Reality is assembled — layer on layer, not found whole.",
    canvas: { background: "#e23a32" },
    palette: { ink: "#ffffff" },
    elements: [
      { shape: "rect", x: 30, y: 58, w: 40, h: 14, fill: "#ffffff" },
      { shape: "rect", x: 30, y: 72, w: 40, h: 14, fill: "#ffc4c0" },
      { shape: "rect", x: 30, y: 86, w: 40, h: 14, fill: "#e86b66" },
    ],
    rationale:
      "One square, built from three slabs. Nothing arrives as a finished form — the picture is made by stacking.",
    colorNote:
      "A hot ground underneath; each slab a step more built, from white to the colour of the field.",
  },

  "butterfly-effect": {
    concept: "Butterfly effect",
    aliases: ["butterfly effect", "the butterfly effect"],
    description:
      "The idea that a very small change in a system can lead, through a chain of later events, to a large difference in the outcome.",
    interpretation:
      "One small cause; everything after it falls into line.",
    canvas: { background: "#f2eee6" },
    palette: { ink: "#3f4a46" },
    elements: [
      { shape: "circle", cx: 16, cy: 88, r: 4.2, fill: "#ffffff" },
      { shape: "rect", x: 27.2, y: 70, w: 5.6, h: 36, rotation: -50, fill: "#f3cfc4" },
      { shape: "rect", x: 37.2, y: 70, w: 5.6, h: 36, rotation: -36, fill: "#f0d8b0" },
      { shape: "rect", x: 47.2, y: 70, w: 5.6, h: 36, rotation: -24, fill: "#dde4b4" },
      { shape: "rect", x: 57.2, y: 70, w: 5.6, h: 36, rotation: -12, fill: "#b8ddc8" },
      { shape: "rect", x: 67.2, y: 70, w: 5.6, h: 36, rotation: -5, fill: "#a8d6d4" },
      { shape: "rect", x: 77.2, y: 70, w: 5.6, h: 36, rotation: 0, fill: "#9cc8dc" },
      { shape: "rect", x: 87.2, y: 70, w: 5.6, h: 36, rotation: 0, fill: "#9eb4dc" },
    ],
    rationale:
      "A small pale circle starts the chain. The same bar repeats, each one more upright — a tiny cause, then events falling into line.",
    colorNote:
      "A warm paper ground and pastel bars — blush to mint to sky — so the chain feels bright and calm, not heavy or fated.",
  },

  hedonism: {
    concept: "Hedonism",
    description:
      "Pleasure is the only intrinsic good. A hedonist strives to maximize pleasure and minimize pain.",
    interpretation: "Everything tips toward a single point of pleasure.",
    canvas: { background: "#f0a9c6" },
    palette: { ink: "#ffffff" },
    elements: [
      { shape: "triangle", cx: 50, cy: 74, size: 34, rotation: 180, fill: "#e0509a" },
    ],
    rationale:
      "An inverted triangle — mass balanced on a single downward point. Weight tipped entirely toward pleasure.",
    colorNote:
      "Hot pinks — pleasure, indulgence, and the body; a colour that chases feeling.",
  },

  // WAY 1: pure overlap. No new renderer code — just five translucent
  // circles. The meaning emerges from how they stack.
  relativism: {
    concept: "Relativism",
    description:
      "Points of view have no absolute truth or validity, having only relative, subjective value according to differences in perception and consideration.",
    interpretation: "Many overlapping views; truth only where they meet.",
    canvas: { background: "#d7d7d5" },
    palette: { ink: "#3a3a38" },
    elements: [
      { shape: "circle", cx: 32, cy: 84, r: 15, fill: "#6f6f6d", opacity: 0.5 },
      { shape: "circle", cx: 41, cy: 84, r: 15, fill: "#6f6f6d", opacity: 0.5 },
      { shape: "circle", cx: 50, cy: 84, r: 15, fill: "#6f6f6d", opacity: 0.5 },
      { shape: "circle", cx: 59, cy: 84, r: 15, fill: "#6f6f6d", opacity: 0.5 },
      { shape: "circle", cx: 68, cy: 84, r: 15, fill: "#6f6f6d", opacity: 0.5 },
    ],
    rationale:
      "Five identical translucent circles. No single one wins; the image is darkest only where they overlap — shared truth exists only where perspectives meet.",
    colorNote:
      "Everything in grey — no viewpoint is brighter or more 'true' than any other.",
  },

  // WAY 2: uses the new "crescent" (boolean subtract) primitive.
  solipsism: {
    concept: "Solipsism",
    description:
      "Knowledge of anything outside one's own mind is unjustified. The external world and other minds cannot be known and might not exist.",
    interpretation: "Only the self remains; everything else is carved away.",
    canvas: { background: "#6f5a7a" },
    palette: { ink: "#efe7f2" },
    elements: [
      {
        shape: "crescent",
        cx: 50,
        cy: 84,
        r: 22,
        cutCx: 54,
        cutCy: 75,
        cutR: 12,
        fill: "#5c4869",
      },
    ],
    rationale:
      "A single disc with a bite subtracted — one self-contained form, everything beyond it removed into the background.",
    colorNote:
      "One flat purple throughout — nothing exists outside the self, so nothing else stands out.",
  },
  positivism: {
    concept: "Positivism",
    description:
      "The only authentic knowledge is that which is based on sense, experience and positive verification.",
    interpretation: "Knowledge built from what can be confirmed — a plus.",
    canvas: { background: "#faf0c0" },
    palette: { ink: "#5b4712" },
    elements: [
      {
        shape: "cross",
        cx: 50,
        cy: 84,
        size: 22,
        thickness: 6,
        fill: "#e0a92e",
      },
    ],
    rationale:
      "A plus sign built from two crossing bars — knowledge added and verified, the 'positive' made literal.",
    colorNote:
      "Warm, sunny yellows — clarity and optimism; knowledge felt as something bright and hopeful.",
  },

  // --- First AI-layer test: generated from the word "Freedom" using
  // ai-prompt.md (hand-simulated by the art director, not a live model yet).
  freedom: {
    concept: "Freedom",
    description:
      "The power to act, speak, or think without externally imposed restraint.",
    interpretation: "One breaks from the formation and rises into open space.",
    canvas: { background: "#8fbcd6" },
    palette: { ink: "#153048" },
    elements: [
      { shape: "circle", cx: 26, cy: 100, r: 6, fill: "#eef4f7" },
      { shape: "circle", cx: 40, cy: 100, r: 6, fill: "#eef4f7" },
      { shape: "circle", cx: 54, cy: 100, r: 6, fill: "#eef4f7" },
      { shape: "circle", cx: 68, cy: 100, r: 6, fill: "#eef4f7" },
      { shape: "circle", cx: 82, cy: 60, r: 6, fill: "#e0a92e" },
    ],
    rationale:
      "Four identical circles hold a rigid line; the fifth has left the formation and risen into open sky — freedom as breaking from constraint.",
    colorNote:
      "Open-sky blue for freedom; the escaping circle turns warm gold to draw the eye to the one that got out.",
  },

  // --- AI-layer test: generated from the word "Rich".
  // Recolored to cold grayscale: the accumulation stays, the warmth is
  // gone — wealth without happiness.
  rich: {
    concept: "Rich",
    description:
      "Having an abundance of money, assets, or valuable resources.",
    interpretation:
      "Wealth stacked high, drained of all warmth — richness is not happiness.",
    canvas: { background: "#8f8f8f" },
    palette: { ink: "#2a2a2a" },
    elements: [
      { shape: "ellipse", cx: 50, cy: 106, rx: 15, ry: 4, fill: "#f5f5f5" },
      { shape: "ellipse", cx: 50, cy: 97, rx: 15, ry: 4, fill: "#f5f5f5" },
      { shape: "ellipse", cx: 50, cy: 88, rx: 15, ry: 4, fill: "#f5f5f5" },
      { shape: "ellipse", cx: 50, cy: 79, rx: 15, ry: 4, fill: "#f5f5f5" },
      { shape: "ellipse", cx: 50, cy: 70, rx: 15, ry: 4, fill: "#f5f5f5" },
      { shape: "ellipse", cx: 50, cy: 61, rx: 15, ry: 4, fill: "#f5f5f5" },
    ],
    rationale:
      "A tall stack of coins in cold grayscale — abundance stripped of color and warmth. Having much, feeling little.",
    colorNote:
      "Cold grey and white — the wealth is there, but drained of all warmth. Money is not happiness.",
  },

  // --- AI-layer test: "Wealth". Calm, minimal — reserves held in depth,
  // shown as concentric layers. Navy + champagne palette.
  wealth: {
    concept: "Wealth",
    description:
      "An abundance of valuable resources, assets, or material possessions.",
    interpretation: "One mass so large it dwarfs everything else.",
    canvas: { background: "#20304d" },
    palette: { ink: "#ece3d0" },
    elements: [
      { shape: "circle", cx: 50, cy: 74, r: 30, fill: "#e6cfa3" },
      { shape: "circle", cx: 33, cy: 116, r: 4, fill: "#7b8aa5" },
    ],
    rationale:
      "One large circle towering over a single small one — wealth as sheer scale, dwarfing everything beside it.",
    colorNote:
      "Deep navy and soft champagne — quiet, classic luxury; the mass glows far larger than the small one beside it.",
  },

  entropy: {
    concept: "Entropy",
    description:
      "The tendency of order to decay: closed systems drift from structure toward disorder.",
    interpretation: "Difference running out — a core of order evening into sameness.",
    canvas: { background: "#d7d7d5" },
    palette: { ink: "#3a3a38" },
    elements: [
      { shape: "circle", cx: 50, cy: 84, r: 32, fill: "#6f6f6d" },
      { shape: "circle", cx: 50, cy: 84, r: 16, fill: "#b8b8b6" },
    ],
    rationale:
      "A paler core inside a larger grey field — remaining structure, already evening into sameness. Entropy is not wildness; it is difference running out.",
    colorNote:
      "All grey — used-up, uniform, no accent left. The colour of a system with nothing left to prefer.",
  },

  // --- AI-layer test: "Society". Paradox metaphor — a rigid grid of
  // identical units reads as ORDER and CONFORMITY at the same time.
  // A concept can hold MULTIPLE interpretations via `variations`. Each
  // variation is a full view (its own description / colors / elements),
  // so a single word can be read more than one way. The UI shows a
  // button per variation.
  society: {
    concept: "Society",
    description:
      "A large group of people living together in an ordered, interdependent community.",
    variations: [
      {
        label: "Conformity",
        description:
          "A community bound by shared order and rules — structure that can harden into conformity.",
        interpretation:
          "Identical units boxed into cells — and one that broke out through a cracked corner.",
        canvas: { background: "#ece0c8" },
        palette: { ink: "#3a2f26" },
        elements: [
          // The cage: a lattice grid that boxes every circle into its own cell.
          { shape: "line", x1: 20, y1: 54, x2: 20, y2: 114, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 32, y1: 54, x2: 32, y2: 114, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 44, y1: 54, x2: 44, y2: 114, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 56, y1: 54, x2: 56, y2: 114, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 68, y1: 54, x2: 68, y2: 114, stroke: "#3a2f26", strokeWidth: 1 },
          // Right wall: a small break just at the very top corner.
          { shape: "line", x1: 80, y1: 58, x2: 80, y2: 114, stroke: "#3a2f26", strokeWidth: 1 },
          // Top wall: a small break just at the very right corner.
          { shape: "line", x1: 20, y1: 54, x2: 76, y2: 54, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 20, y1: 66, x2: 80, y2: 66, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 20, y1: 78, x2: 80, y2: 78, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 20, y1: 90, x2: 80, y2: 90, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 20, y1: 102, x2: 80, y2: 102, stroke: "#3a2f26", strokeWidth: 1 },
          { shape: "line", x1: 20, y1: 114, x2: 80, y2: 114, stroke: "#3a2f26", strokeWidth: 1 },
          // The individuals, one trapped in each cell.
          { shape: "circle", cx: 26, cy: 60, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 38, cy: 60, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 50, cy: 60, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 62, cy: 60, r: 4, fill: "#bd5f3c" },
          // The one who broke free — its top-right cell is now empty.
          { shape: "circle", cx: 90, cy: 43, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 26, cy: 72, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 38, cy: 72, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 50, cy: 72, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 62, cy: 72, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 74, cy: 72, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 26, cy: 84, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 38, cy: 84, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 50, cy: 84, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 62, cy: 84, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 74, cy: 84, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 26, cy: 96, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 38, cy: 96, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 50, cy: 96, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 62, cy: 96, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 74, cy: 96, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 26, cy: 108, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 38, cy: 108, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 50, cy: 108, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 62, cy: 108, r: 4, fill: "#bd5f3c" },
          { shape: "circle", cx: 74, cy: 108, r: 4, fill: "#bd5f3c" },
        ],
        rationale:
          "A grid cages identical circles in their cells — but one has cracked the corner open and slipped beyond the grid: the individual who breaks from conformity.",
        colorNote:
          "Warm human terracotta for the people; hard dark lines for the rules that box them in.",
      },
      {
        label: "Unity",
        description:
          "A community bound by mutual care — people who show up and hold together for one another.",
        interpretation:
          "Individuals turned toward one another, overlapping into one unbroken ring.",
        canvas: { background: "#efe6f2" },
        palette: { ink: "#3a2b4a" },
        elements: [
          // A ring of individuals, each overlapping its neighbours so the
          // group becomes one connected, unbroken whole.
          { shape: "circle", cx: 72, cy: 84, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 69.05, cy: 95, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 61, cy: 103.05, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 50, cy: 106, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 39, cy: 103.05, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 30.95, cy: 95, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 28, cy: 84, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 30.95, cy: 73, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 39, cy: 64.95, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 50, cy: 62, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 61, cy: 64.95, r: 6.5, fill: "#8a63b0" },
          { shape: "circle", cx: 69.05, cy: 73, r: 6.5, fill: "#8a63b0" },
        ],
        rationale:
          "Individuals drawn into a single unbroken ring, each overlapping its neighbours — a society where everyone is connected and no one stands alone.",
        colorNote:
          "Soft lilac and gentle violet — calm, comfort, and care; a community that feels safe.",
      },
      {
        // Reading [1]: society as the web of bonds and relationships that
        // shape each person (Understanding Society in Philosophy).
        label: "Bonds",
        description:
          "A web of people who share a common life — bound together by the relationships that shape who they are.",
        interpretation:
          "The people are only dots; the real structure is the relationships between them.",
        canvas: { background: "#e6ede6" },
        palette: { ink: "#2f5d50" },
        elements: [
          // The web of relationships (drawn first, behind the people).
          { shape: "line", x1: 50, y1: 54, x2: 76, y2: 69, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 76, y1: 69, x2: 76, y2: 99, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 76, y1: 99, x2: 50, y2: 114, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 50, y1: 114, x2: 24, y2: 99, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 24, y1: 99, x2: 24, y2: 69, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 24, y1: 69, x2: 50, y2: 54, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 50, y1: 54, x2: 50, y2: 114, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 76, y1: 69, x2: 24, y2: 99, stroke: "#7aa295", strokeWidth: 1.2 },
          { shape: "line", x1: 76, y1: 99, x2: 24, y2: 69, stroke: "#7aa295", strokeWidth: 1.2 },
          // The people — every node connected into the whole.
          { shape: "circle", cx: 50, cy: 54, r: 4.5, fill: "#2f5d50" },
          { shape: "circle", cx: 76, cy: 69, r: 4.5, fill: "#2f5d50" },
          { shape: "circle", cx: 76, cy: 99, r: 4.5, fill: "#2f5d50" },
          { shape: "circle", cx: 50, cy: 114, r: 4.5, fill: "#2f5d50" },
          { shape: "circle", cx: 24, cy: 99, r: 4.5, fill: "#2f5d50" },
          { shape: "circle", cx: 24, cy: 69, r: 4.5, fill: "#2f5d50" },
        ],
        rationale:
          "Individuals joined by a mesh of lines — society is not the people alone but the web of relationships between them, the bonds that shape each person.",
        colorNote:
          "Living, natural greens — growth and connection; a community that feels rooted and alive.",
        philosophy:
          "Aristotle called humans 'political animals' — we are built for community, and a person cut off from others is 'either a beast or a god.' On this view the bonds come first: you are shaped and completed by your relationships. Communitarian thinkers like Charles Taylor and Alasdair MacIntyre argue the same — who you are is formed by the community, language and traditions you grow up in. This stands against the social-contract picture (Hobbes, Locke), where society is just separate individuals who agree to live together.",
      },
      {
        // Reading [2]: society not as a collection of lone individuals but as
        // a bonding of preexisting families (New Saint Andrews College).
        label: "Families",
        description:
          "Not merely a collection of individuals, but families bonded together — the family as the basic unit of society.",
        interpretation:
          "The building block isn't the lone person but the family; society is families joined.",
        canvas: { background: "#e9edf2" },
        palette: { ink: "#37507a" },
        elements: [
          // Bonds between families (drawn first, behind the clusters).
          { shape: "line", x1: 50, y1: 54, x2: 78.5, y2: 74.7, stroke: "#8fa3c4", strokeWidth: 1 },
          { shape: "line", x1: 78.5, y1: 74.7, x2: 67.6, y2: 108.3, stroke: "#8fa3c4", strokeWidth: 1 },
          { shape: "line", x1: 67.6, y1: 108.3, x2: 32.4, y2: 108.3, stroke: "#8fa3c4", strokeWidth: 1 },
          { shape: "line", x1: 32.4, y1: 108.3, x2: 21.5, y2: 74.7, stroke: "#8fa3c4", strokeWidth: 1 },
          { shape: "line", x1: 21.5, y1: 74.7, x2: 50, y2: 54, stroke: "#8fa3c4", strokeWidth: 1 },
          // Family 1 (top) — a small huddle of three.
          { shape: "circle", cx: 50, cy: 51, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 47.2, cy: 56, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 52.8, cy: 56, r: 2.4, fill: "#37507a" },
          // Family 2 (right)
          { shape: "circle", cx: 78.5, cy: 71.7, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 75.7, cy: 76.7, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 81.3, cy: 76.7, r: 2.4, fill: "#37507a" },
          // Family 3 (lower right)
          { shape: "circle", cx: 67.6, cy: 105.3, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 64.8, cy: 110.3, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 70.4, cy: 110.3, r: 2.4, fill: "#37507a" },
          // Family 4 (lower left)
          { shape: "circle", cx: 32.4, cy: 105.3, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 29.6, cy: 110.3, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 35.2, cy: 110.3, r: 2.4, fill: "#37507a" },
          // Family 5 (left)
          { shape: "circle", cx: 21.5, cy: 71.7, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 18.7, cy: 76.7, r: 2.4, fill: "#37507a" },
          { shape: "circle", cx: 24.3, cy: 76.7, r: 2.4, fill: "#37507a" },
        ],
        rationale:
          "Each small cluster is a family, not a lone individual — and the families bond to one another into a larger whole: society built from families, not isolated people.",
        colorNote:
          "Steady, dependable blues — the quiet strength and belonging of family ties.",
        philosophy:
          "This is the classical and Christian reading. Aristotle argued the city grows out of households and villages — the family is the first, most natural community, and the state is a 'community of communities.' Confucius made the family the root of all social order, where loyalty at home scales up into a well-ordered society. Catholic social teaching calls the family the 'basic cell of society,' existing before and beyond the state. The rival view — social-contract thinkers like Hobbes, Locke and Rousseau — starts instead from free, separate individuals who choose to associate. New Saint Andrews' question, 'a collection of individuals, or a bonding of families?', is asking you to choose between these two pictures.",
      },
    ],
  },
};

/* ---------- 3) WIRE IT UP TO THE PAGE -------------------------- */

const stage = document.getElementById("art");
const titleEl = document.getElementById("p-title");
const descEl = document.getElementById("p-desc");
const rationaleEl = document.getElementById("rationale");
const colorNoteEl = document.getElementById("color-note");
const philosophyEl = document.getElementById("philosophy");
const philosophyTextEl = document.getElementById("philosophy-text");
const specEl = document.getElementById("spec");
const select = document.getElementById("concept");
const variationsEl = document.getElementById("variations");

// A concept is either a single spec, or a spec with a `variations` array.
// getViews() flattens both into a list of full "views" we can render.
function getViews(spec) {
  if (Array.isArray(spec.variations) && spec.variations.length) {
    return spec.variations.map((v) => ({
      concept: spec.concept,
      description: v.description ?? spec.description,
      interpretation: v.interpretation,
      canvas: v.canvas,
      palette: v.palette,
      elements: v.elements,
      rationale: v.rationale,
      colorNote: v.colorNote,
      philosophy: v.philosophy,
      label: v.label,
    }));
  }
  return [spec];
}

// Draw one view onto the poster.
let currentView = null;

function renderView(view) {
  currentView = view;
  titleEl.textContent = view.concept + ".";
  titleEl.style.color = view.palette?.ink ?? "#000";
  descEl.textContent = view.description;
  descEl.style.color = view.palette?.ink ?? "#000";
  stage.innerHTML = renderSpec(view, measureTitleSafeY());
  rationaleEl.textContent = view.rationale;
  colorNoteEl.textContent = view.colorNote ?? "";
  if (view.philosophy) {
    philosophyTextEl.textContent = view.philosophy;
    philosophyEl.hidden = false;
  } else {
    philosophyTextEl.textContent = "";
    philosophyEl.hidden = true;
  }
  const { aliases: _aliases, ...printable } = view;
  specEl.textContent = JSON.stringify(printable, null, 2);
}

// If a concept has more than one view, show a button for each.
function buildVariationButtons(views) {
  variationsEl.innerHTML = "";
  if (views.length <= 1) {
    variationsEl.hidden = true;
    return;
  }
  variationsEl.hidden = false;
  views.forEach((view, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "variation-btn" + (i === 0 ? " active" : "");
    btn.textContent = view.label ?? `View ${i + 1}`;
    btn.addEventListener("click", () => {
      renderView(view);
      variationsEl
        .querySelectorAll("button")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
    variationsEl.append(btn);
  });
}

/* ---------- 4) THE "LEARN" TAB ---------------------------------
   Same shape vocabulary, but used to TELL A STORY instead of making
   one poster. A lesson is a list of steps: text, a panel of shapes,
   a "becomes" connector, and a closing takeaway. Panels use outlined
   shapes on a dark ground so a transformation reads at a glance. */

const LESSONS = {
  authoritarianism: {
    steps: [
      {
        type: "text",
        body: "Authoritarian control does not merely demand obedience. It attempts to make difference conform:",
      },
      {
        type: "panel",
        elements: [
          { shape: "circle", cx: 24.5, cy: 17, r: 6.2 },
          { shape: "triangle", cx: 41.5, cy: 17, r: 7 },
          { shape: "square", cx: 58.5, cy: 17, r: 6 },
          { shape: "diamond", cx: 75.5, cy: 17, r: 7 },
        ],
      },
      { type: "becomes" },
      {
        type: "panel",
        elements: [
          { shape: "square", cx: 24.5, cy: 17, r: 6 },
          { shape: "square", cx: 41.5, cy: 17, r: 6 },
          { shape: "square", cx: 58.5, cy: 17, r: 6 },
          { shape: "square", cx: 75.5, cy: 17, r: 6 },
        ],
      },
      {
        type: "takeaway",
        body: "Authoritarianism is not simply someone being powerful — it is the suppression of alternatives.",
      },
    ],
  },
};

// Outlined shapes for lesson panels (stroke, no fill).
// Triangles/diamonds use closed <path> (…Z) so the outline always joins up.
function closedPath(pts) {
  return "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ") + " Z";
}

function lessonShape(el, stroke) {
  const common = `fill="none" stroke="${stroke}" stroke-width="${el.strokeWidth ?? 0.9}" stroke-linejoin="round"`;
  const { cx, cy, r } = el;
  switch (el.shape) {
    case "circle":
      return `<circle cx="${cx}" cy="${cy}" r="${r}" ${common}/>`;
    case "square":
      return `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" ${common}/>`;
    case "triangle": {
      const pts = [0, 1, 2].map((k) => {
        const a = ((-90 + k * 120) * Math.PI) / 180;
        return [+(cx + r * Math.cos(a)).toFixed(2), +(cy + r * Math.sin(a)).toFixed(2)];
      });
      return `<path d="${closedPath(pts)}" ${common}/>`;
    }
    case "diamond":
      return `<path d="${closedPath([
        [cx, cy - r],
        [cx + r, cy],
        [cx, cy + r],
        [cx - r, cy],
      ])}" ${common}/>`;
    default:
      return "";
  }
}

function renderLessonStep(step) {
  if (step.type === "text") {
    const label = step.label ? `<p class="step-label">${step.label}</p>` : "";
    return `<div class="step-text">${label}<p>${step.body}</p></div>`;
  }
  if (step.type === "becomes") {
    return `<div class="becomes"><span>Becomes</span></div>`;
  }
  if (step.type === "takeaway") {
    return `<p class="takeaway">${step.body}</p>`;
  }
  if (step.type === "panel") {
    const stroke = step.stroke ?? "#e9e4d8";
    const bg = step.background ?? "#141210";
    const h = step.h ?? 34;
    const shapes = step.elements.map((el) => lessonShape(el, stroke)).join("");
    return `<div class="panel"><svg viewBox="0 0 100 ${h}" preserveAspectRatio="xMidYMid meet"><rect x="0" y="0" width="100" height="${h}" fill="${bg}"/>${shapes}</svg></div>`;
  }
  return "";
}

const lessonEl = document.getElementById("view-learn");

function renderLesson(key) {
  const lesson = LESSONS[key];
  if (!lesson) {
    lessonEl.innerHTML = `<p class="lesson-empty">No lesson for this concept yet — coming soon.</p>`;
    return false;
  }
  lessonEl.innerHTML = lesson.steps.map(renderLessonStep).join("");
  return true;
}

/* ---------- 5) TABS: Poster vs Learn --------------------------- */
const tabPoster = document.getElementById("tab-poster");
const tabLearn = document.getElementById("tab-learn");
const viewPoster = document.getElementById("view-poster");
const viewLearn = document.getElementById("view-learn");

function setTab(view) {
  const learn = view === "learn";
  viewLearn.hidden = !learn;
  viewPoster.hidden = learn;
  tabLearn.classList.toggle("active", learn);
  tabPoster.classList.toggle("active", !learn);
}

tabPoster.addEventListener("click", () => setTab("poster"));
tabLearn.addEventListener("click", () => {
  if (!tabLearn.disabled) setTab("learn");
});

function show(key) {
  const spec = SPECS[key];
  if (!spec) return;
  const views = getViews(spec);
  buildVariationButtons(views);
  renderView(views[0]);

  const hasLesson = renderLesson(key);
  tabLearn.disabled = !hasLesson;
  if (!hasLesson) setTab("poster");
}

// Populate the dropdown from the specs we have, A–Z so nothing is buried.
Object.keys(SPECS)
  .filter((key) => !key.startsWith("generated-"))
  .sort((a, b) => SPECS[a].concept.localeCompare(SPECS[b].concept))
  .forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = SPECS[key].concept;
    select.append(opt);
  });

select.addEventListener("change", (e) => show(e.target.value));

window.addEventListener("resize", () => {
  if (currentView) stage.innerHTML = renderSpec(currentView, measureTitleSafeY());
});

document.getElementById("toggle-spec").addEventListener("click", () => {
  const wrap = document.getElementById("spec-wrap");
  wrap.hidden = !wrap.hidden;
});

/* ---------- 6) AI GENERATE -------------------------------------
   The model writes a spec. renderSpec() already knows how to draw it.
   The API key is stored only in this browser (localStorage). */

const KEY_STORAGE = "philographics-openai-key";
const generateForm = document.getElementById("generate-form");
const wordInput = document.getElementById("word");
const generateBtn = document.getElementById("generate-btn");
const statusEl = document.getElementById("status");
const keyInput = document.getElementById("api-key");
const keyBox = document.getElementById("key-box");
const changeKeyBtn = document.getElementById("change-key");

function cleanKey(raw) {
  return String(raw ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\x21-\x7E]/g, "");
}

function getApiKey() {
  return cleanKey(localStorage.getItem(KEY_STORAGE) ?? "");
}

function setKeyRowVisible(show) {
  keyBox.classList.toggle("is-open", show);
  changeKeyBtn.hidden = show;
}

function syncKeyUi() {
  setKeyRowVisible(false);
}

function setStatus(message, isError) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.classList.remove("error");
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", Boolean(isError));
}

function sanitizeSpec(spec) {
  if (spec.refused) return spec;
  if (!spec.concept || !spec.canvas?.background || !Array.isArray(spec.elements)) {
    throw new Error("The model did not return a complete spec.");
  }
  spec.elements = spec.elements.filter((el) => el && draw[el.shape]);
  if (!spec.elements.length) {
    throw new Error("The spec used shapes the renderer cannot draw.");
  }
  spec.palette = spec.palette ?? { ink: "#1c1a17" };
  spec.description = spec.description ?? "";
  spec.rationale = spec.rationale ?? "";
  spec.colorNote = spec.colorNote ?? "";
  return spec;
}

function parseModelJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function normalizeName(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findLibraryKey(word) {
  const q = normalizeName(word);
  if (!q) return undefined;
  return Object.keys(SPECS).find((key) => {
    if (key.startsWith("generated-")) return false;
    const spec = SPECS[key];
    const names = [key, spec.concept, ...(spec.aliases || [])];
    return names.some((n) => n && normalizeName(n) === q);
  });
}

function showLibraryPoster(key, message) {
  select.value = key;
  show(key);
  setStatus(message);
}

function showGenerated(spec) {
  const id = "generated-" + Date.now();
  SPECS[id] = spec;
  const opt = document.createElement("option");
  opt.value = id;
  opt.textContent = spec.concept + " (AI)";
  select.append(opt);
  select.value = id;
  setTab("poster");
  show(id);
}

async function askModel(word) {
  const key = getApiKey();
  const prompt = window.ART_DIRECTOR_PROMPT;
  if (!prompt) throw new Error("The art-director prompt failed to load.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: word },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message ?? res.statusText;
    throw new Error(msg);
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("The model returned an empty reply.");
  return parseModelJson(text);
}

document.getElementById("save-key").addEventListener("click", () => {
  const value = keyInput.value.trim();
  if (!value) {
    setStatus("Paste a key first.", true);
    return;
  }
  localStorage.setItem(KEY_STORAGE, cleanKey(value));
  keyInput.value = "";
  syncKeyUi();
  setStatus("Key saved. Type a word and hit Generate.");
});

changeKeyBtn.addEventListener("click", () => {
  setKeyRowVisible(true);
  keyInput.focus();
});

syncKeyUi();

generateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = wordInput.value.trim();
  if (!word) {
    setStatus("Type a word or phrase first.", true);
    return;
  }
  const existing = findLibraryKey(word);
  if (existing) {
    showLibraryPoster(
      existing,
      "This word already has a poster. We kept the one in the library."
    );
    return;
  }
  if (!getApiKey()) {
    setKeyRowVisible(true);
    keyInput.focus();
    setStatus("Paste your API key and hit Save first.", true);
    return;
  }

  generateBtn.disabled = true;
  setStatus("Asking the art director…");
  try {
    const spec = sanitizeSpec(await askModel(word));
    if (spec.refused) {
      setStatus(spec.reason ?? "The model declined that idea.", true);
      return;
    }
    const already = findLibraryKey(spec.concept || word);
    if (already) {
      showLibraryPoster(
        already,
        "This word already has a poster. We kept the one in the library."
      );
      return;
    }
    showGenerated(spec);
    setStatus("Drawn from a spec the AI just wrote.");
  } catch (err) {
    const msg = err.message || "Generation failed.";
    if (/ISO-8859-1|Failed to fetch|Failed to execute 'fetch'/i.test(msg)) {
      setKeyRowVisible(true);
      keyInput.focus();
      setStatus(
        "The saved key has extra characters. Paste it again (no spaces) and hit Save, then Generate.",
        true
      );
    } else {
      setStatus(msg, true);
    }
  } finally {
    generateBtn.disabled = false;
  }
});

// First render.
show(Object.keys(SPECS)[0]);
