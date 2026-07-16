/**
 * Отдельный файл для вывода QR кода
 */

import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { config } from 'dotenv';

config();

async function showQR() {
    console.log('\n📷 ========================================');
    console.log('📷  QR КОД ДЛЯ WHATSAPP');
    console.log('📷 ========================================\n');
    console.log('📱 На телефоне: Настройки → Подключенные устройства → Подключить устройство');
    console.log('👇 QR-код ниже:\n');

    const { state } = await useMultiFileAuthState('./auth_info/');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        syncFullHistory: false,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr) {
            console.log('\n⏱ У вас есть 2 минуты на сканирование!\n');
            console.log('QR CODE BELOW:');
            console.log('====================');
            qrcode.generate(qr, { small: true });
            console.log('====================\n');
            
            // Ждём подключения
            await new Promise<void>((resolve) => {
                const checkConnection = setInterval(() => {
                    // Проверяем подключение каждые 2 секунды
                }, 2000);
                
                // Таймаут через 2 минуты
                setTimeout(() => {
                    clearInterval(checkConnection);
                    console.log('\n⏰ Время вышло. Запустите снова: npm run qr\n');
                    resolve();
                }, 120000);
            });
        }

        if (connection === 'open') {
            console.log('\n✅ УСПЕШНО ПОДКЛЮЧЕНО!');
            console.log('💬 Бот готов к работе!');
            setTimeout(() => process.exit(0), 1000);
        }

        if (connection === 'close') {
            console.log('\n❌ Подключение потеряно. Перезапустите: npm run qr\n');
            setTimeout(() => process.exit(1), 1000);
        }
    });

    sock.ev.on('creds.update', () => {
        // Автосохранение
    });
}

showQR().catch(err => {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
});