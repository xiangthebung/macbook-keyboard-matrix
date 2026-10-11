import {physicalEventDecision} from './observations.mjs?v=f3ab99c6cf25';

// No document/window keyboard handler: the dedicated surface owns all captured keys.
export function attachPhysicalCapture(surface,{getSession,mapEvent,onUpdate=()=>{},onPause=()=>{}}={}) {
  const abort = new AbortController(); const options={signal:abort.signal};
  let active=false;
  const doc=surface.ownerDocument; const win=doc.defaultView;
  function pause(reason='Paused. Release all keys, then focus input to resume.') {
    active=false;getSession()?.interrupt();onPause(reason);onUpdate();
  }
  function onKey(event) {
    if(!active)return;
    const decision=physicalEventDecision(event,{active:!doc.hidden && doc.hasFocus(),focused:doc.activeElement===surface && event.target===surface});
    if(decision.kind!=='capture') {
      if(decision.kind==='cancel')getSession()?.cancel?.();
      pause(decision.reason);return;
    }
    const name=mapEvent(event);
    if(!name) {pause('Unsupported key interrupted the attempt. Release all keys and resume.');return;}
    event.preventDefault();event.stopPropagation();
    const session=getSession();
    if(event.type==='keydown')session?.keyDown(name,{shift:event.shiftKey,repeat:event.repeat,timestamp:performance.now()});
    else session?.keyUp(name,{timestamp:performance.now()});
    onUpdate();
  }
  surface.addEventListener('keydown',onKey,options);surface.addEventListener('keyup',onKey,options);
  surface.addEventListener('focusout',()=>{if(active)pause();},options);
  for(const type of ['compositionstart','paste','drop','beforeinput'])surface.addEventListener(type,()=>{if(active)pause('Composition, paste, or edited input cannot earn physical test evidence.');},options);
  doc.addEventListener('pointerdown',()=>{if(active)pause('Mouse interaction paused the attempt. Release all keys and resume explicitly.');},{...options,capture:true});
  win.addEventListener('blur',()=>{if(active)pause('Focus left the browser. Release all keys and resume explicitly.');},options);
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden && active)pause('The test tab is inactive. Release all keys and resume explicitly.');},options);
  return {
    focus() {
      if(doc.hidden||!doc.hasFocus()){pause('Activate this browser tab before starting the test.');return false;}
      getSession()?.interrupt();surface.focus();active=true;onPause('Capturing physical keys. Hold the target together, then release every key. Tab pauses.');onUpdate();return true;
    },
    pause, suspend(reason='Completed. Capture paused.') { active=false;onPause(reason); }, get active(){return active;},
    cleanup(){active=false;getSession()?.interrupt();abort.abort();}
  };
}
