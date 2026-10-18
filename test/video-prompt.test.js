const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const { chromium } = require('playwright');
const { promptState, answerVideoPrompt } = require('../lib/video-prompt');
const { playResource, findVideo } = require('../lib/media');
const { pauseMedia } = require('../lib/runner');
const { Control } = require('../lib/control');

function snapshot(html) {
    const {document,window} = parseHTML(`<html><body><div id="quizLayer">${html}</div></body></html>`);
    const style = node => ({display:node.style.display || '',visibility:node.style.visibility || ''});
    window.Element.prototype.getClientRects = function() {
        for(let node=this;node?.nodeType===1;node=node.parentElement) if(node.hidden || style(node).display==='none') return [];
        return [{}];
    };
    return vm.runInNewContext(`(${promptState.toString()})(root)`,{root:document.getElementById('quizLayer'),getComputedStyle:style});
}

test('video prompt inspection waits for async templates and ignores hidden or disabled preview controls', () => {
    assert.equal(snapshot('<div question-common></div><button class="btn-success">确定</button>').ready,false);
    const state = snapshot('<div hidden><input type="checkbox"></div><input disabled type="radio"><div class="smallTest-view"><div class="ti-q-c">样例</div><label><input type="radio" name="answer_1" value="A">甲</label><label><input type="radio" name="answer_1" value="B">乙</label></div><button class="btn-success">确定</button>');
    assert.equal(state.ready,true);
    assert.equal(state.multiple,false);
    assert.equal(state.options.length,2);
    assert.deepEqual([...state.options.map(option=>option.index)],[2,3]);
    assert.equal(snapshot('<input type="radio" value="{{key}}"><button class="btn-success">确定</button>').ready,false);
});

test('ambiguous radio groups and too many choices are kept for manual handling', () => {
    const button='<button ng-click="sureAnswer(curQsource)">确定</button>';
    assert.equal(snapshot('<input type="radio" name="one"><input type="radio" name="two">'+button).unsupported,true);
    assert.equal(snapshot('<input type="checkbox">'.repeat(9)+button).unsupported,true);
    assert.equal(snapshot('<label><input type="checkbox" style="display:none">甲</label>'+button).ready,true);
});

// Independent local fixtures based on the published template's DOM contract.
// No UOOC source code, real questions, login sessions or AI requests are used.
function questionPage({multiple=false,count=4,delay=0,hidden=false,styled=false,next=false,noFeedback=false,wrong=false}={}) {
    return `<!doctype html><meta charset="utf-8"><style>label{display:block;padding:4px}#quizLayer{border:1px solid #888;padding:12px;width:420px}</style>
      <div id="quizLayer"><div id="content"></div><div class="mpopup-bottom"><span ng-if="wrongTip" class="fl_left"></span><button class="btn btn-success" ng-click="sureAnswer(curQsource)">确定</button></div></div>
      <script>
      window.submissions=[];window.round=0;
      function render(){document.querySelector('#content').innerHTML=${JSON.stringify((hidden?'<div hidden><input type="checkbox" checked></div><input type="radio" disabled>':'')+'<div class="smallTest-view"><div class="ti-q-c">本地视频弹题</div>'+Array.from({length:count},(_,i)=>`<label class="ti-a"><input type="${multiple?'checkbox':'radio'}" name="answer_fixture" value="${i}" ${styled?'style="display:none"':''}>选项 ${i+1}</label>`).join('')+'</div>')};}
      setTimeout(render,${delay});
      document.querySelector('button').onclick=()=>{
        const selected=[...document.querySelectorAll('.smallTest-view input:checked')].map(x=>Number(x.value));
        window.submissions.push(selected);
        const expected=${JSON.stringify(multiple?[0,3]:[count-1])};
        if(!${wrong}&&JSON.stringify(selected)===JSON.stringify(expected)){
          if(${next}&&window.round++===0){render();document.querySelector('.ti-q-c').textContent='第二道视频题';document.querySelectorAll('.smallTest-view input').forEach(x=>x.name='answer_second');document.querySelector('.fl_left').textContent='';}
          else document.querySelector('#quizLayer').remove();
        }else if(!${noFeedback})document.querySelector('.fl_left').textContent='回答错误，请重新选择';
      };
      </script>`;
}

for (const channel of ['chrome','msedge']) {
    const installed = channel==='chrome'
        ? [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean).some(base=>fs.existsSync(path.join(base,'Google/Chrome/Application/chrome.exe')))
        : [process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)']].filter(Boolean).some(base=>fs.existsSync(path.join(base,'Microsoft/Edge/Application/msedge.exe')));
    test(`${channel} video prompt browser regressions`,{skip:!installed,timeout:60000},async t=>{
        const browser=await chromium.launch({channel,headless:true});
        t.after(()=>browser.close());
        async function pageFor(html,{iframe=false}={}) {
            const page=await browser.newPage();
            await page.route('**/*',route=>route.abort());
            if(iframe){await page.setContent('<iframe style="width:700px;height:600px"></iframe>');await page.frames()[1].setContent(html);}
            else await page.setContent(html);
            return page;
        }
        for(const fixture of [
            {name:'classic single-choice',options:{}},
            {name:'modern delayed Angular template and hidden previews',options:{delay:650,hidden:true}},
            {name:'multiple choice',options:{multiple:true}},
            {name:'true/false',options:{count:2}},
            {name:'styled inputs use their visible labels',options:{styled:true}},
            {name:'successive questions get separate option sequences',options:{next:true}},
            {name:'iframe prompt',options:{},iframe:true}
        ]) await t.test(fixture.name,async()=>{
            const page=await pageFor(questionPage(fixture.options),fixture);
            const notices=[];
            try{
                const result=await answerVideoPrompt(page,new Control(),{onVerify:notice=>notices.push(notice)});
                assert.ok(result.handled>=1);
                const frame=fixture.iframe?page.frames()[1]:page;
                assert.equal(await frame.locator('#quizLayer').count(),0);
                const attempts=await frame.evaluate(()=>window.submissions);
                assert.ok(attempts.length>=1);
                assert.equal(notices.filter(Boolean).length,0);
                if(fixture.options.next)assert.equal(attempts.length,8);
                else if(!fixture.options.multiple)assert.deepEqual(attempts,Array.from({length:fixture.options.count||4},(_,i)=>[i]));
                else assert.deepEqual(attempts.at(-1),[0,3]);
            }finally{await page.close();}
        });
        await t.test('unsupported prompt stays open and stop cancels manual waiting',async()=>{
            const page=await pageFor(questionPage({count:9}));const control=new Control(),notices=[];
            try{
                await assert.rejects(answerVideoPrompt(page,control,{onVerify:notice=>{notices.push(notice);if(notice)control.stop();}}),error=>error.code==='STOPPED');
                assert.equal(await page.locator('#quizLayer').isVisible(),true);
                assert.equal(notices[0].kind,'video-question');assert.equal(notices.at(-1),null);
                assert.deepEqual(await page.evaluate(()=>window.submissions),[]);
            }finally{await page.close();}
        });
        await t.test('hidden iframe templates do not shadow the visible video question',async()=>{
            const page=await pageFor(questionPage()+'<iframe style="display:none"></iframe>');
            try{
                await page.frames()[1].setContent(questionPage({count:9}));
                await answerVideoPrompt(page,new Control());
                assert.equal(await page.locator('#quizLayer').count(),0);
                assert.deepEqual(await page.frames()[1].evaluate(()=>window.submissions),[]);
            }finally{await page.close();}
        });
        await t.test('uncertain submission is not repeated',async()=>{
            const page=await pageFor(questionPage({noFeedback:true}));const control=new Control();
            try{
                await assert.rejects(answerVideoPrompt(page,control,{resultTimeout:450,onVerify:notice=>{if(notice)control.stop();}}),error=>error.code==='STOPPED');
                assert.deepEqual(await page.evaluate(()=>window.submissions),[[0]]);
            }finally{await page.close();}
        });
        await t.test('manual answer resumes after all choices have been tried',async()=>{
            const page=await pageFor(questionPage({count:2,wrong:true}));const notices=[],actions=[];
            try{
                await answerVideoPrompt(page,new Control(),{onVerify:notice=>{notices.push(notice);if(notice)actions.push(page.locator('#quizLayer').evaluate(node=>node.remove()));}});
                await Promise.all(actions);
                assert.deepEqual(await page.evaluate(()=>window.submissions),[[0],[1]]);
                assert.equal(notices.filter(Boolean).length,1);assert.equal(notices.at(-1),null);
            }finally{await page.close();}
        });
        await t.test('iframe video is located and paused',async()=>{
            const page=await pageFor('<video style="width:300px;height:180px"></video>',{iframe:true});
            try{
                const video=await findVideo(page);assert.equal(await video.count(),1);
                await video.evaluate(node=>{node.pause=()=>{node.dataset.fixturePaused='yes';};});
                await pauseMedia(page);assert.equal(await video.getAttribute('data-fixture-paused'),'yes');
            }finally{await page.close();}
        });
        await t.test('long manual handling is excluded from the playback stall clock',async()=>{
            const page=await pageFor(questionPage({count:9})+'<video style="width:300px;height:180px"></video>');
            let clock=0;const actions=[];
            try{
                await page.evaluate(()=>{
                    location.hash='/course/unit/vid-1';
                    document.querySelector('#quizLayer').style.display='none';
                    window.playbackFixture={time:0,ended:false,plays:0};
                    const state=window.playbackFixture,video=document.querySelector('video');
                    Object.defineProperties(video,{currentTime:{get:()=>state.time},duration:{get:()=>90},paused:{get:()=>true},ended:{get:()=>state.ended},error:{get:()=>null}});
                    video.play=async()=>{
                        if(document.querySelector('#quizLayer')?.getClientRects().length)throw Error('Attempted playback through an unanswered prompt');
                        state.plays++;
                        if(state.plays===1){state.time=10;setTimeout(()=>{document.querySelector('#quizLayer').style.display='block';},150);}
                        if(state.plays>=3){state.time=90;state.ended=true;}
                    };
                });
                const outcome=await playResource({page,confirmed:async()=>true},{id:'vid-1',title:'样例视频'},{record(){}},{
                    control:new Control(),now:()=>clock,onVerify:notice=>{if(notice){clock+=120000;actions.push(page.locator('#quizLayer').evaluate(node=>node.remove()));}}
                });
                await Promise.all(actions);
                assert.equal(outcome,'网站确认完成');
                assert.equal(await page.evaluate(()=>window.playbackFixture.plays),3);
                assert.equal(clock,120000);
            }finally{await page.close();}
        });
    });
}
