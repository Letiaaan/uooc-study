let prompts;
async function ui() {
    if (!process.stdin.isTTY) throw new Error('请在交互式终端运行，或使用 --inspect --courses=all');
    prompts ||= await import('@inquirer/prompts');
    return prompts;
}

async function credentials(existing) {
    if (existing.username && existing.password) return existing;
    const { input, password } = await ui();
    return {
        username: existing.username || await input({ message: 'UOOC 手机号或邮箱', validate: value => value.trim() ? true : '请输入账号' }),
        password: existing.password || await password({ message: 'UOOC 密码', mask: '*', validate: value => value.length ? true : '请输入密码' })
    };
}

async function chooseCourses(courses, requested) {
    if (requested) {
        if (requested === 'all') return courses;
        const indices = [...new Set(requested.split(',').map(Number))];
        if (indices.some(index => !Number.isInteger(index) || index < 1 || index > courses.length)) {
            throw new Error('课程编号超出列表范围，请使用 --courses=1,2 或 --courses=all');
        }
        return indices.map(index => courses[index - 1]);
    }
    const { checkbox } = await ui();
    return checkbox({
        message: '空格选择课程，回车确认',
        required: true,
        choices: courses.map((course, index) => ({ name: `${index + 1}. ${course.title}`, value: course }))
    });
}

async function chooseMode(requested) {
    if (requested) return requested;
    const { select } = await ui();
    return select({ message: '本次操作', choices: [
        { name: '优先播放视频，受阻时处理测验', value: 'video' },
        { name: '仅查看目录与任务状态', value: 'inspect' },
        { name: '处理独立测验', value: 'quiz' },
        { name: '退出账号', value: 'logout' }
    ] });
}

function printReport(course, rows) {
    console.log(`\n${course.title} · 处理结果`);
    for (const row of rows) console.log(`  [${row.status}] ${row.title}${row.reason ? `：${row.reason}` : ''}`);
    const totals = {};
    for (const row of rows) totals[row.status] = (totals[row.status] || 0) + 1;
    console.log(Object.entries(totals).map(([status, count]) => `${status} ${count}`).join(' / ') || '目录中没有可识别资源');
}

module.exports = { credentials, chooseCourses, chooseMode, printReport };
