import {ChordObservationSession} from './observations.mjs?v=96c282d34c00';
export const ERGONOMIC_CANDIDATES = Object.freeze([
  {word:'use',keys:['Quote','U','S']}, {word:'you',keys:['Quote','Y','O']}
]);

// Adapters replay the real engine and dictionaries. No proposal is installed globally.
export function candidateCompatibility(candidate, {mode='english',layoutNames=[],collision=()=>false,rolloverLimit=6,usable=()=>true,replay} = {}) {
  const problems = [];
  const finish = () => ({candidate,allowed:!problems.length,problems,hardwareNote:'Selected limits are predictions until tested physically. No speed or comfort measurements exist yet.'});
  if(mode!=='english') problems.push('This isolated experiment is English only. Quote+U+S keeps its C++ meaning, “using”.');
  const keys=candidate?.keys;
  if(!Array.isArray(keys)||!keys.length||keys.some(k=>typeof k!=='string')||new Set(keys).size!==keys.length||typeof candidate?.word!=='string'||!candidate.word) {
    problems.push('The proposed word or chord is invalid.');return finish();
  }
  if(keys.some(k=>!layoutNames.includes(k))) problems.push('The proposed keys are absent from this layout.');
  if(keys.length>rolloverLimit) problems.push('The proposed chord exceeds the selected rollover limit.');
  // Invalid layouts and limits must never reach an engine or an isolated dictionary constructor.
  if(problems.length)return finish();
  try {
    if(collision(keys))problems.push('The proposed chord already has an English or shared meaning.');
    if(!usable(keys))problems.push('The selected keyboard profile excludes the proposed chord.');
  } catch {
    problems.push('The current mapping could not validate this proposed chord.');
  }
  // A collision is rejected before appending a brief; strict core dictionary validation stays intact.
  if(problems.length)return finish();
  if(typeof replay!=='function')problems.push('Exact engine output validation is unavailable.');
  else for(const context of ['fresh','after-sat']) {
    try {
      if(replay(candidate,context)!==(context==='fresh'?candidate.word:`sat ${candidate.word}`))problems.push(`Exact output and spacing validation failed in ${context} context.`);
    } catch {
      problems.push(`Exact engine output validation could not run in ${context} context.`);
    }
  }
  return finish();
}

export function buildErgonomicTrials({optedIn=false,candidates=ERGONOMIC_CANDIDATES,compatibility,makeRoute} = {}) {
  if(!optedIn || typeof compatibility!=='function' || typeof makeRoute!=='function') return [];
  const trials = [];
  for(const repetition of [1,2]) for(const context of ['fresh','after-sat']) for(const candidate of candidates) {
    if(!compatibility(candidate).allowed) continue;
    const order = repetition===1?['current','proposed']:['proposed','current'];
    const pair = order.map(route=>makeRoute(candidate,route,context)).filter(t=>t && t.steps?.length && t.steps.every(s=>s.keys?.length));
    if(pair.length!==2) continue;
    for(const t of pair) trials.push({...t,word:candidate.word,context,repetition,expectedOutput:context==='fresh'?candidate.word:`sat ${candidate.word}`});
  }
  return trials;
}

export class ErgonomicTrialSession {
  constructor(trials=[], {replaySteps}={}) {
    this.trials=trials; this.replaySteps=replaySteps; this.index=0; this.measurements=[];
    this.cancelled=false; this.started=null; this.corrections=0; this.pendingMilliseconds=null; this.resetRoute();
  }
  get current() { return this.cancelled?null:this.trials[this.index]??null; }
  get currentStep() { return this.current?.steps[this.stepIndex]??null; }
  get down() { return this.observation.down; }
  resetRoute() { this.stepIndex=0; this.completedSteps=[]; this.observation=new ChordObservationSession(this.current?[this.current.steps[0]]:[]); }
  keyDown(name,{timestamp=performance.now(),shift=false,repeat=false}={}) {
    if(!this.current || this.pendingMilliseconds!==null) return;
    if(repeat) {this.interrupt();return;}
    if(this.started===null) this.started=timestamp;
    this.observation.keyDown(name,{shift,timestamp});
  }
  keyUp(name,{timestamp=performance.now()}={}) {
    if(!this.current || this.pendingMilliseconds!==null) return false;
    const result=this.observation.keyUp(name,{timestamp}); if(!result) return false;
    if(!result.allRegistered) {this.corrections++;this.resetRoute();return false;}
    this.completedSteps.push(this.currentStep); this.stepIndex++;
    if(this.stepIndex<this.current.steps.length) {this.observation=new ChordObservationSession([this.currentStep]);return false;}
    const output=this.replaySteps?.(this.current,this.completedSteps);
    if(output!==this.current.expectedOutput || this.started===null || timestamp<=this.started) {this.corrections++;this.resetRoute();return false;}
    this.pendingMilliseconds=timestamp-this.started;
    return true;
  }
  rateComfort(comfort) {
    if(!Number.isInteger(comfort)||comfort<1||comfort>5||this.pendingMilliseconds===null||!this.current||this.down.size) return false;
    this.measurements.push({trial:this.current,elapsedMilliseconds:this.pendingMilliseconds,corrections:this.corrections,comfort});
    this.index++;this.started=null;this.corrections=0;this.pendingMilliseconds=null;this.resetRoute();return true;
  }
  retry() {if(this.started!==null) this.corrections++;this.pendingMilliseconds=null;this.resetRoute();}
  interrupt() {this.started=null;this.corrections=0;this.pendingMilliseconds=null;this.resetRoute();}
  skip() {this.interrupt();if(this.current)this.index++;this.resetRoute();}
  cancel() {this.interrupt();this.cancelled=true;this.resetRoute();}
}

export function ergonomicReport(session, identity={}) {
  let out='# KeyChord opt-in English ergonomic trial\nversion 1\nkeyboard '+String(identity.keyboard||'unknown').replace(/[\r\n]/g,' ')+'\n';
  out+='# Aggregate local human measurements only. Time includes corrections/retries. Comfort is a separate self-report from 1 (uncomfortable) to 5 (comfortable).\n';
  if(!session.measurements.length)out+='# No human measurements collected. Model compatibility is not speed or comfort evidence.\n';
  for(const m of session.measurements) {
    const t=m.trial;
    out+=`observed word=${t.word} route=${t.route} context=${t.context} repetition=${t.repetition} milliseconds=${Math.round(m.elapsedMilliseconds)} corrections=${m.corrections} comfort=${m.comfort}\n`;
  }
  return out+'# Compare matched contexts and repetitions. Practice, order, and hand preferences remain. No global winner, frequency claim, or dictionary change is inferred.\n';
}
