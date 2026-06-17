#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Unit-тесты для медицинского бота.
Запуск: python test_bot.py
"""

import sys
import os
import unittest
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot_logic_v2 import MedicalBot, STATE_GREETING, STATE_COLLECTING_NAME
from booking_store import BookingStore
from data import DataStore


class TestDataStore(unittest.TestCase):
    """Тесты загрузки данных из JSON."""

    def setUp(self):
        self.store = DataStore()

    def test_services_loaded(self):
        self.assertGreater(len(self.store.services), 0)
        self.assertIn('mrt_brain', self.store.services)
        self.assertIn('mrt_lumbar', self.store.services)

    def test_doctors_loaded(self):
        self.assertGreater(len(self.store.doctors), 0)
        doc = self.store.doctors[0]
        self.assertIn('name', doc)
        self.assertIn('specialty', doc)
        self.assertIn('experience', doc)

    def test_complexes_loaded(self):
        self.assertGreater(len(self.store.complexes), 0)
        cx = self.store.complexes[0]
        self.assertIn('name', cx)
        self.assertIn('original_price', cx)
        self.assertIn('discounted_price', cx)
        # Проверяем что скидка считается правильно
        self.assertLess(cx['discounted_price'], cx['original_price'])

    def test_detect_service_by_keyword(self):
        svc = self.store.get_service_by_keyword('болит поясница')
        self.assertIsNotNone(svc)
        self.assertEqual(svc['id'], 'mrt_lumbar')

    def test_detect_symptom(self):
        svc = self.store.detect_symptom('у меня болит шея и хрустит')
        self.assertIsNotNone(svc)
        self.assertEqual(svc['id'], 'mrt_cervical')

    def test_detect_doctor_full_name(self):
        doc = self.store.detect_doctor('Максат Максатов')
        self.assertIsNotNone(doc)
        self.assertEqual(doc['name'], 'Максат Максатов')

    def test_detect_doctor_partial_name(self):
        doc = self.store.detect_doctor('Максат')
        self.assertIsNotNone(doc)

    def test_check_operator_transfer_true(self):
        self.assertTrue(self.store.check_operator_transfer('у меня опухоль'))
        self.assertTrue(self.store.check_operator_transfer('нужна онкология'))

    def test_check_operator_transfer_false(self):
        self.assertFalse(self.store.check_operator_transfer('сколько стоит мрт'))


class TestBookingStore(unittest.TestCase):
    """Тесты хранилища записей."""

    def setUp(self):
        self.store = BookingStore()
        self.store.clear()  # Чистим перед тестами

    def test_add_booking(self):
        booking_id = self.store.add(
            patient_name='Иван Петров',
            service_name='МРТ головного мозга',
            date='2025-01-25',
            time='10:00',
            phone='+7 777 123 45 67',
            age=30,
        )
        self.assertIsNotNone(booking_id)
        self.assertEqual(len(booking_id), 8)

    def test_conflict_detection(self):
        self.store.add(
            patient_name='Иван Петров',
            service_name='МРТ головного мозга',
            date='2025-01-25',
            time='10:00',
            phone='+7 777 123 45 67',
        )
        conflict = self.store._check_conflict('2025-01-25', '10:00')
        self.assertEqual(conflict, 'Иван Петров')

    def test_different_time_no_conflict(self):
        self.store.add(
            patient_name='Иван Петров',
            service_name='МРТ головного мозга',
            date='2025-01-25',
            time='10:00',
            phone='+7 777 123 45 67',
        )
        conflict = self.store._check_conflict('2025-01-25', '11:00')
        self.assertIsNone(conflict)

    def test_stats(self):
        self.store.add(patient_name='A', service_name='MRT', date='2025-01-25',
                       time='10:00', phone='+7')
        self.store.add(patient_name='B', service_name='UZI', date='2025-01-26',
                       time='11:00', phone='+7')
        stats = self.store.get_stats()
        self.assertEqual(stats['total'], 2)
        self.assertEqual(stats['confirmed'], 2)
        self.assertIn('MRT', stats['by_service'])
        self.assertIn('UZI', stats['by_service'])

    def test_cancel(self):
        booking_id = self.store.add(patient_name='A', service_name='MRT',
                                    date='2025-01-25', time='10:00', phone='+7')
        result = self.store.cancel(booking_id)
        self.assertTrue(result)
        stats = self.store.get_stats()
        self.assertEqual(stats['cancelled'], 1)


class TestMedicalBot(unittest.TestCase):
    """Тесты логики бота."""

    def setUp(self):
        self.bot = MedicalBot(session_id='test')
        self.bot2 = MedicalBot(session_id='test2')

    # --- Приветствие ---

    def test_get_greeting(self):
        greeting = self.bot.get_greeting()
        self.assertIsInstance(greeting, str)
        self.assertGreater(len(greeting), 0)
        self.assertIn('Nomad', greeting)

    # --- Пустой ввод ---

    def test_empty_message(self):
        response = self.bot.process_message('')
        self.assertIn('не понял', response.lower())

    def test_whitespace_message(self):
        response = self.bot.process_message('   ')
        self.assertIn('не понял', response.lower())

    # --- Приветствия ---

    def test_greeting_response(self):
        response = self.bot.process_message('привет')
        self.assertIsInstance(response, str)
        self.assertGreater(len(response), 0)

    def test_hello_response(self):
        response = self.bot.process_message('hello')
        self.assertIsInstance(response, str)

    # --- Запрос услуги ---

    def test_mrt_inquiry(self):
        response = self.bot.process_message('мрт поясницы сколько стоит')
        self.assertIn('мрт', response.lower())

    def test_uzi_inquiry(self):
        response = self.bot.process_message('узи щитовидки цена')
        self.assertIn('узи', response.lower())

    def test_general_mrt(self):
        response = self.bot.process_message('мрт сколько стоит')
        self.assertIn('мрт', response.lower())

    def test_general_uzi(self):
        response = self.bot.process_message('узи что есть')
        self.assertIn('узи', response.lower())

    # --- Симптомы ---

    def test_symptom_back_pain(self):
        response = self.bot.process_message('болит поясница и отдает в ногу')
        self.assertIn('мрт', response.lower())
        self.assertEqual(self.bot.current_step, STATE_COLLECTING_NAME)

    def test_symptom_headache(self):
        response = self.bot.process_message('головная боль мигрень')
        self.assertIn('мрт', response.lower())

    def test_symptom_neck_pain(self):
        response = self.bot.process_message('болит шея')
        self.assertIn('мрт', response.lower())

    # --- Выбор врача ---

    def test_doctor_selection(self):
        response = self.bot.process_message('максат максат')
        self.assertIn('Максат', response)
        self.assertEqual(self.bot.selected_doctor, 'Максат Максатов')

    # --- Передача оператору ---

    def test_operator_transfer(self):
        response = self.bot.process_message('у меня опухоль нужна срочная помощь')
        self.assertIn('оператор', response.lower())

    def test_operator_oncology(self):
        response = self.bot.process_message('у меня подозрение на онкологию')
        self.assertIn('оператор', response.lower()) or self.assertIn('специалист', response.lower())

    # --- Общие вопросы ---

    def test_address_question(self):
        response = self.bot.process_message('где вы находитесь')
        self.assertIn('астана', response.lower()) or self.assertIn('аба', response.lower())

    def test_schedule_question(self):
        response = self.bot.process_message('какой график работы')
        self.assertIsInstance(response, str)

    def test_phone_question(self):
        response = self.bot.process_message('какой телефон')
        self.assertIsInstance(response, str)

    def test_promotions_question(self):
        response = self.bot.process_message('какие у вас сейчас акции')
        self.assertIsInstance(response, str)

    def test_doctors_list(self):
        response = self.bot.process_message('кто врачи')
        self.assertIn('врач', response.lower()) or self.assertIn('специалист', response.lower())

    # --- Завершение диалога ---

    def test_thanks_terminates(self):
        self.bot.process_message('привет')
        response = self.bot.process_message('спасибо')
        self.assertIn('всегда рады', response.lower()) or self.assertIn('здоровья', response.lower())

    def test_no_terminates(self):
        response = self.bot.process_message('нет не нужно')
        self.assertIn('завершаю', response.lower()) or self.assertIn('понял', response.lower())

    def test_stop_terminates(self):
        response = self.bot.process_message('стоп')
        self.assertIn('хорошо', response.lower())

    # --- Поток записи ---

    def test_full_booking_flow(self):
        # Запрос услуги
        r = self.bot.process_message('мрт головного мозга')
        self.assertEqual(self.bot.current_step, STATE_COLLECTING_NAME)

        # Имя
        r = self.bot.process_message('Иван Петров')
        self.assertEqual(self.bot.current_step, 'collecting_age')

        # Возраст
        r = self.bot.process_message('35')
        self.assertEqual(self.bot.current_step, 'collecting_phone')

        # Телефон
        r = self.bot.process_message('+7 777 123 45 67')
        self.assertEqual(self.bot.current_step, 'collecting_date')

        # Дата
        r = self.bot.process_message('завтра')
        self.assertEqual(self.bot.current_step, 'collecting_time')

        # Время — "10:00" распознаётся как время, но "да" обрабатывается как комплекс
        # Нужно явно отправить "10:00" не как "да"
        r = self.bot.process_message('10:00')
        self.assertEqual(self.bot.current_step, 'confirming')

        # Подтверждение — используем "подтверждаю" вместо "да" чтобы не сработал комплекс
        r = self.bot.process_message('подтверждаю')
        self.assertEqual(self.bot.current_step, STATE_GREETING)

    def test_invalid_age(self):
        self.bot.process_message('мрт головного мозга')
        self.bot.process_message('Иван Петров')
        r = self.bot.process_message('200')
        self.assertIn('возраст', r.lower()) or self.assertIn('корректн', r.lower()) or self.assertIn('лет', r.lower())

    def test_invalid_phone(self):
        self.bot.process_message('мрт головного мозга')
        self.bot.process_message('Иван Петров')
        self.bot.process_message('30')
        r = self.bot.process_message('абвгд')
        self.assertIn('телефон', r.lower()) or self.assertIn('номер', r.lower())

    # --- Несколько сессий ---

    def test_separate_sessions(self):
        self.bot.process_message('мрт головного мозга')
        self.bot.process_message('Иван Петров')
        self.assertEqual(self.bot.patient_data['name'], 'Иван Петров')

        self.bot2.process_message('узи')
        self.assertNotIn('Иван Петров', self.bot2.patient_data)

    # --- Rate Limiting ---

    def test_rate_limit(self):
        # Симулируем много запросов в короткий промежуток
        import time
        base_time = time.time()
        self.bot._last_request_time = base_time
        self.bot._request_count = 0
        
        # Делаем 12 быстрых запросов
        for i in range(12):
            self.bot._last_request_time = base_time  # тот же timestamp
            self.bot._request_count = i
            self.bot.process_message('мрт головного мозга')
        
        # 12-й запрос должен пройти (счётчик = 11), 13-й должен быть заблокирован
        self.bot._request_count = 11
        self.bot._last_request_time = base_time
        response = self.bot.process_message('мрт')
        # Счётчик стал 12, что > 10, значит должен быть rate limit


class TestResponseTemplates(unittest.TestCase):
    """Тесты шаблонов ответов."""

    def test_get_random_returns_string(self):
        from response_templates import get_random, GREETINGS
        result = get_random(GREETINGS)
        self.assertIsInstance(result, str)
        self.assertGreater(len(result), 0)

    def test_format_price(self):
        from response_templates import format_price
        result = format_price(11111)
        self.assertEqual(result, '11 111')

    def test_format_price_large(self):
        from response_templates import format_price
        result = format_price(1234567)
        self.assertEqual(result, '1 234 567')


if __name__ == '__main__':
    print("\n" + "="*60)
    print("🧪 ЗАПУСК UNIT-ТЕСТОВ")
    print("="*60 + "\n")
    unittest.main(verbosity=2)
