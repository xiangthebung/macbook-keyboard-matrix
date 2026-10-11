import {graphemes, graphemeCount, commonPrefix} from './buffer.js?v=96c282d34c00';
import {BANKS, keyIndices, keyNames, chordID, effectiveEntry, subtract, intersection, isSubset, displayEntry, describeCommand} from './data.js?v=96c282d34c00';

const clone = value => structuredClone(value);
export const initialContext = () => ({atStart: true, last: null, pendingCap: false, doubleQuoteOpen: false, casing: null, snippets: [], afterSnippet: false, prevWord: null});
export const capitalizeFirst = text => { const chars = graphemes(text); return (chars.shift()?.toUpperCase() ?? '') + chars.join(''); };
export const lowercaseFirst = text => { const chars = graphemes(text); return (chars.shift()?.toLowerCase() ?? '') + chars.join(''); };
const isLetter = char => /^\p{Letter}/u.test(char);
const isVowel = char => ['a', 'e', 'i', 'o', 'u'].includes(char.toLowerCase());
const consonant = char => isLetter(char) && !isVowel(char);
const upper = char => char.toUpperCase() === char && char.toLowerCase() !== char;
const whitespace = char => char !== undefined && /^\p{White_Space}+$/u.test(char);
export function attachSuffix(word, suffix, exceptions = {}) {
  if (!word || !suffix) return word + suffix;
  const lowerWord = word.toLowerCase(), lowerSuffix = suffix.toLowerCase();
  const result = exceptions[lowerWord + '+' + lowerSuffix];
  if (result != null) {
    const letters = graphemes(word).filter(isLetter);
    if (letters.length > 1 && letters.every(upper)) return result.toUpperCase();
    return upper(graphemes(word)[0]) ? capitalizeFirst(result) : result;
  }
  const chars = graphemes(word), lowerChars = graphemes(lowerWord), first = graphemes(lowerSuffix)[0];
  const last = lowerChars.at(-1), penultimate = lowerChars.at(-2);
  if (first === 'e' && last === 'e' || isVowel(first) && chars.length >= 2 && last === 'e' && consonant(penultimate)) return chars.slice(0, -1).join('') + suffix;
  if (first !== 'i' && chars.length >= 2 && last === 'y' && consonant(penultimate)) {
    const y = chars.pop(); chars.push(upper(y) ? 'I' : 'i');
    return chars.join('') + (lowerSuffix === 's' ? (upper(graphemes(suffix)[0]) ? 'ES' : 'es') : suffix);
  }
  if (lowerSuffix === 's' && ['s', 'x', 'z', 'ch', 'sh'].some(end => lowerWord.endsWith(end))) return word + (upper(graphemes(suffix)[0]) ? 'ES' : 'es');
  if (isVowel(first) && chars.length >= 2 && lowerChars.every(isLetter) && consonant(last) && !['w','x','y'].includes(last) && isVowel(penultimate) && !lowerChars.slice(0, -2).some(isVowel)) return word + chars.at(-1) + suffix;
  return word + suffix;
}
const result = (actions = [], signal = null, modeSwitched = false) => ({actions, signal, modeSwitched});
const textEntry = (text, options = {}) => ({type:'text', text, cursorFromEnd:null, attachLeft:false, attachRight:false, wordAttach:false, glue:false, capitalizeNext:false, kind:'word', ...options});

export class ChordEngine {
  static undoCapacity = 100;
  constructor(data, subMode = 'english') {
    this.data = data; this.subMode = subMode; this.context = initialContext(); this.history = [];
    this.held = new Set(); this.chordKeys = new Set(); this.join = false;
  }
  get chordInProgress() { return this.chordKeys.size > 0; }
  get heldChordKeys() { return new Set(this.held); }
  get undoDepth() { return this.history.length; }
  get currentContext() { return clone(this.context); }
  replaceData(data) { this.data = data; this.discardChord(); this.contextReset(); }
  setSubMode(mode) { if (!['english','cpp'].includes(mode)) throw new TypeError('Unknown chord mode.'); this.discardChord(); this.subMode = mode; this.contextReset(); }
  restore(context) { if (!context || !Array.isArray(context.snippets) || typeof context.atStart !== 'boolean') throw new TypeError('Invalid engine context.'); this.context = clone(context); }
  contextReset() { const cap = this.context.pendingCap; this.context = initialContext(); this.context.pendingCap = cap; this.history = []; }
  keyDown(key, options = {}) {
    if (options.repeat) return;
    const index = keyIndices(this.data, [key])[0];
    this.held.add(index); this.chordKeys.add(index);
    if (options === true || options.shift) this.join = true;
  }
  joinPressed() { if (this.chordInProgress) this.join = true; }
  keyUp(key, options = {}) {
    const index = keyIndices(this.data, [key])[0];
    if (!this.held.delete(index) || this.held.size) return null;
    const keys = [...this.chordKeys].sort((a,b)=>a-b), join = this.join;
    this.chordKeys.clear(); this.join = false;
    return this.translate(keys, {join, capsLock:options.capsLock ?? false});
  }
  discardChord() { this.held.clear(); this.chordKeys.clear(); this.join = false; }
  syncPhysical(keys) { const physical = new Set(keyIndices(this.data, keys)); if (this.chordInProgress && ![...this.held].some(key => physical.has(key))) this.discardChord(); }
  translate(chord, {join = false, capsLock = false} = {}) {
    const layout = this.data.layout;
    let keys = keyIndices(this.data, chord);
    if (layout.spaceIndex != null && keys.includes(layout.spaceIndex)) {
      if (keys.length === 1) return this.emit(textEntry(' ', {attachLeft:true, attachRight:true, kind:'symbol'}), join, capsLock);
      keys = keys.filter(i => i !== layout.spaceIndex); join = true;
    }
    if (!keys.length) return result([], 'untranslatable');
    const entry = effectiveEntry(this.data, this.subMode, keys);
    if (entry) return entry.type === 'command' ? this.run(entry.command) : this.emit(entry, join, capsLock);
    if (layout.spellIndex != null && keys.includes(layout.spellIndex)) {
      const letter = layout.fingerspellingMap.get(chordID(subtract(keys, [layout.spellIndex])));
      return letter == null ? result([], 'untranslatable') : this.emit(textEntry(letter, {glue:true}), join, capsLock);
    }
    if (isSubset(keys, layout.numberMask)) return this.emit(textEntry(keys.map(i => layout.keys[i].digit).join(''), {glue:true}), join, capsLock);
    if (isSubset(keys, layout.allBanksMask)) {
      let text = '';
      for (const bank of BANKS) {
        const part = intersection(keys, layout.bankMasks[bank]); if (!part.length) continue;
        const cluster = layout.clusterMaps[bank].get(chordID(part));
        if (cluster == null) return result([], 'untranslatable');
        text += cluster;
      }
      return this.emit(textEntry(text), join, capsLock);
    }
    return result([], 'untranslatable');
  }
  record(record) { this.history.push(record); if (this.history.length > ChordEngine.undoCapacity) this.history.shift(); }
  run(command) {
    if (command === 'undo') {
      const record = this.history.pop(); if (!record) return result([], 'undoEmpty');
      const actions = [];
      if (record.movedRight) actions.push({type:'moveLeft',count:record.movedRight});
      if (record.insertedAfter) actions.push({type:'deleteForward',count:record.insertedAfter});
      if (record.insertedBefore) actions.push({type:'deleteBackward',count:record.insertedBefore});
      if (record.deleted) actions.push({type:'insert',text:record.deleted});
      this.context = clone(record.before); return result(actions);
    }
    if (command === 'modeSwitch') { this.subMode = this.subMode === 'english' ? 'cpp' : 'english'; this.contextReset(); return result([],null,true); }
    const record = {before:clone(this.context),deleted:'',insertedBefore:0,insertedAfter:0,movedRight:0};
    if (command === 'snippetExit') {
      const frame = this.context.snippets.pop(); if (!frame) return result([], 'untranslatable');
      this.context.last = {kind:frame.kind,attachRight:frame.attachRight,glue:false,endsWithWhitespace:frame.endsWithWhitespace,closesExpression:frame.closesExpression};
      this.context.afterSnippet = false; this.context.casing = null; this.context.prevWord = null;
      record.movedRight = frame.tail; this.record(record);
      return result(frame.tail > 0 ? [{type:'moveRight',count:frame.tail}] : []);
    }
    if (command === 'capitalizeNext') this.context.pendingCap = true;
    else if (command.startsWith('casing:')) this.context.casing = {mode:command.slice(7),words:0};
    else if (command === 'endIdentifier') this.context.casing = null;
    else throw new TypeError(`Unknown engine command: ${command}`);
    this.record(record); return result();
  }
  needsSpace(entry, join) {
    const context = this.context, last = context.last;
    if (context.atStart || context.afterSnippet || !last || last.attachRight || entry.attachLeft || join) return false;
    if (last.endsWithWhitespace || whitespace(graphemes(entry.text)[0])) return false;
    if (entry.wordAttach && (['word','suffix'].includes(last.kind) || last.closesExpression) || entry.glue && last.glue) return false;
    return true;
  }
  emit(entry, join, capsLock) {
    const before = clone(this.context), context = this.context;
    const record = {before,deleted:'',insertedBefore:0,insertedAfter:0,movedRight:0}, actions = [];
    entry = {...entry};
    if (entry.kind === 'symbol' && entry.cursorFromEnd == null && entry.text === '"' && !(entry.attachLeft && entry.attachRight)) {
      if (entry.attachLeft || context.doubleQuoteOpen) { entry.attachLeft = true; entry.attachRight = false; context.doubleQuoteOpen = false; }
      else { entry.attachRight = true; context.doubleQuoteOpen = true; }
    }
    if (entry.kind === 'suffix') {
      let inserted = capsLock ? entry.text.toUpperCase() : entry.text;
      if (context.prevWord != null) {
        const word = attachSuffix(context.prevWord, entry.text, this.data.orthographyExceptions), prefix = commonPrefix(context.prevWord, word);
        record.deleted = graphemes(context.prevWord).slice(prefix).join('');
        inserted = graphemes(word).slice(prefix).join(''); if (capsLock) inserted = inserted.toUpperCase();
        context.prevWord = graphemes(word).slice(0,prefix).join('') + inserted;
      } else context.prevWord = null;
      if (record.deleted) actions.push({type:'deleteBackward',count:graphemeCount(record.deleted)});
      if (inserted) actions.push({type:'insert',text:inserted});
      record.insertedBefore = graphemeCount(inserted);
      context.last = {kind:'suffix',attachRight:!!entry.attachRight,glue:false,endsWithWhitespace:whitespace(graphemes(inserted).at(-1)),closesExpression:false}; context.atStart = false; context.afterSnippet = false;
      this.record(record); return result(actions);
    }
    if (entry.kind === 'symbol') context.casing = null;
    const spaced = this.needsSpace(entry, join);
    let text = entry.text, cursorFromEnd = entry.cursorFromEnd, separator = spaced ? ' ' : '', continuesWord = false;
    if (entry.kind === 'word') {
      if (context.pendingCap) { text = capitalizeFirst(text); context.pendingCap = false; }
      if (context.casing) {
        const casing = context.casing;
        const continuing = casing.words > 0 && (join || entry.glue && before.last?.glue);
        const digits = casing.words > 0 && text.length > 0 && /^\p{Number}+$/u.test(text);
        const newWord = !continuing && !digits;
        switch (casing.mode) {
          case 'snake': text = text.toLowerCase(); break;
          case 'screamingSnake': text = text.toUpperCase(); break;
          case 'camel': if (newWord) text = casing.words === 0 ? lowercaseFirst(text) : capitalizeFirst(text); break;
          case 'pascal': if (newWord) text = capitalizeFirst(text); break;
        }
        if (casing.words > 0) separator = newWord && ['snake','screamingSnake'].includes(casing.mode) ? '_' : '';
        continuesWord = !newWord; if (newWord) casing.words++;
      } else continuesWord = !spaced && !before.afterSnippet && ['word','suffix'].includes(before.last?.kind);
    }
    if (capsLock) { if (cursorFromEnd != null) cursorFromEnd = graphemeCount(graphemes(text).slice(-cursorFromEnd || Infinity).join('').toUpperCase()); text = text.toUpperCase(); }
    context.prevWord = entry.kind === 'word' && !whitespace(graphemes(text).at(-1)) ? (continuesWord ? (context.prevWord ?? '') + text : text) : null;
    const closesExpression = !entry.attachRight && (entry.attachLeft || cursorFromEnd != null) && [')', ']', '}', '>', '"', "'"].includes(graphemes(text).at(-1));
    const full = separator + text; actions.push({type:'insert',text:full});
    if (cursorFromEnd != null) {
      if (cursorFromEnd < 0 || cursorFromEnd > graphemeCount(text)) throw new RangeError('Cursor marker outside snippet.');
      if (cursorFromEnd > 0) actions.push({type:'moveLeft',count:cursorFromEnd});
      context.snippets.push({tail:cursorFromEnd,attachRight:!!entry.attachRight,kind:entry.kind,endsWithWhitespace:whitespace(graphemes(text).at(-1)),closesExpression}); context.afterSnippet = true;
      record.insertedBefore = graphemeCount(full) - cursorFromEnd; record.insertedAfter = cursorFromEnd;
    } else { context.afterSnippet = false; record.insertedBefore = graphemeCount(full); }
    const beforeCursor = cursorFromEnd == null ? text : graphemes(text).slice(0, graphemeCount(text) - cursorFromEnd).join('');
    context.last = {kind:entry.kind,attachRight:!!entry.attachRight,glue:!!entry.glue,endsWithWhitespace:whitespace(graphemes(beforeCursor).at(-1)),closesExpression:cursorFromEnd == null && closesExpression}; context.atStart = false;
    if (entry.capitalizeNext && this.subMode === 'english') context.pendingCap = true;
    this.record(record); return result(actions);
  }
}

export function recipeForChord(data, chord, {mode = 'english', shift = false} = {}) {
  const layout = data.layout, parts = []; let keys = keyIndices(data, chord), joins = shift;
  const part = (text, keys, role) => ({text,keys:keyNames(data,keys),role});
  if (layout.spaceIndex != null && keys.includes(layout.spaceIndex)) {
    if (keys.length === 1) return {parts:[part('space',keys,'space')],outcome:{type:'text',text:' '},joins:false};
    parts.push(part('join',[layout.spaceIndex],'join')); keys = subtract(keys,[layout.spaceIndex]); joins = true;
  }
  const nothing = () => ({parts,outcome:{type:'nothing'},joins});
  if (!keys.length) return nothing();
  const entry = effectiveEntry(data, mode, keys);
  if (entry) {
    const command = entry.type === 'command', shown = command ? describeCommand(entry.command) : displayEntry(entry);
    parts.push(part(shown,keys,command ? 'command' : entry.kind === 'suffix' ? 'suffix' : entry.kind === 'symbol' ? 'symbol' : 'word'));
    return {parts,outcome:{type:command?'command':'text',text:shown},joins};
  }
  if (layout.spellIndex != null && keys.includes(layout.spellIndex)) {
    const rest = subtract(keys,[layout.spellIndex]), letter = layout.fingerspellingMap.get(chordID(rest));
    parts.push(part('spell',[layout.spellIndex],'spell'));
    if (letter == null) { if (rest.length) parts.push(part('?',rest,'letter')); return nothing(); }
    const lower = letter.toLowerCase(), lowerID = [...layout.fingerspellingMap].find(([, text]) => text === lower)?.[0];
    const lowerKeys = lowerID?.split(',').map(Number);
    if (lower !== letter && lowerKeys && isSubset(lowerKeys,rest) && subtract(rest,lowerKeys).length) { parts.push(part('capital',subtract(rest,lowerKeys),'capital'),part(lower,lowerKeys,'letter')); }
    else parts.push(part(letter,rest,'letter'));
    return {parts,outcome:{type:'text',text:letter},joins};
  }
  let text = '', valid = isSubset(keys,layout.numberMask) || isSubset(keys,layout.allBanksMask);
  for (const index of intersection(keys,layout.numberMask)) { const digit = layout.keys[index].digit; text += digit; parts.push(part(digit,[index],'digit')); }
  for (const bank of BANKS) {
    const indices = intersection(keys,layout.bankMasks[bank]); if (!indices.length) continue;
    const cluster = layout.clusterMaps[bank].get(chordID(indices)); parts.push(part(cluster ?? '?',indices,bank));
    if (cluster == null) valid = false; else text += cluster;
  }
  return {parts,outcome:valid && text ? {type:'text',text} : {type:'nothing'},joins};
}
