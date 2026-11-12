// Game rules and content tables. Distances in metres, time in seconds.
export const RACE = {
  laps: 3, racers: 5, countdown: 3,
  lapTarget: 18000, // the loop is scaled to ~18 km per lap
  respawnDelay: 4, rollback: 250, protect: 1.5, // rollback never crosses the lap start
  checkpointSpacing: 1000, // checkpoints must be passed in order
  minSpeed: 55, // no reverse, no hovering
  heatMax: 100, overheatLock: 1.6,
  wallDamage: 26, // per second scraping
  crashDamage: 28,
  pickupRespawn: 4, // one pickup per case group per lap for each racer (death does not reset it)
  energyRegen: 9,
};

export const SHIPS = [
  { key: 'kestrel', name: 'KESTREL', role: 'Скорость', color: '#2f8bff',
    desc: 'Лёгкая дельта с одним мощным двигателем. Самая высокая скорость, но тонкая броня.',
    cruise: 105, top: 119, accel: 34, handling: 46, climb: 40, hp: 90, cooling: 30, energy: 100,
    stats: { speed: 5, handling: 3, armor: 1, firepower: 3 },
    ability: { key: 'dash', name: 'СЛИПСТРИМ-РЫВОК', cd: 9, dur: 1.3, desc: 'Рывок ×1.6 на 1.3 с, пробивает выхлоп соперника' } },
  { key: 'mirage', name: 'MIRAGE', role: 'Маневренность', color: '#ff2fb0',
    desc: 'Серповидное крыло с двигателями на законцовках. Лучший манёвр и голограмма-приманка.',
    cruise: 102, top: 115, accel: 32, handling: 62, climb: 56, hp: 100, cooling: 26, energy: 100,
    stats: { speed: 4, handling: 5, armor: 2, firepower: 2 },
    ability: { key: 'decoy', name: 'МИРАЖ', cd: 11, dur: 3, desc: 'Голограмма срывает захват ракет, вы становитесь полупрозрачным' } },
  { key: 'bastion', name: 'BASTION', role: 'Броня', color: '#ffd400',
    desc: 'Тяжёлая двухбалочная машина. Держит удар, таранит соперников, ставит энергокупол.',
    cruise: 98, top: 110, accel: 26, handling: 38, climb: 32, hp: 160, cooling: 28, energy: 100,
    stats: { speed: 2, handling: 1, armor: 5, firepower: 4 },
    ability: { key: 'shield', name: 'ЭНЕРГОКУПОЛ', cd: 13, dur: 3.5, desc: 'Купол поглощает 70 урона и отражает лазеры' } },
  { key: 'arc', name: 'ARC', role: 'Лазеры', color: '#a05cff',
    desc: 'Раздвоенный нос с излучателем. Мощнейшие лазеры и быстрое охлаждение.',
    cruise: 100, top: 113, accel: 30, handling: 48, climb: 44, hp: 110, cooling: 42, energy: 100,
    stats: { speed: 3, handling: 3, armor: 2, firepower: 5 },
    ability: { key: 'overload', name: 'ПЕРЕГРУЗКА', cd: 13, dur: 3.5, desc: 'Урон лазеров ×1.6, нагрев отключён' } },
  { key: 'nomad', name: 'NOMAD', role: 'Универсал', color: '#ff8a1e',
    desc: 'Две гондолы и V-хвост. Сбалансирован, чинится в полёте и носит больше ракет.',
    cruise: 102, top: 115, accel: 31, handling: 50, climb: 46, hp: 125, cooling: 32, energy: 100, extraMissiles: 2,
    stats: { speed: 3, handling: 3, armor: 3, firepower: 3 },
    ability: { key: 'repair', name: 'НАНОРЕМОНТ', cd: 16, dur: 3, desc: 'Восстанавливает 40 брони за 3 с' } },
];

export const LIVERIES = [
  { name: 'НЕОН-САКУРА', primary: '#ff2d95', secondary: '#f4f4f8', accent: '#00e5ff', neon: '#ff4fd8' },
  { name: 'КИСЛОТА', primary: '#b6ff00', secondary: '#15171c', accent: '#ff2bd6', neon: '#b6ff00' },
  { name: 'ЖАР-ПТИЦА', primary: '#ff5a00', secondary: '#ffd400', accent: '#16161a', neon: '#ffb020' },
  { name: 'ЛЁД', primary: '#eaf6ff', secondary: '#2a6bff', accent: '#00f0ff', neon: '#4cf0ff' },
  { name: 'УЛЬТРАФИОЛЕТ', primary: '#7a2cff', secondary: '#ff2fd0', accent: '#f2f2ff', neon: '#b56bff' },
  { name: 'РУБИН-ХРОМ', primary: '#d0102a', secondary: '#c9ccd4', accent: '#ffffff', neon: '#ff3050' },
  { name: 'ТОКСИК', primary: '#00ff9c', secondary: '#0d2b3a', accent: '#ffe600', neon: '#00ffb0' },
  { name: 'ЗАКАТ', primary: '#ff3c6e', secondary: '#2b1055', accent: '#ffb347', neon: '#ff6a3c' },
  { name: 'КОБАЛЬТ', primary: '#0b3cff', secondary: '#ff7b16', accent: '#f6f7ff', neon: '#43edff' },
  { name: 'ЗОЛОТО', primary: '#ffcc33', secondary: '#1b1b1f', accent: '#ff2a2a', neon: '#ffd84a' },
];
// Five paint schemes per ship: factory colours first, then four picked from the shared set.
const FACTORY = [
  { name: 'ЗАВОДСКАЯ', primary: '#2f8bff', secondary: '#e8eef8', accent: '#ff3050', neon: '#29f3ff' },
  { name: 'ЗАВОДСКАЯ', primary: '#ff2fb0', secondary: '#1a1024', accent: '#29f3ff', neon: '#ff4fd8' },
  { name: 'ЗАВОДСКАЯ', primary: '#ffd400', secondary: '#2a2a30', accent: '#ff5a00', neon: '#ffb020' },
  { name: 'ЗАВОДСКАЯ', primary: '#a05cff', secondary: '#101018', accent: '#b6ff00', neon: '#b56bff' },
  { name: 'ЗАВОДСКАЯ', primary: '#ff8a1e', secondary: '#f2efe6', accent: '#19beb6', neon: '#4de9d2' },
];
const PICKS = [[8, 3, 0, 5], [0, 4, 7, 1], [9, 2, 5, 6], [4, 1, 6, 3], [2, 6, 8, 7]];
export const SHIP_LIVERIES = FACTORY.map((f, i) => [f, ...PICKS[i].map(k => LIVERIES[k])]);

export const FINISHES = [
  { key: 'gloss', name: 'Глянец', metalness: 0.35, roughness: 0.22, clearcoat: 1 },
  { key: 'metal', name: 'Металлик', metalness: 0.75, roughness: 0.3, clearcoat: 0.6 },
  { key: 'chrome', name: 'Хром', metalness: 1.0, roughness: 0.08, clearcoat: 1 },
  { key: 'matte', name: 'Матовый', metalness: 0.15, roughness: 0.75, clearcoat: 0 },
];
export const PALETTE = ['#ff2d95', '#ff3050', '#ff5a00', '#ffb020', '#ffe600', '#b6ff00', '#00ff9c', '#00e5ff', '#2a6bff', '#7a2cff', '#ff2fd0', '#f4f4f8', '#9aa0aa', '#15171c'];

// Lasers: pick one in the hangar
export const LASERS = [
  { key: 'pulse', name: 'ПУЛЬСАР', desc: 'Скорострельные импульсы. Универсал.', color: '#29f3ff', rate: 11, dmg: 2.6, heat: 4.2, speed: 900, range: 520, spread: 0 },
  { key: 'beam', name: 'КОСА', desc: 'Непрерывный луч. Мгновенное попадание, быстрый перегрев.', color: '#ff2fd0', beam: true, dps: 28, heatPS: 30, range: 300 },
  { key: 'prism', name: 'ПРИЗМА', desc: 'Веер из 5 лучей. Убийственна вблизи.', color: '#b6ff00', rate: 3.2, dmg: 2.8, pellets: 5, heat: 13, speed: 800, range: 230, spread: 0.07 },
  { key: 'rail', name: 'РЕЛЬСА', desc: 'Заряд 0.7 с, пробивающий выстрел огромной силы.', color: '#ffb020', charge: 0.7, dmg: 34, heat: 38, range: 900, rail: true },
];

// Missiles: pick one type; ammo regenerates slowly
export const MISSILES = [
  { key: 'wasp', name: 'ОСА', desc: 'Рой из 4 самонаводящихся мини-ракет.', color: '#ffd400', count: 4, dmg: 8, speed: 210, turn: 3.2, ammo: 4, regen: 7, lock: true, radius: 10 },
  { key: 'harpoon', name: 'ГАРПУН', desc: 'Тяжёлая самонаводящаяся ракета. Нужен захват.', color: '#ff3050', count: 1, dmg: 32, speed: 190, turn: 2.4, ammo: 3, regen: 9, lock: true, radius: 18 },
  { key: 'lance', name: 'КОПЬЁ', desc: 'Неуправляемая сверхбыстрая ракета, большой радиус взрыва.', color: '#29f3ff', count: 1, dmg: 42, speed: 330, turn: 0, ammo: 3, regen: 8, lock: false, radius: 30 },
  { key: 'mine', name: 'МИНА-ШЛЕЙФ', desc: 'Сбрасывает 3 мины позади. Для лидеров гонки.', color: '#ff2fb0', count: 3, dmg: 30, speed: 0, ammo: 3, regen: 9, mine: true, radius: 22 },
];

// Flying cases (one slot, E to use)
export const ITEMS = [
  { key: 'boost', name: 'ФОРСАЖ', color: '#29f3ff', icon: '»', desc: 'Скорость ×1.55 на 3 с' },
  { key: 'chrono', name: 'ХРОНОПОЛЕ', color: '#a05cff', icon: '◷', desc: 'Замедляет всех впереди в радиусе 320 м' },
  { key: 'nova', name: 'СВЕРХНОВАЯ', color: '#ff3050', icon: '✸', desc: 'Супероружие: испепеляющий луч на 2.5 с' },
  { key: 'shield', name: 'ЩИТ', color: '#4cf0ff', icon: '⬡', desc: 'Щит на 60 урона' },
  { key: 'repair', name: 'РЕМКОМПЛЕКТ', color: '#00ff9c', icon: '+', desc: '+50 брони' },
  { key: 'emp', name: 'ЭМИ', color: '#ffe600', icon: 'ϟ', desc: 'Глушит оружие соперников рядом на 3.5 с' },
  { key: 'drones', name: 'РОЙ ДРОНОВ', color: '#ff8a1e', icon: '⁂', desc: '3 дрона-охотника атакуют 7 с' },
  { key: 'phase', name: 'ФАЗА', color: '#ffffff', icon: '◌', desc: 'Неуязвимость и полёт сквозь препятствия 2.5 с' },
  { key: 'holo', name: 'ГОЛО-СЛЕД', color: '#7dfcff', icon: '≋', desc: 'Голографический след 5 с: ракеты бьют в фантомов, лазеры мажут' },
  { key: 'magnet', name: 'ГРАВИТРОС', color: '#ff2fd0', icon: '⟿', desc: 'Притягивает к лидеру и даёт тягу 4 с' },
];

export const AI_LEVELS = [
  { key: 'rookie', name: 'НОВИЧОК', speed: 0.9, aim: 0.35, react: 0.9, aggro: 0.35, line: 0.5, rubber: 0.06 },
  { key: 'pilot', name: 'ПИЛОТ', speed: 0.96, aim: 0.6, react: 0.55, aggro: 0.6, line: 0.75, rubber: 0.05 },
  { key: 'ace', name: 'АС', speed: 1.0, aim: 0.8, react: 0.32, aggro: 0.85, line: 0.9, rubber: 0.04 },
  { key: 'legend', name: 'ЛЕГЕНДА', speed: 1.04, aim: 0.95, react: 0.18, aggro: 1.0, line: 1.0, rubber: 0.03 },
];

export const AI_NAMES = ['ВЕКТОР', 'ГАДЮКА', 'ТУМАН', 'ФЕНИКС', 'КОБРА', 'ОРИОН', 'РАЗРЯД', 'СТРИЖ'];
