const fs = require('node:fs');
const path = require('node:path');
const { data, makeDataDirectory } = require('./settings');

class Journal {
    constructor(course) {
        makeDataDirectory();
        this.file = path.join(data, `course-${course.id}.jsonl`);
        this.latest = new Map();
        if (fs.existsSync(this.file)) {
            for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
                try { const event = JSON.parse(line); this.latest.set(event.id, event); } catch {}
            }
        }
    }

    record(source, status, details = {}) {
        const event = {
            id: source.id, title: source.title, unit: source.unit, status,
            ...details, time: new Date().toISOString()
        };
        fs.appendFileSync(this.file, JSON.stringify(event) + '\n', 'utf8');
        this.latest.set(source.id, event);
        return event;
    }

    resumeUnit() {
        return [...this.latest.values()].filter(event => ['播放中', '视频待处理', '播放结束待确认'].includes(event.status))
            .sort((a, b) => b.time.localeCompare(a.time))[0]?.unit;
    }
}

module.exports = { Journal };
