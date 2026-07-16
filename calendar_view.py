#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Визуальный календарь записей Nomad Clinic.
Показывает все бронирования по датам, фильтрация, экспорт в .ics.

Запуск: python calendar_view.py [--month 2025-01] [--export]
"""

import sys
import os
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from booking_store import _booking_store


def get_month_range(year: int, month: int) -> tuple:
    """Возвращает начало и конец месяца."""
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = datetime(year, month + 1, 1) - timedelta(days=1)
    return start, end


def get_bookings_for_date(date_str: str) -> List[Dict]:
    """Получить все записи на дату."""
    all_bookings = _booking_store.get_all()
    return [b for b in all_bookings if b["date"] == date_str and b["status"] == "confirmed"]


def render_calendar(year: int, month: int):
    """Отрисовка календаря."""
    start, end = get_month_range(year, month)
    month_name = start.strftime("%B %Y")
    
    # Заголовок
    print("\n" + "=" * 60)
    print(f"  📅 {month_name}")
    print("=" * 60)
    
    # Дни недели
    weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    header = "  ".join(f"{d:>4}" for d in weekdays)
    print(f"\n{header}")
    print("-" * 60)
    
    # Смещение для первого дня (0=понедельник)
    first_weekday = start.weekday()  # 0=Пн, 6=Вс
    
    current = start
    line = "      " * first_weekday  # Отступ для первого дня
    while current <= end:
        # Получаем записи на день
        date_str = current.strftime("%Y-%m-%d")
        bookings = get_bookings_for_date(date_str)
        
        # Формируем день
        day_num = current.day
        if bookings:
            line += f"[{day_num:2d}:{len(bookings)}]"
        else:
            line += f"  {day_num:2d}  "
        
        # Конец недели или конец месяца
        if current.weekday() == 6 or current == end:
            print(line)
            line = ""
        
        current += timedelta(days=1)
    
    # Статистика
    print("-" * 60)
    stats = _booking_store.get_stats()
    print(f"  Всего записей: {stats['confirmed']} | Отменено: {stats['cancelled']}")
    
    if stats.get('by_service'):
        print("  По услугам:")
        for name, count in stats['by_service'].items():
            print(f"    • {name}: {count}")
    print()


def show_bookings_detail(year: Optional[int] = None, month: Optional[int] = None, day: Optional[int] = None):
    """Подробный просмотр записей."""
    today = datetime.now()
    
    if year and month and day:
        target = datetime(year, month, day)
    elif year and month:
        target = today.replace(year=year, month=month, day=1)
    else:
        target = today
    
    date_str = target.strftime("%Y-%m-%d")
    bookings = get_bookings_for_date(date_str)
    
    day_name = target.strftime("%A, %d %B %Y")
    print(f"\n📋 Записи на {day_name}:\n")
    
    if not bookings:
        print("  Нет записей на эту дату.")
    else:
        # Группируем по времени
        by_time: Dict[str, List[Dict]] = {}
        for b in bookings:
            by_time.setdefault(b["time"], []).append(b)
        
        for time_slot in sorted(by_time.keys()):
            print(f"  ⏰ {time_slot}")
            for b in by_time[time_slot]:
                print(f"    • {b['patient_name']} | {b['service_name']}")
                print(f"      📞 {b['phone']} | 🎂 {b.get('age', '-')} | 👨‍⚕️ {b.get('doctor', '-')}")
            print()
    
    return bookings


def export_to_ics(bookings: List[Dict], filename: Optional[str] = None) -> str:
    """Экспорт записей в ICS формат."""
    if not bookings:
        print("  Нет записей для экспорта.")
        return ""
    
    if not filename:
        filename = f"nomad_bookings_{datetime.now().strftime('%Y%m%d')}.ics"
    
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Nomad Clinic//Booking//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    
    for b in bookings:
        try:
            dt = datetime.strptime(f"{b['date']} {b['time']}", "%Y-%m-%d %H:%M")
            end_dt = dt + timedelta(minutes=30)  # Стандартная длительность
            
            lines.extend([
                "BEGIN:VEVENT",
                f"DTSTART:{dt.strftime('%Y%m%dT%H%M%S')}",
                f"DTEND:{end_dt.strftime('%Y%m%dT%H%M%S')}",
                f"SUMMARY:{b['service_name']} - {b['patient_name']}",
                f"DESCRIPTION:Телефон: {b['phone']}\\nВозраст: {b.get('age', '-')}\\nВрач: {b.get('doctor', '-')}",
                "STATUS:CONFIRMED",
                "END:VEVENT",
            ])
        except (ValueError, KeyError) as e:
            print(f"  ⚠️ Пропущена запись: {e}")
    
    lines.append("END:VCALENDAR")
    
    content = "\n".join(lines)
    
    with open(filename, "w", encoding="utf-8") as f:
        f.write(content)
    
    return filename


def show_help():
    """Показать справку."""
    print("""
📅 Nomad Clinic Calendar

Использование:
  python calendar_view.py                    — календарь на текущий месяц
  python calendar_view.py --month 2025-01    — календарь на январь 2025
  python calendar_view.py --detail           — записи на сегодня
  python calendar_view.py --detail 2025 1 25 — записи на 25 января 2025
  python calendar_view.py --export           — экспорт всех записей в .ics
  python calendar_view.py --export 2025 1    — экспорт записей за январь 2025

Команды в интерактивном режиме:
  c — показать календарь
  d [год] [мес] [день] — детали записей
  e [год] [мес] — экспорт
  q — выход
""")


def interactive_mode():
    """Интерактивный режим."""
    print("\n" + "=" * 60)
    print("  📅 Nomad Clinic Calendar — Интерактивный режим")
    print("=" * 60)
    print("  Введите 'help' для справки или 'q' для выхода\n")
    
    today = datetime.now()
    
    while True:
        try:
            cmd = input("  > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n👋 До свидания!\n")
            break
        
        if not cmd:
            continue
        
        if cmd in ["q", "quit", "выход"]:
            print("👋 До свидания!\n")
            break
        
        if cmd in ["help", "h", "?"]:
            show_help()
            continue
        
        if cmd == "c":
            show_bookings_detail(today.year, today.month, today.day)
        elif cmd.startswith("c "):
            parts = cmd[2:].split()
            if len(parts) >= 2:
                try:
                    y, m = int(parts[0]), int(parts[1])
                    render_calendar(y, m)
                except ValueError:
                    print("  Формат: c год месяц (например: c 2025 1)")
            else:
                show_bookings_detail(today.year, today.month, today.day)
        elif cmd.startswith("d"):
            parts = cmd[2:].split()
            if len(parts) == 3:
                try:
                    y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
                    show_bookings_detail(y, m, d)
                except ValueError:
                    print("  Формат: d год месяц день")
            elif len(parts) == 2:
                try:
                    y, m = int(parts[0]), int(parts[1])
                    show_bookings_detail(y, m)
                except ValueError:
                    print("  Формат: d год месяц")
            else:
                show_bookings_detail()
        elif cmd.startswith("e"):
            parts = cmd[2:].split()
            if len(parts) == 2:
                try:
                    y, m = int(parts[0]), int(parts[1])
                    start, end = get_month_range(y, m)
                    all_bookings = _booking_store.get_all()
                    filtered = []
                    for b in all_bookings:
                        if b["status"] == "confirmed":
                            try:
                                bd = datetime.strptime(b["date"], "%Y-%m-%d")
                                if start <= bd <= end:
                                    filtered.append(b)
                            except ValueError:
                                continue
                    if filtered:
                        fname = export_to_ics(filtered)
                        print(f"  ✅ Экспортировано {len(filtered)} записей в {fname}")
                    else:
                        print("  Нет записей за этот месяц.")
                except ValueError:
                    print("  Формат: e год месяц")
            else:
                all_bookings = _booking_store.get_all()
                confirmed = [b for b in all_bookings if b["status"] == "confirmed"]
                if confirmed:
                    fname = export_to_ics(confirmed)
                    print(f"  ✅ Экспортировано {len(confirmed)} записей в {fname}")
                else:
                    print("  Нет записей для экспорта.")
        else:
            print("  Неизвестная команда. Введите 'help'.")


def main():
    parser = argparse.ArgumentParser(description="Nomad Clinic Calendar View")
    parser.add_argument("--month", type=str, help="Месяц в формате YYYY-MM (например: 2025-01)")
    parser.add_argument("--detail", nargs="*", type=int, metavar="YEAR MONTH DAY",
                        help="Подробный просмотр записей")
    parser.add_argument("--export", nargs="*", type=int, metavar="YEAR MONTH",
                        help="Экспорт записей в .ics")
    parser.add_argument("--interactive", "-i", action="store_true",
                        help="Интерактивный режим")
    
    args = parser.parse_args()
    
    if args.interactive:
        interactive_mode()
        return
    
    if args.month:
        try:
            y, m = map(int, args.month.split("-"))
            render_calendar(y, m)
        except ValueError:
            print("  ❌ Неверный формат месяца. Используйте YYYY-MM")
            sys.exit(1)
    
    elif args.detail:
        if len(args.detail) == 3:
            show_bookings_detail(*args.detail)
        elif len(args.detail) == 2:
            show_bookings_detail(*args.detail)
        else:
            show_bookings_detail()
    
    elif args.export:
        if len(args.export) == 2:
            y, m = args.export
            start, end = get_month_range(y, m)
            all_bookings = _booking_store.get_all()
            filtered = []
            for b in all_bookings:
                if b["status"] == "confirmed":
                    try:
                        bd = datetime.strptime(b["date"], "%Y-%m-%d")
                        if start <= bd <= end:
                            filtered.append(b)
                    except ValueError:
                        continue
            if filtered:
                fname = export_to_ics(filtered)
                print(f"✅ Экспортировано {len(filtered)} записей в {fname}")
            else:
                print("Нет записей за этот месяц.")
        else:
            all_bookings = _booking_store.get_all()
            confirmed = [b for b in all_bookings if b["status"] == "confirmed"]
            if confirmed:
                fname = export_to_ics(confirmed)
                print(f"✅ Экспортировано {len(confirmed)} записей в {fname}")
            else:
                print("Нет записей для экспорта.")
    
    else:
        # По умолчанию — календарь на текущий месяц
        today = datetime.now()
        render_calendar(today.year, today.month)


if __name__ == "__main__":
    main()
