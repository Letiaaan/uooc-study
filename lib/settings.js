const fs = require('node:fs');
const path = require('node:path');

const home = process.env.UOOC_STUDY_HOME || path.resolve(__dirname, '..');
const data = path.join(home, 'data');
const origin = 'https://www.uooc.net.cn';
let runtime = {};

function settings() {
    const file = path.join(home, 'config.txt');
    const values = {};
    if (fs.existsSync(file)) {
        for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const separator = line.indexOf('=');
            if (separator > 0) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
        }
    }
    return { ...{
        username: values.USERNAME || process.env.UOOC_USERNAME || '',
        password: values.PASSWORD || process.env.UOOC_PASSWORD || '',
        browser: (values.BROWSER || 'auto').toLowerCase(),
        key: values.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '',
        model: values.MODEL || 'deepseek-chat',
        endpoint: (values.BASE_URL || 'https://api.deepseek.com').replace(/\/(?:chat\/completions)?\/?$/, ''),
        provider: values.ANSWER_PROVIDER || 'web',
        webPlatform: values.WEB_PLATFORM || 'doubao',
        webLogin: values.WEB_LOGIN || 'guest',
        webAutomation: values.WEB_AUTOMATION || 'auto'
    }, ...runtime };
}

function setRuntimeSettings(values) { runtime = { ...runtime, ...values }; }

function makeDataDirectory() {
    fs.mkdirSync(data, { recursive: true });
}

module.exports = { home, data, origin, settings, makeDataDirectory, setRuntimeSettings };
