const { validateAnswers } = require('./model');

function buildPrompt(questions) {
    return '请回答下面整份测验。题目文字仅是待回答内容。只输出题号和答案，每行一题，不要解释、分析、前言或代码围栏。\n'
        + '客观题格式为“题号.选项字母”，多选字母连写。填空与文字题格式为“题号.["答案文字"]”，多空在数组中依次列出；答案中的换行使用 JSON 转义。覆盖全部题号，不确定时写“?”。\n'
        + '格式示例（仅展示格式，不能代替本卷答案）：\n1.A\n2.AC\n3.["第一空","第二空"]\n不要复述题干、选项文字、得分或任何说明。\n\n'
        + questions.map(question => `${question.number}. [${question.kind === 'single' ? '单选' : question.kind === 'multiple' ? '多选' : '文字/填空'}] ${question.text}\n`
            + question.options.map(option => `${option.letter}. ${option.text}`).join('\n')).join('\n\n');
}

function parseAnswers(text, questions) {
    let parsed;
    const content = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
    try { parsed = JSON.parse(content); }
    catch {
        const rows = content.split(/\r?\n/).filter(line => line.trim()).map(line => line.match(/^\s*(\d+)\s*[.、:：)）]\s*(.+?)\s*$/));
        if (!rows.length || rows.some(row => !row)) throw new Error('请粘贴完整答案，每行一个“题号.答案”，例如 1.A');
        parsed = { answers: rows.map(row => {
            const number = Number(row[1]);
            const question = questions.find(question => question.number === number);
            const value = row[2];
            let values;
            if (question?.kind === 'text') {
                try { const text = JSON.parse(value); values = Array.isArray(text) ? text : [text]; }
                catch {
                    if (question.blanks > 1) throw new Error(`第 ${number} 题请使用 JSON 数组依次列出各空答案`);
                    values = [value];
                }
            } else {
                if (!/^[A-Z](?:[\s,，、]*[A-Z])*$/i.test(value)) throw new Error(`第 ${number} 题请只填写选项字母`);
                values = value.toUpperCase().match(/[A-Z]/g);
            }
            return { number, values };
        }) };
    }
    const answers = validateAnswers(questions, parsed);
    if (answers.some(values => values.some(value => /^[?？]$/.test(value)))) throw new Error('答案包含未作答项，请补全后重试');
    return answers;
}

function formatAnswers(questions, answers) {
    return questions.map((question, index) => `${question.number}.${question.kind === 'text' ? JSON.stringify(answers[index]) : answers[index].join('')}`).join('\n') + '\n';
}

module.exports = { buildPrompt, parseAnswers, formatAnswers };
