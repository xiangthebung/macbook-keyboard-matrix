import {graphemes} from './buffer.js?v=96c282d34c00';

const mask = (1n << 64n) - 1n;
export class WordPracticeWordStream {
  constructor(words, seed) {
    if (!words?.length) throw new TypeError('A vocabulary must contain words.');
    this.words = words;
    this.state = BigInt(seed) & mask;
    this.previous = null;
  }
  next() {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & mask;
    let value = this.state;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & mask;
    value ^= value >> 31n;
    let index = Number(value % BigInt(this.words.length - (this.previous === null || this.words.length === 1 ? 0 : 1)));
    if (this.previous !== null && this.words.length > 1 && index >= this.previous) index++;
    this.previous = index;
    return this.words[index];
  }
}

// The session follows WordPractice.swift. Only preferences are persisted by the UI.
export class WordPracticeSession {
  constructor({vocabulary = 'english', goal = {type: 'words', count: 10}, seed, words}) {
    if (!['time', 'words'].includes(goal.type) || !Number.isInteger(goal.count) || goal.count <= 0) throw new TypeError('Invalid practice goal.');
    Object.assign(this, {vocabulary, goal: {...goal}, initialSeed: seed, sourceWords: words});
    this.stream = new WordPracticeWordStream(words, seed);
    this.targetWords = Array.from({length: goal.type === 'time' ? 50 : goal.count}, () => this.stream.next());
    this.typedText = ''; this.startedAt = null; this.finishedAt = null;
    this.samples = []; this.insertedCharacters = 0; this.correctInsertions = 0;
    this.lastTime = 0; this.lastSampleErrors = 0; this.nextSampleSecond = 1;
    this.characterBins = new Map();
  }
  get isFinished() { return this.finishedAt !== null; }
  get currentWordIndex() { return this.typedText.split(' ').length - 1; }
  get typedWords() { return this.typedText.split(' '); }
  restarted() { return new WordPracticeSession({vocabulary: this.vocabulary, goal: this.goal, seed: this.initialSeed, words: this.sourceWords}); }
  edit([start, end], replacement, now, verifiedChordPreview = false) {
    this.advance(now);
    if (this.isFinished) return false;
    const chars = graphemes(this.typedText), inserted = graphemes(replacement);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > chars.length || inserted.some(c => /\s/u.test(c) && c !== ' ')) return false;
    if (this.startedAt === null && inserted.length) { this.startedAt = now; this.lastTime = now; }
    chars.splice(start, end - start, ...inserted); this.typedText = chars.join('');
    if (this.goal.type === 'time') while (this.currentWordIndex >= this.targetWords.length - 10) this.targetWords.push(...Array.from({length: 50}, () => this.stream.next()));
    const correctness = this.characterCorrectness();
    for (let offset = start; offset < start + inserted.length; offset++) {
      this.insertedCharacters++;
      if (verifiedChordPreview || correctness[offset]) this.correctInsertions++;
    }
    if (this.startedAt !== null && inserted.length) {
      const bin = Math.floor(Math.max(0, this.lastTime - this.startedAt) + 1e-9);
      this.characterBins.set(bin, (this.characterBins.get(bin) ?? 0) + inserted.length);
    }
    if (this.goal.type === 'words' && (this.currentWordIndex >= this.goal.count || (this.currentWordIndex === this.goal.count - 1 && this.typedWords.at(-1) === this.targetWords.at(-1)))) this.finish(this.lastTime);
    return true;
  }
  advance(now) {
    if (this.startedAt === null || this.isFinished) return;
    this.lastTime = Math.max(this.lastTime, now);
    if (this.goal.type === 'time') this.lastTime = Math.min(this.lastTime, this.startedAt + this.goal.count);
    if (this.lastTime - this.startedAt >= this.nextSampleSecond) {
      this.addSample(this.lastTime); this.nextSampleSecond = Math.floor(this.lastTime - this.startedAt) + 1;
    }
    if (this.goal.type === 'time' && this.lastTime >= this.startedAt + this.goal.count) this.finish(this.lastTime);
  }
  metrics(now) {
    let end = this.finishedAt ?? Math.max(this.lastTime, now);
    if (this.goal.type === 'time' && this.startedAt !== null) end = Math.min(end, this.startedAt + this.goal.count);
    const elapsed = this.startedAt === null ? 0 : Math.max(0, end - this.startedAt);
    let correct = 0, incorrect = 0, extra = 0, missed = 0, correctWords = 0, credited = 0;
    const tokens = this.typedWords, completed = Math.min(this.currentWordIndex, this.targetWords.length);
    for (let index = 0; index < Math.min(tokens.length, this.targetWords.length); index++) {
      const expected = graphemes(this.targetWords[index]), actual = graphemes(tokens[index]);
      const equal = tokens[index] === this.targetWords[index];
      const committed = index < this.currentWordIndex || (this.isFinished && equal);
      actual.forEach((character, position) => { if (position >= expected.length) extra++; else if (character === expected[position]) correct++; else incorrect++; });
      if (committed) missed += Math.max(0, expected.length - actual.length);
      if (equal && committed) { correctWords++; credited += expected.length; if (index < this.currentWordIndex) { credited++; correct++; } }
      else if (index === this.currentWordIndex && actual.every((c, i) => expected[i] === c)) credited += actual.length;
    }
    const fullSeconds = Math.floor(elapsed + 1e-9), finalPartial = this.isFinished && elapsed - fullSeconds >= .25;
    const bins = Array.from({length: Math.max(1, fullSeconds + (finalPartial ? 1 : 0))}, (_, i) => (this.characterBins.get(i) ?? 0) / Math.min(1, Math.max(.001, elapsed - i)));
    const mean = bins.reduce((a, b) => a + b, 0) / bins.length;
    const variance = bins.reduce((a, b) => a + (b - mean) ** 2, 0) / bins.length;
    return {elapsed, wpm: elapsed > 0 ? credited * 12 / Math.max(elapsed, .001) : 0,
      rawWPM: elapsed > 0 ? graphemes(this.typedText).length * 12 / Math.max(elapsed, .001) : 0,
      accuracy: this.insertedCharacters ? this.correctInsertions * 100 / this.insertedCharacters : 100,
      consistency: bins.length > 1 && mean > 0 ? Math.max(0, 100 * (1 - Math.sqrt(variance) / mean)) : 0,
      correct, incorrect, extra, missed, completedWords: this.isFinished ? Math.max(completed, correctWords) : completed,
      correctWords, mistakes: this.insertedCharacters - this.correctInsertions};
  }
  characterCorrectness() {
    let word = 0, position = 0, expected = graphemes(this.targetWords[0]);
    return graphemes(this.typedText).map(c => {
      if (c === ' ') { word++; position = 0; expected = graphemes(this.targetWords[word] ?? ''); return word <= this.targetWords.length; }
      return c === expected[position++];
    });
  }
  addSample(now) {
    const m = this.metrics(now); let errors = Math.max(0, m.mistakes - this.lastSampleErrors);
    if (this.samples.at(-1)?.seconds === m.elapsed) errors += this.samples.pop().errors;
    this.samples.push({seconds: m.elapsed, wpm: m.wpm, rawWPM: m.rawWPM, errors}); this.lastSampleErrors = m.mistakes;
  }
  finish(now) { this.finishedAt = now; this.addSample(now); }
}
