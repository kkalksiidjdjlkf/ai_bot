#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Flask-сервер для веб-интерфейса симулятора бота.
Запуск: python web_server.py
Открыть: http://localhost:5000
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, render_template_string, request, jsonify
from bot_logic_v2 import MedicalBot

app = Flask(__name__)

# Хранилище сессий: session_id -> MedicalBot
sessions: dict = {}

TEMPLATE = """
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nomad Clinic — Симулятор бота</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: linear-gradient(135deg, #1a73e8, #0d47a1);
            color: white;
            padding: 12px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            z-index: 10;
        }
        .header h1 { font-size: 18px; font-weight: 600; }
        .header-actions { display: flex; gap: 8px; }
        .header-actions button {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            padding: 6px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            transition: background 0.2s;
        }
        .header-actions button:hover { background: rgba(255,255,255,0.35); }
        .container {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        .chat-panel {
            flex: 1;
            display: flex;
            flex-direction: column;
            max-width: 800px;
            margin: 0 auto;
            width: 100%;
        }
        .stats-panel {
            width: 280px;
            background: white;
            border-left: 1px solid #e0e0e0;
            padding: 16px;
            overflow-y: auto;
            display: none;
        }
        .stats-panel.visible { display: block; }
        .stats-panel h3 { font-size: 14px; color: #1a73e8; margin-bottom: 12px; }
        .stat-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
            font-size: 13px;
        }
        .stat-row .label { color: #666; }
        .stat-row .value { font-weight: 600; color: #333; }
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .message {
            max-width: 80%;
            padding: 10px 16px;
            border-radius: 18px;
            font-size: 14px;
            line-height: 1.5;
            word-wrap: break-word;
            white-space: pre-wrap;
            animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .message.bot {
            align-self: flex-start;
            background: white;
            color: #333;
            border-bottom-left-radius: 4px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .message.user {
            align-self: flex-end;
            background: #1a73e8;
            color: white;
            border-bottom-right-radius: 4px;
        }
        .message.system {
            align-self: center;
            background: #fff3e0;
            color: #e65100;
            font-size: 12px;
            padding: 6px 14px;
            border-radius: 12px;
        }
        .chat-input-area {
            padding: 12px 20px;
            background: white;
            border-top: 1px solid #e0e0e0;
            display: flex;
            gap: 10px;
            align-items: center;
        }
        .chat-input-area input {
            flex: 1;
            padding: 12px 18px;
            border: 1px solid #ddd;
            border-radius: 24px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
        }
        .chat-input-area input:focus { border-color: #1a73e8; }
        .chat-input-area button {
            background: #1a73e8;
            color: white;
            border: none;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        .chat-input-area button:hover { background: #1557b0; }
        .quick-actions {
            padding: 8px 20px;
            background: white;
            border-top: 1px solid #f0f0f0;
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .quick-actions button {
            background: #f0f2f5;
            border: 1px solid #e0e0e0;
            padding: 6px 12px;
            border-radius: 16px;
            cursor: pointer;
            font-size: 12px;
            color: #555;
            transition: all 0.2s;
        }
        .quick-actions button:hover {
            background: #e8f0fe;
            border-color: #1a73e8;
            color: #1a73e8;
        }
        .typing-indicator {
            align-self: flex-start;
            padding: 10px 16px;
            background: white;
            border-radius: 18px;
            border-bottom-left-radius: 4px;
            display: none;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .typing-indicator span {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #bbb;
            border-radius: 50%;
            margin: 0 2px;
            animation: typing 1.4s infinite;
        }
        .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
        .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing {
            0%, 60%, 100% { transform: translateY(0); }
            30% { transform: translateY(-6px); }
        }
        .session-info {
            font-size: 11px;
            opacity: 0.7;
        }
        @media (max-width: 768px) {
            .stats-panel { display: none !important; }
            .message { max-width: 90%; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>🏥 Nomad Clinic — Симулятор</h1>
            <div class="session-info">Сессия: <span id="sessionId">—</span></div>
        </div>
        <div class="header-actions">
            <button onclick="toggleStats()">📊 Статистика</button>
            <button onclick="newDialog()">🔄 Новый диалог</button>
        </div>
    </div>
    <div class="container">
        <div class="chat-panel">
            <div class="chat-messages" id="chatMessages">
                <div class="message system">Загрузка...</div>
            </div>
            <div class="typing-indicator" id="typingIndicator">
                <span></span><span></span><span></span>
            </div>
            <div class="quick-actions">
                <button onclick="sendQuick('Привет')">👋 Привет</button>
                <button onclick="sendQuick('Сколько стоит МРТ?')">💰 МРТ цена</button>
                <button onclick="sendQuick('Болит поясница')">🩺 Боль в спине</button>
                <button onclick="sendQuick('Где вы находитесь?')">📍 Адрес</button>
                <button onclick="sendQuick('Какой график работы?')">🕐 График</button>
                <button onclick="sendQuick('Какие есть акции?')">🎁 Акции</button>
                <button onclick="sendQuick('Кто врачи?')">👨‍⚕️ Врачи</button>
            </div>
            <div class="chat-input-area">
                <input type="text" id="messageInput" placeholder="Введите сообщение..." 
                       onkeydown="if(event.key==='Enter') sendMessage()">
                <button onclick="sendMessage()">➤</button>
            </div>
        </div>
        <div class="stats-panel" id="statsPanel">
            <h3>📊 Статистика</h3>
            <div id="statsContent">
                <div class="stat-row">
                    <span class="label">Записей:</span>
                    <span class="value" id="statTotal">0</span>
                </div>
                <div class="stat-row">
                    <span class="label">Подтверждено:</span>
                    <span class="value" id="statConfirmed">0</span>
                </div>
                <div class="stat-row">
                    <span class="label">Отменено:</span>
                    <span class="value" id="statCancelled">0</span>
                </div>
                <div id="statByService"></div>
            </div>
        </div>
    </div>

    <script>
        let bot = null;
        let sessionId = null;

        async function init() {
            try {
                const resp = await fetch('/api/init');
                const data = await resp.json();
                sessionId = data.session_id;
                document.getElementById('sessionId').textContent = sessionId;
                bot = data.bot_session;
                addMessage(data.greeting, 'bot');
                updateStats();
            } catch(e) {
                addMessage('❌ Ошибка инициализации: ' + e.message, 'system');
            }
        }

        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            addMessage(text, 'user');
            await processMessage(text);
        }

        async function sendQuick(text) {
            addMessage(text, 'user');
            await processMessage(text);
        }

        async function processMessage(text) {
            const typing = document.getElementById('typingIndicator');
            typing.style.display = 'block';
            scrollChat();
            
            try {
                const resp = await fetch('/api/message', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({session_id: sessionId, message: text})
                });
                const data = await resp.json();
                typing.style.display = 'none';
                if (data.error) {
                    addMessage('❌ ' + data.error, 'system');
                } else {
                    addMessage(data.response, 'bot');
                }
            } catch(e) {
                typing.style.display = 'none';
                addMessage('❌ Ошибка: ' + e.message, 'system');
            }
        }

        function addMessage(text, type) {
            const container = document.getElementById('chatMessages');
            const div = document.createElement('div');
            div.className = 'message ' + type;
            div.textContent = text;
            container.appendChild(div);
            scrollChat();
        }

        function scrollChat() {
            const container = document.getElementById('chatMessages');
            container.scrollTop = container.scrollHeight;
        }

        async function newDialog() {
            try {
                await fetch('/api/reset', {method: 'POST', headers: {'Content-Type': 'application/json'}});
                document.getElementById('chatMessages').innerHTML = '<div class="message system">Диалог сброшен</div>';
                await init();
            } catch(e) {
                addMessage('❌ Ошибка: ' + e.message, 'system');
            }
        }

        async function toggleStats() {
            const panel = document.getElementById('statsPanel');
            panel.classList.toggle('visible');
            if (panel.classList.contains('visible')) {
                await updateStats();
            }
        }

        async function updateStats() {
            try {
                const resp = await fetch('/api/stats');
                const data = await resp.json();
                document.getElementById('statTotal').textContent = data.total;
                document.getElementById('statConfirmed').textContent = data.confirmed;
                document.getElementById('statCancelled').textContent = data.cancelled;
                
                const svcDiv = document.getElementById('statByService');
                svcDiv.innerHTML = '<h3 style="margin-top:16px">По услугам</h3>';
                for (const [name, count] of Object.entries(data.by_service || {})) {
                    svcDiv.innerHTML += `
                        <div class="stat-row">
                            <span class="label">${name}</span>
                            <span class="value">${count}</span>
                        </div>`;
                }
            } catch(e) {}
        }

        // Инициализация при загрузке
        init();
    </script>
</body>
</html>
"""


@app.route('/')
def index():
    return render_template_string(TEMPLATE)


@app.route('/api/init', methods=['GET'])
def api_init():
    import uuid
    session_id = str(uuid.uuid4())[:8]
    bot = MedicalBot(session_id=session_id)
    return jsonify({
        'session_id': session_id,
        'greeting': bot.get_greeting(),
        'bot_session': 'initialized'
    })


@app.route('/api/message', methods=['POST'])
def api_message():
    data = request.get_json()
    session_id = data.get('session_id', 'default')
    message = data.get('message', '')

    if session_id not in sessions:
        sessions[session_id] = MedicalBot(session_id=session_id)
    else:
        sessions[session_id].session_id = session_id

    bot = sessions[session_id]
    response = bot.process_message(message)
    return jsonify({'response': response})


@app.route('/api/reset', methods=['POST'])
def api_reset():
    data = request.get_json()
    session_id = data.get('session_id', 'default')
    if session_id in sessions:
        sessions[session_id].reset()
    return jsonify({'status': 'ok'})


@app.route('/api/stats', methods=['GET'])
def api_stats():
    from booking_store import _booking_store
    return jsonify(_booking_store.get_stats())


if __name__ == '__main__':
    print("\n" + "="*50)
    print("🏥 Nomad Clinic — Симулятор бота")
    print("📍 Откройте: http://localhost:5000")
    print("="*50 + "\n")
    app.run(host='0.0.0.0', port=5000, debug=True)
