import {graphemes,graphemeCount} from './buffer.js?v=f3ab99c6cf25';
import {BANKS,keyIndices,keyNames,chordID,compareKeys,effectiveEntry,effectiveDictionary,describeCommand,keyMeanings,getProfile} from './data.js?v=f3ab99c6cf25';
import {TypingPlanner,replayGuide} from './planner.js?v=f3ab99c6cf25';

function spells(text,pieces) {if(!pieces.length)return !text;for(let i=0;i<pieces.length;i++)if(pieces[i]&&text.startsWith(pieces[i])&&spells(text.slice(pieces[i].length),pieces.filter((_,j)=>j!==i)))return true;return false;}
export function pairClusters(data,bank) {
  const table=data.layout.clusterMaps[bank],out=[];
  for(const [id,text] of table) {const keys=id.split(',').map(Number),singles=keys.map(i=>table.get(chordID([i])));if(keys.length>1 && singles.every(Boolean)&&spells(text,singles))out.push({text,keys,singles});}
  return out.sort((a,b)=>a.text<b.text?-1:a.text>b.text?1:compareKeys(a.keys,b.keys));
}
export function learnedSkills(data,completedIDs,mode='english') {
  const ids=new Set(completedIDs),out=new Set();
  for(const lesson of data.course.steps)if(ids.has(lesson.id))for(const skill of lesson.new)if(lesson.mode===mode||!['word:','ending:','symbol:','abbreviation:'].some(prefix=>skill.startsWith(prefix)))out.add(skill);
  for(const bank of BANKS)if(out.has('pairs:'+bank))for(const cluster of pairClusters(data,bank))if(cluster.singles.every(single=>out.has(`sound:${bank}:${single}`)))out.add(`sound:${bank}:${cluster.text}`);
  return out;
}
export function taughtSkills(data,index) {
  if(index<0||index>=data.course.steps.length)return new Set();return learnedSkills(data,data.course.steps.slice(0,index+1).map(step=>step.id),data.course.steps[index].mode);
}
export function skillsOfStep(data,step,mode='english') {
  const out=new Set(),action=step.action;
  if(action.type==='key'&&['Return','Tab'].includes(action.key))out.add('newLine');
  if(action.type!=='chord')return out;if(action.shift)out.add('shiftJoin');
  for(const part of step.parts??[]) {
    const role=part.role;
    if(BANKS.includes(role)) {const keys=keyIndices(data,part.keys),text=data.layout.clusterMaps[role].get(chordID(keys))??part.text;out.add(`sound:${role}:${text}`);}
    else if(['word','suffix','symbol'].includes(role)) {
      const entry=effectiveEntry(data,mode,keyIndices(data,part.keys));
      if(entry?.type==='text')out.add(`${entry.kind==='suffix'?'ending':entry.kind==='symbol'?(mode==='english'&&!entry.capitalizeNext&&['.','?','!'].includes(entry.text)?'abbreviation':'symbol'):'word'}:${entry.text}`);
      else out.add(`${role==='suffix'?'ending':role}:${part.text}`);
    } else if(role==='command') {const entry=effectiveEntry(data,mode,keyIndices(data,part.keys));if(entry?.type==='command')out.add('command:'+entry.command);}
    else if(['spell','letter'].includes(role))out.add('spell');
    else if(role==='capital')out.add('capitalLetter');
    else if(role==='digit')out.add('digits');
    else if(role==='join')out.add('join');else if(role==='space')out.add('space');
  }
  return out;
}
export function courseIsAllowed(step) {return step.action.type!=='normal' && !(step.action.type==='key'&&step.action.key==='Delete') && step.kind!=='cancelCapital';}
export function guideSkills(data,guide) {return new Set(guide.steps.flatMap(step=>[...skillsOfStep(data,step,guide.mode)]));}
export function courseChordsForSkill(data,skill,mode='english') {
  const layout=data.layout,effective=effectiveDictionary(data,mode),make=(label,keys,role,note=null,shift=false)=>({label,keys:keyNames(data,keys),role,note,shift});
  const rows=[...effective].map(([id,entry])=>({keys:id.split(',').map(Number),entry})).sort((a,b)=>compareKeys(a.keys,b.keys));
  const textRows=predicate=>rows.filter(row=>row.entry.type==='text'&&predicate(row.entry));
  if(skill.startsWith('sound:')) {const [,bank,...rest]=skill.split(':'),text=rest.join(':'),keys=[...layout.clusterMaps[bank]].filter(([,value])=>value===text).map(([id])=>id.split(',').map(Number)).sort(compareKeys);return keys.slice(0,1).map(keys=>make(text,keys,bank));}
  if(skill.startsWith('pairs:')) {const bank=skill.slice(6);return pairClusters(data,bank).map(row=>make(row.text,row.keys,bank));}
  if(skill.startsWith('word:'))return textRows(entry=>entry.text===skill.slice(5)&&entry.kind!=='suffix'&&entry.cursorFromEnd==null).slice(0,1).map(row=>make(row.entry.text,row.keys,null));
  if(skill.startsWith('ending:'))return textRows(entry=>entry.text===skill.slice(7)&&entry.kind==='suffix').slice(0,1).map(row=>make('-'+row.entry.text,row.keys,'special'));
  if(skill.startsWith('symbol:')||skill.startsWith('abbreviation:')) {
    const quiet=skill.startsWith('abbreviation:'),text=skill.slice(skill.indexOf(':')+1),all=textRows(entry=>entry.text===text&&entry.cursorFromEnd==null&&(mode==='english'&&!entry.capitalizeNext&&['.','?','!'].includes(text))===quiet);
    return all.map(row=>make(text,row.keys,'special',quiet?'no capital after it':all.length>1&&!!row.entry.attachRight!==!!row.entry.attachLeft?(['"',"'",'(',')','[',']','{','}','<','>'].includes(text)?(row.entry.attachRight?'opening':'closing'):(row.entry.attachRight?'before a name':'after a name')):null));
  }
  if(skill.startsWith('command:')) {const command=skill.slice(8);return rows.filter(row=>row.entry.type==='command'&&row.entry.command===command).slice(0,1).map(row=>make(describeCommand(command),row.keys,'special'));}
  if(['join','space'].includes(skill))return layout.spaceIndex!=null?[make(skill,[layout.spaceIndex],'space',skill==='join'?'hold it with the chord':'alone')]:[];
  if(skill==='shiftJoin')return [make('join',[],'space','hold Shift with the chord',true)];
  if(skill==='spell')return layout.spellIndex!=null?[make('spell',[layout.spellIndex],'spell','+ the key printed with the letter')]:[];
  if(skill==='capitalLetter') {const meanings=keyMeanings(data,mode);return meanings.spellKey!=null&&meanings.capitalKey!=null?[make('capital',[meanings.spellKey,meanings.capitalKey],'spell','+ the letter')]:[];}
  if(skill==='digits')return [make('0 – 9',[],'number','the number row')];
  if(skill==='newLine')return [make('new line',[],null,'the Return key')];return [];
}
export function courseIntroductionChords(data,index) {
  const lesson=data.course.steps[index],known=taughtSkills(data,index);
  return lesson.new.map(skill=>{
    let chords=courseChordsForSkill(data,skill,lesson.mode);
    if(skill.startsWith('pairs:')) {const bank=skill.slice(6),preferred=bank==='onset'?['th','sh','st']:['nd','te','me'];chords=pairClusters(data,bank).filter(c=>c.singles.every(s=>known.has(`sound:${bank}:${s}`))).sort((a,b)=>(preferred.indexOf(a.text)<0?3:preferred.indexOf(a.text))-(preferred.indexOf(b.text)<0?3:preferred.indexOf(b.text))||a.text.localeCompare(b.text)).slice(0,3).map(row=>({label:row.text,keys:keyNames(data,row.keys),shift:false,role:bank,note:null}));}
    return {skill,chords};
  });
}
export function migrateCompletedIDs(data,ids,fromVersion) {const result=new Set(ids);if(fromVersion<data.course.curriculumVersion)for(const [original,additions]of Object.entries(data.course.legacyLessonExpansions))if(result.has(original))for(const id of additions)result.add(id);return result;}

class Random {
  constructor(seed) {this.state=BigInt(Math.trunc(Number(seed)||0));}
  next() {const mask=(1n<<64n)-1n;this.state=(this.state+0x9e3779b97f4a7c15n)&mask;let value=this.state;value=((value^(value>>30n))*0xbf58476d1ce4e5b9n)&mask;value=((value^(value>>27n))*0x94d049bb133111ebn)&mask;return value^(value>>31n);}
  index(count) {return Number(this.next()%BigInt(count));}
  shuffle(items) {const result=[...items];for(let i=result.length-1;i>0;i--){const j=this.index(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
}
const commonWords=new Set(['their','about','people','into','other','only','over','also','after','first','because','through','before','between','never','every','little','different','important','something']);
function sentences(text) {
  const chars=graphemes(text),out=[];let buffer='';
  for(let i=0;i<chars.length;i++) {const char=chars[i];buffer+=char;if(['.','?','!'].includes(char)&&chars[i+1]!=='"'||char==='"'&&['.','?','!'].includes(chars[i-1])){out.push(buffer.trimStart());buffer='';}}
  if(buffer.trim())out.push(buffer.trimStart());return out;
}
function drillWord(token) {const chars=graphemes(token),allowed=c=>/^(?:\p{Letter}|\p{Number}|_)/u.test(c);while(chars.length&&!allowed(chars[0]))chars.shift();while(chars.length&&!allowed(chars.at(-1)))chars.pop();return chars.length&&chars.every(allowed)?chars.join(''):null;}
const nativeWordPool='sat hat tan at an as has sad had sand hand stand sit hit fit set get wet sun fun run rat red bed led tip dip lip hot dot lot man mat cat pat can pan pet pot kid nap cup van jet jam joy big dog dug fog fox box cab six book look took cook good food rain tail wait paid sea tea read seed feed tree green sleep sheep ship fresh plant black stamp trust thank click crash wish fish bath back song king ring long small crab clap plan stop trip from the then that this she they we he her him my his for day home make take like nice give love face page cave hope tried played jumped making nicer biggest faster slowly kindness payment readable careful restful darkness useful wonderful possible anything everybody understanding';
function nativeSentencePool() {
  const subjects=['I','He','She','We','They','The cat','The dog','The kid','Tom','Sam'],actions=['sat on the mat','went home','read a book','had a nap','made tea','ran in the sun','waited in the rain','looked at the sea','played in the park','tried making tea'];
  const result=subjects.flatMap(subject=>actions.map(action=>`${subject} ${action}.`));
  result.push('He runs faster and reads slowly.','She is making tea in the kitchen.','She is making tea.','He runs faster.','She reads slowly.','He tried hoping.','The nicest thing is a good book.','The nicest thing is a warm cup of tea.','Kindness is useful.','The payment is due.','The note is readable.','The darkness is restful.','Everybody wants something wonderful.','Anything is possible.','Understanding takes time.','People like their work because it is important.','We have other things to do after that.','Every little thing is different.','Is it hot?','Can we go in the sea?','Yes, we can!','She said: "Thank you."','Tom (my friend) is here; he likes it.',"It's a well-made bed: the cat's bed is big.");
  for(let n=1;n<=30;n++)result.push(`The team met at 10:30 in room ${n}.`,`I have ${n} cats and 2 dogs.`,`The NASA team met the BBC in room ${n}.`);return result;
}
export class PracticeGenerator {
  constructor({data,source,profile='generic',rolloverLimit,usable}={}) {
    this.data=data;this.source=source;this.profile=getProfile(data,profile,{rolloverLimit,usable});
    this.lesson=(source?.type==='course'?data.course.steps:source?.type==='topic'?data.topics:[])[source?.index];
    if(!this.lesson)throw new RangeError('Unknown practice source.');this.mode=this.lesson.mode;this.original=this.lesson.text;
    this.taught=source.type==='course'?taughtSkills(data,source.index):null;
    this.requirements=source.type==='course'?this.lesson.new.filter(skill=>!['command:undo','command:modeSwitch'].includes(skill)).map(skill=>skill.startsWith('pairs:')?new Set(pairClusters(data,skill.slice(6)).map(c=>`sound:${skill.slice(6)}:${c.text}`).filter(s=>this.taught.has(s))):new Set(skill==='shiftJoin'?['shiftJoin','join']:[skill])):[];
    this.wordDrill=this.mode==='english'?(source.type==='course'?!this.taught.has('symbol:.'):source.index<2):['cpp-mode','cpp-more-keywords'].includes(this.lesson.id);
    this.planner=new TypingPlanner({data,mode:this.mode,profile:this.profile});this.examples=null;this.used=new Set();
  }
  accepts(guide) {
    if(!guide.steps.length||!guide.steps.every(courseIsAllowed))return false;
    if(!guide.steps.every(step=>step.action.type!=='chord'||this.profile.usable(keyIndices(this.data,step.action.keys))))return false;
    const skills=guideSkills(this.data,guide);if(this.taught&&[...skills].some(skill=>!this.taught.has(skill)))return false;
    if(this.source.type==='topic') {
      const index=this.source.index;
      if(index===0)return guide.steps.every(step=>step.kind==='syllable'&&step.parts.every(p=>p.keys.length===1));
      if(index===1)return guide.steps.every(step=>step.kind==='syllable')&&guide.steps.some(step=>step.parts.some(p=>p.keys.length>1));
      if(index===2)return guide.steps.some(step=>step.kind==='brief'&&step.parts.some(p=>p.role==='word'&&commonWords.has(p.text)));
      if(index===3)return guide.steps.some(step=>step.kind==='symbol');if(index===4)return guide.steps.some(step=>step.kind==='suffix');
      if(index===5)return guide.steps.some(step=>step.parts.some(p=>p.role==='join'));if(index===6)return guide.steps.some(step=>['digits','fingerspell'].includes(step.kind));
    }
    return true;
  }
  checked(text) {
    const guide=this.planner.plan(text);if(!this.accepts(guide))return null;const skills=guideSkills(this.data,guide);
    if(!this.requirements.every(requirement=>[...requirement].some(skill=>skills.has(skill))))return null;
    return {text,guide,source:this.source,variantID:'generated:'+text,nativeValidated:false};
  }
  buildExamples() {
    const sources=this.source.type==='course'?this.data.course.steps.slice(0,this.source.index+1).filter(step=>step.mode===this.mode).map(step=>step.text):[this.original];
    const candidates=new Set();
    if(this.wordDrill) {
      const wordSources=this.mode==='english'?[...sources,...this.data.course.steps.filter(step=>step.mode==='english').map(step=>step.text),nativeWordPool]:sources;
      for(const source of wordSources)for(const token of source.split(/\s+/u)){const word=drillWord(token);if(word)candidates.add(word);}
    } else if(this.mode==='english') {
      for(const source of [...sources.filter(text=>/[.!?]/.test(text)),...nativeSentencePool()])for(let sentence of sentences(source)) {
        if(this.taught&&!this.taught.has('symbol:.')){sentence=sentence.replace(/[.!?]+$/,'');if(!sentence.startsWith('I '))sentence=sentence[0].toLowerCase()+sentence.slice(1);}candidates.add(sentence);
      }
      candidates.add(this.original);
      for(const variants of Object.values(this.lesson.variants??{}))for(const variant of variants)for(const sentence of sentences(variant.text))candidates.add(sentence);
    }
    this.examples=[];for(const text of [...candidates].sort()){const guide=this.planner.plan(text);if(this.accepts(guide))this.examples.push({text,skills:guideSkills(this.data,guide)});}
  }
  code(random) {
    const name=['count','score','sum','total'][random.index(4)],first=1+random.index(90),second=1+random.index(9),third=1+random.index(9),id=this.lesson.id;
    if(this.source.type==='course') {
      if(id==='cpp-symbols')return `int ${name} = ${first}; ${name} = ${name} + ${second} - ${third};`;
      if(id==='cpp-symbols-round')return `if (${name} == ${first}) return ${name};`;
      if(id==='cpp-symbols-braces')return `if (${name} == ${first}) { return ${name}; }`;
      if(id==='cpp-names'){const prefixes=['max','min','total','last','first','current'],nouns=['size','value','count','score','sum','time','limit','step'];const variable=prefixes[random.index(prefixes.length)]+'_'+nouns[random.index(nouns.length)],constant=prefixes[random.index(prefixes.length)]+'_'+nouns[random.index(nouns.length)];return `int ${variable} = ${constant.toUpperCase()};`;}
    }
    const operation=random.index(2)===0?'+':'-',expression=this.taught?name:`${name} ${operation} ${second}`;
    return `int main() {\n    int ${name} = ${first};\n    return ${expression};\n}`;
  }
  next(seed=Date.now(),avoiding=null) {
    const random=new Random(seed);if(!this.examples && !(this.mode==='cpp'&&!this.wordDrill))this.buildExamples();
    for(let attempt=0;attempt<24;attempt++) {
      let text;
      if(this.mode==='cpp'&&!this.wordDrill)text=this.code(random);
      else {
        let pool=random.shuffle(this.examples);const coverage=this.wordDrill?pool:[...pool].sort((a,b)=>(graphemeCount(a.text)>48?1:0)-(graphemeCount(b.text)>48?1:0));
        const chosen=[];let outstanding=[...this.requirements];
        for(const candidate of coverage)if(outstanding.some(requirement=>[...requirement].some(skill=>candidate.skills.has(skill)))){chosen.push(candidate);outstanding=outstanding.filter(requirement=>![...requirement].some(skill=>candidate.skills.has(skill)));if(!outstanding.length)break;}
        if(outstanding.length||!pool.length)continue;const target=this.wordDrill?8+random.index(5):3;
        pool=pool.filter(candidate=>!chosen.some(item=>item.text===candidate.text));while(chosen.length<target){if(!pool.length)pool=random.shuffle(this.examples);chosen.push(pool.pop());}
        const remaining=random.shuffle(chosen),ordered=[];
        while(remaining.length){const candidates=remaining.map((item,index)=>({item,index})).filter(({item})=>item.text!==ordered.at(-1)?.text);const index=candidates.length?candidates[random.index(candidates.length)].index:0;ordered.push(remaining.splice(index,1)[0]);}
        text=ordered.map(item=>item.text).join(' ');
      }
      if(text===this.original||text===avoiding||this.used.has(text))continue;
      const result=this.checked(text);if(result){this.used.add(text);return result;}
    }
    // A small pool can be exhausted. Distinct native variants remain useful if they replay under current rules.
    for(const variant of this.lesson.variants?.[this.profile.modelID??this.profile.id]??[]) {
      if(variant.text===avoiding||variant.text===this.original||this.used.has(variant.text))continue;
      const checked=this.checked(variant.text);if(checked){this.used.add(variant.text);return {...checked,nativeValidated:this.data.mappingVersion==='native-core-v1',variantID:'native:'+variant.seed};}
    }
    return null;
  }
}
export class ListeningPractice {
  constructor({data,profile='generic',rolloverLimit,usable,learnedSkills:provided=null,completedIDs=null,sessionLength=null}={}) {
    this.data=data;this.profile=getProfile(data,profile,{rolloverLimit,usable});this.sessionLength=sessionLength==null?null:Math.max(0,sessionLength);
    const learned=provided??(completedIDs!=null?learnedSkills(data,completedIDs,'english'):null),planner=new TypingPlanner({data,mode:'english',profile:this.profile});
    this.words=[];
    for(const text of data.listeningVocabulary) {const guide=planner.plan(text);if(!guide.steps.length||!guide.steps.every(courseIsAllowed))continue;const skills=guideSkills(data,guide);if(learned&&[...skills].some(skill=>!learned.has(skill)))continue;this.words.push({text,guide});}
    this.prompt=null;this.hintRevealed=false;this.completedWords=0;this.assistedWords=0;this.isComplete=false;this.remaining=[];
  }
  get isSessionComplete(){return this.sessionLength!=null && this.completedWords>=this.sessionLength;}
  get canAdvance(){return this.prompt!=null && this.isComplete&&!this.isSessionComplete;}
  get isAvailable(){return this.words.length>0;}
  next(seed=Date.now()) {
    if(!this.words.length||this.isSessionComplete)return null;if(this.sessionLength!=null&&this.prompt&&!this.isComplete)return this.prompt;
    if(!this.remaining.length)this.remaining=new Random(seed).shuffle(this.words.map((_,index)=>index));
    if(this.remaining.length>1&&this.words[this.remaining.at(-1)].text===this.prompt?.text)[this.remaining[0],this.remaining[this.remaining.length-1]]=[this.remaining.at(-1),this.remaining[0]];
    this.prompt=this.words[this.remaining.pop()];this.hintRevealed=false;this.isComplete=false;return this.prompt;
  }
  revealHint(){if(!this.prompt||this.isComplete)return false;this.hintRevealed=true;return true;}
  check(typed){if(!this.prompt||this.isComplete||typed!==this.prompt.text)return false;this.isComplete=true;this.completedWords++;if(this.hintRevealed)this.assistedWords++;return true;}
}
