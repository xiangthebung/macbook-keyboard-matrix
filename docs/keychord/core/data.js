import {graphemes} from './buffer.js?v=f3ab99c6cf25';

export const BANKS = ['onset', 'vowel', 'coda'];
export const chordID = keys => keys.join(',');
export const union = (...sets) => [...new Set(sets.flat())].sort((a, b) => a - b);
export const subtract = (a, b) => a.filter(key => !b.includes(key));
export const intersection = (a, b) => a.filter(key => b.includes(key));
export const isSubset = (a, b) => a.every(key => b.includes(key));
export const compareKeys = (a, b) => a.length - b.length || compareBits(a, b);
export function compareBits(a, b) {
  const bit = keys => keys.reduce((result, i) => result | (1n << BigInt(i)), 0n);
  const left = bit(a), right = bit(b); return left < right ? -1 : left > right ? 1 : 0;
}
export function keyIndices(data, keys) {
  if (typeof keys === 'string') keys = keys ? keys.split('+') : [];
  if (keys instanceof Set) keys = [...keys];
  if (!Array.isArray(keys)) throw new TypeError('Chord keys must be a list of native layout names or indices.');
  return union(keys.map(key => {
    const index = typeof key === 'string' ? data.layout.indexByName.get(key) : key;
    if (!Number.isInteger(index) || index < 0 || index >= data.layout.keys.length) throw new RangeError(`Unknown chord key: ${key}`);
    return index;
  }));
}
export const keyNames = (data, keys) => keyIndices(data, keys).map(index => data.layout.keys[index].name);
export const keyIndexForEvent = (data, event) => data.layout.indexByBrowserCode.get(event.code) ?? null;
export const effectiveDictionary = (data, mode) => new Map([...data.dictionaryMaps.shared, ...data.dictionaryMaps[mode]]);
export const effectiveEntry = (data, mode, keys) => data.dictionaryMaps[mode].get(chordID(keys)) ?? data.dictionaryMaps.shared.get(chordID(keys));

export function createRuntimeData(exported) {
  if (!exported || exported.schemaVersion !== 1 || !Array.isArray(exported.layout?.keys)) throw new TypeError('Unsupported KeyChord data.');
  const data = {...exported, exported, isRuntimeData: true};
  data.layout = {...exported.layout, keys: exported.layout.keys.map((key, index) => ({...key, index}))};
  const layout = data.layout;
  if (!layout.keys.length || layout.keys.length > 64) throw new TypeError('A layout must contain 1–64 keys.');
  for (const field of ['name', 'code', 'browserCode']) {
    const values = layout.keys.map(k => k[field]);
    if (new Set(values).size !== values.length) throw new TypeError(`Duplicate layout ${field}.`);
  }
  layout.indexByName = new Map(layout.keys.map(key => [key.name, key.index]));
  layout.indexByCode = new Map(layout.keys.map(key => [key.code, key.index]));
  layout.indexByBrowserCode = new Map(layout.keys.map(key => [key.browserCode, key.index]));
  for(const key of layout.keys) {
    if(typeof key.name!=='string'||!key.name||!Number.isInteger(key.code)||key.code<0||key.code>65535||key.code>=54&&key.code<=63||!['onset','vowel','coda','number','spell','space'].includes(key.role)||typeof key.browserCode!=='string'||!key.browserCode)throw new TypeError('Invalid native layout key.');
    if(key.role==='number'&&!/^\d$/.test(key.digit??''))throw new TypeError('Number keys require one digit.');
  }
  if(layout.keys.filter(k=>k.role==='spell').length>1||layout.keys.filter(k=>k.role==='space').length>1)throw new TypeError('A layout can contain only one spell key and one space key.');
  layout.spellIndex = layout.keys.find(key => key.role === 'spell')?.index ?? null;
  layout.spaceIndex = layout.keys.find(key => key.role === 'space')?.index ?? null;
  layout.bankMasks = Object.fromEntries(BANKS.map(bank => [bank, layout.keys.filter(key => key.role === bank).map(key => key.index)]));
  layout.numberMask = layout.keys.filter(key => key.role === 'number').map(key => key.index);
  layout.allBanksMask = union(...Object.values(layout.bankMasks));
  for(const bank of BANKS) {
    const seen=new Set();for(const row of layout.clusters[bank]??[]) {
      const indices=keyIndices(data,row.keys),id=chordID(indices);
      if(!indices.length||!isSubset(indices,layout.bankMasks[bank])||typeof row.text!=='string'||!row.text||seen.has(id))throw new TypeError(`Invalid or duplicate ${bank} cluster.`);
      seen.add(id);
    }
  }
  const spellSeen=new Set();for(const row of layout.fingerspelling) {
    const indices=keyIndices(data,row.keys),id=chordID(indices);
    if(!indices.length||indices.includes(layout.spellIndex)||typeof row.text!=='string'||graphemes(row.text).length!==1||!/^\p{Letter}/u.test(row.text)||spellSeen.has(id))throw new TypeError('Invalid or duplicate fingerspelling entry.');
    spellSeen.add(id);
  }
  layout.clusterMaps = Object.fromEntries(BANKS.map(bank => [bank, new Map((layout.clusters[bank] ?? []).map(row => [chordID(keyIndices(data, row.keys)), row.text]))]));
  layout.fingerspellingMap = new Map(layout.fingerspelling.map(row => [chordID(keyIndices(data, row.keys)), row.text]));
  data.dictionaryMaps = {};
  const commands=new Set(['undo','modeSwitch','capitalizeNext','snippetExit','endIdentifier','casing:snake','casing:camel','casing:pascal','casing:screamingSnake']);
  for(const mode of ['shared','english','cpp']) {
    if(!Array.isArray(exported.dictionaries?.[mode]))throw new TypeError(`Missing ${mode} dictionary.`);
    const table=new Map();for(const row of exported.dictionaries[mode]) {
      const indices=keyIndices(data,row.keys),id=chordID(indices),entry=row.entry;
      if(!indices.length||indices.length>1&&indices.includes(layout.spaceIndex)||table.has(id))throw new TypeError(`Invalid or duplicate ${mode} chord.`);
      if(entry?.type==='command'){if(!commands.has(entry.command))throw new TypeError('Unknown native command.');}
      else if(entry?.type==='text') {
        if(typeof entry.text!=='string'||!entry.text||!['word','symbol','suffix'].includes(entry.kind))throw new TypeError('Invalid native text entry.');
        if(entry.cursorFromEnd!=null&&(!Number.isInteger(entry.cursorFromEnd)||entry.cursorFromEnd<0||entry.cursorFromEnd>graphemes(entry.text).length||entry.kind==='suffix'))throw new TypeError('Invalid native cursor marker.');
        for(const flag of ['attachLeft','attachRight','wordAttach','glue','capitalizeNext'])if(entry[flag]!=null&&typeof entry[flag]!=='boolean')throw new TypeError('Entry flags must be booleans.');
      } else throw new TypeError('Entry must be text or command.');
      table.set(id,{...entry});
    }data.dictionaryMaps[mode]=table;
  }
  data._inventoryCache = new Map();
  return data;
}
export function getProfile(data, id = 'generic', options = {}) {
  if (typeof id === 'object' && id !== null) {
    const given = id;
    return {...given, rolloverLimit: options.rolloverLimit ?? given.rolloverLimit ?? 6,
      usable(keys) { const indices = keyIndices(data, keys); return indices.length <= this.rolloverLimit && (given.usable?.(indices) ?? given.accepts?.(indices) ?? true) && (options.usable?.(indices) ?? true); }};
  }
  const profile = data.profiles.find(profile => profile.id === id) ?? data.profiles[0];
  const limit = options.rolloverLimit ?? profile.rolloverLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new RangeError('Rollover must be between 1 and 64.');
  const blocked = (options.blockedChords ?? []).map(keys => keyIndices(data, keys));
  const wiring = profile.wiring;
  const positions = new Map(wiring?.positions.map(p => [p.code, p]) ?? []);
  const occupied = new Set([...(wiring?.positions ?? []), ...(wiring?.otherKeys ?? [])].map(p => `${p.row}\0${p.column}`));
  function blockedTriple(a, b, c) {
    const ps = [a, b, c].map(index => positions.get(data.layout.keys[index].code));
    if (ps.some(p => !p)) return false;
    for (let i = 0; i < 3; i++) {
      const x = ps[i], y = ps[(i + 1) % 3], z = ps[(i + 2) % 3];
      if (y.row === z.row || y.column === z.column) continue;
      if (x.row === y.row && x.column === z.column && occupied.has(`${z.row}\0${y.column}`)) return true;
      if (x.column === y.column && x.row === z.row && occupied.has(`${y.row}\0${z.column}`)) return true;
    }
    return false;
  }
  const explain = keys => {
    const indices = keyIndices(data, keys);
    if (indices.length > limit) return `${indices.length} keys exceed the ${limit}-key rollover limit.`;
    if (blocked.some(chord => isSubset(chord, indices))) return 'This chord contains a combination your local keyboard check could not capture.';
    for (let i = 0; i < indices.length; i++) for (let j = i + 1; j < indices.length; j++) for (let k = j + 1; k < indices.length; k++) {
      if (blockedTriple(indices[i], indices[j], indices[k])) return 'The selected keyboard wiring predicts a dropped key in this chord.';
    }
    if (options.usable && !options.usable(indices)) return 'This chord is blocked by your local keyboard profile.';
    return null;
  };
  return {...profile, rolloverLimit: limit, usable: keys => explain(keys) === null, accepts: keys => explain(keys) === null, explain};
}
export function displayEntry(entry) {
  if (entry.type === 'command') return ({undo:'undo', modeSwitch:'mode', capitalizeNext:'Cap', snippetExit:'exit', endIdentifier:'end', 'casing:snake':'snake', 'casing:camel':'camel', 'casing:pascal':'Pascal', 'casing:screamingSnake':'SNAKE'})[entry.command] ?? entry.command;
  if (entry.kind === 'suffix') return '-' + entry.text;
  if (entry.cursorFromEnd != null) { const chars = graphemes(entry.text); return chars.slice(0, chars.length - entry.cursorFromEnd).join('') + '…' + chars.slice(chars.length - entry.cursorFromEnd).join(''); }
  return entry.text;
}
export function describeCommand(command) {
  return ({undo:'undo the last chord', modeSwitch:'switch between English and C++', capitalizeNext:'capital on the next word', snippetExit:'jump out of the brackets or quotes', endIdentifier:'end the name', 'casing:snake':'start a snake_case name', 'casing:camel':'start a camelCase name', 'casing:pascal':'start a PascalCase name', 'casing:screamingSnake':'start a SCREAMING_SNAKE_CASE name'})[command] ?? command;
}
export function keyMeanings(data, mode = 'english') {
  const layout = data.layout, effective = effectiveDictionary(data, mode);
  const commandKeys = command => [...effective].filter(([, e]) => e.type === 'command' && e.command === command).map(([key]) => key ? key.split(',').map(Number) : []).sort(compareKeys)[0];
  const keys = layout.keys.map(key => {
    const entry = effective.get(chordID([key.index])), alone = entry ? displayEntry(entry) : null;
    if (BANKS.includes(key.role)) {
      const sound = layout.clusterMaps[key.role].get(chordID([key.index]));
      return {...key, role: sound ? key.role : 'special', label: sound || alone || '', alone: sound ? (alone === sound ? null : alone) : null};
    }
    return {...key, label: key.role === 'number' ? key.digit : key.role === 'space' ? 'join' : 'spell', alone: key.role === 'space' ? 'space' : key.role === 'spell' ? alone : null};
  });
  const extra = new Set(); let capitals = 0;
  for (const [id, letter] of layout.fingerspellingMap) if (graphemes(letter).length === 1 && letter.toUpperCase() === letter && letter.toLowerCase() !== letter) {
    const lower = [...layout.fingerspellingMap].find(([, text]) => text === letter.toLowerCase());
    const upperKeys = id.split(',').map(Number), lowerKeys = lower?.[0].split(',').map(Number) ?? [];
    const diff = subtract(upperKeys, lowerKeys);
    if (!lower || !isSubset(lowerKeys, upperKeys) || diff.length !== 1) { extra.add(-1); continue; }
    extra.add(diff[0]); capitals++;
  }
  return {keys, capitalKey: capitals > 0 && extra.size === 1 ? [...extra][0] : null, spellKey: layout.spellIndex,
    undoKeys: commandKeys('undo')?.map(i => layout.keys[i].name) ?? [], capitalizeNextKeys: commandKeys('capitalizeNext')?.map(i => layout.keys[i].name) ?? [], modeSwitchKeys: commandKeys('modeSwitch')?.map(i => layout.keys[i].name) ?? []};
}
