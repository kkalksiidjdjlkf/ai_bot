#!/usr/bin/env node
/**
 * WhatsApp бот — сервер Baileys
 * Пересылает сообщения на Python-сервер и получает ответы
 * Запуск: node wa_server.js
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');

const PYTHON_SERVER_PORT = 8765;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./wa_auth');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     '[Медиа]';

        const sender = msg.key.remoteJid;
        const phone = sender.split('@')[0];

        console.log(`\n📱 От ${phone}: ${text}`);

        try {
            // Отправляем на Python-сервер
            const net = require('net');
            const client = new net.Socket();

            await new Promise((resolve, reject) => {
                client.connect(PYTHON_SERVER_PORT, '127.0.0.1', () => {
                    client.write(JSON.stringify({ phone, text }));
                });
                client.setTimeout(5000);
                client.on('timeout', () => {
                    client.destroy();
                    reject(new Error('Timeout'));
                });
                client.on('data', async (data) => {
                    try {
                        const response = JSON.parse(data.toString());
                        if (response.text) {
                            await sock.sendMessage(sender, { text: response.text });
                            console.log(`✅ Ответ отправлен`);
                        }
                    } catch(e) {}
                    client.destroy();
                    resolve();
                });
                client.on('error', () => {
                    client.destroy();
                    resolve();
                });
            });
        } catch(e) {
            console.log(`⚠️ Ошибка отправки: ${e.message}`);
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 Отсканируйте QR-код в WhatsApp:');
            console.log('Нажмите на QR-код выше, чтобы открыть его');
            console.log('Или перейдите в WhatsApp > Связанные устройства > Привязка устройства\n');
        }

        if (connection === 'close') {
            const reason = new DisconnectReason(lastDisconnect?.error)?.output?.statusCode;
            console.log(`❌ Соединение потеряно. Причина: ${reason}`);
            if (reason === DisconnectReason.loggedOut) {
                console.log('Удалите папку wa_auth и перезапустите бота');
            } else {
                console.log('Переподключение через 5 секунд...');
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('\n✅ Подключено к WhatsApp! Бот активен.\n');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp().catch(err => {
    console.error('Критическая ошибка:', err);
});
