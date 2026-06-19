#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Терминальный симулятор медицинского бота Nomad Clinic.
Запуск: python terminal_bot.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bot_logic_v2 import MedicalBot
from booking_store import _booking_store


def print_banner():
    print("\n" + "=" * 50)
    print("🏥 Nomad Clinic — Терминальный бот")
    print("=" * 50)
    print("\nВведите сообщение для общения с ботом.")
    print("\nКоманды:")
    print("  /reset   — начать диалог заново")
    print("  /stats   — показать статистику записей")
    print("  /quit    — выйти")
    print("=" * 50 + "\n")


def print_stats():
    stats = _booking_store.get_stats()
    print("\n📊 Статистика записей:")
    print("  ─" * 30)
    print(f"  Всего записей:     {stats['total']}")
    print(f"  Подтверждено:      {stats['confirmed']}")
    print(f"  Отменено:          {stats['cancelled']}")
    
    if stats.get('by_service'):
        print("\n  По услугам:")
        for name, count in stats['by_service'].items():
            print(f"    • {name}: {count}")
    print()


def main():
    bot = MedicalBot(session_id="terminal")
    
    print_banner()
    greeting = bot.get_greeting()
    print(f"🤖 {greeting}\n")

    while True:
        try:
            user_input = input("👤 Вы: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n👋 До свидания!")
            break

        if not user_input:
            continue

        # Команды
        cmd = user_input.lower()
        
        if cmd in ["/quit", "/exit", "/выход", "пока", "до свидания"]:
            print("\n👋 До свидания! Будьте здоровы!")
            break

        if cmd == "/reset":
            bot.reset()
            greeting = bot.get_greeting()
            print(f"\n🔄 Диалог сброшен.\n🤖 {greeting}\n")
            continue

        if cmd == "/stats":
            print_stats()
            continue

        # Обработка сообщения
        response = bot.process_message(user_input)
        print(f"\n🤖 Бот: {response}\n")


if __name__ == '__main__':
    main()
