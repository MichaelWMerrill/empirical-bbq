/*
 * Generates branded (non-photographic) hero graphics for blog posts that don't
 * have a real cook photo yet. Same dark/flame-gradient language as
 * generate-og.mjs, with a small topic-specific line motif per post. Run once
 * (or after changing the design or adding a post to `jobs`):
 * `node scripts/generate-blog-heroes.mjs`. The JPGs are committed.
 */
import sharp from 'sharp';

const W = 1600;
const H = 900;

const FONT = 'DejaVu Sans, Verdana, Arial, sans-serif';

const base = (label, motif) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="55%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#fb923c"/>
    </linearGradient>
    <radialGradient id="glowA" cx="86%" cy="-8%" r="70%">
      <stop offset="0%" stop-color="#f97316" stop-opacity="0.22"/>
      <stop offset="60%" stop-color="#f97316" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="-6%" cy="112%" r="65%">
      <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.16"/>
      <stop offset="55%" stop-color="#f59e0b" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#121824"/>
  <rect width="${W}" height="${H}" fill="url(#glowA)"/>
  <rect width="${W}" height="${H}" fill="url(#glowB)"/>

  <rect x="100" y="200" rx="22" ry="22" width="330" height="46" fill="#f97316" fill-opacity="0.12" stroke="#f97316" stroke-opacity="0.4"/>
  <text x="126" y="231" font-family="${FONT}" font-size="19" font-weight="700" letter-spacing="3" fill="#fdba74">FIELD NOTES</text>

  <text x="98" y="360" font-family="${FONT}" font-size="64" font-weight="800" letter-spacing="-1.5" fill="url(#title)">${label}</text>

  ${motif}

  <rect x="0" y="882" width="${W}" height="18" fill="url(#title)"/>
</svg>`;

// Turkey post: a monotonic climb line (no stall plateau) vs. a brisket-style
// stalled curve, faded, for contrast.
const turkeyMotif = `
  <g stroke-width="6" fill="none" opacity="0.9">
    <polyline points="140,760 340,700 540,520 760,460 980,340 1220,260 1440,210" stroke="url(#title)" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g stroke-width="6" fill="none" opacity="0.28">
    <polyline points="140,800 340,720 460,660 760,650 900,645 1080,520 1440,320" stroke="#7c8aab" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 14"/>
  </g>
  <text x="1220" y="245" font-family="${FONT}" font-size="22" font-weight="600" fill="#fdba74" text-anchor="end">turkey — no stall</text>
  <text x="1440" y="345" font-family="${FONT}" font-size="20" font-weight="500" fill="#7c8aab" text-anchor="end">brisket — stall band</text>
`;

// Fuel post: a rising bar comparison (ideal vs. cold+windy burn) plus a
// simple flame glyph.
const fuelMotif = `
  <g>
    <rect x="1180" y="620" width="90" height="180" rx="10" fill="#7c8aab" fill-opacity="0.35"/>
    <rect x="1300" y="430" width="90" height="370" rx="10" fill="url(#title)"/>
    <text x="1225" y="810" font-family="${FONT}" font-size="18" font-weight="600" fill="#7c8aab" text-anchor="middle">70&#176;F calm</text>
    <text x="1345" y="810" font-family="${FONT}" font-size="18" font-weight="600" fill="#fdba74" text-anchor="middle">22&#176;F windy</text>
  </g>
  <g transform="translate(1440,470) scale(0.34)">
    <path d="M 106 404 C 136 404, 148 302, 174 270 Q 194 246, 238 244 L 306 244 Q 350 243, 366 202 C 382 162, 390 140, 408 106" fill="none" stroke="#fbbf24" stroke-width="52" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
  </g>
`;

// Ribs post: a fixed 3-2-1 block schedule (stacked bars, proportional 3:2:1)
// against the physics-model's smooth curve, to show the two disagreeing clocks.
const ribsMotif = `
  <g>
    <rect x="140" y="640" width="330" height="52" rx="8" fill="url(#title)"/>
    <rect x="484" y="640" width="220" height="52" rx="8" fill="url(#title)" fill-opacity="0.65"/>
    <rect x="718" y="640" width="110" height="52" rx="8" fill="url(#title)" fill-opacity="0.4"/>
    <text x="140" y="722" font-family="${FONT}" font-size="20" font-weight="600" fill="#fdba74">3-2-1 SCHEDULE — fixed blocks</text>
  </g>
  <g stroke-width="6" fill="none" opacity="0.75">
    <polyline points="140,540 340,510 560,430 800,380 1040,300 1260,240 1440,200" stroke="#7c8aab" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 14"/>
  </g>
  <text x="1440" y="180" font-family="${FONT}" font-size="20" font-weight="500" fill="#7c8aab" text-anchor="end">predictor — physics curve</text>
`;

// Turkey brine/spatchcock post: three comparison bars (baseline, brined,
// spatchcocked) showing carved yield moving in different directions.
const brineMotif = `
  <g>
    <rect x="1080" y="660" width="80" height="140" rx="10" fill="#7c8aab" fill-opacity="0.35"/>
    <rect x="1200" y="560" width="80" height="240" rx="10" fill="url(#title)"/>
    <rect x="1320" y="676" width="80" height="124" rx="10" fill="#7c8aab" fill-opacity="0.55"/>
    <text x="1120" y="830" font-family="${FONT}" font-size="17" font-weight="600" fill="#7c8aab" text-anchor="middle">baseline</text>
    <text x="1240" y="830" font-family="${FONT}" font-size="17" font-weight="600" fill="#fdba74" text-anchor="middle">brined</text>
    <text x="1360" y="830" font-family="${FONT}" font-size="17" font-weight="600" fill="#7c8aab" text-anchor="middle">spatchcock</text>
  </g>
`;

// Climate stall-paradox post: two stall curves on the same axes — arid
// flattens (stalls) earlier and holds the plateau longer, humid flattens
// later and breaks sooner, both converging by the finish.
const climateMotif = `
  <g stroke-width="6" fill="none" opacity="0.9">
    <polyline points="140,790 320,660 460,630 700,615 880,600 1040,430 1220,300 1440,215" stroke="url(#title)" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g stroke-width="6" fill="none" opacity="0.32">
    <polyline points="140,800 300,700 540,650 800,640 1000,630 1160,470 1440,260" stroke="#7c8aab" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 14"/>
  </g>
  <text x="1440" y="195" font-family="${FONT}" font-size="22" font-weight="600" fill="#fdba74" text-anchor="end">arid — earlier, longer stall</text>
  <text x="1440" y="440" font-family="${FONT}" font-size="20" font-weight="500" fill="#7c8aab" text-anchor="end">humid — later, shorter stall</text>
`;

// Brisket yield post: a rising bar chart of cooked yield % by grade — Prime
// shortest, Select tallest, inverse of the price/prestige ordering.
const yieldMotif = `
  <g>
    <rect x="1070" y="672" width="86" height="150" rx="10" fill="#7c8aab" fill-opacity="0.4"/>
    <rect x="1186" y="592" width="86" height="230" rx="10" fill="#f59e0b" fill-opacity="0.65"/>
    <rect x="1302" y="502" width="86" height="320" rx="10" fill="url(#title)"/>
    <text x="1113" y="655" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">46.8%</text>
    <text x="1229" y="575" font-family="${FONT}" font-size="18" font-weight="700" fill="#fdba74" text-anchor="middle">50.2%</text>
    <text x="1345" y="485" font-family="${FONT}" font-size="18" font-weight="700" fill="#fdba74" text-anchor="middle">54.3%</text>
    <text x="1113" y="850" font-family="${FONT}" font-size="18" font-weight="600" fill="#7c8aab" text-anchor="middle">PRIME</text>
    <text x="1229" y="850" font-family="${FONT}" font-size="18" font-weight="600" fill="#7c8aab" text-anchor="middle">CHOICE</text>
    <text x="1345" y="850" font-family="${FONT}" font-size="18" font-weight="600" fill="#7c8aab" text-anchor="middle">SELECT</text>
  </g>
`;

// Brisket mass-exponent post: two bar pairs — climb rate roughly halving
// 8lb->16lb (steep exponent) next to stall duration barely moving (shallow
// exponent) — the decoupling is the whole point of the post.
const massExponentMotif = `
  <g>
    <text x="1030" y="470" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">CLIMB RATE</text>
    <rect x="990" y="500" width="80" height="220" rx="10" fill="url(#title)"/>
    <rect x="1110" y="610" width="80" height="110" rx="10" fill="url(#title)" fill-opacity="0.5"/>
    <text x="1030" y="745" font-family="${FONT}" font-size="16" font-weight="600" fill="#fdba74" text-anchor="middle">8 lb</text>
    <text x="1150" y="745" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">16 lb</text>
  </g>
  <g>
    <text x="1330" y="470" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">STALL LENGTH</text>
    <rect x="1290" y="620" width="80" height="100" rx="10" fill="#7c8aab" fill-opacity="0.55"/>
    <rect x="1410" y="595" width="80" height="125" rx="10" fill="#7c8aab" fill-opacity="0.55"/>
    <text x="1330" y="745" font-family="${FONT}" font-size="16" font-weight="600" fill="#fdba74" text-anchor="middle">8 lb</text>
    <text x="1450" y="745" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">16 lb</text>
  </g>
`;

// Turkey danger-zone post: a bracketed 40-140°F band with a clock glyph, plus
// the two levers (spatchcock / higher pit temp) that shrink the exposure.
const dangerZoneMotif = `
  <g>
    <rect x="140" y="560" width="1180" height="70" rx="12" fill="#f97316" fill-opacity="0.16" stroke="#f97316" stroke-opacity="0.55" stroke-width="2"/>
    <text x="170" y="605" font-family="${FONT}" font-size="24" font-weight="700" fill="#fdba74">40&#176;F</text>
    <text x="1250" y="605" font-family="${FONT}" font-size="24" font-weight="700" fill="#fdba74" text-anchor="end">140&#176;F</text>
    <text x="710" y="605" font-family="${FONT}" font-size="19" font-weight="600" fill="#fca5a5" text-anchor="middle" letter-spacing="1">DANGER ZONE</text>
  </g>
  <g transform="translate(1360,470) scale(0.42)">
    <circle cx="256" cy="256" r="200" fill="none" stroke="#7c8aab" stroke-width="26" opacity="0.5"/>
    <line x1="256" y1="256" x2="256" y2="120" stroke="#fdba74" stroke-width="26" stroke-linecap="round"/>
    <line x1="256" y1="256" x2="360" y2="256" stroke="#fdba74" stroke-width="26" stroke-linecap="round"/>
  </g>
  <text x="1440" y="700" font-family="${FONT}" font-size="19" font-weight="600" fill="#7c8aab" text-anchor="end">spatchcock or raise pit temp</text>
  <text x="1440" y="730" font-family="${FONT}" font-size="19" font-weight="600" fill="#7c8aab" text-anchor="end">to shrink the window</text>
`;

// Pork shoulder post: two grouped-bar comparisons — trim loss (bone-in 12%
// vs boneless 6%, visibly different) next to cook loss (38% vs 38%, identical
// heights) — showing the whole yield gap is a trim-only effect.
const porkTrimMotif = `
  <g>
    <text x="1030" y="470" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">TRIM LOSS</text>
    <rect x="990" y="620" width="80" height="100" rx="10" fill="url(#title)"/>
    <rect x="1110" y="670" width="80" height="50" rx="10" fill="url(#title)" fill-opacity="0.5"/>
    <text x="1030" y="605" font-family="${FONT}" font-size="16" font-weight="700" fill="#fdba74" text-anchor="middle">12%</text>
    <text x="1150" y="655" font-family="${FONT}" font-size="16" font-weight="700" fill="#fdba74" text-anchor="middle">6%</text>
    <text x="1030" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">BONE-IN</text>
    <text x="1150" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">BONELESS</text>
  </g>
  <g>
    <text x="1330" y="470" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">COOK LOSS</text>
    <rect x="1290" y="580" width="80" height="140" rx="10" fill="#7c8aab" fill-opacity="0.55"/>
    <rect x="1410" y="580" width="80" height="140" rx="10" fill="#7c8aab" fill-opacity="0.55"/>
    <text x="1330" y="565" font-family="${FONT}" font-size="16" font-weight="700" fill="#7c8aab" text-anchor="middle">38%</text>
    <text x="1450" y="565" font-family="${FONT}" font-size="16" font-weight="700" fill="#7c8aab" text-anchor="middle">38%</text>
    <text x="1330" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">BONE-IN</text>
    <text x="1450" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">BONELESS</text>
  </g>
`;

// Fuel BTU-vs-burn-rate post: a rising bar chart of lb/hr ideal burn rate by
// fuel, each bar labeled with its BTU/lb — splits top both, the counter-
// intuitive pairing the post is about.
const fuelBtuMotif = `
  <g>
    <text x="1230" y="450" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">LB/HR BURN RATE (BTU/LB LABELED)</text>
    <rect x="1070" y="712" width="86" height="110" rx="10" fill="#7c8aab" fill-opacity="0.4"/>
    <rect x="1186" y="672" width="86" height="150" rx="10" fill="#f59e0b" fill-opacity="0.65"/>
    <rect x="1302" y="502" width="86" height="320" rx="10" fill="url(#title)"/>
    <text x="1113" y="695" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle">8,000</text>
    <text x="1229" y="655" font-family="${FONT}" font-size="17" font-weight="700" fill="#fdba74" text-anchor="middle">9,500</text>
    <text x="1345" y="485" font-family="${FONT}" font-size="17" font-weight="700" fill="#fdba74" text-anchor="middle">12,000</text>
    <text x="1113" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">PELLETS</text>
    <text x="1229" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">CHARCOAL</text>
    <text x="1345" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">SPLITS</text>
  </g>
`;

// Pit-type post: two crossing lines — climb-to-stall time rising left-to-right
// across cooker types (pellet fastest, kamado slowest), stall length falling
// the opposite way (pellet longest, kamado shortest) — the inverse trade the
// post is about.
const pitTradeoffMotif = `
  <g stroke-width="6" fill="none" opacity="0.9">
    <polyline points="140,700 620,590 1020,460 1440,240" stroke="url(#title)" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g stroke-width="6" fill="none" opacity="0.32">
    <polyline points="140,710 620,760 1020,800 1440,830" stroke="#7c8aab" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 14"/>
  </g>
  <text x="1440" y="215" font-family="${FONT}" font-size="20" font-weight="600" fill="#fdba74" text-anchor="end">climb to stall — pellet fast, kamado slow</text>
  <text x="1440" y="800" font-family="${FONT}" font-size="20" font-weight="500" fill="#7c8aab" text-anchor="end">stall length — pellet long, kamado short</text>
`;

// Wrap-timing post: five bars fading from full height/opacity (wrap right at
// stall onset = full benefit) down to a sliver (wrap at the top of the 12°F
// band = no benefit, same as never wrapping) — the continuous dial the post
// is about.
const wrapBandMotif = `
  <g>
    <text x="1230" y="450" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">WRAP BENEFIT ACROSS THE 12&#176;F BAND</text>
    <rect x="990" y="680" width="70" height="140" rx="8" fill="url(#title)"/>
    <rect x="1080" y="720" width="70" height="100" rx="8" fill="url(#title)" fill-opacity="0.7"/>
    <rect x="1170" y="760" width="70" height="60" rx="8" fill="url(#title)" fill-opacity="0.45"/>
    <rect x="1260" y="795" width="70" height="25" rx="8" fill="#7c8aab" fill-opacity="0.5"/>
    <rect x="1350" y="810" width="70" height="10" rx="6" fill="#7c8aab" fill-opacity="0.35"/>
    <text x="1025" y="665" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="middle">155&#176;F</text>
    <text x="1385" y="798" font-family="${FONT}" font-size="15" font-weight="700" fill="#7c8aab" text-anchor="middle">167&#176;F</text>
    <text x="1025" y="845" font-family="${FONT}" font-size="13" font-weight="600" fill="#7c8aab" text-anchor="middle">WRAP EARLY</text>
    <text x="1385" y="845" font-family="${FONT}" font-size="13" font-weight="600" fill="#7c8aab" text-anchor="middle">WRAP LATE</text>
  </g>
`;

// Turkey hold-window post: two cooling curves falling toward the shared
// 140°F floor at very different rates — brisket's slow, long approach vs.
// turkey's fast crossing — the gap the post is about.
const turkeyHoldMotif = `
  <text x="1230" y="460" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">TIME TO THE 140&#176;F FLOOR</text>
  <g>
    <line x1="1010" y1="500" x2="1060" y2="500" stroke="url(#title)" stroke-width="6" stroke-linecap="round"/>
    <text x="1075" y="506" font-family="${FONT}" font-size="16" font-weight="700" fill="#fdba74">BRISKET ~6.4H</text>
    <line x1="1010" y1="535" x2="1060" y2="535" stroke="#7c8aab" stroke-width="6" stroke-linecap="round" stroke-dasharray="2 10"/>
    <text x="1075" y="541" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab">TURKEY ~2.5H</text>
  </g>
  <g stroke-width="6" fill="none" opacity="0.9">
    <polyline points="140,650 500,690 900,730 1300,775 1440,790" stroke="url(#title)" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g stroke-width="6" fill="none" opacity="0.32">
    <polyline points="140,650 350,750 550,810 750,828 1440,832" stroke="#7c8aab" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 14"/>
  </g>
`;

// Stall-exponent-universality post: two grouped-bar comparisons — climb
// exponent (bars visibly different heights, brisket vs pork) next to stall
// exponent (bars identical height and full brand color, both 0.333) — the
// cross-protein match the post is about.
const stallUniversalityMotif = `
  <g>
    <text x="1030" y="470" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">CLIMB EXPONENT</text>
    <rect x="990" y="630" width="80" height="90" rx="10" fill="#7c8aab" fill-opacity="0.55"/>
    <rect x="1110" y="610" width="80" height="110" rx="10" fill="#7c8aab" fill-opacity="0.55"/>
    <text x="1030" y="615" font-family="${FONT}" font-size="15" font-weight="700" fill="#7c8aab" text-anchor="middle">-1.073</text>
    <text x="1150" y="595" font-family="${FONT}" font-size="15" font-weight="700" fill="#7c8aab" text-anchor="middle">-1.086</text>
    <text x="1030" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">BRISKET</text>
    <text x="1150" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">PORK</text>
  </g>
  <g>
    <text x="1330" y="470" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">STALL EXPONENT</text>
    <rect x="1290" y="580" width="80" height="140" rx="10" fill="url(#title)"/>
    <rect x="1410" y="580" width="80" height="140" rx="10" fill="url(#title)"/>
    <text x="1330" y="565" font-family="${FONT}" font-size="16" font-weight="700" fill="#fdba74" text-anchor="middle">0.333</text>
    <text x="1450" y="565" font-family="${FONT}" font-size="16" font-weight="700" fill="#fdba74" text-anchor="middle">0.333</text>
    <text x="1330" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">BRISKET</text>
    <text x="1450" y="745" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">PORK</text>
  </g>
`;

// Physics-of-the-stall primer post: the classic climb-plateau-climb curve
// with the 155°F stall threshold marked as a reference line, plus a small
// droplet glyph for evaporative cooling — the foundational post the newer
// stall-math deep-dives (climate, pit-type, wrap-timing) all link back to.
const stallPrimerMotif = `
  <line x1="140" y1="470" x2="1440" y2="470" stroke="#7c8aab" stroke-width="3" stroke-dasharray="4 10" opacity="0.5"/>
  <text x="980" y="415" font-family="${FONT}" font-size="19" font-weight="600" fill="#7c8aab" text-anchor="middle">155&#176;F stall threshold (225&#176;F pit)</text>
  <g stroke-width="7" fill="none" opacity="0.95">
    <polyline points="140,800 320,620 460,500 620,472 900,462 1330,462 1440,250" stroke="url(#title)" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g transform="translate(760,560) scale(1.6)" opacity="0.8">
    <path d="M0,-22 C10,-6 16,4 16,12 A16,16 0 1 1 -16,12 C-16,4 -10,-6 0,-22 Z" fill="#7dd3fc" opacity="0.55"/>
  </g>
`;

// Science-of-bark post: two rub-particle clusters — coarse 16-mesh (few
// large orange dots, more surface area) vs. fine table-ground (many small
// grey dots, packed tight) — the granulation point the post is about.
const barkGranulationMotif = `
  <text x="1230" y="450" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">RUB SURFACE AREA</text>
  <g fill="url(#title)" opacity="0.9">
    <circle cx="1020" cy="590" r="16"/>
    <circle cx="1080" cy="612" r="14"/>
    <circle cx="1135" cy="583" r="18"/>
    <circle cx="1045" cy="655" r="15"/>
    <circle cx="1110" cy="665" r="16"/>
    <circle cx="1165" cy="632" r="13"/>
  </g>
  <text x="1092" y="720" font-family="${FONT}" font-size="15" font-weight="600" fill="#fdba74" text-anchor="middle">COARSE 16-MESH</text>
  <g fill="#7c8aab" opacity="0.55">
    <circle cx="1245" cy="580" r="5"/><circle cx="1275" cy="580" r="5"/><circle cx="1305" cy="580" r="5"/><circle cx="1335" cy="580" r="5"/><circle cx="1365" cy="580" r="5"/>
    <circle cx="1245" cy="612" r="5"/><circle cx="1275" cy="612" r="5"/><circle cx="1305" cy="612" r="5"/><circle cx="1335" cy="612" r="5"/><circle cx="1365" cy="612" r="5"/>
    <circle cx="1245" cy="644" r="5"/><circle cx="1275" cy="644" r="5"/><circle cx="1305" cy="644" r="5"/><circle cx="1335" cy="644" r="5"/><circle cx="1365" cy="644" r="5"/>
    <circle cx="1245" cy="676" r="5"/><circle cx="1275" cy="676" r="5"/><circle cx="1305" cy="676" r="5"/><circle cx="1335" cy="676" r="5"/><circle cx="1365" cy="676" r="5"/>
  </g>
  <text x="1305" y="720" font-family="${FONT}" font-size="15" font-weight="600" fill="#7c8aab" text-anchor="middle">FINE GROUND</text>
`;

// Chemistry-of-wood-smoke post: three smoke-color puffs — thick white
// (creosote/smolder), thin pale blue (600-800°F clean burn), grey-black
// (oxygen-starved) — the three combustion phases the post walks through.
const smokeColorMotif = `
  <text x="1230" y="450" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">SMOKE COLOR = COMBUSTION PHASE</text>
  <g fill="#cbd5e1" opacity="0.85">
    <circle cx="1020" cy="655" r="38"/><circle cx="1058" cy="628" r="44"/><circle cx="1090" cy="658" r="36"/>
  </g>
  <text x="1055" y="730" font-family="${FONT}" font-size="14" font-weight="600" fill="#e2e8f0" text-anchor="middle">THICK WHITE</text>
  <g fill="#7dd3fc" opacity="0.55">
    <circle cx="1205" cy="655" r="26"/><circle cx="1233" cy="633" r="30"/><circle cx="1262" cy="656" r="24"/>
  </g>
  <text x="1233" y="730" font-family="${FONT}" font-size="14" font-weight="600" fill="#7dd3fc" text-anchor="middle">THIN BLUE</text>
  <g fill="#334155" opacity="0.9" stroke="#7c8aab" stroke-width="1.5">
    <circle cx="1385" cy="655" r="36"/><circle cx="1420" cy="630" r="40"/><circle cx="1452" cy="656" r="34"/>
  </g>
  <text x="1418" y="730" font-family="${FONT}" font-size="14" font-weight="600" fill="#7c8aab" text-anchor="middle">GREY-BLACK</text>
`;

// Faux-cambro hold post: three descending bars for how long each hold vessel
// keeps meat above 140°F (faux cambro ~6h, bare cooler ~3h, counter ~1h),
// plus a small note that a warm oven hold never crosses the floor at all.
const holdWindowMotif = `
  <text x="1230" y="450" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">HOURS ABOVE THE 140&#176;F FLOOR</text>
  <text x="1230" y="474" font-family="${FONT}" font-size="14" font-weight="500" fill="#7c8aab" text-anchor="middle" opacity="0.7">(warm oven hold near 150&#176;F never crosses it)</text>
  <g>
    <rect x="1070" y="502" width="86" height="320" rx="10" fill="url(#title)"/>
    <rect x="1186" y="652" width="86" height="170" rx="10" fill="#f59e0b" fill-opacity="0.65"/>
    <rect x="1302" y="762" width="86" height="60" rx="10" fill="#7c8aab" fill-opacity="0.5"/>
    <text x="1113" y="495" font-family="${FONT}" font-size="18" font-weight="700" fill="#fdba74" text-anchor="middle">~6H</text>
    <text x="1229" y="645" font-family="${FONT}" font-size="18" font-weight="700" fill="#fdba74" text-anchor="middle">~3H</text>
    <text x="1345" y="755" font-family="${FONT}" font-size="18" font-weight="700" fill="#7c8aab" text-anchor="middle">~1H</text>
    <text x="1113" y="850" font-family="${FONT}" font-size="15" font-weight="600" fill="#7c8aab" text-anchor="middle">CAMBRO</text>
    <text x="1229" y="850" font-family="${FONT}" font-size="15" font-weight="600" fill="#7c8aab" text-anchor="middle">COOLER</text>
    <text x="1345" y="850" font-family="${FONT}" font-size="15" font-weight="600" fill="#7c8aab" text-anchor="middle">COUNTER</text>
  </g>
`;

// Per-person BBQ post: raw-vs-cooked bar pair showing the ~50% shrinkage tax
// that turns a 20 lb raw brisket into 10 lb of servable cooked meat.
const yieldTaxMotif = `
  <text x="1290" y="450" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">RAW BOUGHT &#8594; COOKED SERVED</text>
  <g>
    <rect x="1150" y="502" width="100" height="320" rx="10" fill="#7c8aab" fill-opacity="0.45"/>
    <rect x="1330" y="662" width="100" height="160" rx="10" fill="url(#title)"/>
    <text x="1200" y="485" font-family="${FONT}" font-size="19" font-weight="700" fill="#7c8aab" text-anchor="middle">20 LB</text>
    <text x="1380" y="645" font-family="${FONT}" font-size="19" font-weight="700" fill="#fdba74" text-anchor="middle">10 LB</text>
    <text x="1200" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">RAW</text>
    <text x="1380" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#fdba74" text-anchor="middle">COOKED</text>
    <text x="1290" y="600" font-family="${FONT}" font-size="16" font-weight="700" fill="#fca5a5" text-anchor="middle">~50% YIELD</text>
  </g>
`;

// Wrap-permeability post: a "shown vs. used" node diagram — permeability_psi
// sits next to computeModel() but a dashed, ×-marked line shows it's never
// read; the real drivers (stall_duration_multiplier / post_stall_climb_
// modifier) connect with a solid line.
const permeabilityMotif = `
  <text x="1230" y="465" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">WHAT computeModel() ACTUALLY READS</text>
  <g>
    <rect x="970" y="520" width="260" height="52" rx="10" fill="#7c8aab" fill-opacity="0.3" stroke="#7c8aab" stroke-opacity="0.5" stroke-width="1.5"/>
    <text x="1100" y="551" font-family="${FONT}" font-size="14" font-weight="700" fill="#7c8aab" text-anchor="middle">permeability_psi</text>
    <text x="1100" y="592" font-family="${FONT}" font-size="12" font-weight="600" fill="#7c8aab" text-anchor="middle" opacity="0.7">never read &#8212; decorative</text>
  </g>
  <g>
    <rect x="970" y="656" width="260" height="52" rx="10" fill="#f97316" fill-opacity="0.16" stroke="#f97316" stroke-opacity="0.6" stroke-width="1.5"/>
    <text x="1100" y="687" font-family="${FONT}" font-size="13" font-weight="700" fill="#fdba74" text-anchor="middle">stall_duration_multiplier</text>
    <text x="1100" y="728" font-family="${FONT}" font-size="12" font-weight="600" fill="#fdba74" text-anchor="middle" opacity="0.85">drives the model directly</text>
  </g>
  <rect x="1330" y="555" width="160" height="150" rx="12" fill="none" stroke="#7c8aab" stroke-width="2" stroke-opacity="0.6"/>
  <text x="1410" y="628" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="middle">compute</text>
  <text x="1410" y="649" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="middle">Model()</text>
  <line x1="1230" y1="546" x2="1330" y2="600" stroke="#7c8aab" stroke-width="3" stroke-dasharray="3 8" opacity="0.5"/>
  <text x="1275" y="565" font-family="${FONT}" font-size="20" font-weight="700" fill="#fca5a5" text-anchor="middle">&#215;</text>
  <line x1="1230" y1="682" x2="1330" y2="640" stroke="url(#title)" stroke-width="4"/>
`;

// Turkey-scheduler post: same "shown vs. used" node diagram, reused
// deliberately — the wrap/wrap-temp/climate controls are visible on the
// scheduler UI but never read for turkey's no-stall branch; pit temp/type/
// weight are what actually moves the schedule.
const turkeyGatingMotif = `
  <text x="1230" y="465" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">TURKEY: SHOWN ON-SCREEN VS. ACTUALLY USED</text>
  <g>
    <rect x="970" y="520" width="260" height="52" rx="10" fill="#7c8aab" fill-opacity="0.3" stroke="#7c8aab" stroke-opacity="0.5" stroke-width="1.5"/>
    <text x="1100" y="546" font-family="${FONT}" font-size="13" font-weight="700" fill="#7c8aab" text-anchor="middle">wrap type / wrap temp</text>
    <text x="1100" y="563" font-family="${FONT}" font-size="13" font-weight="700" fill="#7c8aab" text-anchor="middle">/ regional climate</text>
    <text x="1100" y="592" font-family="${FONT}" font-size="12" font-weight="600" fill="#7c8aab" text-anchor="middle" opacity="0.7">visible in the UI, never read</text>
  </g>
  <g>
    <rect x="970" y="656" width="260" height="52" rx="10" fill="#f97316" fill-opacity="0.16" stroke="#f97316" stroke-opacity="0.6" stroke-width="1.5"/>
    <text x="1100" y="687" font-family="${FONT}" font-size="14" font-weight="700" fill="#fdba74" text-anchor="middle">pit temp / pit type / weight</text>
    <text x="1100" y="728" font-family="${FONT}" font-size="12" font-weight="600" fill="#fdba74" text-anchor="middle" opacity="0.85">these move the schedule</text>
  </g>
  <rect x="1330" y="555" width="160" height="150" rx="12" fill="none" stroke="#7c8aab" stroke-width="2" stroke-opacity="0.6"/>
  <text x="1410" y="628" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="middle">turkey</text>
  <text x="1410" y="649" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="middle">schedule</text>
  <line x1="1230" y1="546" x2="1330" y2="600" stroke="#7c8aab" stroke-width="3" stroke-dasharray="3 8" opacity="0.5"/>
  <text x="1275" y="565" font-family="${FONT}" font-size="20" font-weight="700" fill="#fca5a5" text-anchor="middle">&#215;</text>
  <line x1="1230" y1="682" x2="1330" y2="640" stroke="url(#title)" stroke-width="4"/>
`;

// Party planner post: three appetite-multiplier bars (light 0.7x, standard
// 1.0x, hearty 1.35x) with the asymmetric percentage swings called out —
// light's -30% vs hearty's +35% is the whole point.
const appetiteMotif = `
  <text x="1230" y="460" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">APPETITE MULTIPLIER</text>
  <text x="1230" y="484" font-family="${FONT}" font-size="14" font-weight="500" fill="#7c8aab" text-anchor="middle" opacity="0.75">light &#8722;30% &#183; hearty +35% (not symmetric)</text>
  <g>
    <rect x="1070" y="680" width="86" height="140" rx="10" fill="#7c8aab" fill-opacity="0.45"/>
    <rect x="1186" y="620" width="86" height="200" rx="10" fill="#f59e0b" fill-opacity="0.65"/>
    <rect x="1302" y="550" width="86" height="270" rx="10" fill="url(#title)"/>
    <text x="1113" y="663" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle">0.7&#215;</text>
    <text x="1229" y="603" font-family="${FONT}" font-size="17" font-weight="700" fill="#fdba74" text-anchor="middle">1.0&#215;</text>
    <text x="1345" y="533" font-family="${FONT}" font-size="17" font-weight="700" fill="#fdba74" text-anchor="middle">1.35&#215;</text>
    <text x="1113" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">LIGHT</text>
    <text x="1229" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">STANDARD</text>
    <text x="1345" y="850" font-family="${FONT}" font-size="16" font-weight="600" fill="#7c8aab" text-anchor="middle">HEARTY</text>
  </g>
`;

// Cook scheduler post: three horizontal confidence-band bars (foil narrowest,
// naked widest) with a point-estimate marker on each, showing the range the
// single fire-up clock time is quietly built on top of.
const confidenceBandMotif = `
  <text x="1230" y="460" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">FIRE-UP ESTIMATE WIDTH BY WRAP</text>
  <g stroke-linecap="round">
    <line x1="1040" y1="560" x2="1234" y2="560" stroke="#7c8aab" stroke-opacity="0.55" stroke-width="16"/>
    <circle cx="1137" cy="560" r="9" fill="#0d121b" stroke="#7c8aab" stroke-width="3"/>
    <line x1="1053" y1="650" x2="1334" y2="650" stroke="#f59e0b" stroke-opacity="0.7" stroke-width="16"/>
    <circle cx="1193" cy="650" r="9" fill="#0d121b" stroke="#f59e0b" stroke-width="3"/>
    <rect x="1080" y="732" width="393" height="16" rx="8" fill="url(#title)"/>
    <circle cx="1277" cy="740" r="9" fill="#0d121b" stroke="#fb923c" stroke-width="3"/>
  </g>
  <text x="960" y="565" font-family="${FONT}" font-size="15" font-weight="700" fill="#7c8aab" text-anchor="end">FOIL &#177;15%</text>
  <text x="960" y="655" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="end">PAPER &#177;20%</text>
  <text x="960" y="745" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="end">NAKED &#177;25%</text>
`;

// Danger-zone-vs-real-cook post: a horizontal timeline with a dashed 4-hour
// guideline marker, and two bars showing how far past it a normal brisket
// and pork shoulder cook actually run at the stall predictor's own defaults.
const dangerZoneRealityMotif = `
  <text x="1240" y="460" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">TIME TO CLEAR THE DANGER ZONE</text>
  <text x="1190" y="555" font-family="${FONT}" font-size="13" font-weight="700" fill="#fca5a5" text-anchor="middle">4H GUIDELINE</text>
  <line x1="1190" y1="575" x2="1190" y2="710" stroke="#fca5a5" stroke-width="3" stroke-dasharray="4 8" opacity="0.7"/>
  <text x="960" y="605" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="end">BRISKET ~8.1H</text>
  <rect x="990" y="592" width="405" height="16" rx="8" fill="#f59e0b" fill-opacity="0.75"/>
  <text x="960" y="695" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="end">PORK SHOULDER ~9.2H</text>
  <rect x="990" y="682" width="460" height="16" rx="8" fill="url(#title)"/>
`;

// Ribs-no-party-planner post: the same "shown vs. used" two-node diagram as
// the permeability and turkey-scheduler posts, reused deliberately — ribs
// sits outside the party planner's protein list because it has no yield
// block, while the other three proteins do.
const ribsExcludedMotif = `
  <text x="1230" y="465" font-family="${FONT}" font-size="17" font-weight="700" fill="#7c8aab" text-anchor="middle" letter-spacing="1">WHO THE PARTY PLANNER SERVES</text>
  <g>
    <rect x="970" y="520" width="260" height="52" rx="10" fill="#7c8aab" fill-opacity="0.3" stroke="#7c8aab" stroke-opacity="0.5" stroke-width="1.5"/>
    <text x="1100" y="551" font-family="${FONT}" font-size="15" font-weight="700" fill="#7c8aab" text-anchor="middle">RIBS</text>
    <text x="1100" y="592" font-family="${FONT}" font-size="12" font-weight="600" fill="#7c8aab" text-anchor="middle" opacity="0.7">no yield block &#8212; excluded</text>
  </g>
  <g>
    <rect x="970" y="656" width="260" height="52" rx="10" fill="#f97316" fill-opacity="0.16" stroke="#f97316" stroke-opacity="0.6" stroke-width="1.5"/>
    <text x="1100" y="687" font-family="${FONT}" font-size="13" font-weight="700" fill="#fdba74" text-anchor="middle">BRISKET / PORK / TURKEY</text>
    <text x="1100" y="728" font-family="${FONT}" font-size="12" font-weight="600" fill="#fdba74" text-anchor="middle" opacity="0.85">have a yield block</text>
  </g>
  <rect x="1330" y="555" width="160" height="150" rx="12" fill="none" stroke="#7c8aab" stroke-width="2" stroke-opacity="0.6"/>
  <text x="1410" y="628" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="middle">party</text>
  <text x="1410" y="649" font-family="${FONT}" font-size="15" font-weight="700" fill="#fdba74" text-anchor="middle">planner</text>
  <line x1="1230" y1="546" x2="1330" y2="600" stroke="#7c8aab" stroke-width="3" stroke-dasharray="3 8" opacity="0.5"/>
  <text x="1275" y="565" font-family="${FONT}" font-size="20" font-weight="700" fill="#fca5a5" text-anchor="middle">&#215;</text>
  <line x1="1230" y1="682" x2="1330" y2="640" stroke="url(#title)" stroke-width="4"/>
`;

const jobs = [
  { file: 'public/blog/danger-zone-guideline-vs-real-cook.jpg', label: 'DANGER ZONE: THE MATH', motif: dangerZoneRealityMotif },
  { file: 'public/blog/ribs-no-party-planner.jpg', label: 'RIBS: NO PARTY PLANNER', motif: ribsExcludedMotif },
  { file: 'public/blog/party-planner-appetite-asymmetry.jpg', label: 'THE APPETITE DIAL', motif: appetiteMotif },
  { file: 'public/blog/cook-scheduler-confidence-band.jpg', label: 'FIRE-UP CONFIDENCE', motif: confidenceBandMotif },
  { file: 'public/blog/wrap-permeability-is-decorative.jpg', label: 'PERMEABILITY MYTH', motif: permeabilityMotif },
  { file: 'public/blog/turkey-scheduler-dead-controls.jpg', label: 'TURKEY: DEAD CONTROLS', motif: turkeyGatingMotif },
  { file: 'public/blog/faux-cambro-holding.jpg', label: 'THE FAUX CAMBRO', motif: holdWindowMotif },
  { file: 'public/blog/how-much-bbq-per-person.jpg', label: 'HOW MUCH TO BUY', motif: yieldTaxMotif },
  { file: 'public/blog/physics-of-the-stall.jpg', label: 'PHYSICS OF THE STALL', motif: stallPrimerMotif },
  { file: 'public/blog/science-of-smoke.jpg', label: 'SCIENCE OF BARK', motif: barkGranulationMotif },
  { file: 'public/blog/chemistry-of-wood-smoke.jpg', label: 'CLEAN BLUE VS WHITE', motif: smokeColorMotif },
  { file: 'public/blog/turkey-doesnt-stall.jpg', label: 'TURKEY: NO STALL', motif: turkeyMotif },
  { file: 'public/blog/cold-weather-fuel-math.jpg', label: 'COLD-WEATHER FUEL', motif: fuelMotif },
  { file: 'public/blog/ribs-two-clocks.jpg', label: 'RIBS: TWO CLOCKS', motif: ribsMotif },
  { file: 'public/blog/turkey-brine-vs-spatchcock-yield.jpg', label: 'BRINE VS SPATCHCOCK', motif: brineMotif },
  { file: 'public/blog/climate-stall-paradox.jpg', label: 'CLIMATE: STALL SHIFT', motif: climateMotif },
  { file: 'public/blog/prime-brisket-yield-myth.jpg', label: 'BRISKET YIELD MATH', motif: yieldMotif },
  { file: 'public/blog/brisket-mass-exponents.jpg', label: 'MASS VS. THE STALL', motif: massExponentMotif },
  { file: 'public/blog/turkey-danger-zone-clock.jpg', label: 'TURKEY DANGER ZONE', motif: dangerZoneMotif },
  { file: 'public/blog/pork-shoulder-bone-in-yield-gap.jpg', label: 'BONE-IN VS BONELESS', motif: porkTrimMotif },
  { file: 'public/blog/wood-splits-btu-vs-burn-rate.jpg', label: 'WOOD: BTU VS BURN', motif: fuelBtuMotif },
  { file: 'public/blog/pit-type-climb-vs-stall-tradeoff.jpg', label: 'CLIMB VS. STALL TRADE', motif: pitTradeoffMotif },
  { file: 'public/blog/wrap-timing-not-just-what.jpg', label: 'WRAP: TIMING MATTERS', motif: wrapBandMotif },
  { file: 'public/blog/turkey-hold-window-gap.jpg', label: 'TURKEY HOLD WINDOW', motif: turkeyHoldMotif },
  { file: 'public/blog/stall-exponent-universality.jpg', label: 'STALL EXPONENT: 0.333', motif: stallUniversalityMotif },
];

for (const { file, label, motif } of jobs) {
  const svg = base(label, motif);
  await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(file);
  const meta = await sharp(file).metadata();
  console.log(`[blog-hero] wrote ${file} (${meta.width}x${meta.height})`);
}
