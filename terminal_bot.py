#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Терминальный и WhatsApp интерфейс для симулятора медицинского бота.
Запуск:
  - Терминал:    python bot_server.py terminal
  - WhatsApp:    python bot_server.py whatsapp
  - Оба режима:  python bot_server.py (или просто python bot_server.py)
"""

import sys
import os
import json
import asyncio
import socket
import threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bot_logic_v2 import MedicalBot
from booking_store import _booking_store


# === Состояние диалогов ===
sessions = {}


def get_or_create_session(phone: str) -> MedicalBot:
    if phone not in sessions:
        sessions[phone] = MedicalBot(session_id=phone)
    else:
        sessions[phone].session_id = phone
    return sessions[phone]


def format_response(response: str) -> str:
    if not response:
        return ""
    lines = response.strip().split('\n')
    return '\n\n'.join(line.strip() for line in lines if line.strip())


def process_bot_message(text: str, phone: str = "terminal") -> str:
    bot = get_or_create_session(phone)
    response = bot.process_message(text)
    return format_response(response)


# === Утилиты ===

def print_banner():
    print("\n" + "=" * 50)
    print("🏥 Nomad Clinic — Симулятор бота")
    print("Введите сообщение для общения с ботом.")
    print("Команды:")
    print("  /reset   — начать диалог заново")
    print("  /stats   — показать статистику записей")
    print("  /quit    — выйти")
    print("=" * 50 + "\n")


def print_stats():
    stats = _booking_store.get_stats()
    print("\n📊 Статистика:")
    print(f"  Всего записей:     {stats['total']}")
    print(f"  Подтверждено:      {stats['confirmed']}")
    print(f"  Отменено:          {stats['cancelled']}")
    print("\n  По услугам:")
    for name, count in stats.get('by_service', {}).items():
        print(f"    {name}: {count}")
    print()


# === Терминальный режим ===

def run_terminal():
    bot = MedicalBot(session_id="terminal")
    print_banner()
    greeting = bot.get_greeting()
    print(f"🤖 {greeting}")

    while True:
        try:
            user_input = input("\n👤 ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nДо свидания!")
            break

        if not user_input:
            continue

        if user_input.lower() in ["/quit", "/exit", "/выход"]:
            print("До свидания!")
            break

        if user_input.lower() == "/reset":
            bot.reset()
            greeting = bot.get_greeting()
            print(f"🤖 {greeting}")
            continue

        if user_input.lower() == "/stats":
            print_stats()
            continue

        response = bot.process_message(user_input)
        print(f"\n🤖 {response}")


# === WhatsApp сервер (сокет) ===

async def run_whatsapp_server():
    import socket

    HOST = '127.0.0.1'
    PORT = 8765

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen()

    print(f"\n📡 WhatsApp сервер запущен на {HOST}:{PORT}")
    print("Ожидание подключений от Node.js...\n")

    while True:
        try:
            client, addr = server.accept()
            print(f"🔗 Подключение от {addr}")

            data = b""
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                data += chunk
                try:
                    msg = json.loads(data)
                    break
                except json.JSONDecodeError:
                    continue

            phone = msg.get("phone", "unknown")
            text = msg.get("text", "")
            print(f"📱 {phone}: {text}")

            response = process_bot_message(text, phone)
            print(f"✅ Ответ: {response[:80]}...")

            client.sendall(json.dumps({"text": response}, ensure_ascii=False).encode('utf-8'))
            client.close()

        except Exception as e:
            print(f"❌ Ошибка: {e}")


# === Запуск ===

def main():
    args = sys.argv[1:] if len(sys.argv) > 1 else []

    if "whatsapp" in args:
        # Только WhatsApp
        asyncio.run(run_whatsapp_server())
    elif "terminal" in args:
        # Только терминал
        run_terminal()
    else:
        # Оба режима
        print_banner()
        print("🖥️  Режим: терминал + WhatsApp сервер")
        print("Откройте новый терминал и запустите: node wa_bot/wa_server.js")
        print()

        # Запускаем WhatsApp сервер в фоне
        ws_thread = threading.Thread(target=lambda: asyncio.run(run_whatsapp_server()), daemon=True)
        ws_thread.start()

        # Даем время серверу подняться
        import time
        time.sleep(1)

        # Терминальный режим
        bot = MedicalBot(session_id="terminal")
        greeting = bot.get_greeting()
        print(f"🤖 {greeting}")

        while True:
            try:
                user_input = input("\n👤 ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nДо свидания!")
                break

            if not user_input:
                continue

            if user_input.lower() in ["/quit", "/exit", "/выход"]:
                print("До свидания!")
                break

            if user_input.lower() == "/reset":
                bot.reset()
                greeting = bot.get_greeting()
                print(f"🤖 {greeting}")
                continue

            if user_input.lower() == "/stats":
                print_stats()
                continue

            response = bot.process_message(user_input)
            print(f"\n🤖 {response}")


if __name__ == '__main__':
    main()
