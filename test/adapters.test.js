const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { parseHTML } = require('linkedom');
const { CourseSite, layout, normalizeSource } = require('../lib/site');

function fixture(version, finished = true) {
    const source = `<div ng-repeat="source in sectionItem.unitSource" class="basic ${finished ? 'complete' : ''}"><span>视频</span></div>`;
    if (version === 'classic') return `<ul><li class="catalogItem" id="10"><div class="basic chapter" ng-click="toggleChapter(chapterItem)"><i class="icon-xiangshang"></i></div><ul><li id="11"><div class="basic" ng-click="toggleChapter(sectionItem)"><i class="icon-xiangshang"></i></div><div class="resourcelist">${source}</div></li></ul></li></ul>`;
    const modernSource = `<div class="level_2_resourcelist_item" ng-repeat="source in sectionItem.unitSource">示例视频${finished ? '<img ng-if="source.finished == 1 &amp;&amp; source.is_task == 1">' : ''}</div>`;
    return `<ul><li><div class="level_1_title" id="id_10"><img src="xiangshang.svg"></div><ul class="level_2"><li><div class="level_2_title" id="id_11"><img src="xiangshang.svg"></div><div class="level_2_resourcelist">${modernSource}</div></li></ul></li></ul>`;
}

function environment(html, onClick = () => { throw new Error('fixture is already expanded'); }) {
    const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
    window.Element.prototype.getClientRects = function () {
        let node = this;
        while (node?.nodeType === 1) {
            if (node.hasAttribute('hidden')) return [];
            node = node.parentElement;
        }
        return [{}];
    };
    class Locator {
        constructor(nodes) { this.nodes = nodes; }
        locator(selector) { return new Locator(selector === '..' ? [this.nodes[0].parentElement] : this.nodes.flatMap(node => [...node.querySelectorAll(selector)])); }
        first() { return new Locator(this.nodes.slice(0, 1)); }
        nth(index) { return new Locator(this.nodes.slice(index, index + 1)); }
        async count() { return this.nodes.length; }
        async waitFor() { assert.ok(this.nodes.length, 'fixture selector must match'); }
        async evaluate(fn) { return fn(this.nodes[0]); }
        async click() { return onClick(this.nodes[0]); }
    }
    const page = Object.assign(new EventEmitter(), {
        locator: selector => new Locator([...document.querySelectorAll(selector)]),
        evaluate: fn => vm.runInNewContext(`(${fn.toString()})()`, { document }),
        waitForTimeout: async () => {}, isClosed: () => false
    });
    return { page, document };
}

for (const version of ['modern', 'classic']) {
    test(`${version} detects visible directory and maps resource by website ID`, async () => {
        const { page } = environment(fixture(version));
        assert.equal(page.evaluate(layout), version);
        const site = new CourseSite(page, { id: '1' });
        site.units.set('11', { sources: [{ id: '21', title: '示例视频', type: 'video' }] });
        const current = await site.visit({ chapter: '10', section: '11', title: '章 / 节' });
        assert.equal(current.sources[0].id, '21');
        assert.equal(await site.confirmed(current.sources[0]), true);
        site.close();
    });
    test(`${version} refuses resource index mismatch`, async () => {
        const { page } = environment(fixture(version));
        const site = new CourseSite(page, { id: '1' });
        site.units.set('11', { sources: [{ id: '21' }, { id: '22' }] });
        const current = await site.visit({ chapter: '10', section: '11', title: '示例' });
        assert.deepEqual(current.sources, []);
        assert.match(current.reason, /数量不一致/);
        site.close();
    });
}

test('hidden or conflicting markup is not treated as an active supported page', () => {
    assert.equal(environment(`<div hidden>${fixture('modern')}</div>${fixture('classic')}`).page.evaluate(layout), 'classic');
    assert.equal(environment(fixture('modern') + fixture('classic')).page.evaluate(layout), 'loading');
    assert.equal(environment('<div>loading</div>').page.evaluate(layout), 'loading');
});

test('knowledge point resources use their own identity and an unfinished resource stays pending', async () => {
    const section = fixture('modern', false);
    const point = '<ul class="level_3"><li><div class="level_3_title" id="id_12"><img src="xiangshang.svg"></div><div class="level_3_resourcelist"><div ng-repeat="source in pointItem.unitSource">知识点视频</div></div></li></ul>';
    const { page, document } = environment(section);
    document.querySelector('#id_11').parentElement.insertAdjacentHTML('beforeend', point);
    const site = new CourseSite(page, { id: '1' });
    site.units.set('12', { sources: [{ id: '22', type: 'video', title: '知识点视频' }] });
    const current = await site.visit({ chapter: '10', section: '11', point: '12', title: '知识点' });
    assert.equal(current.sources[0].id, '22');
    assert.equal(await site.confirmed(current.sources[0]), false);
    site.close();
});

test('modern chapter homework maps type 80 to its resource entry and opens the quiz popup', async () => {
    const html = fixture('modern', false).replace('示例视频</div>', '示例视频</div><div class="level_2_resourcelist_item" ng-repeat="source in sectionItem.unitSource" ng-click="goSource(source, \'section\')">第三章</div>');
    const popup = { waitForLoadState: async () => {} };
    let clicked;
    const { page } = environment(html, node => { clicked = node.textContent; page.emit('popup', popup); });
    page.waitForEvent = event => new Promise(resolve => page.once(event, resolve));
    const site = new CourseSite(page, { id: '1' });
    const unit = { chapter: '10', section: '11', title: '发展的基础 / 3.6 课后作业' };
    site.units.set('11', { sources: [normalizeSource({ id: 21, type: 10, title: '示例视频' }),
        normalizeSource({ id: 22, type: '80', title: '第三章', task_id: 30, finished: 0 })] });
    const current = await site.visit(unit);
    assert.equal(current.sources[1].type, 'quiz');
    assert.equal(current.sources[1].taskId, '30');
    assert.equal(current.sources[1].finished, false);
    const opened = await site.openResource(current.sources[1]);
    assert.equal(clicked, '第三章');
    assert.equal(opened.page, popup);
    assert.equal(opened.popup, true);
    site.close();
});
