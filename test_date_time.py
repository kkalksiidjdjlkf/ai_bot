#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тесты парсинга даты и времени + интеграционные тесты бота с разными форматами ввода.
Запуск: python test_date_time.py
"""

import sys
import os
import unittest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bot_logic_v2 import (
    parse_date, parse_time, parse_date_time, format_date_human,
    MedicalBot, STATE_COLLECTING_NAME, STATE_COLLECTING_TIME, STATE_CONFIRMING, STATE_GREETING,
)


class TestParseTime(unittest.TestCase):
    """Тесты парсинга времени."""

    def test_colon_format(self):
        self.assertEqual(parse_time("11:30"), "11:30")

    def test_dot_format(self):
        self.assertEqual(parse_time("11.30"), "11:30")

    def test_single_digit_hour(self):
        self.assertEqual(parse_time("9:00"), "09:00")

    def test_single_digit_hour_dot(self):
        self.assertEqual(parse_time("9.00"), "09:00")

    def test_with_preposition_v(self):
        self.assertEqual(parse_time("в 11:30"), "11:30")

    def test_with_preposition_na(self):
        self.assertEqual(parse_time("на 11.30"), "11:30")

    def test_hour_only(self):
        self.assertEqual(parse_time("11"), "11:00")

    def test_hour_only_9(self):
        self.assertEqual(parse_time("9"), "09:00")

    def test_dash_format(self):
        self.assertEqual(parse_time("14-30"), "14:30")

    def test_space_format(self):
        self.assertEqual(parse_time("14 30"), "14:30")

    def test_invalid_hour(self):
        self.assertIsNone(parse_time("25:00"))

    def test_invalid_minutes(self):
        self.assertIsNone(parse_time("11:99"))

    def test_not_a_time(self):
        self.assertIsNone(parse_time("абвгд"))

    def test_early_hour_ignored(self):
        # Часы < 7 не парсятся как "только час"
        self.assertIsNone(parse_time("3"))


class TestParseDate(unittest.TestCase):
    """Тесты парсинга даты."""

    def setUp(self):
        self.today = datetime.now()
        self.today_str = self.today.strftime('%Y-%m-%d')
        self.tomorrow_str = (self.today + timedelta(days=1)).strftime('%Y-%m-%d')

    # --- Относительные даты: русский ---

    def test_today_ru(self):
        self.assertEqual(parse_date("сегодня"), self.today_str)

    def test_tomorrow_ru(self):
        self.assertEqual(parse_date("завтра"), self.tomorrow_str)

    def test_day_after_tomorrow_ru(self):
        expected = (self.today + timedelta(days=2)).strftime('%Y-%m-%d')
        self.assertEqual(parse_date("послезавтра"), expected)

    def test_preposition_na_zavtra(self):
        self.assertEqual(parse_date("на завтра"), self.tomorrow_str)

    def test_preposition_na_segodnya(self):
        self.assertEqual(parse_date("на сегодня"), self.today_str)

    # --- Относительные даты: казахский ---

    def test_today_kz(self):
        self.assertEqual(parse_date("бүгін"), self.today_str)

    def test_tomorrow_kz(self):
        self.assertEqual(parse_date("ертең"), self.tomorrow_str)

    def test_tomorrow_kz_alt(self):
        self.assertEqual(parse_date("ертен"), self.tomorrow_str)

    # --- Числовые форматы ---

    def test_dd_mm_dot(self):
        result = parse_date("25.01")
        self.assertIsNotNone(result)
        self.assertIn("-01-25", result)

    def test_dd_mm_slash(self):
        result = parse_date("25/01")
        self.assertIsNotNone(result)
        self.assertIn("-01-25", result)

    def test_dd_mm_yyyy(self):
        self.assertEqual(parse_date("25.01.2026"), "2026-01-25")

    def test_iso_format(self):
        self.assertEqual(parse_date("2026-07-15"), "2026-07-15")

    # --- Словесные даты ---

    def test_day_month_name_ru(self):
        result = parse_date("25 января")
        self.assertIsNotNone(result)
        self.assertIn("-01-25", result)

    def test_day_month_name_ru_march(self):
        result = parse_date("3 марта")
        self.assertIsNotNone(result)
        self.assertIn("-03-03", result)

    def test_day_month_name_ru_december(self):
        result = parse_date("15 декабря")
        self.assertIsNotNone(result)
        self.assertIn("-12-15", result)

    def test_day_month_name_kz(self):
        result = parse_date("25 қаңтар")
        self.assertIsNotNone(result)
        self.assertIn("-01-25", result)

    # --- Дни недели ---

    def test_weekday_ru(self):
        result = parse_date("понедельник")
        self.assertIsNotNone(result)
        d = datetime.strptime(result, '%Y-%m-%d')
        self.assertEqual(d.weekday(), 0)  # Понедельник

    def test_weekday_ru_friday(self):
        result = parse_date("пятницу")
        self.assertIsNotNone(result)
        d = datetime.strptime(result, '%Y-%m-%d')
        self.assertEqual(d.weekday(), 4)  # Пятница

    def test_weekday_kz_friday(self):
        result = parse_date("жұма")
        self.assertIsNotNone(result)
        d = datetime.strptime(result, '%Y-%m-%d')
        self.assertEqual(d.weekday(), 4)  # Жұма = Пятница

    # --- Невалидные ---

    def test_invalid_text(self):
        self.assertIsNone(parse_date("абвгд"))

    def test_random_numbers(self):
        self.assertIsNone(parse_date("999"))


class TestParseDateTimeCombined(unittest.TestCase):
    """Тесты парсинга комбинированного ввода дата+время."""

    def setUp(self):
        self.today = datetime.now()
        self.tomorrow_str = (self.today + timedelta(days=1)).strftime('%Y-%m-%d')

    def test_zavtra_v_1130_dot(self):
        date, time = parse_date_time("завтра в 11.30")
        self.assertEqual(date, self.tomorrow_str)
        self.assertEqual(time, "11:30")

    def test_zavtra_v_1130_colon(self):
        date, time = parse_date_time("завтра в 11:30")
        self.assertEqual(date, self.tomorrow_str)
        self.assertEqual(time, "11:30")

    def test_na_zavtra_v_10(self):
        date, time = parse_date_time("на завтра в 10")
        self.assertEqual(date, self.tomorrow_str)
        self.assertEqual(time, "10:00")

    def test_segodnya_v_9_00(self):
        today_str = self.today.strftime('%Y-%m-%d')
        date, time = parse_date_time("сегодня в 9:00")
        self.assertEqual(date, today_str)
        self.assertEqual(time, "09:00")

    def test_25_yanvarya_v_14_30(self):
        date, time = parse_date_time("25 января в 14.30")
        self.assertIsNotNone(date)
        self.assertIn("-01-25", date)
        self.assertEqual(time, "14:30")

    def test_erten_v_11_00(self):
        date, time = parse_date_time("ертең в 11.00")
        self.assertEqual(date, self.tomorrow_str)
        self.assertEqual(time, "11:00")

    def test_only_time(self):
        date, time = parse_date_time("11.30")
        self.assertIsNone(date)
        self.assertEqual(time, "11:30")

    def test_only_date(self):
        date, time = parse_date_time("завтра")
        self.assertEqual(date, self.tomorrow_str)
        self.assertIsNone(time)

    def test_mozhno_na_zavtra_v_11_30(self):
        """'можно на завтра в 11.30' — парсим хотя бы время"""
        date, time = parse_date_time("можно на завтра в 11.30")
        # 'можно' не парсится как дата, но время должно найтись
        self.assertEqual(time, "11:30")


class TestFormatDateHuman(unittest.TestCase):
    """Тесты человекочитаемого формата даты."""

    def test_today(self):
        today_str = datetime.now().strftime('%Y-%m-%d')
        self.assertEqual(format_date_human(today_str), "сегодня")

    def test_tomorrow(self):
        tomorrow_str = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        self.assertEqual(format_date_human(tomorrow_str), "завтра")

    def test_specific_date(self):
        result = format_date_human("2026-01-25")
        self.assertEqual(result, "25 января 2026")

    def test_invalid_format(self):
        self.assertEqual(format_date_human("invalid"), "invalid")


class TestBotDateTimeIntegration(unittest.TestCase):
    """Интеграционные тесты: полный поток записи с разными форматами даты/времени."""

    def _setup_bot_to_date_step(self):
        """Подготовить бота к шагу сбора даты."""
        bot = MedicalBot(session_id='test_dt')
        bot.process_message('мрт головного мозга')  # → collecting_name
        bot.process_message('Иван Петров')           # → collecting_age
        bot.process_message('30')                     # → collecting_phone
        bot.process_message('+7 777 123 45 67')      # → collecting_date
        self.assertEqual(bot.current_step, 'collecting_date')
        return bot

    def test_flow_with_zavtra(self):
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('завтра')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        self.assertEqual(bot.appointment_data['date'],
                         (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d'))

    def test_flow_with_segodnya(self):
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('сегодня')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        self.assertEqual(bot.appointment_data['date'],
                         datetime.now().strftime('%Y-%m-%d'))

    def test_flow_with_date_and_time_combined(self):
        """'завтра в 11.30' — должен сразу прыгнуть к подтверждению"""
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('завтра в 11.30')
        self.assertEqual(bot.current_step, STATE_CONFIRMING)
        self.assertEqual(bot.appointment_data['date'],
                         (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d'))
        self.assertEqual(bot.appointment_data['time'], '11:30')

    def test_flow_with_25_yanvarya(self):
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('25 января')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        self.assertIn('-01-25', bot.appointment_data['date'])

    def test_flow_with_dd_mm_dot(self):
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('25.01')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        self.assertIn('-01-25', bot.appointment_data['date'])

    def test_flow_with_time_dot_format(self):
        """На шаге выбора времени, '11.30' должен правильно парситься"""
        bot = self._setup_bot_to_date_step()
        bot.process_message('завтра')  # → collecting_time
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        r = bot.process_message('11.30')
        self.assertEqual(bot.current_step, STATE_CONFIRMING)
        self.assertEqual(bot.appointment_data['time'], '11:30')

    def test_flow_with_time_v_format(self):
        """'в 11.30' — тоже должно работать"""
        bot = self._setup_bot_to_date_step()
        bot.process_message('завтра')
        r = bot.process_message('в 11.30')
        self.assertEqual(bot.current_step, STATE_CONFIRMING)
        self.assertEqual(bot.appointment_data['time'], '11:30')

    def test_flow_kz_erten(self):
        """Казахский: ертең"""
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('ертең')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        self.assertEqual(bot.appointment_data['date'],
                         (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d'))

    def test_flow_kz_bugin(self):
        """Казахский: бүгін"""
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('бүгін')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        self.assertEqual(bot.appointment_data['date'],
                         datetime.now().strftime('%Y-%m-%d'))

    def test_flow_kz_erten_v_time(self):
        """Казахский+русский: 'ертең в 11.30'"""
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('ертең в 11.30')
        self.assertEqual(bot.current_step, STATE_CONFIRMING)
        self.assertEqual(bot.appointment_data['date'],
                         (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d'))
        self.assertEqual(bot.appointment_data['time'], '11:30')

    def test_flow_weekday_ponedelnik(self):
        """'понедельник' — следующий понедельник"""
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('понедельник')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        d = datetime.strptime(bot.appointment_data['date'], '%Y-%m-%d')
        self.assertEqual(d.weekday(), 0)

    def test_flow_unknown_date_fallback(self):
        """Неизвестный текст — fallback с подсказкой"""
        bot = self._setup_bot_to_date_step()
        r = bot.process_message('какой-то непонятный текст')
        self.assertEqual(bot.current_step, STATE_COLLECTING_TIME)
        self.assertIn('Совет', r)

    def test_full_flow_combined_then_confirm(self):
        """Полный поток: услуга → имя → возраст → телефон → 'завтра в 10:00' → подтверждаю"""
        bot = MedicalBot(session_id='test_full_dt')
        bot.process_message('мрт головного мозга')
        bot.process_message('Айдар Касымов')
        bot.process_message('25')
        bot.process_message('+7 701 555 12 34')
        r = bot.process_message('завтра в 10:00')
        self.assertEqual(bot.current_step, STATE_CONFIRMING)
        # Подтверждение должно содержать человекочитаемую дату
        self.assertIn('завтра', r)
        self.assertIn('10:00', r)
        r = bot.process_message('подтверждаю')
        self.assertEqual(bot.current_step, STATE_GREETING)


if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("🧪 ТЕСТЫ ПАРСИНГА ДАТЫ/ВРЕМЕНИ")
    print("=" * 60 + "\n")
    unittest.main(verbosity=2)
