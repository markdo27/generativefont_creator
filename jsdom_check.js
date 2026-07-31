const fs=require('fs'); const {JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{
  runScripts:'dangerously', resources:'usable', url:'https://example.org/', pretendToBeVisual:true,
  beforeParse(w){
    w.console=console;
    w.opentype={Path:function(){this.moveTo=()=>{};this.lineTo=()=>{};this.close=()=>{};},Glyph:function(){},Font:function(){}};
    w.SVGElement.prototype.getBoundingClientRect=()=>({width:300,height:300,top:0,left:0});
    Object.defineProperty(w.SVGSVGElement.prototype,'viewBox',{get(){return {baseVal:{width:144,height:148}};}});
  },
});
const w=dom.window;
w.addEventListener('error',e=>console.log('WINDOW ERROR:',(e.error&&e.error.stack)||e.message));
setTimeout(()=>{
  const d=w.document;
  const defs=d.getElementById('glyphDefsInner');
  console.log('shared glyph defs:',defs.children.length);
  const testers=d.querySelectorAll('.tester');
  console.log('tester blocks:',testers.length);
  const t0=testers[0];
  console.log('block0 name:',t0.querySelector('.tester-name').textContent);
  console.log('block0 ctrls:',t0.querySelectorAll('.tester-ctrl').length,'| values:',
    [...t0.querySelectorAll('.tester-ctrl b')].map(x=>x.textContent).join(' '));
  console.log('block0 glyph instances:',t0.querySelectorAll('.tester-text svg').length,
    '| words:',t0.querySelectorAll('.word').length);
  console.log('uses (not duplicated paths):',t0.querySelectorAll('use').length);
  console.log('paper block present:',!!d.querySelector('.tester.paper'));
  console.log('glyph set groups:',d.querySelectorAll('.glyphset-group').length,
    '| cells:',d.querySelectorAll('.glyph-cell').length);

  // click a glyph in the character set -> editor follows
  const cell=[...d.querySelectorAll('.glyph-cell')].find(c=>c.dataset.letter==='S');
  cell.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  console.log('after clicking S -> badge:',d.getElementById('letterBadge').textContent);

  // --- redesign checks: brand, letter-jump removal, relocated toggles, node editing
  console.log('wordmark:',d.querySelector('.wordmark').textContent.replace(/\s+/g,' ').trim());
  console.log('letterJumpInput removed:',!d.getElementById('letterJumpInput'));
  console.log('letterBadge still present (as readout):',!!d.getElementById('letterBadge'));
  const controlBar=d.querySelector('.control-bar');
  console.log('Global/Mirror now live in control-bar:',
    controlBar.contains(d.getElementById('btnGlobalEdit')) && controlBar.contains(d.getElementById('btnMirror')));
  const editorPanel=d.querySelector('.editor-panel');
  console.log('Global/Mirror NOT in editor-panel:',
    !editorPanel.contains(d.getElementById('btnGlobalEdit')) && !editorPanel.contains(d.getElementById('btnMirror')));

  // node inspector: select a node handle, expect fields to enable
  const handle=d.querySelectorAll('#editorSvg .node-handle')[2];
  handle.dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10}));
  w.dispatchEvent(new w.MouseEvent('pointerup',{bubbles:true}));
  console.log('node fields enabled after selecting a node:',!d.getElementById('nodeX').disabled);
  console.log('node X value populated:',d.getElementById('nodeX').value !== '');

  const nodesBefore=d.querySelectorAll('#editorSvg .node-handle').length;
  d.getElementById('btnAddNode').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));

  setTimeout(()=>{
    const nodesAfter=d.querySelectorAll('#editorSvg .node-handle').length;
    console.log('Add Node increased node count:',nodesBefore,'->',nodesAfter,'(',nodesAfter===nodesBefore+1,')');

    d.getElementById('btnDelNode').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    setTimeout(()=>{
      const nodesAfterDel=d.querySelectorAll('#editorSvg .node-handle').length;
      console.log('Delete Node decreased node count back:',nodesAfterDel,'(',nodesAfterDel===nodesBefore,')');

      d.getElementById('btnUndo').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
      d.getElementById('btnUndo').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
      console.log('Undo after structural edits ran without throwing');

      // per-block size control
      const r=t0.querySelector('.tester-ctrl input');
      r.value=200; r.dispatchEvent(new w.Event('input',{bubbles:true}));
      console.log('after size change -> label:',t0.querySelector('.tester-ctrl b').textContent,
        '| glyph h:',t0.querySelector('.tester-text svg').getAttribute('height'));

      // shape param must update every preview through the shared defs
      const before=defs.querySelector('path').getAttribute('d').length;
      const sm=d.getElementById('sldMelt'); sm.value=34; sm.dispatchEvent(new w.Event('input',{bubbles:true}));
      setTimeout(()=>{
        const after=defs.querySelector('path').getAttribute('d').length;
        console.log('defs geometry updated by Melt:',before!==after,'(',before,'->',after,')');
        d.getElementById('btnAddBlock').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
        console.log('after add block:',d.querySelectorAll('.tester').length);
        console.log('ALL CHECKS DONE');
        process.exit(0);
      },260);
    },260);
  },260);
},700);
