#!/usr/bin/env python3
"""Block Island scoped regression test. Does not modify the shipped index.html.
Run: python -m pip install playwright && python -m playwright install chromium
     python tests/smoke_progression.py [path/to/index.html]

Uses the game's built-in ?qa hooks; document-insertion is used because some
CI/sandbox browsers block file:// and localhost navigation. localStorage is
mocked for snapshot serialization checks; real Safari persistence is NOT tested.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HTML = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'index.html'
html = HTML.read_text(encoding='utf-8')
needle = "if(new URLSearchParams(location.search).has('qa'))installQA();"
assert html.count(needle) == 1, 'QA initialization location changed; revise test adapter'
# Only change the in-memory test document, never the application file on disk.
html = html.replace(needle, 'installQA();')
shim = '''<script>
window.__qaStorage = new Map();
Object.defineProperty(window,'localStorage',{configurable:true,value:{
 getItem(k){return window.__qaStorage.has(k)?window.__qaStorage.get(k):null},
 setItem(k,v){window.__qaStorage.set(k,String(v))},
 removeItem(k){window.__qaStorage.delete(k)},clear(){window.__qaStorage.clear()}
}});
</script>'''
html = html.replace('<head>', '<head>' + shim, 1)


def check(condition, msg):
    if not condition:
        raise AssertionError(msg)
    print('PASS', msg, flush=True)


with sync_playwright() as p:
    browser_path = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
    browser = p.chromium.launch(headless=True, executable_path=browser_path, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width':375,'height':812}, device_scale_factor=1, is_mobile=True, has_touch=True)
    errors = []
    page.on('pageerror', lambda ex: errors.append(str(ex)))
    page.set_content(html, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function('!!window.BI_QA', timeout=12000)
    check(page.locator('#board .cell').count() == 36, '6x6 puzzle board')
    check(page.evaluate("BI_QA.data().CONFIG.turns === 45"), '45 turn rule intact')

    # The same test covers all four actual Final animation paths.
    for branch in ['population','industry','nature','culture']:
        setup = page.evaluate('''branch => {
          const qa=BI_QA, chain=qa.data().CHAINS[branch], state=qa.get().state;
          const cells=state.cells.map(c=>({...c,terrain:'land',object:null,finalGroup:null}));
          cells[14].object=chain[2].id; cells[15].object=chain[2].id;
          qa.set({state:{cells,turn:45,finalPhase:true,finished:false,animating:false,specialEvent:null}});
          return chain[3].id;
        }''',branch)
        page.evaluate('BI_QA.merge(14,15)')
        page.wait_for_timeout(420)
        check(page.evaluate("!!document.querySelector('.board .finalMegaVisual.merge-result.final')"), branch + ' Final merge animation')
        page.wait_for_timeout(840)
        final_state = page.evaluate('''() => {
          const cells=BI_QA.get().state.cells;
          return {objects:[cells[14].object,cells[15].object],
             group:[cells[14].finalGroup,cells[15].finalGroup],
             animating:BI_QA.get().state.animating};
        }''')
        check(final_state['objects'] == [setup,setup]
              and final_state['group'][0] and final_state['group'][0] == final_state['group'][1]
              and not final_state['animating'], branch + ' Final retains exactly two linked cells')

    # User flow: finish -> resource claim once -> cannot claim again.
    page.evaluate('''() => {BI_QA.home();BI_QA.fresh();const s=BI_QA.get().state;
      const cells=s.cells.map(c=>({...c,terrain:'land'}));
      cells[14].object='pioneer';BI_QA.set({state:{cells,turn:45,finalPhase:true,finished:false,animating:false,specialEvent:null}}); }''')
    page.evaluate('BI_QA.finish()')
    check(page.evaluate("BI_QA.get().currentScreen === 'result'"),'finish opens result')
    before=page.evaluate('BI_QA.get().motherState.resources')
    page.evaluate('BI_QA.claim()')
    after=page.evaluate('BI_QA.get().motherState.resources')
    check(page.evaluate("BI_QA.get().currentScreen === 'mother'"), 'return opens mother island')
    check(any(after[k]>before[k] for k in before), 'return grants exploration resources')
    page.evaluate('BI_QA.claim()')
    check(page.evaluate('BI_QA.get().motherState.resources') == after, 'resources cannot be claimed twice')

    # With abundant test resources, build through the REAL dependency rules;
    # this checks that all 4 stages are reachable, not natural-play balance.
    build = page.evaluate('''() => {
      const qa=BI_QA, start=qa.get().motherState;
      qa.set({motherState:{resources:Object.fromEntries(Object.keys(start.resources).map(k=>[k,10000]))}});
      let built=[],fails=[];
      for(let i=0;i<100;i++){
        const a=qa.available(), id=a[0];if(!id)break;
        const prev=qa.get().motherState.built[id]||0;
        qa.build(id);
        if(qa.placement.draft())qa.placement.confirm();
        if((qa.get().motherState.built[id]||0)!==prev+1){fails.push(id);break}
        built.push(id);
      }
      const m=qa.get().motherState;
      return {built, fails, rewards:m.rewards, port:m.port, portComplete:m.portComplete,
              resources:m.resources, all:qa.data().FACILITIES.map(f=>({id:f.id,cap:f.cap}))};
    }''')
    print('BUILT', len(build['built']), 'FAILS',build['fails'],'REWARDS', json.dumps(build['rewards'],ensure_ascii=False),flush=True)
    check(not build['fails'], 'facility construction applies to every allowed action')
    check(all(build['built'].count(f['id'])==f['cap'] for f in build['all']), 'all 37 buildings constructible in valid dependency order')
    check(all(build['rewards'].get(k) for k in ['s2','s3','s4']), 'stages 2/3/4 unlock')

    port = page.evaluate('''() => {
      const qa=BI_QA, before=qa.get().motherState;
      Object.keys(before.port).forEach(k=>qa.invest(k,999));
      const after=qa.get().motherState;
      return {port:after.port,portComplete:after.portComplete};
    }''')
    check(all(value == 40 for value in port['port'].values()) and port['portComplete'], 'port completes after four 40-resource deposits')
    page.evaluate('BI_QA.save()')
    saved = page.evaluate("localStorage.getItem('blockIslandV2Alpha')")
    snapshot = json.loads(saved) if saved else {}
    check(snapshot.get('schema')==3 and snapshot.get('screen')=='mother', 'schema3 snapshot serializes mother state')
    check(page.evaluate('BI_QA.placement.valid()'), 'mother island layout remains valid')
    # Reopen in a fresh document seeded from the serialized save. This is an
    # application-level restore test with mocked storage, not a Safari test.
    restore_html = html.replace('window.__qaStorage = new Map();',
        'window.__qaStorage = new Map([["blockIslandV2Alpha",' + json.dumps(saved) + ']]);',1)
    resume = browser.new_page(viewport={'width':375,'height':812})
    resume_errors = []
    resume.on('pageerror', lambda ex: resume_errors.append(str(ex)))
    resume.set_content(restore_html, wait_until='domcontentloaded', timeout=60000)
    resume.wait_for_function('!!window.BI_QA',timeout=12000)
    restored = resume.evaluate('BI_QA.get()')
    check(restored['currentScreen']=='mother' and restored['motherState']['portComplete']
        and all(v==40 for v in restored['motherState']['port'].values()), 'schema3 save restores completed port')
    check(not resume_errors, 'restore has no JavaScript errors')
    resume.close()
    check(not errors, 'no JavaScript page errors: ' + str(errors[:2]))
    browser.close()
