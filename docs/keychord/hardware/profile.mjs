import {MatrixModel, MatrixScanSession, Report, NAME, CODE} from './matrix.mjs?v=f3ab99c6cf25';
export const PROFILE_STORAGE_KEY = 'keychord-web-hardware-profile-v1';
export const SCAN_STORAGE_KEY = 'keychord-us-matrix-probe-v1';
export const DEFAULT_SETTINGS = Object.freeze({modelID:'generic', rolloverLimit:6, keyboard:'', associated:false, localReport:'', wiringText:''});
const subscribers = new Set();
let settings = {...DEFAULT_SETTINGS};
let loaded = false;
function storage() { try { return globalThis.localStorage; } catch { return undefined; } }
export function getHardwareSettings() {
  if (!loaded) {
    loaded = true;
    try { settings = normalizeSettings(JSON.parse(storage()?.getItem(PROFILE_STORAGE_KEY) || '{}')); } catch { settings = {...DEFAULT_SETTINGS}; }
  }
  return {...settings};
}
export function normalizeSettings(value = {}) {
  const id = ['generic','macbook-ansi','macbook-iso','local-scan','custom-wiring'].includes(value.modelID) ? value.modelID : 'generic';
  return {modelID:id, rolloverLimit:Math.max(1,Math.min(48,Number.isInteger(Number(value.rolloverLimit)) ? Number(value.rolloverLimit) : 6)),
    keyboard:String(value.keyboard || '').replace(/[\r\n]/g,' ').slice(0,240), associated:value.associated === true,
    localReport:String(value.localReport || ''), wiringText:String(value.wiringText || '')};
}
export function setHardwareSettings(update) {
  settings = normalizeSettings({...getHardwareSettings(), ...update});
  try { storage()?.setItem(PROFILE_STORAGE_KEY,JSON.stringify(settings)); } catch { /* Runtime still works when storage is unavailable. */ }
  for (const cb of subscribers) cb({...settings});
  return {...settings};
}
export function subscribeHardwareProfile(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }

export function parseScanReport(text) {
  if (!/^version\s+1\s*(?:#.*)?$/m.test(text)) throw new Error('A scan report needs version 1.');
  const report = Report.parse(text);
  if (!report) throw new Error('This scan uses a different KeyChord layout.');
  for (const s of report.sweeps) {
    if (s.pair.a === s.pair.b) throw new Error('A held pair needs two different keys.');
    const tested = s.tapped ?? new Set(NAME.map((_,i)=>i).filter(i=>i!==s.pair.a && i!==s.pair.b));
    if (tested.has(s.pair.a) || tested.has(s.pair.b)) throw new Error('A held pair cannot also be listed as tapped.');
    if (!tested.size || [...s.blocked].some(i=>!tested.has(i))) throw new Error('Blocked keys must belong to the tested keys.');
  }
  for (const c of report.combos) {
    if (c.keys.size < 2 || [...c.missing].some(k=>!c.keys.has(k)) || (c.outcome==='pass' && c.missing.size)) throw new Error('Invalid combo evidence.');
  }
  const usableSweeps = report.sweeps.filter(s=>!MatrixScanSession.nothingRegistered(s));
  const model = new MatrixModel(NAME.length,usableSweeps);
  const count = report.combos.length + usableSweeps.reduce((n,s)=>n+(s.tapped?.size ?? NAME.length-2),0);
  return {...report, model, count, excludedSweeps:report.sweeps.length-usableSweeps.length};
}

export function parseWiring(text, data) {
  const byName = new Map((data?.layout?.keys ?? NAME.map((name,i)=>({name,code:CODE[i]}))).map(k=>[k.name,k.code]));
  const positions = [], otherKeys = [], rows = [], columns = [], solo = [];
  const used = new Set(); let hardware = ''; let version = false;
  const code = (name,n) => { if (!byName.has(name)) throw new Error(`Unknown key ${name} on line ${n}.`); if (used.has(name)) throw new Error(`Duplicate key ${name} on line ${n}.`); used.add(name); return byName.get(name); };
  text.split(/\r\n|\n|\r/).forEach((raw,i)=> {
    const f = raw.split('#')[0].trim().split(/\s+/); if (!f[0]) return;
    const bad = () => { throw new Error(`Malformed wiring line ${i+1}.`); };
    if (f[0]==='version') { if(f.length!==2 || f[1]!=='1') bad(); version = true; }
    else if(f[0]==='hardware') hardware=f.slice(1).join(' ');
    else if(f[0]==='columns') { if(columns.length || f.length<2 || new Set(f.slice(1)).size!==f.length-1) bad(); columns.push(...f.slice(1)); }
    else if(f[0]==='row') {
      if(!columns.length || f.length!==columns.length+2 || rows.includes(f[1])) bad();
      rows.push(f[1]); f.slice(2).forEach((cell,c)=> { const p = {row:f[1],column:columns[c]}; if(cell==='?') otherKeys.push(p); else if(cell!=='.') positions.push({code:code(cell,i+1),...p}); });
    } else if(f[0]==='solo') { for(const name of f.slice(1)) {const k=code(name,i+1);solo.push(k); positions.push({code:k,row:`solo-${k}`,column:`solo-${k}`});} }
    else bad();
  });
  if(!version || (!positions.length && !otherKeys.length)) throw new Error('Wiring needs version 1 and at least one position.');
  return {hardware,rows,columns,positions,otherKeys,solo};
}
export function serializeWiring(wiring, data) {
  const nameByCode = new Map((data?.layout?.keys ?? NAME.map((name,i)=>({name,code:CODE[i]}))).map(k=>[k.code,k.name]));
  const positions = wiring.positions ?? [...(wiring.position ?? new Map())].map(([code,p])=>({code,...p}));
  const cells = new Map(positions.filter(p=>!(wiring.solo??[]).includes(p.code)).map(p=>[`${p.row}|${p.column}`,nameByCode.get(p.code)]));
  for (const p of wiring.otherKeys ?? []) cells.set(`${p.row}|${p.column}`,'?');
  return '# KeyChord wiring prediction; selecting this file does not test a keyboard.\nversion 1\nhardware ' + String(wiring.hardware||'unknown').replace(/[\r\n#]/g,' ') + '\ncolumns ' + wiring.columns.join(' ') + '\n' +
    wiring.rows.map(r=>'row '+r+' '+wiring.columns.map(c=>cells.get(`${r}|${c}`)||'.').join(' ')+'\n').join('') +
    ((wiring.solo?.length)?'solo '+wiring.solo.map(c=>nameByCode.get(c)).join(' ')+'\n':'');
}
export function wiringBlocks(wiring, codes) {
  if (!wiring || codes.length<3) return false;
  const pos = new Map((wiring.positions ?? []).map(p=>[p.code,p]));
  const occupied = new Set([...(wiring.positions??[]),...(wiring.otherKeys??[])].map(p=>`${p.row}|${p.column}`));
  for (let i=0;i<codes.length;i++) for(let j=i+1;j<codes.length;j++) for(let k=j+1;k<codes.length;k++) {
    const triple = [codes[i],codes[j],codes[k]].map(c=>pos.get(c)); if(triple.some(p=>!p)) continue;
    for(const [x,y,z] of [[triple[0],triple[1],triple[2]],[triple[1],triple[0],triple[2]],[triple[2],triple[0],triple[1]]]) {
      if(y.row===z.row || y.column===z.column) continue;
      if(x.row===y.row && x.column===z.column && occupied.has(`${z.row}|${y.column}`)) return true;
      if(x.column===y.column && x.row===z.row && occupied.has(`${y.row}|${z.column}`)) return true;
    }
  }
  return false;
}
export function createHardwareProfile(data, input = DEFAULT_SETTINGS) {
  const s = normalizeSettings(input);
  const keys = data?.layout?.keys ?? NAME.map((name,i)=>({name,code:CODE[i]}));
  const bundled = (data?.profiles ?? []).find?.(p=>p.id===s.modelID) ?? data?.profiles?.[s.modelID];
  let scan, wiring = bundled?.wiring ?? null;
  try { if(s.localReport) scan = parseScanReport(s.localReport); } catch { /* Invalid saved report is shown as unchecked. */ }
  if(s.modelID==='custom-wiring') { try { wiring = parseWiring(s.wiringText,data); } catch { wiring = null; } }
  const titles = {
    generic:['unchecked','Current keyboard · unchecked','No local observation of this keyboard is confirmed. The selected limit is a user setting.'],
    'macbook-iso':['bundledISO','Bundled ISO model · measured on a related MacBook','Measured on a 2021 MacBook Pro (MacBookPro18,1), explaining 998 of 999 observations. Selection does not test this keyboard.'],
    'macbook-ansi':['derivedANSI','Derived ANSI model · prediction only','Derived from measured ISO wiring, never physically measured. Grave and Backslash positions are unknown. Selection does not test this keyboard.'],
    'local-scan':['localScan','Local scan · '+(scan?.count ?? 0)+' observations',s.associated?'User-confirmed association with this keyboard. Observations cover only the combinations tested; inferred wiring remains a prediction.':'The scan’s keyboard has not been confirmed as the currently connected keyboard. Observations cover only combinations tested.'],
    'custom-wiring':['unchecked','Custom wiring · unchecked prediction','A wiring file is a model prediction until physically tested on this keyboard.']};
  let [source,title,detail] = titles[s.modelID];
  if(s.modelID==='local-scan' && !scan?.count) {source='unchecked';title='Local scan · no usable observations';detail='Import a nonempty compatible report before using a local scan.';}
  const namesFor = values=>[...new Set(values)].map(k=>typeof k==='number'?keys[k]?.name:k);
  function assessment(values) {
    const names = namesFor(values); const count = names.length;
    if(names.some(n=>!keys.some(k=>k.name===n))) return {allowed:false,status:'invalid',reason:'This chord contains a key absent from the layout.'};
    if(count>s.rolloverLimit) return {allowed:false,status:'limit',reason:`${count} keys exceeds the selected ${s.rolloverLimit}-key limit.`};
    const codes = names.map(n=>keys.find(k=>k.name===n).code);
    if(wiringBlocks(wiring,codes)) return {allowed:false,status:'predicted-block',reason:'The selected wiring predicts this chord may be blocked.'};
    if(s.modelID==='local-scan' && scan?.count) {
      const indices = codes.map(code=>CODE.indexOf(code));
      if (indices.some(i=>i<0)) return {allowed:true,status:'unchecked',reason:'This layout contains physical keys outside the imported scan. This chord has no compatible local scan observation.'};
      const set=new Set(indices);
      const failed = scan.combos.find(c=>c.outcome==='fail' && [...c.keys].every(k=>set.has(k)));
      if(failed) return {allowed:false,status:'observed-incomplete',reason:'A scan observation was incomplete for this combination or a subset; repeat locally before diagnosing hardware.'};
      if(scan.model.chordBlocked(indices)===true) return {allowed:false,status:'inferred-block',reason:'The local scan model predicts a blocked combination.'};
      const passed = scan.combos.find(c=>c.outcome==='pass' && c.keys.size===set.size && [...c.keys].every(k=>set.has(k)));
      if(passed) return {allowed:true,status:'observed',reason:'Registered in a local scan observation. This does not guarantee future attempts.'};
      return {allowed:true,status:'unchecked',reason:'Not directly observed in the scan; no known selected limit excludes it.'};
    }
    const unknown = wiring && codes.some(c=>!wiring.positions?.some(p=>p.code===c));
    return {allowed:true,status:wiring && !unknown?'predicted-allowed':'unchecked',reason:wiring && !unknown?'Selected model permits this chord; test locally.':'This combination is unchecked; no known selected limit excludes it.'};
  }
  return {...s,settings:s,id:s.modelID,label:bundled?.label??title,source,title,detail,localModel:scan?.model??null,assessment,
    accepts:keys=>assessment(keys).allowed,usable:keys=>assessment(keys).allowed,explain:keys=>assessment(keys).allowed?null:assessment(keys).reason};
}
export function getHardwareProfile(data) { return createHardwareProfile(data,getHardwareSettings()); }
