import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHardwareProfile,parseScanReport,parseWiring,serializeWiring,normalizeSettings} from '../hardware/profile.mjs';
import {NAME,Report} from '../hardware/matrix.mjs';
const data=JSON.parse(await readFile(new URL('../data.json',import.meta.url),'utf8'));
const scan='# KeyChord Matrix Scan\nversion 1\nhardware local test\nkeys '+NAME.join(' ')+'\nsweep J+M blocked C tapped S C H\ncombo S+C+J fail missing J\ncombo S+C+H pass\n';
test('native scan report parse/serialize roundtrip retains sweeps, missing, outcomes, and key order',()=>{
 const parsed=parseScanReport(scan);const text=Report.serialize(parsed.model,parsed.combos,'local test');const loaded=parseScanReport(text);
 assert.equal(loaded.count,5);assert.equal(loaded.sweeps.length,1);assert.equal(loaded.combos[0].outcome,'fail');assert.deepEqual([...loaded.combos[0].missing],[NAME.indexOf('J')]);assert.equal(loaded.combos[1].outcome,'pass');
});
test('all-dark sweeps are excluded and empty reports create no measured evidence',()=>{
 const p=parseScanReport('version 1\nsweep J+M blocked S C tapped S C\n');assert.equal(p.excludedSweeps,1);assert.equal(p.count,0);
 const profile=createHardwareProfile(data,{modelID:'local-scan',localReport:'version 1\n'});assert.equal(profile.source,'unchecked');
});
test('import validation rejects mixed layout, malformed evidence and incorrect held pairs',()=>{
 for(const text of ['version 2\n','version 1\nkeys incorrect\n','version 1\nsweep S+S blocked - tapped C\n','version 1\nsweep S+C blocked J tapped H\n','version 1\ncombo S+C pass missing C\n'])assert.throws(()=>parseScanReport(text));
});
test('provenance distinguishes related measured ISO, derived unmeasured ANSI, local and unchecked',()=>{
 assert.equal(createHardwareProfile(data,{modelID:'macbook-iso'}).source,'bundledISO');assert.match(createHardwareProfile(data,{modelID:'macbook-iso'}).detail,/998 of 999/);
 assert.equal(createHardwareProfile(data,{modelID:'macbook-ansi'}).source,'derivedANSI');assert.match(createHardwareProfile(data,{modelID:'macbook-ansi'}).detail,/never physically measured/);
 assert.equal(createHardwareProfile(data,{modelID:'generic'}).source,'unchecked');const local=createHardwareProfile(data,{modelID:'local-scan',localReport:scan});assert.equal(local.source,'localScan');assert.match(local.detail,/not been confirmed/);
 assert.match(createHardwareProfile(data,{modelID:'local-scan',localReport:scan,associated:true}).detail,/User-confirmed/);
});
test('local limits filter planner names/indices and never turn one incomplete attempt into a diagnosis',()=>{
 const p=createHardwareProfile(data,{modelID:'local-scan',localReport:scan,rolloverLimit:3});assert.equal(p.usable(['S','C','J']),false);assert.equal(p.assessment(['S','C','J']).status,'observed-incomplete');assert.match(p.explain(['S','C','J']),/repeat locally/);
 assert.equal(p.usable(['S','C','H']),true);assert.equal(p.assessment(['S','C','H']).status,'observed');assert.equal(p.accepts(['S','C','H','J']),false);
 const indices=['S','C','H'].map(n=>data.layout.keys.findIndex(k=>k.name===n));assert.equal(p.accepts(indices),true);assert.equal(p.accepts(['NotAKey']),false);
});
test('native wiring export/import roundtrip preserves positions, non-chord corners and solo keys',()=>{
 for(const profile of data.profiles.filter(p=>p.wiring)){
 const parsed=parseWiring(serializeWiring(profile.wiring,data),data);assert.equal(parsed.positions.length,profile.wiring.positions.length);assert.equal(parsed.otherKeys.length,profile.wiring.otherKeys.length);assert.deepEqual(parsed.solo,profile.wiring.solo);assert.deepEqual(parsed.columns,profile.wiring.columns);
 }
 assert.throws(()=>parseWiring('version 1\ncolumns a b\nrow r S S\n',data));assert.throws(()=>parseWiring('version 1\ncolumns a b\nrow r S\n',data));
});
test('derived ANSI unknown Grave and Backslash stay unchecked and limit normalizes safely',()=>{
 const p=createHardwareProfile(data,{modelID:'macbook-ansi'});assert.equal(p.assessment(['Grave','Backslash','S']).status,'unchecked');assert.equal(normalizeSettings({rolloverLimit:-1}).rolloverLimit,1);assert.equal(normalizeSettings({rolloverLimit:Infinity}).rolloverLimit,6);
});

test('local scan evidence follows physical codes after keys are renamed or reordered; incompatible codes stay unchecked',()=>{
 const custom=structuredClone(data);const key=custom.layout.keys.find(k=>k.name==='S');key.name='StartS';custom.layout.keys.reverse();
 const profile=createHardwareProfile(custom,{modelID:'local-scan',localReport:scan});
 assert.equal(profile.assessment(['StartS','C','J']).status,'observed-incomplete');
 assert.equal(profile.assessment(['StartS','C','H']).status,'observed');
 const indices=['StartS','C','H'].map(name=>custom.layout.keys.findIndex(k=>k.name===name));assert.equal(profile.assessment(indices).status,'observed');
 key.code=999;const incompatible=createHardwareProfile(custom,{modelID:'local-scan',localReport:scan});
 assert.doesNotThrow(()=>incompatible.assessment(['StartS','C','H']));assert.equal(incompatible.assessment(['StartS','C','H']).status,'unchecked');assert.match(incompatible.assessment(['StartS','C','H']).reason,/outside the imported scan/);
});
