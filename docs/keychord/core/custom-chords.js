import {createRuntimeData, chordID, compareBits, effectiveEntry} from './data.js?v=96c282d34c00';
import {recipeForChord} from './engine.js?v=96c282d34c00';

export const customModes = scope => scope === 'both' ? ['english', 'cpp'] : [scope];
export function customKeys(chord, base) {
  if (!Array.isArray(chord.keyCodes)) return null;
  const keys = chord.keyCodes.map(code => base.layout.indexByCode.get(code));
  return keys.some(key => key === undefined) ? null : keys.sort((a, b) => a - b);
}
export function customChordIssue(chord, others, base, {rolloverLimit = 6, usable = () => true} = {}) {
  if (!chord.id || others.some(c => c.id === chord.id)) return 'This saved chord has an invalid identity.';
  if (!chord.keyCodes?.length) return 'Record the keys you want to press together.';
  const keys = customKeys(chord, base);
  if (!keys || new Set(chord.keyCodes).size !== chord.keyCodes.length || !['english', 'cpp', 'both'].includes(chord.scope) || !['words', 'exact'].includes(chord.spacing)) return 'Use keys from the chord keyboard, without Shift, Option, Command, or Control.';
  if (keys.includes(base.layout.spaceIndex)) return 'Space joins words. Choose a chord without Space.';
  if (keys.length > rolloverLimit) return `Use at most ${rolloverLimit} keys in one chord.`;
  if (typeof chord.text !== 'string' || !/\S/u.test(chord.text)) return 'Enter the text this chord should type.';
  if (customModes(chord.scope).some(mode => effectiveEntry(base, mode, keys)?.type === 'command')) return 'These keys perform a built-in action. Choose different keys to keep that action available.';
  if (chord.isEnabled !== false && others.some(c => c.isEnabled !== false && customKeys(c, base)?.join(',') === keys.join(',') && customModes(c.scope).some(mode => customModes(chord.scope).includes(mode)))) return 'You already have a chord with these keys in this language. Edit it or choose different keys.';
  if (!usable(keys)) return 'This keyboard cannot register these keys together. Choose a different combination.';
  return null;
}
export function applyCustomChords(chords, base, options = {}) {
  const exported = {...base.exported, dictionaries: structuredClone(base.exported.dictionaries)};
  for (const [i, chord] of chords.entries()) {
    if (chord.isEnabled === false || customChordIssue(chord, chords.filter((_, j) => i !== j), base, options)) continue;
    const keys = customKeys(chord, base), names = keys.map(i => base.layout.keys[i].name);
    for (const mode of customModes(chord.scope)) {
      exported.dictionaries[mode] = exported.dictionaries[mode].filter(row => row.keys.join(',') !== names.join(','));
      exported.dictionaries[mode].push({keys: names, entry: {type: 'text', text: chord.text, cursorFromEnd: null,
        kind: chord.spacing === 'exact' ? 'symbol' : 'word', attachLeft: chord.spacing === 'exact', attachRight: chord.spacing === 'exact',
        wordAttach: false, glue: false, capitalizeNext: false}});
    }
  }
  let hash = 2166136261;
  for (const c of JSON.stringify(exported.dictionaries)) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  exported.mappingVersion = `${base.mappingVersion}:custom-${(hash >>> 0).toString(16)}`;
  return createRuntimeData(exported);
}
export function customChordSuggestions(scope, chords, base, {rolloverLimit = 6, usable = () => true, geometry = 'ansi', excluding = [], limit = 3} = {}) {
  if (limit <= 0 || rolloverLimit <= 0) return [];
  const positions = base.geometry[geometry].keys, indices = base.layout.keys.map(k => k.index).filter(i => i !== base.layout.spaceIndex);
  const occupied = new Set(chords.filter(c => c.isEnabled !== false && customModes(c.scope).some(m => customModes(scope).includes(m))).map(c => customKeys(c, base)?.join(',')));
  const excluded = new Set(excluding.map(keys => keys.join(','))), result = [];
  const reach = keys => {
    const coords = keys.map(i => positions.find(p => p.code === base.layout.keys[i].code)).filter(Boolean);
    let score = (keys.length - coords.length) * 100 + coords.reduce((n, p) => n + Math.abs(p.y - 2.7), 0);
    for (const hand of [coords.filter(p => p.x + p.width / 2 < 7), coords.filter(p => p.x + p.width / 2 >= 7)]) if (hand.length) score += Math.max(...hand.map(p => p.x)) - Math.min(...hand.map(p => p.x)) + (Math.max(...hand.map(p => p.y)) - Math.min(...hand.map(p => p.y))) * 3;
    return score;
  };
  for (let size = 1; size <= Math.min(3, rolloverLimit, indices.length); size++) {
    const candidates = [];
    const visit = (start, keys) => {
      if (keys.length === size) {
        if (!occupied.has(chordID(keys)) && !excluded.has(chordID(keys)) && usable(keys) && customModes(scope).every(mode => recipeForChord(base, keys, {mode}).outcome.type === 'nothing')) candidates.push({keys, reach: reach(keys)});
        return;
      }
      for (let i = start; i <= indices.length - (size - keys.length); i++) visit(i + 1, [...keys, indices[i]]);
    };
    visit(0, []); candidates.sort((a, b) => a.reach - b.reach || compareBits(a.keys, b.keys));
    result.push(...candidates.slice(0, limit - result.length).map(c => c.keys));
    if (result.length === limit) break;
  }
  return result;
}
