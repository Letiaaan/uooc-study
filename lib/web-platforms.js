const platforms = {
    doubao: { name: '豆包', url: 'https://www.doubao.com/chat/', loginRequired: false,
        editor: '[data-testid="chat_input_input"] [contenteditable="true"]',
        send: '[data-testid="chat_input_send_button"]', newChat: null, newChatName: /^新对话/ },
    qianwen: { name: '千问', url: 'https://www.qianwen.com/', loginRequired: true,
        editor: '[data-slate-editor="true"][contenteditable="true"]',
        send: '[data-session-switch-target="send-query"]', newChat: '[data-session-switch-target="new-chat"]' },
    deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/', home: 'https://www.deepseek.com/', loginRequired: true,
        editor: 'textarea', sendName: /^(发送|发送消息|Send message|Send)$/i, newChatName: /^(开启新对话|新对话|New chat)/i }
};

function platform(id) {
    if (!Object.hasOwn(platforms, id)) throw new Error('请选择豆包、千问或 DeepSeek 网页');
    return platforms[id];
}

module.exports = { platforms, platform };
