const { navigate } = require('./browser');
const { ensureRendered } = require('./window-rendering');

const types = { 10: 'video', 50: 'attachment', 60: 'text', 70: 'discussion', 80: 'quiz' };
const unitKey = unit => String(unit.point || unit.section);

function flattenCatalog(chapters) {
    const units = [];
    for (const chapter of chapters) {
        for (const section of chapter.children || []) {
            const base = { chapter: String(chapter.id), section: String(section.id), title: `${chapter.name} / ${section.name}` };
            units.push(base);
            for (const point of section.children || []) {
                units.push({ ...base, point: String(point.id), title: `${base.title} / ${point.name}` });
            }
        }
    }
    return units;
}

function normalizeSource(source) {
    return {
        id: source.id == null ? '' : String(source.id), type: types[Number(source.type)] || 'unknown',
        title: String(source.title || source.name || types[Number(source.type)] || '未知资源'),
        finished: source.finished === true || Number(source.finished) === 1,
        task: Number(source.is_task) === 1,
        position: Number(source.video_pos) || 0,
        taskId: source.task_id ? String(source.task_id) : null
    };
}

function layout() {
    const displayed = selector => [...document.querySelectorAll(selector)].some(node => node.getClientRects().length);
    const modern = displayed('.level_1_title[id]');
    const classic = displayed('.catalogItem > .basic.chapter');
    if (modern && !classic) return 'modern';
    if (classic && !modern) return 'classic';
    return 'loading';
}

class CourseSite {
    constructor(page, course) {
        this.page = page;
        this.course = course;
        this.chapters = [];
        this.units = new Map();
        this.completions = new Set();
        this.pending = new Set();
        this.response = response => {
            const work = this.observe(response).catch(() => {});
            this.pending.add(work);
            work.finally(() => this.pending.delete(work));
        };
        page.on('response', this.response);
    }

    async observe(response) {
        const address = new URL(response.url());
        if (address.hostname !== 'www.uooc.net.cn' || !response.ok()) return;
        if (!['/home/learn/getCatalogList', '/home/learn/getUnitLearn', '/home/learn/markVideoLearn'].includes(address.pathname)) return;
        const params = Object.fromEntries(address.searchParams);
        try { Object.assign(params, response.request().postDataJSON() || {}); } catch {}
        if (params.cid && String(params.cid) !== this.course.id) return;
        const body = await response.json();
        if (address.pathname.endsWith('/getCatalogList')) {
            if (Number(body.code) === 1 && Array.isArray(body.data)) this.chapters = body.data;
        } else if (address.pathname.endsWith('/getUnitLearn')) {
            const key = String(params.subsection_id && Number(params.subsection_id) ? params.subsection_id : params.section_id || params.catalog_id || '');
            if (key) this.units.set(key, Number(body.code) === 1 && Array.isArray(body.data)
                ? { sources: body.data.map(normalizeSource) }
                : { sources: [], reason: String(body.msg || '网站未返回资源列表') });
            if (Number(body.code) === 1 && Array.isArray(body.data)) {
                for (const source of body.data.map(normalizeSource)) {
                    if (source.finished && source.id) this.completions.add(source.id);
                    else this.completions.delete(source.id);
                }
            }
        } else if (Number(body.code) === 1 && Number(body.data?.finished) === 1 && params.resource_id) {
            this.completions.add(String(params.resource_id));
        }
    }

    async wait(predicate, message, timeout = 12000) {
        const until = Date.now() + timeout;
        while (Date.now() < until) {
            await Promise.all([...this.pending]);
            if (await predicate()) return;
            if (this.page.isClosed()) throw new Error('课程窗口已关闭');
            await this.page.waitForTimeout(300);
        }
        throw new Error(message);
    }

    async open() {
        await navigate(this.page, this.course.url);
        if (!new URL(this.page.url()).pathname.includes('/home/learn/')) {
            const learn = this.page.getByRole('link', { name: /^(开始学习|继续学习)$/ }).first();
            await learn.waitFor({ state: 'visible', timeout: 15000 });
            const href = await learn.getAttribute('href');
            const address = href ? new URL(href, this.page.url()) : null;
            if (address?.origin === 'https://www.uooc.net.cn' && address.pathname.startsWith('/home/learn/')) await navigate(this.page, address.href);
            else await learn.click();
        }
        await Promise.all([...this.pending]);
        if (!this.chapters.length && await this.page.evaluate(layout) !== 'loading') {
            // Reopening the same SPA route may not request the catalog again.
            // Reload the course document once so this new observer sees it.
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        await this.wait(async () => await this.page.evaluate(layout) !== 'loading' && this.chapters.length,
            '课程目录加载未完成，或此页面结构尚待适配');
        this.version = await this.page.evaluate(layout);
        console.log(`识别到${this.version === 'modern' ? '新版' : '旧版'}页面，共 ${this.chapters.length} 章。`);
        return flattenCatalog(this.chapters);
    }

    async heading(id, level) {
        await ensureRendered(this.page);
        if (!/^\d+$/.test(id)) throw new Error('目录标识不符合网站当前格式');
        const version = await this.page.evaluate(layout);
        if (version === 'loading') throw new Error('目录正在变化或当前页面需要人工处理');
        this.version = version;
        const selector = version === 'modern' ? `[id="id_${id}"]`
            : `[id="${id}"] > [ng-click]`;
        const node = this.page.locator(selector).first();
        await node.waitFor({ state: 'visible', timeout: 10000 });
        const expanded = () => node.evaluate(element => Boolean(element.querySelector('img[src*="xiangshang"], .icon-xiangshang:not(.icon-xiangxia)')));
        if (!await expanded()) {
            await node.click();
            await this.page.waitForTimeout(400);
            if (!await expanded() && await node.locator('img[src*="xiangxia"], .icon-xiangxia').count()) await node.click();
        }
        await this.page.waitForTimeout(400);
        return node.locator('..');
    }

    async visit(unit) {
        await this.heading(unit.chapter, 1);
        const section = await this.heading(unit.section, 2);
        this.container = unit.point ? await this.heading(unit.point, 3) : section;
        this.unit = unit;
        await this.wait(() => this.units.has(unitKey(unit)), `尚未读到 ${unit.title} 的网站资源状态`);
        const current = this.units.get(unitKey(unit));
        if (current.reason) return current;
        const selector = this.version === 'modern'
            ? `:scope > .level_${unit.point ? 3 : 2}_resourcelist > [ng-repeat="source in ${unit.point ? 'pointItem' : 'sectionItem'}.unitSource"]`
            : ':scope > .resourcelist > .basic[ng-repeat]';
        this.resourceSelector = selector;
        // 网站数据包含附件聚合及用户权限过滤，只有页面实际提供的入口可操作。
        const sources = current.sources.map((source, index) => ({ ...source, index, unit }));
        if (sources.some(source => !/^\d+$/.test(source.id))) return { sources: [], reason: '网站返回的资源标识尚未识别' };
        let count = await this.container.locator(selector).count();
        for (let tick = 0; count !== sources.length && tick < 10; tick++) {
            await this.page.waitForTimeout(300);
            count = await this.container.locator(selector).count();
        }
        if (count !== sources.length && sources.length) {
            return { sources: [], reason: '网站资源与可见入口数量不一致，请核对课程权限或等待页面加载' };
        }
        return { sources };
    }

    async openResource(source) {
        const current = await this.visit(source.unit);
        if (current.reason) throw new Error(current.reason);
        const actual = current.sources.find(item => item.id === source.id);
        if (!actual) throw new Error('当前节点的资源列表已变化');
        const control = this.container.locator(this.resourceSelector).nth(actual.index);
        if (source.type === 'quiz' && this.version === 'modern') {
            const opened = this.page.waitForEvent('popup', { timeout: 15000 });
            const [quiz] = await Promise.all([opened, control.click()]);
            await quiz.waitForLoadState('domcontentloaded');
            return { page: quiz, popup: true };
        }
        await control.click();
        if (source.type === 'video') {
            await this.page.locator('video').first().waitFor({ state: 'visible', timeout: 15000 });
            await this.wait(() => this.page.url().split('#')[1]?.split('/').includes(source.id), '视频资源切换尚未确认');
        }
        return { page: this.page, popup: false };
    }

    async confirmed(source) {
        await Promise.all([...this.pending]);
        if (this.completions.has(source.id)) return true;
        if (this.unit && unitKey(source.unit) === unitKey(this.unit)) {
            const control = this.container.locator(this.resourceSelector).nth(source.index);
            return control.evaluate(element => element.classList.contains('complete') || Boolean(element.querySelector('[ng-if*="source.finished"]'))).catch(() => false);
        }
        return false;
    }

    async refreshUnit(unit) {
        // 通过网站自己的路由重新加载资源，确认测验结果或播放完成状态。
        this.units.delete(unitKey(unit));
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        if (new URL(this.page.url()).pathname.startsWith('/user/login')) throw new Error('登录已过期，请重新启动并登录');
        await this.wait(async () => await this.page.evaluate(layout) !== 'loading', '刷新后尚未确认目录状态');
        return this.visit(unit);
    }

    close() { this.page.off('response', this.response); }
}

module.exports = { CourseSite, flattenCatalog, normalizeSource, layout, unitKey };
