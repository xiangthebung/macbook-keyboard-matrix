// Native text file formats. Imports are atomic: any validation problem leaves active data unchanged.
import {graphemes,graphemeCount} from './buffer.js?v=f3ab99c6cf25';
import {BANKS,createRuntimeData,keyIndices,chordID,describeCommand} from './data.js?v=f3ab99c6cf25';
import {courseIntroductionChords,taughtSkills} from './learning.js?v=f3ab99c6cf25';
const commandNames={undo:'undo','mode-switch':'modeSwitch','capitalize-next':'capitalizeNext','snippet-exit':'snippetExit','snake-case':'casing:snake','camel-case':'casing:camel','pascal-case':'casing:pascal','screaming-snake-case':'casing:screamingSnake','end-identifier':'endIdentifier'};
const fileNames={layout:'layout.txt',shared:'shared.dict',english:'english.dict',cpp:'cpp.dict',orthography:'orthography.txt'};
const macBrowserCodes={0:'KeyA',1:'KeyS',2:'KeyD',3:'KeyF',4:'KeyH',5:'KeyG',6:'KeyZ',7:'KeyX',8:'KeyC',9:'KeyV',10:'IntlBackslash',11:'KeyB',12:'KeyQ',13:'KeyW',14:'KeyE',15:'KeyR',16:'KeyY',17:'KeyT',18:'Digit1',19:'Digit2',20:'Digit3',21:'Digit4',22:'Digit6',23:'Digit5',24:'Equal',25:'Digit9',26:'Digit7',27:'Minus',28:'Digit8',29:'Digit0',30:'BracketRight',31:'KeyO',32:'KeyU',33:'BracketLeft',34:'KeyI',35:'KeyP',36:'Enter',37:'KeyL',38:'KeyJ',39:'Quote',40:'KeyK',41:'Semicolon',42:'Backslash',43:'Comma',44:'Slash',45:'KeyN',46:'KeyM',47:'Period',48:'Tab',49:'Space',50:'Backquote',51:'Backspace',53:'Escape',65:'NumpadDecimal',67:'NumpadMultiply',69:'NumpadAdd',71:'NumLock',75:'NumpadDivide',76:'NumpadEnter',78:'NumpadSubtract',81:'NumpadEqual',82:'Numpad0',83:'Numpad1',84:'Numpad2',85:'Numpad3',86:'Numpad4',87:'Numpad5',88:'Numpad6',89:'Numpad7',91:'Numpad8',92:'Numpad9',96:'F5',97:'F6',98:'F7',99:'F3',100:'F8',101:'F9',103:'F11',105:'F13',106:'F16',107:'F14',109:'F10',111:'F12',113:'F15',114:'Insert',115:'Home',116:'PageUp',117:'Delete',118:'F4',119:'End',120:'F2',121:'PageDown',122:'F1',123:'ArrowLeft',124:'ArrowRight',125:'ArrowDown',126:'ArrowUp'};
function lines(source) {return source.split('\n').map((text,index)=>({line:index+1,text:text.trim()})).filter(row=>row.text && !row.text.startsWith('#'));}
function assignment(text) {const index=text.indexOf('=');return index<0?null:[text.slice(0,index).trim(),text.slice(index+1).trim()];}
function names(text) {return text.split(/[+\s]+/u).filter(Boolean);}
function quoted(source) {
  if(!source.startsWith('"'))throw new Error('text must be a double-quoted string');
  const chars=graphemes(source),markers=[];let text='',count=0;
  for(let i=1;i<chars.length;i++) {
    const char=chars[i];
    if(char==='\\') {const next=chars[++i];if(next==null)throw new Error('unterminated string');if(!['"','\\','|'].includes(next))throw new Error('unknown escape \\'+next);text+=next;count++;}
    else if(char==='"')return {text,markers,rest:chars.slice(i+1).join('').trim()};
    else if(char==='|')markers.push(count);
    else {text+=char;count++;}
  }
  throw new Error('unterminated string');
}
const problem=(file,line,entry,message)=>({file:fileNames[file]??file,line,entry,message});
function parseLayout(source,rolloverLimit,baseData) {
  const problems=[],keys=[],tableLines={},keyNames=new Set(),codes=new Set();let section=null;
  const fail=(row,message)=>problems.push(problem('layout',row?.line??null,row?.text??null,message));
  for(const row of lines(source)) {
    if(row.text.startsWith('[')) {if(!row.text.endsWith(']')){fail(row,'malformed section header');section=null;continue;}const name=row.text.slice(1,-1).toLowerCase();if(!['keys',...BANKS,'fingerspell'].includes(name)){fail(row,`unknown section [${name}]`);section=null;}else section=name;continue;}
    if(!section){fail(row,'line outside of a section');continue;}
    if(section!=='keys'){(tableLines[section]??=[]).push(row);continue;}
    const fields=row.text.split(/\s+/u);if(fields.length!==3&&fields.length!==4){fail(row,'expected: NAME KEYCODE ROLE [DIGIT]');continue;}
    const [name,codeText,roleText,digit]=fields,code=Number(codeText),role=roleText.toLowerCase();
    if(!/^[A-Za-z0-9_]+$/.test(name)){fail(row,'key name may only contain letters, digits and _');continue;}
    if(!/^\d+$/.test(codeText)||!Number.isInteger(code)||code>65535){fail(row,`invalid key code ${codeText}`);continue;}
    if(![...BANKS,'number','spell','space'].includes(role)){fail(row,`unknown role ${roleText}`);continue;}
    if(role==='number' && !/^\d$/.test(digit??'')){fail(row,'number keys need a single digit');continue;}
    if(fields.length===4 && role!=='number'){fail(row,'only number keys take a digit');continue;}
    if(code>=54&&code<=63){fail(row,`key code ${code} is a modifier, Caps Lock or Fn and cannot be a chord key`);continue;}
    if(keyNames.has(name)){fail(row,`duplicate key name ${name}`);continue;}
    if(codes.has(code)){fail(row,`duplicate key code ${code}`);continue;}
    if(['spell','space'].includes(role)&&keys.some(k=>k.role===role)){fail(row,`more than one ${role} key`);continue;}
    const known=baseData.layout.keys.find(k=>k.code===code),browserCode=macBrowserCodes[code]??known?.browserCode;
    if(!browserCode){fail(row,`virtual key code ${code} has no browser physical-key equivalent`);continue;}
    keyNames.add(name);codes.add(code);keys.push({name,code,role,digit:role==='number'?digit:null,browserCode,index:keys.length,legends:known?.legends??{ansi:name,iso:name}});
  }
  if(keys.length>64){fail(null,'a layout may define at most 64 keys');return {layout:null,problems};}
  if(!keys.length){fail(null,'no keys defined in [keys]');return {layout:null,problems};}
  const byName=new Map(keys.map(k=>[k.name,k])),clusters=Object.fromEntries(BANKS.map(b=>[b,[]])),fingerspelling=[];
  for(const bank of [...BANKS,'fingerspell']) {
    const seen=new Set();
    for(const row of tableLines[bank]??[]) {
      const pair=assignment(row.text);if(!pair){fail(row,'expected: KEYS = "text"');continue;}
      const ns=names(pair[0]),unknown=ns.filter(n=>!byName.has(n));if(!ns.length){fail(row,'missing keys');continue;}if(unknown.length){fail(row,`unknown key name(s): ${unknown.join(', ')}`);continue;}
      const indices=[...new Set(ns.map(n=>byName.get(n).index))].sort((a,b)=>a-b),id=chordID(indices);let value=pair[1];
      if(value.startsWith('"'))try{const q=quoted(value);if(q.rest||q.markers.length){fail(row,'unexpected text after value');continue;}value=q.text;}catch(error){fail(row,error.message);continue;}
      if(!value){fail(row,'empty value');continue;}
      if(seen.has(id)){fail(row,`duplicate key subset in [${bank}]`);continue;}
      if(bank==='fingerspell') {
        if(indices.some(i=>keys[i].role==='spell')){fail(row,'fingerspelling keys must not include the spell key');continue;}
        if(graphemeCount(value)!==1||!/^\p{Letter}/u.test(value)){fail(row,'fingerspelling value must be one letter');continue;}
        if(indices.length+1>rolloverLimit){fail(row,`needs ${indices.length+1} keys with the spell key; rollover limit is ${rolloverLimit}`);continue;}
      } else if(indices.some(i=>keys[i].role!==bank)){fail(row,`keys are not in the ${bank} bank`);continue;}
      seen.add(id);(bank==='fingerspell'?fingerspelling:clusters[bank]).push({keys:indices.map(i=>keys[i].name),text:value});
    }
  }
  const sizes=BANKS.map(bank=>Math.max(0,...clusters[bank].map(row=>row.keys.length)));
  if(sizes.reduce((a,b)=>a+b,0)>rolloverLimit)fail(null,`cluster tables break the rollover limit: largest onset (${sizes[0]}) + vowel (${sizes[1]}) + coda (${sizes[2]}) subsets exceed ${rolloverLimit}`);
  return {layout:problems.length?null:{keys,clusters,fingerspelling},problems};
}
function parseDictionary(source,file,layout,rolloverLimit) {
  const entries=[],problems=[],byName=new Map(layout.keys.map(k=>[k.name,k])),seen=new Set();
  const fail=(row,message)=>problems.push(problem(file,row.line,row.text,message));
  for(const row of lines(source)) {
    const pair=assignment(row.text);if(!pair){fail(row,'expected: KEYS = entry');continue;}
    const ns=names(pair[0]),unknown=ns.filter(n=>!byName.has(n));if(!ns.length){fail(row,'missing keys');continue;}if(unknown.length){fail(row,`unknown key name(s): ${unknown.join(', ')}`);continue;}
    const indices=[...new Set(ns.map(n=>byName.get(n).index))].sort((a,b)=>a-b),keys=indices.map(i=>layout.keys[i].name),id=chordID(indices);
    if(indices.length>1&&indices.some(i=>layout.keys[i].role==='space')){fail(row,'the space key is ignored in multi-key chords; remove it');continue;}
    if(indices.length>rolloverLimit){fail(row,`chord needs ${indices.length} keys; rollover limit is ${rolloverLimit}`);continue;}
    const rhs=pair[1];if(!rhs){fail(row,'missing entry');continue;}let entry;
    if(rhs.startsWith('"')) {
      let q;try{q=quoted(rhs);}catch(error){fail(row,error.message);continue;}
      if(q.markers.length>1){fail(row,'more than one cursor marker');continue;}
      entry={type:'text',text:q.text,cursorFromEnd:q.markers.length?graphemeCount(q.text)-q.markers[0]:null,attachLeft:false,attachRight:false,wordAttach:false,glue:false,capitalizeNext:false,kind:null};
      let bad=null;
      for(const flag of q.rest.split(/\s+/u).filter(Boolean)) {
        const property={'attach-left':'attachLeft','attach-right':'attachRight','word-attach':'wordAttach',glue:'glue','cap-next':'capitalizeNext'}[flag];
        if(property)entry[property]=true;
        else if(['word','symbol','suffix'].includes(flag)){if(entry.kind!=null)bad='more than one of word/symbol/suffix';entry.kind=flag;}
        else bad=`unknown flag ${flag}`;
      }
      if(bad){fail(row,bad);continue;}
      entry.kind??=(q.text && graphemes(q.text).every(c=>/^(?:\p{Letter}|\p{Number}|'| )/u.test(c))?'word':'symbol');
      if(entry.kind==='suffix'&&entry.cursorFromEnd!=null){fail(row,'a suffix cannot contain a cursor marker');continue;}
      if(!entry.text){fail(row,'empty text');continue;}
    } else {const command=commandNames[rhs];if(!command){fail(row,`unknown command ${rhs}`);continue;}entry={type:'command',command,description:describeCommand(command)};}
    if(seen.has(id)){fail(row,`duplicate chord ${keys.join('+')}`);continue;}seen.add(id);entries.push({keys,entry});
  }
  return {entries:problems.length?null:entries,problems};
}
function parseOrthography(source) {
  const exceptions={},problems=[];
  for(const row of lines(source)) {
    const pair=assignment(row.text),parts=pair?.[0].split('+').map(p=>p.trim());
    if(!pair||parts.length!==2||!parts[0]||!parts[1]||!pair[1]||/\s/u.test(pair[1])){problems.push(problem('orthography',row.line,row.text,'expected: word + suffix = result'));continue;}
    const key=parts[0].toLowerCase()+'+'+parts[1].toLowerCase();if(Object.hasOwn(exceptions,key)){problems.push(problem('orthography',row.line,row.text,'duplicate exception'));continue;}exceptions[key]=pair[1].toLowerCase();
  }
  return {exceptions:problems.length?null:exceptions,problems};
}
export function importSources(data,edits,{rolloverLimit=6}={}) {
  if(!Number.isInteger(rolloverLimit)||rolloverLimit<1||rolloverLimit>64)return {data:null,problems:[problem('layout',null,null,'rollover limit must be between 1 and 64')],warnings:[]};
  const allowed=new Set(Object.keys(fileNames)),problems=[];
  for(const [file,source] of Object.entries(edits))if(!allowed.has(file)||typeof source!=='string')problems.push(problem(file,null,null,'imports must supply text for a named native mapping file'));
  if(problems.length)return {data:null,problems,warnings:[]};
  const sources={...data.sources,...edits},parsed=parseLayout(sources.layout,rolloverLimit,data);problems.push(...parsed.problems);
  if(!parsed.layout)return {data:null,problems,warnings:[]};
  const dictionaries={};for(const file of ['shared','english','cpp']){const parsedDict=parseDictionary(sources[file],file,parsed.layout,rolloverLimit);problems.push(...parsedDict.problems);dictionaries[file]=parsedDict.entries;}
  const ortho=parseOrthography(sources.orthography);problems.push(...ortho.problems);if(problems.length)return {data:null,problems,warnings:[]};
  const nativeSources=data.exported.nativeSources??data.exported.sources;
  const nativeMappingVersion=data.exported.nativeMappingVersion??data.exported.mappingVersion;
  const isBundled=Object.keys(fileNames).every(file=>sources[file]===nativeSources[file]);
  const exported={...data.exported,nativeSources,nativeMappingVersion,sources,layout:parsed.layout,dictionaries,orthographyExceptions:ortho.exceptions,mappingVersion:isBundled?nativeMappingVersion:'custom-'+sourceHash(JSON.stringify(sources))};
  const runtime=createRuntimeData(exported);
  runtime.course={...runtime.course,steps:runtime.course.steps.map((step,index)=>({...step,introductions:courseIntroductionChords(runtime,index),taught:[...taughtSkills(runtime,index)].sort()}))};
  const warnings=[];
  if(parsed.layout.keys.some(k=>['Enter','Tab','Backspace','Delete','Escape', 'ArrowLeft','ArrowRight','ArrowDown','ArrowUp'].includes(k.browserCode)))warnings.push(problem('layout',null,null,'This layout assigns browser editing keys as chord keys. Local input handlers must follow the imported layout before treating those keys as pass-through.'));
  return {data:runtime,problems:[],warnings,acceptedSources:sources};
}
function sourceHash(text){let hash=14695981039346656037n;const mask=(1n<<64n)-1n;for(let i=0;i<text.length;i++){hash^=BigInt(text.charCodeAt(i));hash=(hash*1099511628211n)&mask;}return hash.toString(16);}
export function exportSources(data) {return {...data.sources};}
// Validate edits by serializing through the native dictionary parser. No unvalidated entry is activated.
export function editMapping(data,{mode='english',keys,entry,remove=false},{rolloverLimit=6}={}) {
  if(!['shared','english','cpp'].includes(mode))return {data:null,problems:[problem(mode,null,null,'unknown dictionary')],warnings:[]};
  let indices;try{indices=keyIndices(data,keys);}catch(error){return {data:null,problems:[problem(mode,null,null,error.message)],warnings:[]};}
  if(!indices.length)return {data:null,problems:[problem(mode,null,null,'missing keys')],warnings:[]};
  const id=chordID(indices),rows=lines(data.sources[mode]).filter(row=>{const pair=assignment(row.text);if(!pair)return true;try{return chordID(keyIndices(data,names(pair[0])))!==id;}catch{return true;}}).map(row=>row.text);
  if(!remove) {
    try{rows.push(indices.map(i=>data.layout.keys[i].name).join('+')+' = '+serializeEntry(entry));}
    catch(error){return {data:null,problems:[problem(mode,null,null,error.message)],warnings:[]};}
  }
  return importSources(data,{[mode]:rows.join('\n')},{rolloverLimit});
}
function serializeEntry(entry) {
  if(!entry||!['text','command'].includes(entry.type))throw new Error('entry must be text or a recognized command');
  if(entry.type==='command'){const source=Object.entries(commandNames).find(([,name])=>name===entry.command)?.[0];if(!source)throw new Error('unknown command');return source;}
  if(typeof entry.text!=='string'||!entry.text)throw new Error('empty text');
  const chars=graphemes(entry.text),offset=entry.cursorFromEnd;if(offset!=null && (!Number.isInteger(offset)||offset<0||offset>chars.length))throw new Error('cursor marker outside text');
  const quote=text=>text.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('|','\\|');
  let value=offset==null?quote(entry.text):quote(chars.slice(0,chars.length-offset).join(''))+'|'+quote(chars.slice(chars.length-offset).join(''));
  const flags=[];for(const [property,flag] of Object.entries({attachLeft:'attach-left',attachRight:'attach-right',wordAttach:'word-attach',glue:'glue',capitalizeNext:'cap-next'}))if(entry[property])flags.push(flag);
  if(entry.kind!=null){if(!['word','symbol','suffix'].includes(entry.kind))throw new Error('unknown output kind');flags.push(entry.kind);}
  return '"'+value+'"'+(flags.length?' '+flags.join(' '):'');
}
