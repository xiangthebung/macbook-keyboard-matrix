// Port of TypingPlanner.swift. Every candidate is replayed by ChordEngine before a recipe is retained.
import {graphemes, graphemeCount, createBuffer, applyActions, commonPrefix} from './buffer.js?v=f3ab99c6cf25';
import {BANKS, chordID, keyIndices, keyNames, union, subtract, isSubset, compareKeys, effectiveDictionary, getProfile} from './data.js?v=f3ab99c6cf25';
import {ChordEngine, attachSuffix, initialContext, capitalizeFirst} from './engine.js?v=f3ab99c6cf25';

const wordChar = char => /^(?:\p{Letter}|\p{Number}|_)/u.test(char);
const letter = char => /^\p{Letter}/u.test(char);
const number = char => /^\p{Number}/u.test(char);
const uppercase = char => char.toUpperCase() === char && char.toLowerCase() !== char;
const lowercase = char => char.toLowerCase() === char && char.toUpperCase() !== char;
const lower = char => graphemeCount(char.toLowerCase()) === 1 ? char.toLowerCase() : char;
const lineBreak = char => ['\n','\r','\r\n'].includes(char);
const eq = (a,b) => a.length === b.length && a.every((c,i) => c.normalize('NFC') === b[i].normalize('NFC'));
const cost = keys => 100 + keys.length;
const normalNote = 'no chord for this: type this part normally, then resume chord typing';
const noCluster = {text:[],keys:[[]]};
const outSeg = (alts,text,kind,note,parts=null) => ({type:'out',alts,text,kind,note,parts});
const part = (text,keys,role) => ({text,keys,role});
const mergeNormals = segs => {
  const out = [];
  for (const seg of segs) {
    if (seg.type === 'normal' && out.at(-1)?.type === 'normal') out.at(-1).text += seg.text;
    else out.push({...seg});
  }
  return out;
};

export class TypingPlanner {
  constructor({data, mode = 'english', profile = 'generic', rolloverLimit, usable} = {}) {
    if (!data?.isRuntimeData) throw new TypeError('TypingPlanner needs createRuntimeData output.');
    this.data = data; this.mode = mode; this.profile = getProfile(data, profile, {rolloverLimit,usable});
    this.rolloverLimit = this.profile.rolloverLimit; this.layout = data.layout; this.effective = effectiveDictionary(data,mode);
    this.usableCache = new Map(); this.wordCache = new Map();
    this.buildInventory();
  }
  isUsable(keys) {
    const id = chordID(keys);
    if (!this.usableCache.has(id)) this.usableCache.set(id, keys.length <= this.rolloverLimit && this.profile.usable(keys));
    return this.usableCache.get(id);
  }
  buildInventory() {
    this.clusters = {}; this.briefs = new Map(); this.symbols = new Map(); this.mixed = []; this.suffixes = []; this.exceptionBases = new Map(); this.fingerspell = new Map(); this.digitKey = new Map();
    const symbols = new Map(), mixed = new Map();
    const sorted = [...this.effective].map(([id,entry]) => ({keys:id.split(',').map(Number),entry})).sort((a,b) => compareKeys(a.keys,b.keys));
    for (const {keys,entry} of sorted) if (this.isUsable(keys)) {
      if (entry.type === 'command') {
        const property = ({capitalizeNext:'capNextKeys', 'casing:snake':'snakeKeys', 'casing:screamingSnake':'screamingKeys', endIdentifier:'endIdentifierKeys'})[entry.command];
        if (property && !this[property]) this[property] = keys;
        continue;
      }
      const chars = graphemes(entry.text);
      if (entry.cursorFromEnd != null || !chars.length || chars.some(c => /\s/u.test(c))) continue;
      if (entry.kind === 'suffix') { if (chars.every(letter)) this.suffixes.push({text:entry.text,keys}); continue; }
      if (chars.every(wordChar)) {
        if (entry.kind === 'word') { const first = lower(chars[0]); if (!this.briefs.has(first)) this.briefs.set(first,[]); this.briefs.get(first).push({text:chars,keys,entry}); }
      } else {
        const table = chars.some(wordChar) ? mixed : symbols;
        if (!table.has(entry.text)) table.set(entry.text,[]); table.get(entry.text).push(keys);
      }
    }
    for (const [text,alts] of [...symbols].sort(([a],[b]) => a.localeCompare(b,'en'))) {
      const chars = graphemes(text); if (!this.symbols.has(chars[0])) this.symbols.set(chars[0],[]); this.symbols.get(chars[0]).push({text:chars,alts});
    }
    this.mixed = [...mixed].map(([text,alts]) => ({text:graphemes(text),alts})).sort((a,b) => b.text.length - a.text.length || a.text.join('').localeCompare(b.text.join(''),'en'));
    for (const [key,result] of Object.entries(this.data.orthographyExceptions).sort(([a],[b]) => a.localeCompare(b,'en'))) {
      const [base,suffix] = key.split('+'); if (!suffix) continue;
      if (!this.exceptionBases.has(result)) this.exceptionBases.set(result,[]); this.exceptionBases.get(result).push({base,suffix});
    }
    if (this.layout.spellIndex != null) {
      const spells = [...this.layout.fingerspellingMap].map(([id,text]) => ({keys:id.split(',').map(Number),text})).sort((a,b) => compareKeys(a.keys,b.keys));
      for (const {keys,text} of spells) {
        const chord = union(keys,[this.layout.spellIndex]);
        if (this.effective.has(chordID(chord)) || !this.isUsable(chord) || graphemeCount(text) !== 1 || this.fingerspell.has(text)) continue;
        this.fingerspell.set(text,chord);
      }
    }
    for (const key of this.layout.keys) if (key.role === 'number' && !this.digitKey.has(key.digit)) this.digitKey.set(key.digit,key.index);
    for (const bank of BANKS) {
      const byText = new Map();
      const rows = [...this.layout.clusterMaps[bank]].map(([id,text]) => ({keys:id.split(',').map(Number),text})).sort((a,b) => compareKeys(a.keys,b.keys));
      for (const {keys,text} of rows) if (text) { if (!byText.has(text)) byText.set(text,[]); byText.get(text).push(keys); }
      const index = new Map();
      for (const [text,keys] of [...byText].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) {
        const chars = graphemes(text), first = lower(chars[0]); if (!index.has(first)) index.set(first,[]); index.get(first).push({text:chars,keys});
      }
      this.clusters[bank] = index;
    }
    this.spaceKeys = this.layout.spaceIndex != null ? [this.layout.spaceIndex] : null;
    if (this.spaceKeys && !this.isUsable(this.spaceKeys)) this.spaceKeys = null;
  }
  reset(context = null) {
    this.engine = new ChordEngine(this.data,this.mode); if (context) this.engine.restore(context);
    this.steps = []; this.group = 0; this.currentSource = [0,0]; this.matchedUpTo = 0;
  }
  plan(text) {
    this.reset(); const chars = graphemes(text); let lineStart = 0;
    for (let i = 0; i <= chars.length; i++) if (i === chars.length || lineBreak(chars[i])) {
      this.target = chars.slice(lineStart,i); this.buffer = []; this.lineOffset = lineStart; this.planLine();
      if (i === chars.length) break;
      this.group++; this.currentSource = [i,i+1]; this.engine.contextReset();
      if (chars[i] === '\n') this.addStep({type:'key',key:'Return'},'key','\n','new line',i+1);
      else this.addStep({type:'normal',text:chars[i]},'normal',chars[i],'preserve the source line ending',i+1);
      lineStart = i+1;
    }
    const guide = this.makeGuide(text);
    const replay = replayGuide(this.data,guide);
    if (replay.buffer.text !== text) throw new Error('Planner invariant: replay does not match the source passage.');
    guide.validated = true; return guide;
  }
  planContinuation(text, offset, previous = null, maxLength = 2000) {
    const chars = graphemes(text), start = Math.max(0,Math.min(offset,chars.length)); let lineStart = start,lineEnd = start;
    while (lineStart > 0 && !lineBreak(chars[lineStart-1])) lineStart--;
    while (lineEnd < chars.length && !lineBreak(chars[lineEnd])) lineEnd++;
    let end = lineEnd;
    if (lineEnd - start > maxLength) { end = start + maxLength; while (end < lineEnd && !(chars[end] === ' ' && chars[end-1] !== ' ')) end++; }
    const context = initialContext(), before = start > lineStart ? chars[start-1] : null, here = start < lineEnd ? chars[start] : null;
    if (before && before !== ' ' && before !== '\t' && here === ' ') { context.atStart = false; context.last = {kind:'word',attachRight:false,glue:false,endsWithWhitespace:false,closesExpression:false}; }
    const midWord = before && here && wordChar(before) && wordChar(here); context.pendingCap = midWord ? false : previous?.pendingCap ?? false;
    this.reset(context); this.target = chars.slice(lineStart,lineEnd); this.buffer = this.target.slice(0,start-lineStart); this.lineOffset = lineStart;
    this.planLine(start-lineStart,end-lineStart);
    return {guide:this.makeGuide(text),start,end,startContext:context};
  }
  makeGuide(text) {
    const steps = [];
    for (const step of this.steps) {
      const last = steps.at(-1);
      if (step.action.type === 'normal' && last?.action.type === 'normal') {
        last.action.text += step.action.text; last.output += step.output; last.source = [Math.min(last.source[0],step.source[0]),Math.max(last.source[1],step.source[1])];
        last.textEnd = step.textEnd; last.tail = step.tail; last.contextAfter = step.contextAfter;
      } else steps.push(step);
    }
    return {text,mode:this.mode,steps,chordCount:steps.filter(s=>s.action.type==='chord').length,normalCount:steps.filter(s=>s.action.type==='normal').length,validated:true,nativeValidated:false,profileID:this.profile.id};
  }
  planLine(start = 0, limit = this.target.length) {
    const n = this.target.length; let p = start;
    while (p < Math.min(limit,n)) {
      this.group++;
      if (this.target[p] === '\t') {
        this.currentSource = this.global(p,p+1); this.matchedUpTo = this.buffer.length; this.buffer.push('\t'); this.engine.contextReset();
        this.addStep({type:'key',key:'Tab'},'key','\t','Tab key'); p++; continue;
      }
      let q = p; while (q < n && this.target[q] === ' ') q++;
      if (q === n || this.target[q] === '\t') { this.typeSpaces(p,q-p); p = q; continue; }
      const end = this.runEnd(q); this.currentSource = this.global(q,end); let done = false;
      for (const candidate of this.candidates(q,end)) {
        this.currentSource = this.global(q,candidate.end);
        if (this.run(candidate.segs,p,q-p,candidate.end)) { p = candidate.end; done = true; break; }
      }
      if (!done) { this.currentSource = this.global(q,end); this.run([{type:'normal',text:this.target.slice(q,end).join('')}],p,q-p,end); p=end; }
    }
  }
  global(start,end) { return [this.lineOffset+start,this.lineOffset+end]; }
  runEnd(q) { const word = wordChar(this.target[q]); let end=q+1; while (end<this.target.length && this.target[end]!==' ' && this.target[end]!=='\t' && wordChar(this.target[end])===word) end++; return end; }
  typeSpaces(p,count) {
    if (!count) return; this.matchedUpTo=this.buffer.length; this.currentSource=this.global(p,p+count);
    for(let i=0;i<count;i++) {
      const output = this.spaceKeys ? this.tryAppend(this.spaceKeys,false,[' ']) : null;
      if(output!=null) this.addStep(this.chordAction(this.spaceKeys,false),'space',output,'space',null,[part('space',this.spaceKeys,'space')]);
      else { this.buffer.push(' '); this.engine.contextReset(); this.addStep({type:'normal',text:' '},'normal',' ',normalNote); }
    }
  }
  candidates(q,end) {
    const output=[], n=this.target.length;
    for(const mixed of this.mixed) if(q+mixed.text.length<=n && eq(this.target.slice(q,q+mixed.text.length),mixed.text)) {
      const e=q+mixed.text.length;
      if(e===n || wordChar(this.target[e])!==wordChar(this.target[e-1]) || this.target[e]===' ') { output.push({segs:[outSeg(mixed.alts,mixed.text.join(''),'brief','brief')],end:e}); break; }
    }
    const token=this.target.slice(q,end);
    if(wordChar(this.target[q])) {
      if(token.includes('_')) { const casing=this.casingPlan(token,end<n && this.target[end]===' '); if(casing) output.push({...casing,end}); }
      for(const plan of this.wordCandidates(token,this.engine.context.pendingCap)) output.push({...plan,end});
    } else { const symbols=this.symbolPlan(token); if(symbols) output.push({...symbols,end}); }
    return output;
  }
  wordCandidates(chars,cap) {
    const key=(cap?'1':'0')+chars.join('');
    if(!this.wordCache.has(key)) this.wordCache.set(key,this.wordPlans(chars,cap,2).slice(0,4));
    return this.wordCache.get(key);
  }
  wordPlans(chars,cap,depth) {
    const output=[], direct=this.segment(chars,cap); if(direct) output.push(direct);
    if(depth>0 && chars.length>=3 && chars.length<=48 && chars.every(letter)) {
      const word=chars.join(''), lowered=word.toLowerCase(), exception=this.exceptionBases.has(lowered);
      for(const suffix of this.suffixes) if(chars.length>graphemeCount(suffix.text) && (exception || lowered.endsWith(suffix.text.toLowerCase()))) {
        for(const base of this.baseCandidates(word,suffix.text)) if(attachSuffix(base,suffix.text,this.data.orthographyExceptions)===word) {
          const plan=this.wordPlans(graphemes(base),cap,depth-1)[0]; if(!plan) continue;
          output.push({cost:plan.cost+cost(suffix.keys)-(base+suffix.text===word?0:2),segs:[...plan.segs,{type:'suffix',keys:suffix.keys,suffix:suffix.text,base,result:word}]});
        }
      }
    }
    return output.sort((a,b)=>a.cost-b.cost);
  }
  baseCandidates(word,suffix) {
    const output=new Set(), chars=graphemes(word), n=graphemeCount(suffix);
    for(const count of [n,n+1]) if(chars.length>count) {
      const stem=chars.slice(0,-count).join(''); output.add(stem); output.add(stem+'e');
      if(stem.endsWith('i')) output.add(stem.slice(0,-1)+'y'); if(stem.endsWith('I')) output.add(stem.slice(0,-1)+'Y');
    }
    for(const item of this.exceptionBases.get(word.toLowerCase())??[]) if(item.suffix===suffix.toLowerCase()) output.add(uppercase(graphemes(word)[0])?capitalizeFirst(item.base):item.base);
    output.delete(''); return [...output].sort();
  }
  matches(text,word,position,cap) { if(!text.length || position+text.length>word.length) return false; return (cap ? word[position]===text[0].toUpperCase() : word[position]===text[0]) && text.slice(1).every((c,i)=>word[position+i+1]===c); }
  composeKeys(onset,vowel,coda) {
    for(const a of onset) for(const b of vowel) for(const c of coda) {
      const keys=union(a,b,c); if(!this.effective.has(chordID(keys)) && this.isUsable(keys)) return {keys,onset:a,vowel:b,coda:c};
    }
    return null;
  }
  fingerspellParts(chord,output) {
    const parts=[]; let rest=[...chord];
    if(this.layout.spellIndex!=null && rest.includes(this.layout.spellIndex)) { rest=subtract(rest,[this.layout.spellIndex]); parts.push(part('spell',[this.layout.spellIndex],'spell')); }
    const char=this.layout.fingerspellingMap.get(chordID(rest))??output, lc=char.toLowerCase();
    if(lc!==char && this.fingerspell.has(lc)) {
      const lowerKeys=subtract(this.fingerspell.get(lc),[this.layout.spellIndex]);
      if(isSubset(lowerKeys,rest) && subtract(rest,lowerKeys).length) { parts.push(part('capital',subtract(rest,lowerKeys),'capital'),part(lc,lowerKeys,'letter')); return parts; }
    }
    parts.push(part(char,rest,'letter')); return parts;
  }
  fingerspellChord(char,cap) {
    const options=[], exact=this.fingerspell.get(char);
    if(exact && (!cap || char.toUpperCase()===char)) options.push(exact);
    const lc=lower(char); if(cap && uppercase(char) && lc!==char && lc.toUpperCase()===char && this.fingerspell.has(lc)) options.push(this.fingerspell.get(lc));
    return options.sort((a,b)=>a.length-b.length)[0]??null;
  }
  cancelChord(char) {
    if(this.fingerspell.has(char)) return {keys:this.fingerspell.get(char),letter:capitalizeFirst(char)};
    for(const c of 'abcdefghijklmnopqrstuvwxyz') if(this.fingerspell.has(c)) return {keys:this.fingerspell.get(c),letter:c.toUpperCase()};
    return null;
  }
  segment(word,startCap) {
    const n=word.length; if(!n || n>48) return null;
    const lowered=word.map(lower), costs=new Map(),choices=new Map();
    const state=(i,cap,last)=>`${i}:${cap?1:0}:${last}`;
    const joinCost=(keys,last,glue)=>last==='word' || last==='glue'&&!glue ? (this.spaceJoined(keys)?2:10) : 0;
    const clusterList=(bank,pos)=>pos<n ? this.clusters[bank].get(lowered[pos])??[] : [];
    const solve=(i,cap,last)=> {
      if(i===n) return 0;
      const key=state(i,cap,last); if(costs.has(key)) return costs.get(key);
      costs.set(key,Infinity); let best=Infinity,choice=null;
      const consider=(amount,next,nextCap,nextLast,make)=> {
        const rest=solve(next,nextCap,nextLast);
        if(amount+rest<best) { best=amount+rest; choice={seg:make(),next:next===n?null:state(next,nextCap,nextLast)}; }
      };
      const char=word[i];
      if(!cap && uppercase(char) && this.capNextKeys) consider(cost(this.capNextKeys),i,true,last,()=>({type:'command',keys:this.capNextKeys,note:'capitalize the next word'}));
      if(cap && lowercase(char)) { const throwaway=this.cancelChord(char); if(throwaway) consider(cost(throwaway.keys)+100+joinCost(throwaway.keys,last,true),i,false,'reset',()=>({type:'cancel',...throwaway})); }
      const spelled=this.fingerspellChord(char,cap);
      if(spelled) consider(cost(spelled)+joinCost(spelled,last,true),i+1,false,'glue',()=>outSeg([spelled],char,'fingerspell','fingerspelled letter',this.fingerspellParts(spelled,char)));
      const firstDigit=this.digitKey.get(char);
      if(firstDigit!=null) {
        let keys=[firstDigit],lastIndex=firstDigit,j=i+1;
        while(true) {
          if(!this.effective.has(chordID(keys)) && this.isUsable(keys)) { const k=[...keys],end=j; consider(cost(k)+joinCost(k,last,true),end,false,'glue',()=>outSeg([k],word.slice(i,end).join(''),'digits','digits',k.map(idx=>part(this.layout.keys[idx].digit,[idx],'digit')))); }
          const digit=this.digitKey.get(word[j]); if(j>=n || keys.length>=this.rolloverLimit || digit==null || digit<=lastIndex) break;
          keys=union(keys,[digit]); lastIndex=digit;j++;
        }
      }
      for(const brief of this.briefs.get(lowered[i])??[]) if(this.matches(brief.text,word,i,cap)) {
        const glue=!!brief.entry.glue; consider(cost(brief.keys)+joinCost(brief.keys,last,glue),i+brief.text.length,brief.entry.capitalizeNext&&this.mode==='english',glue?'glue':'word',()=>outSeg([brief.keys],cap?capitalizeFirst(brief.text.join('')):brief.text.join(''),'brief','brief'));
      }
      for(const onset of [noCluster,...clusterList('onset',i)]) if(!onset.text.length || this.matches(onset.text,word,i,cap)) {
        const p1=i+onset.text.length,capV=cap&&!onset.text.length;
        for(const vowel of [...clusterList('vowel',p1),noCluster]) if(!vowel.text.length || this.matches(vowel.text,word,p1,capV)) {
          const p2=p1+vowel.text.length,capC=capV&&!vowel.text.length;
          for(const coda of [noCluster,...clusterList('coda',p2)]) if(!coda.text.length || this.matches(coda.text,word,p2,capC)) {
            const end=p2+coda.text.length; if(end<=i) continue;
            const chosen=this.composeKeys(onset.keys,vowel.keys,coda.keys); if(!chosen) continue;
            const k=chosen.keys; consider(cost(k)+joinCost(k,last,false),end,false,'word',()=> {
              const texts=[onset.text.join(''),vowel.text.join(''),coda.text.join('')].filter(Boolean);
              const parts=[part(onset.text.join(''),chosen.onset,'onset'),part(vowel.text.join(''),chosen.vowel,'vowel'),part(coda.text.join(''),chosen.coda,'coda')].filter(p=>p.text);
              const text=[...onset.text,...vowel.text,...coda.text].join(''); return outSeg([k],cap?capitalizeFirst(text):text,'syllable','syllable: '+texts.join(' + '),parts);
            });
          }
        }
      }
      consider(1000,i+1,cap,'reset',()=>({type:'normal',text:char}));
      costs.set(key,best); choices.set(key,choice);return best;
    };
    const total=solve(0,startCap,'start'); if(!Number.isFinite(total)) return null;
    const segs=[]; let key=state(0,startCap,'start'); while(key!=null && choices.get(key)) {const choice=choices.get(key);segs.push(choice.seg);key=choice.next;}
    return {cost:total,segs:mergeNormals(segs)};
  }
  casingPlan(word,endIdentifier) {
    const parts=word.join('').split('_').map(graphemes); if(parts.length<2 || parts.some(p=>!p.length) || word.length>48) return null;
    let upper;if(!word.some(uppercase)) upper=false;else if(!word.some(lowercase)) upper=true;else return null;
    const start=upper?this.screamingKeys:this.snakeKeys;if(!start)return null;
    const segs=[{type:'command',keys:start,note:upper?'start a SCREAMING_SNAKE_CASE identifier':'start a snake_case identifier'}];let amount=cost(start);
    for(let p=0;p<parts.length;p++) {
      if(p>0 && parts[p].every(number)) return null;
      const plan=this.segment(parts[p].map(lower),false);if(!plan)return null;amount+=plan.cost;
      for(let i=0;i<plan.segs.length;i++) {const seg=plan.segs[i];if(seg.type!=='out')return null; let text=upper?seg.text.toUpperCase():seg.text;if(p>0 && i===0)text='_'+text;segs.push({...seg,text});}
    }
    if(endIdentifier) {if(!this.endIdentifierKeys)return null;segs.push({type:'command',keys:this.endIdentifierKeys,note:'end the identifier'});amount+=cost(this.endIdentifierKeys);}
    return {cost:amount,segs};
  }
  symbolPlan(word) {
    const best=Array(word.length+1).fill(null);best[word.length]={cost:0,segs:[]};
    for(let i=word.length-1;i>=0;i--) {
      for(const symbol of this.symbols.get(word[i])??[]) if(i+symbol.text.length<=word.length && eq(word.slice(i,i+symbol.text.length),symbol.text)) {
        const next=best[i+symbol.text.length],amount=cost(symbol.alts[0]);if(next && (!best[i] || amount+next.cost<best[i].cost)) best[i]={cost:amount+next.cost,segs:[outSeg(symbol.alts,symbol.text.join(''),'symbol','symbol'),...next.segs]};
      }
      const next=best[i+1];if(next && (!best[i] || 1000+next.cost<best[i].cost))best[i]={cost:1000+next.cost,segs:[{type:'normal',text:word[i]},...next.segs]};
    }
    return best[0]?{cost:best[0].cost,segs:mergeNormals(best[0].segs)}:null;
  }
  addStep(action,kind,output,note,textEnd=null,parts=[]) {
    let tail='';if(textEnd==null) {let position=Math.min(this.matchedUpTo,this.buffer.length);while(position<this.buffer.length && position<this.target.length && this.buffer[position]===this.target[position])position++;tail=this.buffer.slice(position).join('');}
    this.steps.push({action,kind,output,note,source:[...this.currentSource],group:this.group,textEnd:textEnd??this.lineOffset+this.buffer.length,tail,contextAfter:this.engine.currentContext,parts:parts.map(p=>({...p,keys:keyNames(this.data,p.keys)}))});
  }
  chordAction(keys,join) {return {type:'chord',keys:keyNames(this.data,keys),shift:join};}
  spaceJoined(keys) {if(!this.spaceKeys || !keys.length || isSubset(this.spaceKeys,keys))return null;const joined=union(keys,this.spaceKeys);return this.isUsable(joined)?joined:null;}
  tryAppend(keys,join,expected) {
    const context=this.engine.currentContext,history=this.engine.history.slice();let translated;
    try {translated=this.engine.translate(keys,{join});} catch {this.engine.restore(context);this.engine.history=history;return null;}
    if(translated.signal || translated.modeSwitched || translated.actions.some(a=>a.type!=='insert')) {this.engine.restore(context);this.engine.history=history;return null;}
    const output=translated.actions.flatMap(a=>graphemes(a.text));if(!eq(output,expected)){this.engine.restore(context);this.engine.history=history;return null;}
    this.buffer.push(...output);return output.join('');
  }
  ordered(alternatives,count) {
    if(alternatives.length<2)return alternatives;const position=this.buffer.length+count,wantRight=position<this.target.length && ![' ','\t'].includes(this.target[position]);
    let p=position;while(p<this.target.length && !letter(this.target[p]) && !number(this.target[p]))p++;const wantCap=p<this.target.length?uppercase(this.target[p]):true;
    const rank=keys=> {const entry=this.effective.get(chordID(keys));return [!!entry?.attachRight!==wantRight?1:0,!!(entry?.capitalizeNext&&this.mode==='english')!==wantCap?1:0];};
    return [...alternatives].sort((a,b)=> {const left=rank(a),right=rank(b);return left[0]-right[0]||left[1]-right[1];});
  }
  emitText(alternatives,text,gap,kind,note,parts=null) {
    let remaining=gap;
    for(let pass=0;pass<2;pass++) {
      if(pass===1) {
        if(remaining<=0 || !this.spaceKeys)return null;
        for(let i=0;i<remaining;i++){const output=this.tryAppend(this.spaceKeys,false,[' ']);if(output==null)return null;this.addStep(this.chordAction(this.spaceKeys,false),'space',output,'space',null,[part('space',this.spaceKeys,'space')]);}remaining=0;
      }
      const expected=[...Array(remaining).fill(' '),...text];
      for(let how=0;how<3;how++) for(const keys of this.ordered(alternatives,expected.length)) {
        const chord=how===1?this.spaceJoined(keys):keys;if(!chord)continue;
        const output=this.tryAppend(chord,how===2,expected);if(output==null)continue;
        const explanation=parts?[...parts]:[part(text.join(''),keys,kind==='symbol'?'symbol':'word')];if(how===1)explanation.unshift(part('join',subtract(chord,keys),'join'));
        this.addStep(this.chordAction(chord,how===2),kind,output,note,null,explanation);return 0;
      }
      if(remaining===0)return null;
    }
    return null;
  }
  run(segs,gapStart,gap,end) {
    const context=this.engine.currentContext,history=this.engine.history.slice(),steps=this.steps.length,wordStart=gapStart+gap;let remaining=gap;this.matchedUpTo=gapStart;
    const fail=()=> {this.engine.restore(context);this.engine.history=history;this.buffer.splice(gapStart);this.steps.splice(steps);return false;};
    for(const seg of segs) {
      if(seg.type==='command') {
        const output=this.engine.translate(seg.keys);if(output.signal || output.modeSwitched || output.actions.length)return fail();
        this.addStep(this.chordAction(seg.keys,false),'command','',seg.note,null,[part(seg.note,seg.keys,'command')]);
      } else if(seg.type==='out') {
        const next=this.emitText(seg.alts,graphemes(seg.text),remaining,seg.kind,seg.note,seg.parts);if(next==null)return fail();remaining=next;
      } else if(seg.type==='cancel') {
        const next=this.emitText([seg.keys],graphemes(seg.letter),remaining,'cancelCapital','throwaway letter: uses up the automatic capital',this.fingerspellParts(seg.keys,graphemes(seg.letter)[0]));
        if(next==null || this.buffer.length<=wordStart)return fail();remaining=next;this.buffer.pop();this.engine.contextReset();this.addStep({type:'key',key:'Delete'},'key','','delete the throwaway letter');
      } else if(seg.type==='suffix') {
        if(remaining!==0)return fail();const translated=this.engine.translate(seg.keys);if(translated.signal)return fail();let deleted=0;const inserted=[];
        for(const action of translated.actions){if(action.type==='deleteBackward'&&!inserted.length)deleted+=action.count;else if(action.type==='insert')inserted.push(...graphemes(action.text));else return fail();}
        if(deleted>this.buffer.length-wordStart)return fail();this.buffer.splice(this.buffer.length-deleted,deleted,...inserted);
        if(!eq(this.buffer.slice(wordStart),graphemes(seg.result)))return fail();
        this.addStep(this.chordAction(seg.keys,false),'suffix',inserted.join(''),`suffix: ${seg.base} + ${seg.suffix} → ${seg.result}`,null,[part('-'+seg.suffix,seg.keys,'suffix')]);
      } else if(seg.type==='normal') {
        const text=' '.repeat(remaining)+seg.text;remaining=0;this.buffer.push(...graphemes(text));this.engine.contextReset();this.addStep({type:'normal',text},'normal',text,normalNote);
      }
    }
    return remaining===0 && this.buffer.length===end && eq(this.buffer.slice(gapStart,end),this.target.slice(gapStart,end)) ? true : fail();
  }
}

export function planText(text, options) { return new TypingPlanner(options).plan(String(text)); }
export function planContinuation(text,offset,options={},previous=null,maxLength=2000) { return new TypingPlanner(options).planContinuation(text,offset,previous,maxLength); }
export function replayGuide(data,guide,{buffer=createBuffer(),context=null}={}) {
  const engine=new ChordEngine(data,guide.mode);if(context)engine.restore(context);const results=[];
  for(const step of guide.steps) {
    let translated;
    if(step.action.type==='chord') { translated=engine.translate(step.action.keys,{join:!!step.action.shift});if(translated.signal || translated.modeSwitched)throw new Error(`Invalid planned chord: ${step.action.keys.join('+')}`); }
    else {const action=step.action.type==='normal'?{type:'insert',text:step.action.text}:step.action.key==='Delete'?{type:'deleteBackward',count:1}:{type:'insert',text:step.action.key==='Return'?'\n':'\t'};translated={actions:[action],signal:null,modeSwitched:false};engine.contextReset();}
    buffer=applyActions(buffer,translated.actions);results.push({step,result:translated,buffer,context:engine.currentContext});
  }
  return {buffer,engine,results};
}
export function guideStepIndex(guide,offset) {if(!guide.steps.length)return null;let i=guide.steps.findIndex(s=>s.source[1]>offset);if(i<0)i=guide.steps.length-1;while(i>0 && guide.steps[i-1].group===guide.steps[i].group)i--;return i;}
export function guideIsPlanned(guide,offset,{tailStep=null,start=0}={}) {
  if(tailStep!=null && guide.steps[tailStep]?.tail)return true;if(offset===0 || offset===start)return true;const first=guideStepIndex(guide,offset);if(first==null)return true;
  for(let k=Math.max(0,first-1);k<guide.steps.length&&(k<first||guide.steps[k].group===guide.steps[first].group);k++) {const step=guide.steps[k];if(!step.tail && step.textEnd===offset)return true;if(step.action.type==='normal' && step.textEnd>offset && step.textEnd-graphemeCount(step.output)<=offset)return true;}
  return false;
}
function sameContext(a,b) {
  if(a===b)return true;if(a==null||b==null||typeof a!=='object'||typeof b!=='object')return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameContext(a[key],b[key]));
}
export function matchGuideProgress(guide,typed,{context=null,appliedStep=null,cursor=null}={}) {
  const target=graphemes(guide.text), chars=graphemes(typed), matched=commonPrefix(target,chars);
  let tailStep=null,completedStep=-1;
  for(let i=0;i<guide.steps.length;i++) {
    const step=guide.steps[i],expected=target.slice(0,step.textEnd-graphemeCount(step.tail)).join('')+step.tail;
    if(typed!==expected)continue;
    const command=step.action.type==='chord'&&step.kind==='command';
    // Text alone cannot establish that a command changed engine state or moved a snippet cursor.
    if(command && !(appliedStep!=null&&appliedStep>=i) && !(context&&step.contextAfter&&sameContext(context,step.contextAfter)))continue;
    if(cursor!=null&&cursor!==chars.length&&!step.contextAfter?.snippets?.length)continue;
    completedStep=i;if(step.tail)tailStep=i;
  }
  const correct=matched===chars.length || tailStep!=null;
  const final=guide.steps.at(-1),finalCommand=final?.action.type==='chord'&&final.kind==='command';
  const complete=typed===guide.text&&(!finalCommand||completedStep===guide.steps.length-1);
  let nextStep=completedStep>=0?Math.min(completedStep+1,guide.steps.length):guideStepIndex(guide,matched);
  if(!typed.length&&completedStep<0)nextStep=guide.steps.length?0:null;
  return {matched,correct,tailStep,completedStep,complete,nextStep};
}
