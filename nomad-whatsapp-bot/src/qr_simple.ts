/**
 * Простой скрипт для вывода QR кода
 */

import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

async function showQR() {
    console.log('\n📷 ========================================');
    console.log('📷  QR КОД ДЛЯ WHATSAPP');
    console.log('📷 ========================================\n');
    console.log('📱 На телефоне: Настройки → Подключенные устройства → Подключить устройство');
    console.log('👇 QR-код появится ниже:\n');

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info/');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    let qrShown = false;

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr && !qrShown) {
            qrShown = true;
            console.log('\n⏱ У вас есть 2 минуты на сканирование!\n');
            console.log('====================');
            qrcode.generate(qr, { small: true });
            console.log('====================\n');
            console.log('📲 Сканируйте сейчас!\n');
        }

        if (connection === 'open') {
            console.log('\n✅ УСПЕШНО ПОДКЛЮЧЕНО!');
            console.log('💬 Бот готов к работе!');
            console.log('\nТеперь запустите: npm start\n');
            process.exit(0);
        }

        if (connection === 'close') {
            const reason = new (require('@hapi/boom').Boom)(update.lastDisconnect?.error)?.output?.statusCode;
            
            if (reason === DisconnectReason.connectionClosed) {
                console.log('\n🔄 Соединение закрыто. Перезапуск...\n');
            } else if (reason === DisconnectReason.connectionLost) {
                console.log('\n📡 Соединение потеряно. Перезапуск...\n');
            } else {
                console.log('\n❌ Ошибка подключения. Попробуйте снова: npm run qr\n');
                process.exit(1);
            }
        }
    });

    // Таймаут через 2 минуты
    setTimeout(() => {
        if (!qrShown) {
            console.log('\n⏰ QR код не появился. Перезапустите: npm run qr\n');
            process.exit(1);
        } else {
            console.log('\n⏰ Время вышло. Перезапустите: npm run qr\n');
            process.exit(0);
        }
    }, 120000);
}

showQR().catch(err => {
    console.error('❌ Ошибка:', err.message);
    console.error(err.stack);
    process.exit(1);
});