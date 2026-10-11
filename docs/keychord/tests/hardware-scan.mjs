import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseScanReport} from '../hardware/profile.mjs';
const html=await readFile(new URL('../scan/index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script id="([^"]+)">([\s\S]*?)<\/script>/g)];
const sandbox={};vm.createContext(sandbox);
vm.runInContext(scripts.find(x=>x[1]==='probe-core')[2]+'\nglobalThis.probe={Report,MatrixModel,MatrixScanSession,NAME,INDEX_BY_NAME,makePair};',sandbox);
const {Report,MatrixModel,MatrixScanSession,NAME,INDEX_BY_NAME,makePair}=sandbox.probe;
test('copied full scanner scripts parse and its report is compatible with hardware/native key list',()=>{
 for(const script of scripts)new vm.Script(script[2]);
 const parsed=Report.parse('version 1\nkeys '+NAME.join(' ')+'\ncombo S+C+J pass\n');const model=new MatrixModel(NAME.length,parsed.sweeps);const report=Report.serialize(model,parsed.combos,'physical keyboard');const reread=parseScanReport(report);assert.equal(reread.count,1);assert.equal(reread.combos[0].outcome,'pass');
});
test('full scan pair workflow, stage switching, undo/redo and aggregate roundtrip remain available',()=>{
 const session=new MatrixScanSession({sweeps:[],combos:[],candidates:[new Set([INDEX_BY_NAME.get('S'),INDEX_BY_NAME.get('C'),INDEX_BY_NAME.get('J'),INDEX_BY_NAME.get('H')])],preferred:[makePair(INDEX_BY_NAME.get('J'),INDEX_BY_NAME.get('M'))],tapOrder:NAME.map((_,i)=>i),canHold:()=>true});
 assert.ok(session.pair);session.skipPair();session.back();session.forward();session.enterCombos();assert.equal(session.stage,'combos');session.returnToSweeps();assert.equal(session.stage,'sweeps');
 const report=Report.serialize(session.model,session.combos,'local keyboard');assert.ok(Report.parse(report));
});
test('storage denial cannot disable scanner; capture is surface-owned and trusted',()=>{
 const app=scripts.find(x=>x[1]==='probe-app')[2];assert.match(app,/const safeStorage/);assert.match(app,/e\.isTrusted !== true/);assert.doesNotMatch(app,/window\.addEventListener\("keydown"/);assert.match(app,/captureSurface.*addEventListener\("keydown"/);
 // Evaluate only the small storage wrapper as a pure unit, with no DOM or browser execution.
 const source=app.match(/const safeStorage = \{[\s\S]*?\n  \};/)[0];const denied={localStorage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}};vm.createContext(denied);vm.runInContext(source+'\nglobalThis.safe = safeStorage;',denied);assert.equal(denied.safe.getItem('native-key'),null);assert.equal(denied.safe.setItem('native-key','text'),false);
});

test('forced and normal sweep completion wait for every captured layout key release',()=>{
 const make=()=>new MatrixScanSession({sweeps:[],combos:[],candidates:[],preferred:[makePair(INDEX_BY_NAME.get('J'),INDEX_BY_NAME.get('M'))],tapOrder:NAME.map((_,i)=>i),canHold:()=>true});
 for(const forced of [true,false]){
 const session=make();const pair=session.pair;session.keyDown(pair.a);session.keyDown(pair.b);const taps=[...session.order];
 if(forced){session.keyDown(taps[0]);session.keyUp(taps[0]);session.forceFinish();assert.equal(session.sweeps.length,0);}
 else for(const tap of taps){session.keyDown(tap);session.keyUp(tap);}
 const extra=taps[0];session.keyDown(extra);session.keyUp(pair.a);session.keyUp(pair.b);assert.equal(session.sweeps.length,0);session.keyUp(extra);assert.equal(session.sweeps.length,1);
 }
});
