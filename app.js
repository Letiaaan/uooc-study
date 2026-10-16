const { parseArgs } = require('node:util');

async function main() {
    const { values } = parseArgs({ options: {
        help: { type: 'boolean', short: 'h' }, check: { type: 'boolean' },
        inspect: { type: 'boolean' }, logout: { type: 'boolean' },
        gui: { type: 'boolean' }, cli: { type: 'boolean' }, 'no-open': { type: 'boolean' },
        courses: { type: 'string' }, mode: { type: 'string' }
    } });
    if (values.help) {
        console.log('UOOC Study\n\nnode app.js                         打开本地界面\nnode app.js --gui [--no-open]        启动界面服务\nnode app.js --cli                   命令行交互\nnode app.js [--inspect] [--courses=all|1,2] [--mode=video|quiz] [--logout] [--check]\n\n首次登录请在浏览器完成验证。--check 只检查本地运行环境。');
        return;
    }
    const { home } = require('./lib/settings');
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('请使用 Node.js 24');
    if (values.check) {
        const { chromium } = require('playwright');
        await import('@inquirer/prompts');
        require('node:fs').accessSync(require('node:path').join(__dirname, 'ui', 'index.html'));
        console.log(`UOOC Study ${require('./package.json').version}\nNode.js ${process.versions.node}\nPlaywright ${require('playwright/package.json').version}\n配置与记录目录：${home}\n运行环境检查通过；浏览器在开始学习时准备。`);
        return;
    }
    if (values.gui || (!values.cli && !values.inspect && !values.logout && !values.mode && !values.courses)) {
        await require('./lib/gui').startGUI({ open: !values['no-open'] });
        return;
    }
    const requested = values.logout ? 'logout' : values.inspect ? 'inspect' : values.mode;
    if (requested && !['video', 'quiz', 'inspect', 'logout'].includes(requested)) throw new Error('mode 可选 video、quiz 或 inspect');
    const { chooseMode, chooseCourses } = require('./lib/console');
    const { openBrowser } = require('./lib/browser');
    const { ensureLogin, listCourses, signOut } = require('./lib/auth');
    const { runCourse } = require('./lib/runner');
    const mode = await chooseMode(requested);
    let context;
    let cancelled = false;
    const stop = () => {
        cancelled = true;
        console.log('\n正在保存浏览器会话并退出……');
        if (context) context.close().catch(() => {});
    };
    process.once('SIGINT', stop);
    try {
        context = await openBrowser();
        if (cancelled) return;
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        if (mode === 'logout') { await signOut(context, page); return; }
        await ensureLogin(page);
        const courses = await listCourses(page);
        if (!courses.length) throw new Error('尚未找到可进入的课程，请在课程中心核对选课和访问权限');
        courses.forEach((course, index) => console.log(`${index + 1}. ${course.title}`));
        const selected = await chooseCourses(courses, values.courses);
        for (const course of selected) {
            if (cancelled) break;
            try { await runCourse(page, course, mode); }
            catch (error) {
                if (cancelled || page.isClosed()) break;
                console.error(`课程暂未完成：${error.message}`);
            }
        }
    } catch (error) {
        if (!cancelled) throw error;
    } finally {
        process.removeListener('SIGINT', stop);
        if (context) await context.close().catch(() => {});
    }
}

if (require.main === module) main().catch(error => {
    if (error.name === 'ExitPromptError') console.log('已退出。');
    else { console.error(`运行停止：${error.message}`); process.exitCode = 1; }
});

module.exports = { main };
