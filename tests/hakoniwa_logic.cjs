/* Scoped production-code tests. Run: node tests/hakoniwa_logic.cjs
 * Executes the shipped wallet/model/transaction functions in an isolated VM.
 * UI rendering and browser storage behavior are covered by smoke_hakoniwa.py.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function section(start, end, text = source) {
  const i = text.indexOf(start), j = text.indexOf(end, i + start.length);
  assert(i >= 0 && j > i, `Production section missing: ${start}`);
  return text.slice(i, j);
}
const nodes = new Map(), storage = new Map();
const context = vm.createContext({
  console, queueMicrotask, window: {scrollTo() {}},
  requestAnimationFrame() {}, showUnlockToast() {},
  $(id) { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
  Platform: {
    write(key, value) { if (context.failSave) return false; storage.set(key, value); return true; },
    read(key) { return storage.get(key) || null; }
  },
  showMotherHome() { vm.runInContext("currentScreen='mother'", context); },
  footprintOverlap(a, b) { return a.x < b.x + b.size && a.x + a.size > b.x && a.y < b.y + b.size && a.y + a.size > b.y; },
  highlightReceivedResources() {}, renderMother() {}, refresh() {}, close() {},
  motherCamera: {}, view: {camera: {}}, confirm: {}, info: {},
  failSave: false
});
const run = code => vm.runInContext(code, context);
const read = code => JSON.parse(JSON.stringify(run(code)));
run(`
const SAVE_KEY='blockIslandV2Alpha', SAVE_SCHEMA=3;
${section('const HAKONIWA_PRICE=', 'function queueSave()')}
const MAX_TURNS=45, KEYS=['population','industry','nature','culture'];
${source.match(/^const DECORS=.*$/m)[0]}
let motherState, state, pendingHaul, motherPreviewMode=false;
let returnToMother, abortExploreToMother;
${section('function hakoniwaReturnMessage()', 'peekMother=function()')}
${section('abortExploreToMother=function()', '// Finish the departure note')}
${section('const BoundaryModel=', 'const BOUNDARY_ART_DATA=')}
${section('const DECOR_ITEMS=', '// A future provider')}
${section('// A future provider', 'function openBottleLetters(')}
${section('function decorDraft(', 'const DecorRenderer=')}
booting=false;
function fixture(turn=45) {
  motherState={resources:Object.fromEntries(KEYS.map(k=>[k,0])),
    stats:Object.fromEntries(KEYS.map(k=>[k,300])), rewards:{s3:true},
    layout:{placements:[]}, decorations:{version:2,width:20,height:20,items:[]},
    boundaries:BoundaryModel.empty()};
  restoreHakoniwa(null,motherState);
  state={turn,finished:true,animating:false,haulClaimed:false};
  pendingHaul=Object.fromEntries(KEYS.map(k=>[k,3])); currentScreen='result';
}
fixture();
`);
assert.equal(run('HAKONIWA_PRICE'), 2);
run('returnToMother(); returnToMother()');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters,motherState.completedExpeditions]'), [1,1,1]);
assert.deepEqual(read('Object.values(motherState.resources)'), [3,3,3,3]);
const claimed = storage.get('blockIslandV2Alpha');
run(`{ const saved=JSON.parse(Platform.read(SAVE_KEY)); motherState=saved.mother;
  state=saved.puzzle; currentScreen=saved.screen; pendingHaul=saved.pendingHaul;
  restoreHakoniwa(saved.hakoniwa,motherState); returnToMother(); }`);
assert.equal(storage.get('blockIslandV2Alpha'), claimed);
run('fixture(44); state.finished=false; abortExploreToMother(); returnToMother()');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters]'), [0,0]);
run('fixture(); state.finished=false; returnToMother()');
assert.equal(run('hakoniwa.tickets'), 0);
run('fixture(); hakoniwa.letters=20; returnToMother()');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters]'), [1,20]);
context.failSave = true;
run('fixture(); returnToMother()');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters,state.haulClaimed,currentScreen,motherState.resources.population]'), [0,0,false,'result',0]);
context.failSave = false;
run('returnToMother(); returnToMother()');
assert.equal(run('hakoniwa.tickets'), 1);
console.log('PASS completed return, abandon, once-only claims, reload, save failure rollback, letter cap');

run(`fixture(); motherState.decorations={version:2,width:20,height:20,tickets:6,
 owned:{bench:2},items:[{uid:'bench-1',id:'bench',x:1,y:1}]};
 restoreHakoniwa(null,motherState); normalizeMotherDecor(motherState);`);
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters,hakoniwa.owned.bench,hakoniwa.owned.gate]'), [6,0,2,1]);
assert.equal(run("'owned' in motherState.decorations || 'tickets' in motherState.decorations"), false);
assert.equal(run('motherState.decorations.items.length'), 1);
run('restoreHakoniwa({tickets:12,letters:8,owned:{bench:140,gate:3}},motherState)');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters,hakoniwa.owned.bench]'), [12,8,140]);
run(`restoreHakoniwa({tickets:6,letters:0,owned:{bench:2}},motherState); currentScreen='mother';
let draft, active='bench', original, originalLayout, closed=false;
const changed=()=>JSON.stringify(draft)!==original;
function prepareDecor(){ draft=decorDraft(motherState); original=JSON.stringify(draft); originalLayout=JSON.stringify(motherState.layout); }
prepareDecor();`);
const decor = section('function openDecorEditor(', 'const decorQAOriginal=');
run(`function buyDecor(){${section(" dialog.querySelector('.decorBuy').onclick=()=>{", '\n };', decor).split('onclick=()=>{')[1]}}
function commitDecor(){${section(' confirm.onclick=()=>{','\n };\n decorEditor=',decor).split('onclick=()=>{')[1]}}`);
run('buyDecor()');
assert.deepEqual(read('[draft.tickets,draft.owned.bench,hakoniwa.tickets]'), [4,3,6]);
run('prepareDecor()'); // cancelling discards only the draft
assert.deepEqual(read('[draft.tickets,draft.owned.bench]'), [6,2]);
run('buyDecor(); draft.items[0].x=2; commitDecor()');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.owned.bench,motherState.decorations.items[0].x]'), [4,3,2]);
run('prepareDecor(); buyDecor()');
context.failSave = true;
run('commitDecor()');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.owned.bench]'), [4,3]);
context.failSave = false;
run('commitDecor()');
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.owned.bench]'), [2,4]);
for (const item of read('DECOR_ITEMS.filter(d=>!d.unique)')) {
  run(`active=${JSON.stringify(item.id)}; hakoniwa.tickets=2; prepareDecor(); buyDecor(); commitDecor()`);
  assert.equal(run('hakoniwa.tickets'), 0);
  assert(run(`hakoniwa.owned[${JSON.stringify(item.id)}] >= 2`));
}
run("active='originTree'; hakoniwa.tickets=2; prepareDecor(); buyDecor()");
assert.equal(run('draft.tickets'), 2);
console.log('PASS schema3 legacy wallet migration, nine decoration exchanges, cancel, failed-save retry, free movement, special tree');

const fence = section('function openBoundaryEditor(', 'const fenceInstallQA=');
run(`let unlockedGate=true, material='gate', gateLimit, tickets, originalWallet;
function prepareFence(){draft=BoundaryModel.sanitize(motherState.boundaries); original=JSON.stringify(draft);
 originalWallet=hakoniwa; tickets=hakoniwa.tickets; gateLimit=hakoniwa.owned.gate;}
function buyGate(){${section(" dialog.querySelector('.gateBuy').onclick=()=>{",'\n };',fence).split('onclick=()=>{')[1]}}
function commitFence(){${section(' confirm.onclick=()=>{','\n };\n boundaryEditor=',fence).split('onclick=()=>{')[1]}}
hakoniwa.tickets=2; prepareFence(); buyGate();
BoundaryModel.set(draft,'h',0,0,'gate',gateLimit);
BoundaryModel.set(draft,'h',1,0,'gate',gateLimit); commitFence();`);
assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.owned.gate,motherState.boundaries.items.length]'), [0,2,2]);
run(`prepareFence(); BoundaryModel.set(draft,'h',0,0,'none',gateLimit);
BoundaryModel.set(draft,'v',2,2,'gate',gateLimit); commitFence();`);
assert.equal(run('hakoniwa.tickets'), 0);
assert.equal(run('motherState.boundaries.items.length'), 2);
run(`{const island2={...motherState,decorations:{version:2,width:20,height:20,items:[]},boundaries:BoundaryModel.empty()};
 globalThis.secondIslandAvailable=decorDraft(island2).owned.bench; }`);
assert.equal(run('secondIslandAvailable'), run('hakoniwa.owned.bench'));
console.log('PASS gate exchange, placement limit, free removal/replacement, per-island placements and shared unlock counts');

(async()=>{
  run('fixture(); hakoniwa.letters=2; currentScreen="mother"');
  assert.equal(await run('redeemBottleLetter()'), false);
  for (const provider of ['async()=>false','async()=>{throw Error("unavailable")}']) {
    run(`rewardedVideo=${provider}`);
    assert.equal(await run('redeemBottleLetter()'), false);
    assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters]'), [0,2]);
  }
  context.failSave=true;
  run('rewardedVideo=async()=>true');
  assert.equal(await run('redeemBottleLetter()'), false);
  assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters]'), [0,2]);
  context.failSave=false;
  run('rewardedVideo=()=>new Promise(resolve=>globalThis.completeVideo=resolve)');
  const result=run('redeemBottleLetter()');
  assert.equal(await run('redeemBottleLetter()'), false);
  run('completeVideo(true)');
  assert.equal(await result, true);
  assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters]'), [1,1]);
  run('completeVideo(true)');
  assert.deepEqual(read('[hakoniwa.tickets,hakoniwa.letters]'), [1,1]);
  const saved=JSON.parse(storage.get('blockIslandV2Alpha'));
  assert.deepEqual([saved.hakoniwa.tickets,saved.hakoniwa.letters], [1,1]);
  run('hakoniwa.letters=0; rewardedVideo=async()=>true');
  assert.equal(await run('redeemBottleLetter()'), false);
  console.log('PASS letters: no provider, cancelled, exception, failed save, duplicate requests, successful completion, persisted balance');
})().catch(error=>{console.error(error);process.exitCode=1});
