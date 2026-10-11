import {candidateCompatibility} from './trial.mjs?v=f3ab99c6cf25';

export function plannedTargets(data,core,profile,mode='words') {
  const words=mode==='capitals'?['A','H','J','K']:['sat','hat','tan'];
  return words.flatMap(word=>{
    const guide=core.planText(word,{data,profile,mode:'english'});
    return guide.steps.filter(s=>s.action.type==='chord').map(s=>({label:`${word} · ${s.note}`,keys:s.action.keys,shift:!!s.action.shift}));
  });
}

export function createTrialAdapter(data,core,profile) {
  const indexByName=data.layout.indexByName;
  const idFor=keys=>keys.map(k=>indexByName.get(k)).sort((a,b)=>a-b).join(',');
  const isolated=new Map();
  function localData(candidate) {
    if(isolated.has(candidate.word))return isolated.get(candidate.word);
    const exported=structuredClone(data.exported);
    exported.dictionaries.english.push({keys:[...candidate.keys],entry:{type:'text',text:candidate.word,kind:'word',cursorFromEnd:null,attachLeft:false,attachRight:false,wordAttach:false,glue:false,capitalizeNext:false}});
    const local=core.createRuntimeData(exported);isolated.set(candidate.word,local);return local;
  }
  function collision(keys) {
    const id=idFor(keys);
    if(data.dictionaryMaps.english.has(id)||data.dictionaryMaps.shared.has(id))return true;
    const original=new core.ChordEngine(data,'english').translate(keys);
    return !original.signal || original.modeSwitched || original.actions.length>0;
  }
  function seed(routeData,context) {
    const engine=new core.ChordEngine(routeData,'english');let buffer=core.createBuffer();
    if(context==='after-sat'){
      const output=engine.translate(['S','C','J']);
      if(output.signal||output.modeSwitched)throw new Error('The baseline sat context is incompatible with this profile.');
      buffer=core.applyActions(buffer,output.actions);if(buffer.text!=='sat')throw new Error('The baseline sat output changed.');
    }
    return {engine,buffer};
  }
  function replay(routeData,context,steps) {
    try {
      let {engine,buffer}=seed(routeData,context);
      for(const step of steps){const result=engine.translate(step.keys,{join:!!step.shift});if(result.signal||result.modeSwitched)return null;if(result.actions.some(a=>!['insert','deleteBackward'].includes(a.type)))return null;buffer=core.applyActions(buffer,result.actions);}
      return buffer.text;
    }catch{return null;}
  }
  function compatibility(candidate) {
    return candidateCompatibility(candidate,{layoutNames:data.layout.keys.map(k=>k.name),collision,rolloverLimit:profile.rolloverLimit,usable:profile.usable,
      replay:(c,context)=>replay(localData(c),context,[{keys:c.keys,shift:false}])});
  }
  function makeRoute(candidate,route,context) {
    if(!compatibility(candidate).allowed)return null;
    const routeData=route==='current'?data:localData(candidate);
    const text=context==='fresh'?candidate.word:`sat ${candidate.word}`;
    let steps;
    if(route==='proposed')steps=[{keys:[...candidate.keys],shift:false}];
    else {
      const guide=core.planText(text,{data,mode:'english',profile});
      const filtered=guide.steps.filter(s=>s.source[0]>=(context==='fresh'?0:4));
      if(!filtered.length||filtered.some(s=>s.action.type!=='chord'))return null;
      steps=filtered.map(s=>({keys:s.action.keys,shift:!!s.action.shift}));
    }
    if(steps.some(s=>!profile.usable(s.keys)||s.keys.length>profile.rolloverLimit))return null;
    if(replay(routeData,context,steps)!==text)return null;
    return {word:candidate.word,route,context,steps,routeData};
  }
  return {compatibility,makeRoute,replaySteps:(trial,steps)=>replay(trial.routeData,trial.context,steps)};
}
