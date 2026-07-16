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
    print("  /calendar — показать предстоящие записи")
    print("  /export  — экспорт в .ics формат")
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

        if cmd == "/calendar":
            upcoming = _booking_store.get_upcoming(7)
            if upcoming:
                print("\n📋 Предстоящие записи (на 7 дней):")
                print("  ─" * 40)
                for b in upcoming:
                    print(f"  📅 {b['date']} ⏰ {b['time']} — {b['service_name']}")
                    print(f"     👤 {b['patient_name']} | 📞 {b['phone']}")
            else:
                print("\n  Нет предстоящих записей.")
            print()
            continue

        if cmd == "/export":
            from calendar_view import export_to_ics
            all_bookings = _booking_store.get_all()
            confirmed = [b for b in all_bookings if b["status"] == "confirmed"]
            if confirmed:
                fname = export_to_ics(confirmed)
                print(f"\n✅ Экспортировано {len(confirmed)} записей в {fname}")
            else:
                print("\n  Нет записей для экспорта.")
            print()
            continue

        # Обработка сообщения
        response = bot.process_message(user_input)
        print(f"\n🤖 Бот: {response}\n")


if __name__ == '__main__':
    main()
