/*
 * celebrate.js — ONE confetti + praise module for the suite.
 * Plain ES module, no build step.  Ported from public/studio.js (the canonical
 * copy): confetti() at studio.js:1126-1141, the shuffle-bag bag() at
 * studio.js:235-241, and the praise/encourage catalogs at studio.js:242-248.
 * Colors come from tokens.css (falls back to the literal palette off-DOM).
 * No app wiring — Phase 3 migrates apps onto this.
 */

// Base .confetti CSS, injected once (studio/index.html:111). Makes the module
// drop-in for apps that don't already declare the class.
let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const s = document.createElement("style");
  s.textContent =
    ".confetti{position:fixed;width:14px;height:22px;border-radius:4px;z-index:80;pointer-events:none}" +
    "@media (prefers-reduced-motion: reduce){.confetti{display:none}}";
  document.head.appendChild(s);
}

// Default confetti colors (studio.js:1127) — teal, vowel-orange, good-green, gold.
// Read from tokens.css custom properties when present, else the literals.
function tokenColors() {
  const fallback = ["#0F7C8A", "#DE7B52", "#2E7D5B", "#B7822B"];
  if (typeof document === "undefined" || !window.getComputedStyle) return fallback;
  const cs = getComputedStyle(document.documentElement);
  const pick = (name, def) => (cs.getPropertyValue(name).trim() || def);
  return [
    pick("--c-teal", fallback[0]),
    pick("--c-vowel", fallback[1]),
    pick("--c-good-literacy", fallback[2]),
    pick("--c-confetti-gold", fallback[3]),
  ];
}

/*
 * confetti(count, opts) — faithful port of studio.js confetti(n), parameterized.
 *   count : number of pieces (studio.js called confetti(n) with n pieces)
 *   opts.colors : color array (default = tokens / literal palette)
 * Each piece falls once and removes itself (Web Animations API).
 */
export function confetti(count = 24, opts = {}) {
  if (typeof document === "undefined") return;
  injectCss();
  const colors = opts.colors || tokenColors();
  for (let i = 0; i < count; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    c.style.background = colors[i % colors.length];
    c.style.left = (20 + Math.random() * 60) + "vw";
    c.style.top = "-30px";
    document.body.appendChild(c);
    const fall = c.animate(
      [{ transform: "translateY(0) rotate(0deg)" },
       { transform: `translateY(${70 + Math.random() * 25}vh) rotate(${180 + Math.random() * 360}deg)` }],
      { duration: 1400 + Math.random() * 800, easing: "cubic-bezier(.2,.6,.3,1)" });
    fall.onfinish = () => c.remove();
  }
}

/*
 * makeShuffleBag(items) — faithful port of studio.js bag(): returns each line
 * once until the pool empties, then reshuffles. No line repeats until its whole
 * bag has been used (finite, warm, cached-mp3-friendly — no LLM per utterance).
 */
export function makeShuffleBag(items) {
  const src = items.slice();
  let pool = [];
  return () => {
    if (!pool.length) pool = src.slice().sort(() => Math.random() - 0.5);
    return pool.pop();
  };
}

// Canonical phrase catalogs (studio.js:242-248), exported for reuse. §13.
// Apps wire these to a fast/plain split themselves (studio.js:249-252).
export const PRAISE_FAST = ["So speedy!", "Wow, that was quick!", "Nice looking!",
  "You smashed it!", "Zoom! You knew that one.", "Quick as a fox!",
  "That was very clear answering."];
export const PRAISE_PLAIN = ["Great job!", "Nice reading!", "You did it!",
  "Beautiful work.", "I love how you challenge yourself.", "You're really thinking today.",
  "That's it!", "Yes! Lovely.", "You found it.", "Super spelling."];
export const ENCOURAGE = ["That's okay — let's look together.",
  "Good try — mistakes help us learn.", "Nearly! Let's have another look.",
  "We'll figure it out together.", "Good thinking — let's check."];
