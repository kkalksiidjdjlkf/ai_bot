#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Консольный симулятор медицинского бота
Для тестирования диалогов без подключения к Telegram
"""

from bot_logic import MedicalBot
from knowledge_base import SERVICES, PROMOTIONS, DOCTORS
from config import CLINIC_NAME
from datetime import datetime

class Simulator:
    def __init__(self):
        self.bot = MedicalBot()
        self.dialog_count = 0
        self.bookings_count = 0
        self.questions_count = 0
        self.started_at = datetime.now()
        
    def print_header(self):
        """Вывод заголовка"""
        print("\n" + "="*60)
        print(f"🏥 СИМУЛЯТОР БОТА: {CLINIC_NAME}")
        print("="*60)
        print("Команды: /reset, /stats, /services, /help, /exit")
        print("="*60 + "\n")
    
    def show_help(self):
        """Показать помощь"""
        print("\n📋 ДОСТУПНЫЕ КОМАНДЫ:")
        print("  /reset     — Начать новый диалог")
        print("  /stats     — Показать статистику")
        print("  /services  — Показать все услуги и цены")
        print("  /promo     — Показать акции")
        print("  /doctors   — Показать врачей")
        print("  /help      — Эта справка")
        print("  /exit      — Выход из симулятора")
        print()
    
    def show_stats(self):
        """Показать статистику"""
        print("\n📊 СТАТИСТИКА:")
        print(f"  Диалогов: {self.dialog_count}")
        print(f"  Записей: {self.bookings_count}")
        print(f"  Вопросов: {self.questions_count}")
        print(f"  Сессия: {datetime.now() - self.started_at}")
        print()
    
    def show_services(self):
        """Показать все услуги"""
        print("\n💎 УСЛУГИ И ЦЕНЫ:")
        for key, service in SERVICES.items():
            print(f"  • {service['name']} — {service['price']:,} тг ({service['duration']})")
        print()
    
    def show_promo(self):
        """Показать акции"""
        print("\n🎁 АКЦИИ:")
        for promo in PROMOTIONS:
            print(f"  • {promo['title']}")
            print(f"    {promo['description']} (до {promo['valid_until']})")
        print()
    
    def show_doctors(self):
        """Показать врачей"""
        print("\n👨‍⚕️ ВРАЧИ:")
        for doc in DOCTORS:
            print(f"  • {doc['name']}")
            print(f"    {doc['specialty']}, стаж {doc['experience']}")
        print()
    
    def log_dialog(self, role, message):
        """Логирование диалога"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        with open("dialogs.log", "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {role}: {message}\n")
    
    def run(self):
        """Запуск симулятора"""
        self.print_header()
        
        # Приветствие бота
        greeting = self.bot.get_greeting()
        print(f"🤖 БОТ: {greeting}\n")
        self.log_dialog("BOT", greeting)
        
        while True:
            try:
                user_input = input("👤 ВЫ: ").strip()
                
                if not user_input:
                    continue
                
                # Обработка команд
                if user_input.lower() == "/exit":
                    print("\n👋 Завершение работы симулятора...")
                    self.show_stats()
                    break
                
                elif user_input.lower() == "/reset":
                    self.bot.reset()
                    greeting = self.bot.get_greeting()
                    print(f"\n🔄 Диалог сброшен.\n🤖 БОТ: {greeting}\n")
                    self.log_dialog("SYSTEM", "Dialog reset")
                    self.log_dialog("BOT", greeting)
                    continue
                
                elif user_input.lower() == "/stats":
                    self.show_stats()
                    continue
                
                elif user_input.lower() == "/services":
                    self.show_services()
                    continue
                
                elif user_input.lower() == "/promo":
                    self.show_promo()
                    continue
                
                elif user_input.lower() == "/doctors":
                    self.show_doctors()
                    continue
                
                elif user_input.lower() == "/help":
                    self.show_help()
                    continue
                
                # Обработка сообщения
                self.dialog_count += 1
                self.log_dialog("USER", user_input)
                
                response = self.bot.process_message(user_input)
                print(f"\n🤖 БОТ: {response}\n")
                self.log_dialog("BOT", response)
                
                # Подсчёт статистики
                if "✅ Запись подтверждена" in response:
                    self.bookings_count += 1
                elif "?" in response or "Когда" in response or "Укажите" in response:
                    self.questions_count += 1
                
            except KeyboardInterrupt:
                print("\n\n👋 Прервано пользователем")
                self.show_stats()
                break
            except Exception as e:
                print(f"\n⚠️ Ошибка: {e}\n")
                self.log_dialog("ERROR", str(e))
            

def main():
    simulator = Simulator()
    simulator.run()


if __name__ == "__main__":
    main()
