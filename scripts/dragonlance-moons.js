/* Dragonlance Moons of Magic - v0.1.15
 * ARS / Foundry VTT v14
 * Lunar calendar and visual display. Spellcasting automation is intentionally not included yet.
 */

const MODULE_ID = "dragonlance-moons";
const WORLD_STATE = "lunarState";
const DAY_SECONDS = 86400;
const HUD_POSITION = "hudPosition";
const HUD_MINIMIZED = "hudMinimized";
const WIZARD_CLASS_NAME = "Wizard of High Sorcery";
const WIZARD_FLAG = "wizardOfHighSorcery";
const WIZARD_ROBE_FLAG = "robe";
const WIZARD_EFFECT_FLAG = "lunarEffectState";

const MOONS = Object.freeze({
  solinari: { key: "solinari", name: "Solinari", robes: "White Robes", period: 36, color: "white" },
  lunitari: { key: "lunitari", name: "Lunitari", robes: "Red Robes", period: 28, color: "red" },
  nuitari: { key: "nuitari", name: "Nuitari", robes: "Black Robes", period: 8, color: "black" }
});

const PHASES = Object.freeze([
  { id: "low", name: "Low Sanction", save: -1, spells: 0, level: -1 },
  { id: "waxing", name: "Waxing", save: 0, spells: 1, level: 0 },
  { id: "high", name: "High Sanction", save: 1, spells: 2, level: 1 },
  { id: "waning", name: "Waning", save: 0, spells: 0, level: 0 }
]);

const ALIGNMENTS = Object.freeze({
  solLun: { save: 1, spells: 1, level: 1 },
  lunNui: { save: 1, spells: 1, level: 1 },
  solNui: { save: 1, spells: 0, level: 0 },
  allThree: { save: 2, spells: 2, level: 1 }
});

const OPEN_WINDOWS = { lunar: null, gm: null };


const WIZARD_XP = Object.freeze([
  0, 2500, 5000, 10000, 20000, 40000, 60000, 90000, 135000, 250000,
  375000, 750000, 1125000, 1500000, 1875000, 2250000, 2625000, 3000000,
  3375000, 3750000, 4150000, 4550000, 5000000, 5500000, 6000000
]);

const WIZARD_SPELLS = Object.freeze([
  [1,0,0,0,0,0,0,0,0],
  [2,0,0,0,0,0,0,0,0],
  [2,1,0,0,0,0,0,0,0],
  [3,2,0,0,0,0,0,0,0],
  [4,2,1,0,0,0,0,0,0],
  [4,2,2,0,0,0,0,0,0],
  [4,3,2,1,0,0,0,0,0],
  [4,3,3,2,0,0,0,0,0],
  [4,3,3,2,1,0,0,0,0],
  [4,4,3,2,2,0,0,0,0],
  [4,4,4,3,3,0,0,0,0],
  [4,4,4,4,4,1,0,0,0],
  [5,5,5,4,4,2,0,0,0],
  [5,5,5,4,4,2,1,0,0],
  [5,5,5,5,5,2,1,0,0],
  [5,5,5,5,5,3,2,1,0],
  [5,5,5,5,5,3,3,2,0],
  [5,5,5,5,5,3,3,2,1],
  [5,5,5,5,5,3,3,3,1],
  [6,5,5,5,5,4,3,3,2],
  [6,5,5,5,5,4,3,3,2],
  [6,6,5,5,5,5,4,3,2],
  [6,6,6,5,5,5,4,3,3],
  [6,6,6,6,5,5,5,4,3],
  [6,6,6,6,6,5,5,4,4]
]);

function wizardHdFormula(level) {
  if (level <= 10) return "1d4";
  return "1";
}

function wizardRankData(sourceRanks = []) {
  return WIZARD_XP.map((xp, index) => {
    const level = index + 1;
    const source = foundry.utils.deepClone(sourceRanks[index] ?? {});
    const arcane = [0, ...WIZARD_SPELLS[index]];
    return {
      ...source,
      level,
      xp,
      hdformula: wizardHdFormula(level),
      arcane,
      divine: Array(8).fill(0),
      casterlevel: { ...(source.casterlevel ?? {}), arcane: level, divine: 0, psionic: source.casterlevel?.psionic ?? 1 },
      title: level === 18 ? "Master*" : (source.title ?? "")
    };
  });
}

function wizardAdvancementData(sourceAdvancement = []) {
  return WIZARD_XP.map((xp, index) => ({
    ...(foundry.utils.deepClone(sourceAdvancement[index] ?? {})),
    level: index + 1
  }));
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizePosition(position, period) {
  const n = Number.parseInt(position, 10);
  if (!Number.isFinite(n)) return 0;
  return ((n % period) + period) % period;
}

function elapsedDays(from, to) {
  return Math.floor((Number(to) - Number(from)) / DAY_SECONDS);
}

// The 1d8 results are the eight numbered starting boxes printed on the
// Moon Tracking Chart.  The values below are the actual box indices on each
// moon's orbit, counted clockwise from the Full Moon box (index 0).  The chart
// itself is advanced counter-clockwise one box per game day.
//
// Solinari: 36 boxes; Lunitari: 28 boxes; Nuitari: 8 boxes.
const ANCHOR_POSITIONS = Object.freeze({
  solinari: { 1: 32, 2: 27, 3: 23, 4: 18, 5: 14, 6: 9, 7: 4, 8: 0 },
  lunitari: { 1: 0, 2: 25, 3: 21, 4: 18, 5: 14, 6: 11, 7: 7, 8: 4 },
  nuitari: { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1, 6: 0, 7: 7, 8: 6 }
});

function currentPosition(moon, state, worldTime = game.time.worldTime) {
  if (!state?.initialized) return null;
  const days = elapsedDays(state.epochWorldTime, worldTime);
  return normalizePosition((state[moon.key]?.position ?? 0) + days, moon.period);
}

function chartIndex(moon, position, anchorRoll = 8) {
  const anchor = ANCHOR_POSITIONS[moon.key]?.[anchorRoll] ?? 0;
  // position is the number of daily counter-clockwise moves since the
  // selected 1d8 starting box.
  return normalizePosition(anchor - normalizePosition(position, moon.period), moon.period);
}

function orbitalAngle(moon, position, anchorRoll = 8) {
  // 0° is the exact Full Moon box. Angles increase clockwise around the
  // printed chart; the moons themselves move counter-clockwise.
  return chartIndex(moon, position, anchorRoll) * 360 / moon.period;
}

function phaseForAngle(angle) {
  // The four Sanctions are quarters of the orbital cycle.
  // High Sanction is a whole quarter, not synonymous with the exact Full Moon.
  if (angle >= 315 || angle < 45) return PHASES[2]; // High Sanction
  if (angle < 135) return PHASES[1];              // Waxing
  if (angle < 225) return PHASES[0];              // Low Sanction
  return PHASES[3];                               // Waning
}

function phaseForPosition(moon, position, anchorRoll = 8) {
  return phaseForAngle(orbitalAngle(moon, position, anchorRoll));
}

// High/Low Sanction are orbital quarters used by the lunar display.
// High Sorcery's mechanical table, however, uses the actual lunar phase:
// Waxing, exact Full Moon, Waning, or exact New Moon.
function wizardLunarPhase(moonData) {
  if (!moonData?.moon || moonData.position == null) return null;
  const angle = orbitalAngle(moonData.moon, moonData.position, moonData.anchorRoll);
  if (angularDistanceDegrees(angle, 0) < 1e-9) return "full";
  if (angularDistanceDegrees(angle, 180) < 1e-9) return "new";
  return angle < 180 ? "waxing" : "waning";
}

function phaseLabel(moon, position, anchorRoll = 8) {
  const phase = phaseForPosition(moon, position, anchorRoll);
  const angle = orbitalAngle(moon, position, anchorRoll);
  // Exact Full/New Moon are single orbital positions; the Sanctions span quarters.
  if (angle === 0) return "High Sanction · Full Moon";
  if (angle === 180) return "Low Sanction · New Moon";
  if (phase.id === "high") return "High Sanction";
  if (phase.id === "low") return "Low Sanction";
  return phase.name;
}

function isExactPhase(moonData, targetAngle) {
  if (!moonData?.moon || moonData.position == null) return false;
  return angularDistanceDegrees(orbitalAngle(moonData.moon, moonData.position, moonData.anchorRoll), targetAngle) < 1e-9;
}

function angularPosition(moon, position, anchorRoll = 8) {
  return orbitalAngle(moon, position, anchorRoll) * Math.PI / 180;
}

function angularDistanceDegrees(a, b) {
  let d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function isAligned(a, b) {
  // A chart box is considered aligned when the angular spans of the two
  // occupied boxes share a radial line from the centre of the chart.
  const aa = orbitalAngle(a.moon, a.position, a.anchorRoll);
  const bb = orbitalAngle(b.moon, b.position, b.anchorRoll);
  const halfA = 180 / a.moon.period;
  const halfB = 180 / b.moon.period;
  return angularDistanceDegrees(aa, bb) <= (halfA + halfB) + 1e-9;
}

function alignmentTriplet(data) {
  const pair = {
    solLun: isAligned(data.solinari, data.lunitari),
    lunNui: isAligned(data.lunitari, data.nuitari),
    solNui: isAligned(data.solinari, data.nuitari)
  };
  const intervals = Object.values(data).map(d => {
    if (!d?.moon) return null;
    const angle = orbitalAngle(d.moon, d.position, d.anchorRoll);
    const half = 180 / d.moon.period;
    return { angle, half };
  }).filter(Boolean);
  // For Night of the Eye all three boxes must share a radial line.
  let allThree = false;
  if (intervals.length === 3) {
    const candidates = intervals.flatMap(i => [i.angle, (i.angle + i.half) % 360, (i.angle - i.half + 360) % 360]);
    allThree = candidates.some(test => intervals.every(i => angularDistanceDegrees(test, i.angle) <= i.half + 1e-9));
  }
  return { ...pair, allThree };
}

function calculateAlignment(data) {
  return alignmentTriplet(data);
}

function calculateState(worldTime = game.time.worldTime) {
  const state = game.settings.get(MODULE_ID, WORLD_STATE);
  if (!state?.initialized) return { initialized: false };
  const moons = {};
  for (const moon of Object.values(MOONS)) {
    const position = currentPosition(moon, state, worldTime);
    moons[moon.key] = {
      moon,
      position,
      chartPosition: chartIndex(moon, position, state[moon.key]?.anchorRoll ?? 8) + 1,
      anchorRoll: state[moon.key]?.anchorRoll ?? 8,
      angle: orbitalAngle(moon, position, state[moon.key]?.anchorRoll ?? 8),
      phase: phaseForPosition(moon, position, state[moon.key]?.anchorRoll ?? 8),
      phaseLabel: phaseLabel(moon, position, state[moon.key]?.anchorRoll ?? 8),
      appearance: lunarAppearance(moon, position, state[moon.key]?.anchorRoll ?? 8)
    };
  }
  return { initialized: true, worldTime, state, ...moons, alignment: calculateAlignment(moons) };
}

function randomAnchorPosition(moon) {
  const roll = Math.floor(Math.random() * 8) + 1;
  // Position 0 means "the rolled 1d8 anchor box". Subsequent days move
  // counter-clockwise one orbital box at a time.
  return { roll, position: 0 };
}

async function saveState(positions, anchorRolls = {}) {
  const state = {
    initialized: true,
    epochWorldTime: game.time.worldTime,
    solinari: { position: normalizePosition(positions.solinari, MOONS.solinari.period), anchorRoll: clampInt(anchorRolls.solinari ?? 8, 1, 8) },
    lunitari: { position: normalizePosition(positions.lunitari, MOONS.lunitari.period), anchorRoll: clampInt(anchorRolls.lunitari ?? 1, 1, 8) },
    nuitari: { position: normalizePosition(positions.nuitari, MOONS.nuitari.period), anchorRoll: clampInt(anchorRolls.nuitari ?? 6, 1, 8) }
  };
  await game.settings.set(MODULE_ID, WORLD_STATE, state);
  return state;
}

function formatMod(value) { return value > 0 ? `+${value}` : `${value}`; }

function isNightOfTheEye(data) {
  // Night of the Eye is the singular configuration where all three moons
  // are simultaneously at their exact Full Moon position and therefore
  // appear in the same front-to-back alignment. Being merely in High
  // Sanction, or merely aligned by overlapping chart boxes, is not enough.
  return Boolean(data?.initialized &&
    isExactPhase(data.solinari, 0) &&
    isExactPhase(data.lunitari, 0) &&
    isExactPhase(data.nuitari, 0) &&
    data.alignment?.allThree);
}

function postNightOfTheEye() {
  ChatMessage.create({ content: `<div class="dlm-night-eye-chat"><img src="modules/${MODULE_ID}/assets/night-of-the-eye.gif" alt="Night of the Eye"><div class="dlm-night-eye-chat-title">✦ NIGHT OF THE EYE ✦</div><p>The three moons of magic are aligned at High Sanction. Magic reaches its peak.</p></div>` });
}

function alignmentName(alignment) {
  const names = [];
  if (alignment.solLun) names.push("Solinari + Lunitari");
  if (alignment.lunNui) names.push("Lunitari + Nuitari");
  if (alignment.solNui) names.push("Solinari + Nuitari");
  if (alignment.allThree) return "All Three Moons";
  return names.length ? names.join(" · ") : "None";
}

function phaseDescription(phase) {
  if (phase.id === "low") return "Low Sanction";
  if (phase.id === "high") return "High Sanction";
  return phase.name;
}

function lunarAppearance(moon, position, anchorRoll = 8) {
  const angle = orbitalAngle(moon, position, anchorRoll);
  if (angle === 0) return "Full Moon";
  if (angle === 180) return "New Moon";
  if (angle < 90) return "Waxing Gibbous";
  if (angle < 180) return "Waxing Crescent";
  if (angle < 270) return "Waning Crescent";
  return "Waning Gibbous";
}

function moonIllumination(moon, position, anchorRoll = 8) {
  if (position == null) return 0;
  const angle = orbitalAngle(moon, position, anchorRoll) * Math.PI / 180;
  // 0° is full/high sanction; 180° is new/low sanction.
  return 0.5 + 0.5 * Math.cos(angle);
}

function moonIcon(moon, phase, size = "normal", position = 0, anchorRoll = 8) {
  const illumination = moonIllumination(moon, position, anchorRoll);
  const angle = orbitalAngle(moon, position, anchorRoll) * Math.PI / 180;
  const waxing = Math.sin(angle) >= 0;
  // Render the visible illuminated disc over a dark lunar body. At full moon
  // the light disc is centered; at new moon it is displaced completely off
  // the visible disc. This keeps the phase geometry visually correct.
  const lightOffset = waxing ? (1 - illumination) * 94 : -(1 - illumination) * 94;
  const sizeClass = size === "large" ? "large" : "normal";
  const colors = {
    white: { light: "#f3f1df", mid: "#aaa99e", dark: "#3c3c39", glow: "rgba(245,242,218,.38)" },
    red: { light: "#e8a08f", mid: "#9a4941", dark: "#351414", glow: "rgba(211,83,65,.30)" },
    black: { light: "#777883", mid: "#414149", dark: "#111117", glow: "rgba(155,155,175,.22)" }
  }[moon.color];
  const id = `dlm-${moon.key}-${size}-${Math.round(illumination * 1000)}-${Math.random().toString(36).slice(2,7)}`;
  return `<span class="dlm-real-moon ${moon.color} ${phase.id} ${sizeClass}" style="--moon-glow:${colors.glow}" aria-label="${moon.name} — ${phaseLabel(moon, position, anchorRoll)}">
    <svg viewBox="0 0 100 100" role="img" aria-hidden="true">
      <defs>
        <radialGradient id="${id}-surface" cx="34%" cy="28%" r="72%">
          <stop offset="0" stop-color="${colors.light}"/>
          <stop offset=".58" stop-color="${colors.mid}"/>
          <stop offset="1" stop-color="${colors.dark}"/>
        </radialGradient>
        <radialGradient id="${id}-crater" cx="35%" cy="30%" r="70%">
          <stop offset="0" stop-color="rgba(255,255,255,.12)"/>
          <stop offset="1" stop-color="rgba(0,0,0,.30)"/>
        </radialGradient>
        <clipPath id="${id}-clip"><circle cx="50" cy="50" r="47"/></clipPath>
      </defs>
      <circle cx="50" cy="50" r="47" fill="${colors.dark}"/>
      <circle cx="50" cy="50" r="47" fill="url(#${id}-surface)" transform="translate(${lightOffset} 0)" clip-path="url(#${id}-clip)"/>
      <g clip-path="url(#${id}-clip)" opacity=".42" fill="url(#${id}-crater)" transform="translate(${lightOffset} 0)">
        <circle cx="30" cy="27" r="8"/><circle cx="66" cy="24" r="5"/><circle cx="73" cy="58" r="10"/>
        <circle cx="39" cy="68" r="6"/><circle cx="22" cy="57" r="4"/><circle cx="57" cy="78" r="4"/>
        <circle cx="50" cy="45" r="3"/><circle cx="80" cy="34" r="3"/>
      </g>
      <circle cx="50" cy="50" r="47" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="1"/>
    </svg>
  </span>`;
}

function renderDisplay() {
  if (!game.settings.get(MODULE_ID, "showHUD")) return;
  const old = document.getElementById("dlm-hud");
  const position = old ? { left: old.style.left, top: old.style.top, minimized: old.classList.contains("minimized") } : getHudPosition();
  old?.remove();

  const data = calculateState();
  const root = document.createElement("section");
  root.id = "dlm-hud";
  root.className = `dlm-hud${position.minimized ? " minimized" : ""}`;
  root.style.left = position.left;
  root.style.top = position.top;
  root.style.right = "auto";

  root.innerHTML = `
    <header class="dlm-hud-header">
      <div class="dlm-title"><i class="fas fa-moon"></i> THE MOONS OF MAGIC</div>
      <div class="dlm-window-tools">
        ${game.user.isGM ? `<button type="button" class="dlm-tool dlm-gm-open" title="Lunar Controls"><i class="fas fa-cog"></i></button>` : ""}
        <button type="button" class="dlm-tool dlm-minimize" title="Minimize / Restore"><i class="fas fa-minus"></i></button>
        <button type="button" class="dlm-tool dlm-open" title="Open Lunar Display"><i class="fas fa-expand"></i></button>
      </div>
    </header>
    <div class="dlm-hud-body"></div>`;

  const body = root.querySelector(".dlm-hud-body");
  if (!data.initialized) {
    body.innerHTML = `<div class="dlm-uninitialized">
      <div class="dlm-uninitialized-icon"><i class="fas fa-moon"></i></div>
      <strong>LUNAR CALENDAR NOT INITIALIZED</strong>
      <span>Set the starting positions of the three moons to begin tracking the Dragonlance lunar calendar.</span>
      <button type="button" class="dlm-primary">${game.user.isGM ? "Open Lunar Controls" : "View Lunar Configuration"}</button>
    </div>`;
  } else {
    body.innerHTML = `<div class="dlm-moons">
      ${Object.values(MOONS).map(m => {
        const d = data[m.key];
        return `<div class="dlm-moon-row">
          ${moonIcon(m, d.phase, "normal", d.position, d.anchorRoll)}
          <div class="dlm-moon-info"><strong>${m.name}</strong><span>${d.phaseLabel}</span><small>${d.appearance}</small></div>
        </div>`;
      }).join("")}
    </div>
    <div class="dlm-alignment ${isNightOfTheEye(data) ? "night-eye" : ""}">${isNightOfTheEye(data) ? "✦ NIGHT OF THE EYE ✦" : alignmentName(data.alignment)}</div>`;
  }

  document.body.appendChild(root);
  const header = root.querySelector(".dlm-hud-header");
  const minimize = root.querySelector(".dlm-minimize");
  makeDraggable(root, header, HUD_POSITION);
  minimize.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if (root.dataset.suppressMinimizeClick === "true") {
      root.dataset.suppressMinimizeClick = "false";
      return;
    }
    if (root.dataset.dragged === "true") {
      root.dataset.dragged = "false";
      return;
    }
    const minimized = !root.classList.contains("minimized");
    root.classList.toggle("minimized", minimized);
    await game.settings.set(MODULE_ID, HUD_MINIMIZED, minimized);
  });
  root.querySelector(".dlm-open").addEventListener("click", () => renderLunarDialog());
  root.querySelector(".dlm-primary")?.addEventListener("click", () => game.user.isGM ? renderGMControls() : renderLunarDialog());
  root.querySelector(".dlm-gm-open")?.addEventListener("click", () => renderGMControls());
}

function getHudPosition() {
  const saved = game.settings.get(MODULE_ID, HUD_POSITION) || {};
  return { left: saved.left ?? "calc(100vw - 300px)", top: saved.top ?? "80px", minimized: Boolean(game.settings.get(MODULE_ID, HUD_MINIMIZED)) };
}

function makeDraggable(element, handle, settingKey) {
  let drag = null;
  let moved = false;
  let pointerTarget = null;

  handle.addEventListener("pointerdown", event => {
    const isHud = element.id === "dlm-hud";
    const minimizedHud = isHud && element.classList.contains("minimized");
    const button = event.target.closest("button");

    // Expanded HUD and floating windows: buttons are controls, never drag handles.
    // Minimized HUD: the moon button doubles as the drag surface; click-vs-drag
    // is resolved by the movement threshold below.
    if (button && !minimizedHud) return;

    const rect = element.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, pointerId: event.pointerId };
    moved = false;
    pointerTarget = button;
    handle.setPointerCapture?.(event.pointerId);
  });

  handle.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    if (!moved) return;
    element.style.left = `${Math.max(0, drag.left + dx)}px`;
    element.style.top = `${Math.max(0, drag.top + dy)}px`;
  });

  handle.addEventListener("pointerup", async event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = element.getBoundingClientRect();
    const wasMoved = moved;
    const wasMinimizedHud = element.id === "dlm-hud" && element.classList.contains("minimized");
    const clickedMinimize = wasMinimizedHud && pointerTarget?.classList.contains("dlm-minimize");
    drag = null;
    pointerTarget = null;

    if (settingKey && wasMoved) {
      await game.settings.set(MODULE_ID, settingKey, {
        left: `${Math.round(rect.left)}px`,
        top: `${Math.round(rect.top)}px`
      });
    }

    if (clickedMinimize && wasMoved) {
      // Suppress the synthetic click generated after a drag.
      element.dataset.dragged = "true";
    } else if (clickedMinimize && !wasMoved) {
      // A click on the minimized moon is handled here rather than relying on
      // the browser's synthetic click after pointer capture. This guarantees
      // that the minimized HUD always restores with a simple click.
      element.classList.remove("minimized");
      element.dataset.suppressMinimizeClick = "true";
      await game.settings.set(MODULE_ID, HUD_MINIMIZED, false);
    }
  });

  handle.addEventListener("pointercancel", () => {
    drag = null;
    pointerTarget = null;
    moved = false;
  });
}

function closeOpenWindow(key) {
  OPEN_WINDOWS[key]?.remove();
  OPEN_WINDOWS[key] = null;
}

function makeWindow(key, title, icon, bodyHTML, buttonsHTML = "") {
  closeOpenWindow(key);
  const root = document.createElement("section");
  root.className = "dlm-floating-window";
  root.innerHTML = `<header class="dlm-window-header"><div><i class="${icon}"></i> ${title}</div><div class="dlm-window-tools">
    <button type="button" class="dlm-tool dlm-window-min" title="Minimize"><i class="fas fa-minus"></i></button>
    <button type="button" class="dlm-tool dlm-window-close" title="Close"><i class="fas fa-times"></i></button>
  </div></header><div class="dlm-window-body">${bodyHTML}</div>${buttonsHTML ? `<footer class="dlm-window-footer">${buttonsHTML}</footer>` : ""}`;
  document.body.appendChild(root);
  if (key === "gm") { root.style.left = "calc(50% - 325px)"; root.style.top = "110px"; }
  if (key === "lunar") { root.style.left = "calc(50% - 325px)"; root.style.top = "110px"; }
  makeDraggable(root, root.querySelector(".dlm-window-header"), null);
  root.querySelector(".dlm-window-min").addEventListener("click", () => root.classList.toggle("minimized"));
  root.querySelector(".dlm-window-close").addEventListener("click", () => closeOpenWindow(key));
  OPEN_WINDOWS[key] = root;
  return root;
}

function renderLunarDialog() {
  const data = calculateState();
  if (!data.initialized) {
    if (game.user.isGM) return renderGMControls();
    ui.notifications.info(game.i18n.localize("DL_MOONS.notInitialized"));
    return;
  }
  const rows = Object.values(MOONS).map(m => {
    const d = data[m.key];
    return `<div class="dlm-detail-row">
      <div class="dlm-detail-moon">${moonIcon(m, d.phase, "large", d.position, d.anchorRoll)}<div><strong>${m.name}</strong><small>${m.robes}</small></div></div>
      <div><span class="dlm-label">Phase</span><strong>${d.appearance}</strong><small>${d.phaseLabel}</small></div>
      <div><span class="dlm-label">Orbital Position</span><strong>${d.chartPosition} / ${m.period}</strong></div>
      <div><span class="dlm-label">Phase Modifiers</span><strong>Save ${formatMod(d.phase.save)} · Spells +${d.phase.spells} · Level ${formatMod(d.phase.level)}</strong></div>
    </div>`;
  }).join("");
  const a = data.alignment;
  const mods = a.allThree ? ALIGNMENTS.allThree : {
    save: (a.solLun ? 1 : 0) + (a.lunNui ? 1 : 0) + (a.solNui ? 1 : 0),
    spells: (a.solLun ? 1 : 0) + (a.lunNui ? 1 : 0),
    level: (a.solLun ? 1 : 0) + (a.lunNui ? 1 : 0)
  };
  const nightEye = isNightOfTheEye(data);
  const body = `<div class="dlm-dialog-banner ${nightEye ? "night-eye" : ""}">${nightEye ? "✦ NIGHT OF THE EYE ✦" : alignmentName(a)}</div>
    ${rows}<div class="dlm-alignment-detail"><div><span class="dlm-label">Alignment</span><strong>${alignmentName(a)}</strong></div>
    <div><span class="dlm-label">Alignment Modifiers</span><strong>Save ${formatMod(mods.save)} · Spells +${mods.spells} · Level ${formatMod(mods.level)}</strong></div></div>
    <p class="dlm-footnote">${game.i18n.localize("DL_MOONS.playerInfo")}</p>`;
  const root = makeWindow("lunar", "Dragonlance — Lunar Configuration", "fas fa-moon", body);
  root.classList.add("dlm-config-window");
}

function renderGMControls() {
  if (!game.user.isGM) return;
  const current = calculateState();
  const rollFor = key => current.initialized ? current[key].anchorRoll : ({ solinari: 8, lunitari: 1, nuitari: 6 }[key]);
  const body = `<form class="dlm-gm-form">
    <div class="dlm-gm-grid">${Object.values(MOONS).map(m => `<label><span>${m.name}</span><select name="${m.key}">${[1,2,3,4,5,6,7,8].map(n => `<option value="${n}" ${n === rollFor(m.key) ? "selected" : ""}>${n}</option>`).join("")}</select></label>`).join("")}</div>
    <div class="dlm-rolls">${Object.values(MOONS).map(m => `<div><strong>${m.name}</strong>: ${current.initialized ? `${current[m.key].anchorRoll}` : "—"}</div>`).join("")}</div>
  </form>`;
  const footer = `<button type="button" class="dlm-action dlm-random"><i class="fas fa-dice"></i> Randomize (1d8 each)</button>
    <button type="button" class="dlm-action dlm-set"><i class="fas fa-check"></i> Set Starting Positions</button>`;
  const root = makeWindow("gm", "Dragonlance — Lunar Controls", "fas fa-cog", body, footer);
  root.querySelector(".dlm-random").addEventListener("click", async () => {
    const generated = {}, rolls = {};
    for (const moon of Object.values(MOONS)) { const r = randomAnchorPosition(moon); generated[moon.key] = r.position; rolls[moon.key] = r.roll; }
    await saveState({ solinari: 0, lunitari: 0, nuitari: 0 }, rolls);
    refreshAllWindows();
    ChatMessage.create({ content: `<strong>The Moons of Magic have been randomized.</strong><br>Solinari 1d8: ${rolls.solinari} · Lunitari 1d8: ${rolls.lunitari} · Nuitari 1d8: ${rolls.nuitari}` });
    if (isNightOfTheEye(calculateState())) postNightOfTheEye();
  });
  root.querySelector(".dlm-set").addEventListener("click", async () => {
    const form = root.querySelector("form");
    const rolls = {};
    for (const moon of Object.values(MOONS)) rolls[moon.key] = clampInt(form.elements[moon.key].value, 1, 8);
    await saveState({ solinari: 0, lunitari: 0, nuitari: 0 }, rolls);
    refreshAllWindows();
    ui.notifications.info("Lunar starting positions updated.");
    if (isNightOfTheEye(calculateState())) postNightOfTheEye();
  });
}

function refreshWindowContent() {
  if (OPEN_WINDOWS.lunar) {
    const wasMin = OPEN_WINDOWS.lunar.classList.contains("minimized");
    const wasLeft = OPEN_WINDOWS.lunar.style.left, wasTop = OPEN_WINDOWS.lunar.style.top;
    renderLunarDialog();
    OPEN_WINDOWS.lunar.classList.toggle("minimized", wasMin);
    OPEN_WINDOWS.lunar.style.left = wasLeft; OPEN_WINDOWS.lunar.style.top = wasTop;
  }
  if (OPEN_WINDOWS.gm) {
    const wasMin = OPEN_WINDOWS.gm.classList.contains("minimized");
    const wasLeft = OPEN_WINDOWS.gm.style.left, wasTop = OPEN_WINDOWS.gm.style.top;
    renderGMControls();
    OPEN_WINDOWS.gm.classList.toggle("minimized", wasMin);
    OPEN_WINDOWS.gm.style.left = wasLeft; OPEN_WINDOWS.gm.style.top = wasTop;
  }
}

function refreshAllWindows() { renderDisplay(); refreshWindowContent(); }

function registerSettings() {
  game.settings.register(MODULE_ID, WORLD_STATE, { scope: "world", config: false, type: Object, default: { initialized: false } });
  game.settings.register(MODULE_ID, HUD_POSITION, { scope: "client", config: false, type: Object, default: { left: "calc(100vw - 300px)", top: "80px" } });
  game.settings.register(MODULE_ID, HUD_MINIMIZED, { scope: "client", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "showHUD", { name: "Show Lunar HUD", hint: "Show the current lunar configuration to all players.", scope: "client", config: true, type: Boolean, default: true, onChange: () => renderDisplay() });
}

function addSceneControl() {
  Hooks.on("getSceneControlButtons", controls => {
    const tokenControls = controls?.tokens;
    if (!tokenControls) return;
    tokenControls.tools ??= {};
    tokenControls.tools.dragonlanceMoons = { name: "dragonlanceMoons", title: "Dragonlance Lunar Display", icon: "fas fa-moon", button: true, onChange: () => renderLunarDialog(), visible: true };
    if (game.user.isGM) tokenControls.tools.dragonlanceMoonControls = { name: "dragonlanceMoonControls", title: "Dragonlance Lunar Controls", icon: "fas fa-cog", button: true, onChange: () => renderGMControls(), visible: true };
  });
}

function refreshAfterTimeChange(worldTime) {
  const before = calculateState(worldTime - DAY_SECONDS);
  const after = calculateState(worldTime);
  renderDisplay();
  refreshWindowContent();
  for (const actor of game.actors?.contents ?? []) syncWizardLunarEffects(actor);
  if (!game.user.isGM || !before.initialized || !after.initialized) return;
  const enteredNight = !isNightOfTheEye(before) && isNightOfTheEye(after);
  if (enteredNight) {
    postNightOfTheEye();
  } else if (before.alignment?.allThree !== after.alignment?.allThree || alignmentName(before.alignment) !== alignmentName(after.alignment)) {
    ChatMessage.create({ content: `<strong>The Moons of Magic</strong><br>${game.i18n.localize("DL_MOONS.chatNoticeAlignment")}<br><em>${alignmentName(after.alignment)}</em>` });
  }
}



const WIZARD_ROBES = Object.freeze({
  none: { label: "None", moon: null },
  white: { label: "White Robe", moon: "solinari" },
  red: { label: "Red Robe", moon: "lunitari" },
  black: { label: "Black Robe", moon: "nuitari" }
});

function getWizardClasses(actor) {
  return actor?.classes?.filter(c => c.type === "class" && c.flags?.[MODULE_ID]?.[WIZARD_FLAG] === true) ?? [];
}

function getWizardRobe(classItem) {
  const value = classItem?.flags?.[MODULE_ID]?.[WIZARD_ROBE_FLAG];
  return WIZARD_ROBES[value] ? value : "none";
}

function wizardPatronMoon(robe) {
  return WIZARD_ROBES[robe]?.moon ?? null;
}

function getIntelligence(actor) {
  return Number(actor?.system?.abilities?.int?.value ?? 0);
}

function getWizardLunarModifiers(actor, classItem, data = calculateState()) {
  const result = { save: 0, spells: 0, level: 0, patron: null, robe: getWizardRobe(classItem), phase: null, sanction: null };
  const level = actor?.getClassLevel?.(classItem) ?? Object.values(classItem?.system?.advancement ?? {}).length;
  if (level < 4 || result.robe === "none" || !data?.initialized) return result;

  const patron = wizardPatronMoon(result.robe);
  result.patron = patron;
  const moon = data[patron];
  if (!moon) return result;
  // High Sorcery uses the four orbital Sanctions as the mechanical phases.
  // Full Moon is one exact position INSIDE High Sanction; New Moon is one
  // exact position INSIDE Low Sanction. They are not separate mechanical
  // phases.
  result.phase = moon.phase?.id ?? null;
  result.sanction = result.phase;

  if (result.phase === "low") {
    result.save -= 1;
    result.level -= 1;
  } else if (result.phase === "waxing") {
    result.spells += 1;
  } else if (result.phase === "high") {
    const qualifies = level >= 6 && getIntelligence(actor) >= 15;
    if (qualifies) {
      result.save += 1;
      result.spells += 2;
      result.level += 1;
    } else {
      // Wizards below 6th level or with INT below 15 receive the waxing
      // spell bonus while the moon is in High Sanction.
      result.spells += 1;
    }
  }
  // Waning gives no lunar-phase modifier.

  // Alignment modifiers depend on the wizard's patron moon.
  if (data.alignment?.allThree) {
    result.save += ALIGNMENTS.allThree.save;
    result.spells += ALIGNMENTS.allThree.spells;
    result.level += ALIGNMENTS.allThree.level;
  } else {
    const aligned = result.robe === "white"
      ? { solLun: data.alignment?.solLun, solNui: data.alignment?.solNui }
      : result.robe === "red"
        ? { solLun: data.alignment?.solLun, lunNui: data.alignment?.lunNui }
        : { lunNui: data.alignment?.lunNui, solNui: data.alignment?.solNui };

    if (aligned.solLun) {
      result.save += ALIGNMENTS.solLun.save;
      result.spells += ALIGNMENTS.solLun.spells;
      result.level += ALIGNMENTS.solLun.level;
    }
    if (aligned.lunNui) {
      result.save += ALIGNMENTS.lunNui.save;
      result.spells += ALIGNMENTS.lunNui.spells;
      result.level += ALIGNMENTS.lunNui.level;
    }
    if (aligned.solNui) {
      result.save += ALIGNMENTS.solNui.save;
      result.spells += ALIGNMENTS.solNui.spells;
      result.level += ALIGNMENTS.solNui.level;
    }
  }
  return result;
}

function getWizardLunarSignature(actor, classItem, mods, data = calculateState()) {
  const moonPositions = Object.fromEntries(Object.values(MOONS).map(m => [
    m.key,
    data?.[m.key]?.chartPosition ?? null
  ]));
  return JSON.stringify({
    robe: getWizardRobe(classItem),
    level: actor?.getClassLevel?.(classItem) ?? 0,
    intelligence: getIntelligence(actor),
    patron: mods?.patron ?? null,
    phase: mods?.phase ?? null,
    save: mods?.save ?? 0,
    spells: mods?.spells ?? 0,
    effectiveLevel: mods?.level ?? 0,
    alignment: data?.alignment ?? null,
    moons: moonPositions
  });
}

function getBonusAllocationRecord(actor, classItem, mods, data = calculateState()) {
  const saved = actor?.flags?.[MODULE_ID]?.moonBonusAllocation;
  const signature = getWizardLunarSignature(actor, classItem, mods, data);

  // v0.1.15 stored this as a plain array. Treat that old value as stale:
  // lunar configuration changes must never carry an old allocation forward.
  if (!saved || Array.isArray(saved) || typeof saved !== "object") {
    return { signature, levels: [] };
  }
  if (saved.signature !== signature || !Array.isArray(saved.levels)) {
    return { signature, levels: [] };
  }
  return {
    signature,
    levels: saved.levels.map(Number).filter(Number.isInteger)
  };
}

function getAllocatedBonusSpells(actor, classItem, mods, data = calculateState()) {
  const record = getBonusAllocationRecord(actor, classItem, mods, data);
  const levels = record.levels;
  const realLevel = actor?.getClassLevel?.(classItem) ?? Object.values(classItem?.system?.advancement ?? {}).length;
  const castable = wizardSlotsAtLevel(classItem, realLevel);
  const count = Math.max(0, Number(mods?.spells ?? 0));
  return levels
    .filter(level => level >= 1 && level <= 9 && castable[level - 1] > 0)
    .slice(0, count);
}

function wizardSlotsAtLevel(classItem, level) {
  const ranks = Object.values(classItem?.system?.ranks ?? {});
  const numericLevel = Number(level);
  if (!Number.isFinite(numericLevel) || numericLevel < 1 || !ranks.length) return Array(9).fill(0);
  const index = Math.max(0, Math.min(ranks.length - 1, numericLevel - 1));
  const rank = ranks[index];
  // ARS reserves arcane[0] for the unused zero-level slot; spell level 1 is arcane[1].
  return Array.from({ length: 9 }, (_, i) => Number(rank?.arcane?.[i + 1] ?? 0) || 0);
}

function buildWizardEffectChanges(actor, wizardClass, mods) {
  const changes = [];
  if (!wizardClass || (mods.level === 0 && mods.save === 0)) return changes;

  // These are the two effects that belong to ARS Active Effects: saving
  // throws and effective caster level. Bonus spell slots are synchronized
  // separately from the actor's real class progression so they can never
  // accumulate into the base spell-slot table.
  if (mods.save) {
    changes.push({
      key: "system.mods.saves.all",
      type: "custom",
      value: JSON.stringify({ formula: String(mods.save), properties: "" })
    });
  }
  if (mods.level) {
    changes.push({
      key: "system.mods.levels.arcane",
      type: "add",
      value: String(mods.level)
    });
  }
  return changes;
}

function getBaseArcaneSlots(actor) {
  const slots = Array(10).fill(0);
  for (const classItem of actor?.classes ?? []) {
    const ranks = Object.values(classItem?.system?.ranks ?? {});
    const levelIndex = Object.values(classItem?.system?.advancement ?? {}).length - 1;
    if (levelIndex < 0 || !ranks[levelIndex]) continue;
    const arcane = ranks[levelIndex]?.arcane ?? [];
    for (let i = 0; i < slots.length; i++) {
      slots[i] += Number(arcane[i] ?? 0) || 0;
    }
  }
  return slots;
}

async function syncWizardArcaneSlots(actor, classItem, bonusCount) {
  if (!actor || !classItem) return;
  const base = getBaseArcaneSlots(actor);
  const mods = getWizardLunarModifiers(actor, classItem);
  const allocated = getAllocatedBonusSpells(actor, classItem, mods, calculateState());
  for (const level of allocated) base[level] += 1;

  const current = actor.system?.spellInfo?.slots?.arcane?.value ?? {};
  const next = foundry.utils.deepClone(current);
  let changed = false;
  for (let i = 0; i < 10; i++) {
    if (Number(next[i] ?? 0) !== base[i]) {
      next[i] = base[i];
      changed = true;
    }
  }
  if (changed) await actor.update({ "system.spellInfo.slots.arcane.value": next }, { [MODULE_ID]: true });
}

const WIZARD_SYNCING = new Set();

async function syncWizardLunarEffects(actor) {
  if (!actor || (actor.type !== "character" && actor.type !== "npc")) return;
  if (WIZARD_SYNCING.has(actor.uuid)) return;
  WIZARD_SYNCING.add(actor.uuid);
  try {
    const wizardClasses = getWizardClasses(actor);
    if (!wizardClasses.length) return;
    const wizardClass = wizardClasses.find(c => getWizardRobe(c) !== "none") ?? wizardClasses[0];
    const mods = getWizardLunarModifiers(actor, wizardClass);
    const state = calculateState();
    const signature = getWizardLunarSignature(actor, wizardClass, mods, state);
    const savedAllocation = actor.flags?.[MODULE_ID]?.moonBonusAllocation;
    const allocationMatches = savedAllocation
      && !Array.isArray(savedAllocation)
      && savedAllocation.signature === signature
      && Array.isArray(savedAllocation.levels);
    const allocations = allocationMatches
      ? getAllocatedBonusSpells(actor, wizardClass, mods, state)
      : [];
    const changes = buildWizardEffectChanges(actor, wizardClass, mods);
    const existing = actor.effects.filter(e => e.flags?.[MODULE_ID]?.[WIZARD_EFFECT_FLAG] === true);

    // Keep one stable effect and update it. Deleting/recreating the effect on
    // every level/time/robe change races with Foundry's document updates and
    // caused "ActiveEffect ... does not exist" errors in the test log.
    const effect = existing[0];
    const source = {
      name: "Dragonlance Lunar Magic",
      icon: "icons/magic/nature/moon-star.webp",
      disabled: false,
      transfer: false,
      flags: { [MODULE_ID]: { [WIZARD_EFFECT_FLAG]: true } },
      "system.changes": changes
    };

    if (!changes.length) {
      if (effect && !effect.disabled) await effect.update({ disabled: true, changes: [] });
    } else if (effect) {
      await effect.update({ ...source });
      if (effect.disabled) await effect.update({ disabled: false });
    } else {
      await actor.createEmbeddedDocuments("ActiveEffect", [source]);
    }

    for (const duplicate of existing.slice(1)) {
      if (actor.effects.get(duplicate.id)) await actor.deleteEmbeddedDocuments("ActiveEffect", [duplicate.id]);
    }

    // Rebuild the complete arcane slot table from the REAL class levels and
    // then add only the currently allocated lunar bonus slots. This prevents
    // Active Effect re-preparation from turning a +1 bonus into repeated +1s.
    await syncWizardArcaneSlots(actor, wizardClass, mods.spells);
    if (mods.spells > 0 && !allocationMatches && actor.isOwner) {
      // Mark the new lunar configuration before opening the dialog. This
      // prevents duplicate dialogs caused by ARS/Foundry update hooks.
      await actor.setFlag(MODULE_ID, "moonBonusAllocation", { signature, levels: [] });
      setTimeout(() => openBonusSpellAllocation(actor, wizardClass, mods.spells), 150);
    } else if (mods.spells <= 0 && actor.flags?.[MODULE_ID]?.moonBonusAllocation) {
      await actor.setFlag(MODULE_ID, "moonBonusAllocation", { signature, levels: [] });
    }
  } finally {
    WIZARD_SYNCING.delete(actor.uuid);
  }
}

async function ensureWizardClass() {
  if (!game.user.isGM) return null;
  const existing = game.items.find(i => i.type === "class" && i.flags?.[MODULE_ID]?.[WIZARD_FLAG] === true);
  let item = existing;
  if (!item) {
    const names = ["Magic-User", "Magic User"];
    let source = null;
    for (const name of names) {
      source = game.items.find(i => i.type === "class" && i.name.toLowerCase() === name.toLowerCase());
      if (source) break;
      const index = await game.ars?.packs?.findItemByName?.(name);
      if (index?.uuid) source = await fromUuid(index.uuid);
      if (source) break;
    }
    if (!source) {
      console.warn("[Dragonlance Moons] Could not locate the ARS Magic-User class to build Wizard of High Sorcery.");
      return null;
    }
    const data = source.toObject();
    delete data._id; delete data.folder; delete data.pack; delete data.sort;
    data.name = WIZARD_CLASS_NAME;
    data.img = data.img || "icons/magic/holy/beam-impact-silhouette-blue.webp";
    data.flags ??= {};
    data.flags[MODULE_ID] = { [WIZARD_FLAG]: true, [WIZARD_ROBE_FLAG]: "none" };
    item = await Item.create(data);
    ui.notifications.info("Wizard of High Sorcery class added to the world Items.");
  }

  const sourceRanks = item.system?.ranks ?? [];
  const sourceAdvancement = item.system?.advancement ?? [];
  const ranks = wizardRankData(sourceRanks);
  // ARS stores the current class level in the number of advancement entries.
  // ARS adds every class at level 0. Level advancement is a manual decision by
  // the player/DM, so the Wizard of High Sorcery must start with no advancement rows.
  await item.update({
    "system.ranks": ranks,
    "system.advancement": [],
    "system.features.lasthitdice": 10,
    [`flags.${MODULE_ID}.${WIZARD_FLAG}`]: true
  });
  return item;
}

function injectWizardRobeField(app, html) {
  const item = app?.document;
  if (!item || item.type !== "class" || item.flags?.[MODULE_ID]?.[WIZARD_FLAG] !== true) return;
  const actor = item.parent;
  const level = actor?.getClassLevel?.(item) ?? 0;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".dlm-robe-field")) return;
  if (actor && level < 3) return;
  if (!actor) return;
  const typeInput = root.querySelector('input[name="system.type"]');
  if (!typeInput) return;
  const wrap = document.createElement("div");
  wrap.className = "dlm-robe-field general-header";
  wrap.innerHTML = `<label>Robe <select><option value="none">None</option><option value="white">White Robe</option><option value="red">Red Robe</option><option value="black">Black Robe</option></select></label>`;
  typeInput.parentElement?.after(wrap);
  const select = wrap.querySelector("select");
  select.value = getWizardRobe(item);
  select.addEventListener("change", async () => {
    await item.update({ [`flags.${MODULE_ID}.${WIZARD_ROBE_FLAG}`]: select.value });
    if (item.parent?.type === "character" || item.parent?.type === "npc") await syncWizardLunarEffects(item.parent);
  });
}

function renderWizardMoonPanel(app, html) {
  const actor = app?.document;
  if (!actor || (actor.type !== "character" && actor.type !== "npc")) return;
  const cls = getWizardClasses(actor).find(c => getWizardRobe(c) !== "none");
  if (!cls) return;
  const existing = html.querySelector?.(".dlm-wizard-moon-panel");
  existing?.remove();
  const mods = getWizardLunarModifiers(actor, cls);
  const root = html instanceof HTMLElement ? html : html?.[0];
  const classList = root?.querySelector(".item-classes-list");
  if (!classList) return;
  const panel = document.createElement("div");
  panel.className = "dlm-wizard-moon-panel";
  panel.innerHTML = `<div class="general-header">Moon Magic</div><div class="dlm-wizard-moon-content"><strong>${WIZARD_ROBES[mods.robe].label}</strong><span>Save ${formatMod(mods.save)} · Bonus Spells +${mods.spells} · Effective Level ${formatMod(mods.level)}</span><button type="button" class="dlm-allocate-spells">Bonus Spells</button></div>`;
  classList.after(panel);
  panel.querySelector(".dlm-allocate-spells").addEventListener("click", () => openBonusSpellAllocation(actor, cls, mods.spells));
}

async function openBonusSpellAllocation(actor, classItem, count) {
  if (!count || !actor?.isOwner) return;
  const classLevel = actor.getClassLevel(classItem) || 0;
  const mods = getWizardLunarModifiers(actor, classItem);
  // Effective Level does not grant access to higher spell levels or slots.
  // Availability is based strictly on the wizard's real class level.
  const available = wizardSlotsAtLevel(classItem, classLevel)
    .map((slots, index) => ({ level: index + 1, slots }))
    .filter(entry => entry.slots > 0);
  if (!available.length) return;

  const current = getAllocatedBonusSpells(actor, classItem, mods, calculateState());
  const options = available.map(entry => `<option value="${entry.level}">${entry.level}</option>`).join("");
  const fields = Array.from({ length: count }, (_, i) => `<label>Bonus spell ${i + 1}<select name="slot${i}">${options}</select></label>`).join("");
  const content = `<p>Choose the spell level for each additional spell slot. You may choose any spell level you can cast at your REAL wizard level. Effective Level never grants access to a higher spell level.</p><form class="dlm-bonus-spell-form">${fields}</form>`;
  const dialog = new Dialog({
    title: "Allocate Bonus Spells",
    content,
    buttons: {
      save: {
        label: "Save",
        callback: async html => {
          const values = [];
          for (let i = 0; i < count; i++) {
            const value = Number(html.find(`[name=slot${i}]`).val());
            if (available.some(entry => entry.level === value)) values.push(value);
          }
          const signature = getWizardLunarSignature(actor, classItem, mods, calculateState());
          await actor.setFlag(MODULE_ID, "moonBonusAllocation", { signature, levels: values });
          await syncWizardLunarEffects(actor);
        }
      },
      cancel: { label: "Cancel" }
    },
    default: "save"
  });
  dialog.render(true);
  for (let i = 0; i < current.length; i++) dialog.element?.find?.(`[name=slot${i}]`)?.val?.(current[i]);
}


async function migrateOwnedWizardClasses(worldClass) {
  // Do not overwrite a character's advancement. In ARS the length of
  // system.advancement IS the current class level. The world class carries
  // all 25 ranks, while an owned class contains only the levels actually
  // reached by that character.
  if (!worldClass) return;
  const ranks = wizardRankData(worldClass.system?.ranks ?? []);
  for (const actor of game.actors?.contents ?? []) {
    for (const item of actor.items.filter(i => i.type === "class" && i.flags?.[MODULE_ID]?.[WIZARD_FLAG] === true)) {
      const currentLevel = actor.getClassLevel?.(item) ?? 0;
      const safeLevel = Math.max(0, Math.min(25, currentLevel));
      const currentAdvancement = Object.values(foundry.utils.deepClone(item.system?.advancement ?? {}));
      const advancement = currentAdvancement.length ? currentAdvancement.slice(0, safeLevel) : [];
      for (const [index, entry] of advancement.entries()) {
        entry.level = index + 1;
        const hp = Number(entry.hp);
        if (!Number.isFinite(hp) || hp <= 0) {
          const roll = await new Roll(String(entry.level <= 10 ? "1d4" : "1"), actor.getRollData()).evaluate();
          entry.hp = Number(roll.total);
        } else {
          entry.hp = hp;
        }
      }
      await item.update({
        "system.ranks": foundry.utils.deepClone(ranks),
        "system.advancement": advancement,
        ...(safeLevel < 4 ? { [`flags.${MODULE_ID}.${WIZARD_ROBE_FLAG}`]: "none" } : {})
      }, { [MODULE_ID]: true });
      await syncWizardLunarEffects(actor);
    }
  }
}

function positionForWizardTest(moon, phase) {
  const target = { full: 0, waxing: 90, new: 180, waning: 270 }[String(phase).toLowerCase()];
  if (target == null) throw new Error(`Unknown test phase: ${phase}`);
  const steps = Math.round(target / (360 / moon.period));
  const anchorRoll = { solinari: 8, lunitari: 1, nuitari: 6 }[moon.key];
  const anchor = ANCHOR_POSITIONS[moon.key]?.[anchorRoll] ?? 0;
  return normalizePosition(anchor - steps, moon.period);
}

function getTestContext() {
  const controlledActor = canvas?.tokens?.controlled?.map(t => t.actor).find(Boolean) ?? null;
  const actor = controlledActor
    ?? game.actors?.contents?.find(candidate => candidate.isOwner && candidate.type === "character")
    ?? null;
  const wizardClass = actor?.items?.find(item => item.type === "class" && item.flags?.[MODULE_ID]?.[WIZARD_FLAG] === true) ?? null;
  return {
    actor,
    wizardClass,
    level: actor && wizardClass ? (actor.getClassLevel?.(wizardClass) ?? Object.values(wizardClass.system?.advancement ?? {}).length) : 0,
    robe: wizardClass ? getWizardRobe(wizardClass) : "none"
  };
}

function getWizardTestReport() {
  const { actor, wizardClass, level, robe } = getTestContext();
  const state = calculateState();
  const mods = actor && wizardClass ? getWizardLunarModifiers(actor, wizardClass, state) : null;
  const slots = actor ? foundry.utils.deepClone(actor.system?.spellInfo?.slots?.arcane?.value ?? {}) : null;
  const effects = actor ? actor.effects.filter(e => e.flags?.[MODULE_ID]?.[WIZARD_EFFECT_FLAG] === true).map(e => ({
    id: e.id,
    disabled: e.disabled,
    changes: foundry.utils.deepClone(e.system?.changes ?? [])
  })) : [];
  return {
    actor: actor?.name ?? null,
    actorType: actor?.type ?? null,
    wizardClass: wizardClass?.name ?? null,
    level,
    intelligence: getIntelligence(actor),
    robe,
    moonPhases: Object.fromEntries(Object.values(MOONS).map(m => [m.key, {
      phase: state[m.key]?.phase?.id ?? null,
      chartPosition: state[m.key]?.chartPosition ?? null,
      angle: state[m.key]?.angle ?? null
    }])),
    alignment: state.alignment ?? null,
    modifiers: mods ? { save: mods.save, spells: mods.spells, level: mods.level, patron: mods.patron, phase: mods.phase, sanction: mods.sanction } : null,
    arcaneSlots: slots,
    lunarEffects: effects,
    bonusAllocation: actor && wizardClass ? getBonusAllocationRecord(actor, wizardClass, mods ?? { spells: 0 }, state) : null
  };
}

async function setTestMoons(phases = {}) {
  if (!game.user.isGM) throw new Error("Only the GM can set lunar test states.");
  const normalized = {
    solinari: phases.solinari ?? "full",
    lunitari: phases.lunitari ?? "full",
    nuitari: phases.nuitari ?? "full"
  };
  const positions = Object.fromEntries(Object.values(MOONS).map(m => [m.key, positionForWizardTest(m, normalized[m.key])]));
  await saveState(positions, { solinari: 8, lunitari: 1, nuitari: 6 });
  refreshAfterTimeChange(game.time.worldTime);
  const state = calculateState();
  console.log("[Dragonlance Moons] Test state", { requested: normalized, state });
  return state;
}

let characterBrowserTarget = null;

function installCharacterBrowserFallback() {
  if (window.__dlmCharacterBrowserFallback) return;
  window.__dlmCharacterBrowserFallback = true;

  // ARS opens its Item Browser from the class/race buttons, but its Take/Buy
  // action deliberately chooses a token/assigned character instead of the
  // sheet that launched the browser. Remember the launching actor so those
  // buttons can work from the character sheet too.
  Hooks.on("renderActorSheetV2", (app, element) => {
    const root = element?.element ?? element;
    if (!root || root.dataset?.dlmBrowserBound === "1") return;
    if (root.dataset) root.dataset.dlmBrowserBound = "1";
    root.addEventListener("click", event => {
      const button = event.target?.closest?.(".character-browser-director [data-action^='find']");
      if (!button || !app.actor) return;
      const action = button.dataset.action;
      const type = action === "findClassChoice" ? "class"
        : action === "findRaceChoice" ? "race"
        : action === "findBackgroundChoice" ? "background" : null;
      if (!type) return;
      characterBrowserTarget = { actor: app.actor, type };
    });
  });

  document.addEventListener("click", async event => {
    const takeButton = event.target?.closest?.(".item-browser .item-take");
    const buyButton = event.target?.closest?.(".item-browser .item-buy");
    if (!takeButton && !buyButton) return;
    if (!characterBrowserTarget?.actor) return;

    const browser = game.ars?.ui?.itembrowser;
    if (!browser) return;
    const card = (takeButton || buyButton).closest(".browser-card[data-uuid]");
    if (!card) return;

    const { actor, type } = characterBrowserTarget;
    if (!actor.isOwner && !game.user.isGM) return;
    if (type === "class" && actor.classes?.length) return;
    if (type === "race" && actor.races?.length) return;
    if (type === "background" && actor.backgrounds?.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const source = await fromUuid(card.dataset.uuid);
      if (!source) throw new Error(`Unable to resolve ${card.dataset.uuid}`);
      const data = source.toObject();
      delete data._id;
      await actor.createEmbeddedDocuments("Item", [data]);
      characterBrowserTarget = null;
      browser.close();
    } catch (error) {
      console.error("[Dragonlance Moons] Unable to add character-sheet selection", error);
      ui.notifications.error(`Unable to add ${card.querySelector(".browser-col-name")?.textContent?.trim() || "item"}.`);
    }
  }, true);

  // Safety fallback for the ARS delegated action if it is not attached after a
  // sheet re-render. This only opens the browser; the target handling above
  // performs the actual addition.
  document.addEventListener("click", event => {
    const button = event.target?.closest?.(".character-browser-director [data-action^='find']");
    if (!button) return;
    const action = button.dataset.action;
    const type = action === "findClassChoice" ? "class"
      : action === "findRaceChoice" ? "race"
      : action === "findBackgroundChoice" ? "background" : null;
    if (!type) return;
    setTimeout(() => {
      const browser = game.ars?.ui?.itembrowser;
      if (!browser || browser.rendered) return;
      browser.filters.type = type;
      browser.filters.source = "all";
      browser.render(true);
    }, 50);
  }, false);
}

function registerWizardHooks() {
  installCharacterBrowserFallback();
  Hooks.on("renderItemSheetV2", injectWizardRobeField);
  Hooks.on("renderActorSheetV2", renderWizardMoonPanel);
  Hooks.on("createItem", item => setTimeout(async () => {
    const actor = item?.parent;
    if (!actor || (actor.type !== "character" && actor.type !== "npc")) return;
    if (item.type !== "class" || item.flags?.[MODULE_ID]?.[WIZARD_FLAG] !== true) return;
    await syncWizardLunarEffects(actor);
  }, 0));
  Hooks.on("createActor", actor => setTimeout(() => syncWizardLunarEffects(actor), 0));
  Hooks.on("updateItem", item => {
    if (item.parent?.type === "character" || item.parent?.type === "npc") setTimeout(() => syncWizardLunarEffects(item.parent), 0);
  });
  Hooks.on("updateActor", (actor, changes, options) => {
    if (changes.system || changes.items || changes.flags) setTimeout(() => syncWizardLunarEffects(actor), 0);
  });
}

Hooks.once("init", () => {
  if (game.system.id !== "ars") return;
  registerSettings();
  window.DragonlanceMoons = { calculateState, renderLunarDialog, renderGMControls, saveState, setTestMoons, getTestContext, getWizardTestReport, MOONS, PHASES, ALIGNMENTS, getWizardLunarModifiers, syncWizardLunarEffects, ensureWizardClass };
  console.log("[Dragonlance Moons] Initialized for ARS.");
});

Hooks.once("ready", () => {
  if (game.system.id !== "ars") return;
  addSceneControl();
  registerWizardHooks();
  ensureWizardClass();
  renderDisplay();
  console.log("[Dragonlance Moons] Ready. HUD rendered; lunar windows are draggable and minimizable.");
});

Hooks.on("updateWorldTime", worldTime => {
  if (game.system.id !== "ars") return;
  refreshAfterTimeChange(worldTime);
});

Hooks.on("closeSettingsConfig", () => renderDisplay());
Hooks.on("renderSidebarTab", () => renderDisplay());
