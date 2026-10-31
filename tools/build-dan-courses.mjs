/**
 * Generates data/dan-courses.json
 * Run: node tools/build-dan-courses.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../data/dan-courses.json");
mkdirSync(resolve(__dirname, "../data"), { recursive: true });

// Stage roman numeral -> danLevelId
const STAGE_TO_TIER = {
  "I":    "reform-1st-mid",  "II":   "reform-2nd-mid",  "III": "reform-3rd-mid",
  "IV":   "reform-4th-mid",  "V":    "reform-5th-mid",  "VI":  "reform-6th-mid",
  "VII":  "reform-7th-mid",  "VIII": "reform-8th-mid",  "IX":  "reform-9th-mid",
  "X":    "reform-10th-mid", "XI":   "alpha-mid",        "XII": "beta-mid",
  "XIII": "gamma-mid",       "XIV":  "delta-mid",        "Last":"epsilon-mid",
};

// Greek/ordinal word -> danLevelId (for ~ word ~ packs)
const WORD_TO_TIER = {
  "1st":"reform-1st-mid",   "2nd":"reform-2nd-mid",   "3rd":"reform-3rd-mid",
  "4th":"reform-4th-mid",   "5th":"reform-5th-mid",   "6th":"reform-6th-mid",
  "7th":"reform-7th-mid",   "8th":"reform-8th-mid",   "9th":"reform-9th-mid",
  "10th":"reform-10th-mid", "Alpha":"alpha-mid",       "Beta":"beta-mid",
  "Gamma":"gamma-mid",      "Delta":"delta-mid",       "Epsilon":"epsilon-mid",
};

// All RC beatmapsets with their maps
const RC_SETS = [
  { setId: 2451651, maps: [
    [5695276, "Stage 0 - Delete Upon Download"],
    [5695346, "Stage I - Dweller's Empty Path"],
    [5695356, "Stage II - Sayonara Hatsukoi"],
    [5695357, "Stage III - Reincarnation"],
    [5695347, "Stage IV - Backyun!"],
    [5695360, "Stage V - air's gravity"],
    [5695358, "Stage VI - Another Medium"],
    [5695355, "Stage VII - Saltwater"],
    [5695349, "Stage VIII - EVERGREEN"],
    [5695345, "Stage IX - Alea jacta est!"],
    [5695353, "Stage X - What is love"],
    [5695359, "Stage XI - Count What You Have Now"],
    [5761204, "Stage XII - 1NKBURNER"],
    [5695354, "Stage XIII - The Safari"],
    [5695350, "Stage XIV - Nijiiro Kekkai"],
    [5695351, "Last Stage - GOODTEK"],
  ]},
  { setId: 2454019, maps: [
    [5370030, "Stage 0 - Delete Upon Download"],
    [5370035, "Stage I - Analogy"],
    [5370042, "Stage II - IONIZATION"],
    [5370048, "Stage III - Ambitious"],
    [5370044, "Stage IV - for Q"],
    [5370045, "Stage V - kibou no tsuki"],
    [5370043, "Stage VI - BIRTH"],
    [5370047, "Stage VII - girls.exe"],
    [5370050, "Stage VIII - Hestia"],
    [5694558, "Stage IX - Angel's Salad"],
    [5370046, "Stage X - T'Suramic"],
    [5370036, "Stage XI - Nowise"],
    [5370049, "Stage XII - Rainshower"],
    [5864342, "Stage XIII - Jailbreak"],
    [5370039, "Stage XIV - Sulfide"],
    [5370038, "Last Stage - POLYBIUS GB SPEEDRUN"],
  ]},
  { setId: 2455713, maps: [
    [5366859, "Stage 0 - Delete Upon Download"],
    [5366862, "Stage I - I Can Fly in The Universe"],
    [5366869, "Stage II - AXION"],
    [5366872, "Stage III - Phi"],
    [5375029, "Stage IV - 498 Tokio"],
    [5366875, "Stage V - BREAK IT"],
    [5366871, "Stage VI - The Wanderlast"],
    [5366877, "Stage VII - Serendipity"],
    [5366870, "Stage VIII - Eureka"],
    [5366868, "Stage IX - Angel Halo"],
    [5366867, "Stage X - cold planet"],
    [5366873, "Stage XI - NightTheater"],
    [5366863, "Stage XII - DON'T GIVE A FUCK"],
    [5366874, "Stage XIII - Nirmiti"],
    [5366864, "Stage XIV - Tojita Sekai"],
    [5366865, "Last Stage - Disconnected Trance"],
  ]},
  { setId: 2458391, maps: [
    [5375816, "Stage 0 - Delete Upon Download"],
    [5375830, "Stage I - Dummy! Remix"],
    [5375827, "Stage II - Sky is the Limit"],
    [5375823, "Stage III - Kouyou"],
    [5694590, "Stage IV - Reon - Remind"],
    [5375826, "Stage V - Ouka Sange"],
    [5839801, "Stage VI - Shinwa ni mebuku"],
    [5375829, "Stage VII - Synthesis."],
    [5375819, "Stage VIII - Literal Crystal"],
    [5375831, "Stage IX - CERCA/ESOTERICA"],
    [5375820, "Stage X - Kisaragi"],
    [5375825, "Stage XI - Sendan Life"],
    [5375822, "Stage XII - The Limit Does Not Exist"],
    [5375821, "Stage XIII - [ns]"],
    [5375845, "Stage XIV - Excuse Me"],
    [5375828, "Last Stage - Juggernaut"],
  ]},
  // Stage IV-VI extra pack
  { setId: 2341589, maps: [
    [5319952, "Stage IV - Resuscitation"],
    [5031832, "Stage V - Disturbance"],
    [5031833, "Stage VI - Revitalization"],
  ]},
  // Stage VII-X extra pack
  { setId: 2341590, maps: [
    [5785553, "Stage VII - Motivation"],
    [5785554, "Stage VIII - Misfortune"],
    [5785552, "Stage IX - Catastrophe"],
    [5785555, "Stage X - Finale"],
  ]},
  // Stage XI-XIII extra pack
  { setId: 1575457, maps: [
    [3216602, "Stage XI - Alpha"],
    [3216603, "Stage XII - Beta"],
    [3216604, "Stage XIII - Gamma"],
  ]},
  // Greek/ordinal word packs
  { setId: 2316976, maps: [
    [4961192, "~ 1st ~"],[4961190, "~ 2nd ~"],[4961188, "~ 3rd ~"],
    [4961185, "~ 4th ~"],[4961189, "~ 5th ~"],[4961195, "~ 6th ~"],
    [4961191, "~ 7th ~"],[4961197, "~ 8th ~"],[4961184, "~ 9th ~"],
    [4961196, "~ 10th ~"],[4961186, "~ Alpha ~"],[4961193, "~ Beta ~"],
    [4961183, "~ Gamma ~"],[4961182, "~ Delta ~"],[4961194, "~ Epsilon ~"],
  ]},
  { setId: 2316993, maps: [
    [4961239, "~ 1st ~"],[4961238, "~ 2nd ~"],[4961233, "~ 3rd ~"],
    [4961230, "~ 4th ~"],[4961227, "~ 5th ~"],[4961237, "~ 6th ~"],
    [4961240, "~ 7th ~"],[4961235, "~ 8th ~"],[4961228, "~ 9th ~"],
    [4961236, "~ 10th ~"],[4961234, "~ Alpha ~"],[4961226, "~ Beta ~"],
    [4961231, "~ Gamma ~"],[4961229, "~ Delta ~"],[4961232, "~ Epsilon ~"],
  ]},
  { setId: 2317095, maps: [
    [4961718, "~ 1st ~"],[4961710, "~ 2nd ~"],[4961719, "~ 3rd ~"],
    [4961706, "~ 4th ~"],[4961709, "~ 5th ~"],[4961716, "~ 6th ~"],
    [4961714, "~ 7th ~"],[4961707, "~ 8th ~"],[4961711, "~ 9th ~"],
    [4961708, "~ 10th ~"],[4961715, "~ Alpha ~"],[4961717, "~ Beta ~"],
    [4961720, "~ Gamma ~"],[4961712, "~ Delta ~"],[4961713, "~ Epsilon ~"],
  ]},
  { setId: 2320002, maps: [
    [4969885, "~ 1st ~"],[4969886, "~ 2nd ~"],[4969876, "~ 3rd ~"],
    [4969884, "~ 4th ~"],[4969882, "~ 5th ~"],[4969888, "~ 5th ~"],
    [4969878, "~ 6th ~"],[4969887, "~ 6th ~"],[4969877, "~ 7th ~"],
    [4969889, "~ 8th ~"],[4969875, "~ 9th ~"],[4969881, "~ 10th ~"],
    [4969879, "~ Alpha ~"],[4969874, "~ Beta ~"],[4969883, "~ Gamma ~"],
    [4969890, "~ Delta ~"],[4969880, "~ Epsilon ~"],
  ]},
];

// High Greek tiers (direct single-map entries)
const HIGH_TIER_MAPS = [
  { danLevelId: "emik-zeta-mid",        beatmapId: 2738788, setId: 1156299, isCourseClear: true },
  { danLevelId: "thaumiel-eta-mid",     beatmapId: 2738787, setId: 1156299, isCourseClear: true },
  { danLevelId: "cloverwisp-theta-mid", beatmapId: 4747219, setId: 2234779, isCourseClear: true },
  { danLevelId: "iota-mid",             beatmapId: 4865589, setId: 2234779, isCourseClear: true },
  { danLevelId: "kappa-mid",            beatmapId: 5132512, setId: 2234779, isCourseClear: true },
];

// LN Dan track
const LN_MAPS = [
  { danLevelId: "ln-1st-dan-mid",  beatmapId: 1862813, setId: 891143 },
  { danLevelId: "ln-2nd-dan-mid",  beatmapId: 1862814, setId: 891143 },
  { danLevelId: "ln-3rd-dan-mid",  beatmapId: 1862815, setId: 891143 },
  { danLevelId: "ln-4th-dan-mid",  beatmapId: 1862816, setId: 891143 },
  { danLevelId: "ln-5th-dan-mid",  beatmapId: 1862832, setId: 891152 },
  { danLevelId: "ln-6th-dan-mid",  beatmapId: 1862833, setId: 891152 },
  { danLevelId: "ln-7th-dan-mid",  beatmapId: 1862834, setId: 891152 },
  { danLevelId: "ln-8th-dan-mid",  beatmapId: 1862842, setId: 891157 },
  { danLevelId: "ln-9th-dan-mid",  beatmapId: 1862843, setId: 891157 },
  { danLevelId: "ln-10th-dan-mid", beatmapId: 1862841, setId: 891157 },
  { danLevelId: "ln-11th-dan-mid", beatmapId: 1862874, setId: 891164 },
  { danLevelId: "ln-12th-dan-mid", beatmapId: 1862875, setId: 891164 },
  { danLevelId: "ln-13th-dan-mid", beatmapId: 1862876, setId: 891164 },
  { danLevelId: "ln-14th-dan-mid", beatmapId: 2332319, setId: 1116467 },
  { danLevelId: "ln-15th-dan-mid", beatmapId: 2332320, setId: 1116467 },
  { danLevelId: "ln-16th-dan-mid", beatmapId: 4767800, setId: 2243057 },
  { danLevelId: "ln-17th-dan-mid", beatmapId: 5029140, setId: 2340696 },
];

function getTierId(version) {
  // "Stage XIV - ..." or "Last Stage - ..."
  const stageM = version.match(/^Stage\s+(0|[IVX]+|Last)\b/i);
  if (stageM) {
    const key = stageM[1];
    if (key === "0") return null;
    return STAGE_TO_TIER[key] ?? null;
  }
  // "~ Word ~"
  const wordM = version.match(/~\s*([^~]+?)\s*~/);
  if (wordM) return WORD_TO_TIER[wordM[1].trim()] ?? null;
  return null;
}

const entries = [];
const seen = new Set();

for (const { setId, maps } of RC_SETS) {
  for (const [beatmapId, version] of maps) {
    if (/delete/i.test(version)) continue;
    const tierId = getTierId(version);
    if (!tierId) continue;
    const key = `${tierId}:${beatmapId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ danLevelId: tierId, beatmapId, setId });
  }
}

for (const e of [...HIGH_TIER_MAPS, ...LN_MAPS]) {
  const key = `${e.danLevelId}:${e.beatmapId}`;
  if (!seen.has(key)) { seen.add(key); entries.push(e); }
}

writeFileSync(OUT, JSON.stringify(entries, null, 2) + "\n");
console.log(`Wrote ${entries.length} entries to data/dan-courses.json`);

const byTier = {};
for (const e of entries) byTier[e.danLevelId] = (byTier[e.danLevelId] ?? 0) + 1;
for (const [tier, count] of Object.entries(byTier)) {
  console.log(`  ${tier}: ${count}`);
}
