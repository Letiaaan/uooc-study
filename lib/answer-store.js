const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { data } = require('./settings');
const { parseAnswers, formatAnswers } = require('./answer-format');

function removeAnswer(file, id, { directory = path.join(data, 'temp-answers') } = {}) {
    const root = path.resolve(directory), folder = path.resolve(path.dirname(file));
    if (path.dirname(folder) !== root || !/^quiz-[\w-]+$/.test(path.basename(folder))) throw new Error('临时答案路径不在指定目录中');
    if (!fs.existsSync(folder)) return;
    if (fs.lstatSync(folder).isSymbolicLink()) throw new Error('临时答案目录已变化，保留文件供核对');
    const names = ['reply.txt', 'answers.txt', 'paper.json'];
    if (fs.readdirSync(folder).some(name => !names.includes(name))) throw new Error('临时答案目录有其他文件，保留供核对');
    for (const name of names) {
        const target = path.join(folder, name);
        if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw new Error('临时答案文件已变化，保留供核对');
    }
    if (JSON.parse(fs.readFileSync(path.join(folder, 'paper.json'), 'utf8')).id !== id) throw new Error('临时答案测验标识不匹配');
    for (const name of names.filter(name => name !== 'paper.json')) fs.rmSync(path.join(folder, name), { force: true });
    fs.unlinkSync(path.join(folder, 'paper.json'));
    fs.rmdirSync(folder);
}

function saveAnswer(text, questions, { directory = path.join(data, 'temp-answers'), platform = 'web', id = randomUUID(), quizKey } = {}) {
    const answers = parseAnswers(text, questions);
    fs.mkdirSync(directory, { recursive: true });
    const folder = fs.mkdtempSync(path.join(directory, 'quiz-'));
    fs.writeFileSync(path.join(folder, 'reply.txt'), text, { encoding: 'utf8', flag: 'wx' });
    const file = path.join(folder, 'answers.txt');
    fs.writeFileSync(file, formatAnswers(questions, answers), { encoding: 'utf8', flag: 'wx' });
    fs.writeFileSync(path.join(folder, 'paper.json'), JSON.stringify({ id, quizKey, platform, numbers: questions.map(question => question.number), time: new Date().toISOString() }), { encoding: 'utf8', flag: 'wx' });
    return { file, answers: parseAnswers(fs.readFileSync(file, 'utf8'), questions), cleanup: () => removeAnswer(file, id, { directory }) };
}

module.exports = { saveAnswer, removeAnswer };
