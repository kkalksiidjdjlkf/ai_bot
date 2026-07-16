#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Интеграция с Google Calendar API.
Автоматическое создание событий при бронировании и удаление при отмене.

Настройка:
1. Установите google-api-python-client и google-auth-httplib2
2. Создайте сервисный аккаунт в Google Cloud Console
3. Скачайте credentials.json
4. Установите GOOGLE_CALENDAR_ID и GOOGLE_CREDENTIALS_PATH в .env
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, List

logger = logging.getLogger(__name__)

try:
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False
    logger.warning("Google API не установлен. pip install google-api-python-client google-auth-httplib2")


class GoogleCalendarIntegration:
    """Интеграция с Google Calendar для автоматического создания событий."""
    
    def __init__(self):
        self.service = None
        self.calendar_id = os.getenv("GOOGLE_CALENDAR_ID", "primary")
        self.credentials_path = os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json")
        self.enabled = GOOGLE_AVAILABLE and os.path.exists(self.credentials_path)
        self._initialize()
    
    def _initialize(self):
        """Инициализация Google Calendar API."""
        if not self.enabled:
            logger.info("Google Calendar интеграция отключена (нет credentials.json)")
            return
        
        try:
            with open(self.credentials_path, "r") as f:
                credentials_data = json.load(f)
            
            # Создаём credentials из JSON
            credentials = Credentials.from_service_account_info(credentials_data)
            
            # Scope для календаря
            scopes = ["https://www.googleapis.com/auth/calendar"]
            scoped_credentials = credentials.with_scopes(scopes)
            
            # Строим сервис
            self.service = build("calendar", "v3", credentials=scoped_credentials)
            logger.info("✅ Google Calendar API инициализирован")
        except Exception as e:
            logger.error(f"❌ Ошибка инициализации Google Calendar: {e}")
            self.enabled = False
    
    def create_event(self, booking: Dict) -> Optional[str]:
        """
        Создать событие в Google Calendar.
        Возвращает event_id или None при ошибке.
        """
        if not self.service or not booking:
            return None
        
        try:
            # Парсим дату и время
            date_str = booking.get("date", "")
            time_str = booking.get("time", "")
            patient_name = booking.get("patient_name", "Пациент")
            service_name = booking.get("service_name", "Исследование")
            phone = booking.get("phone", "")
            doctor = booking.get("doctor", "")
            
            # Формируем дату события
            event_start = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
            event_end = event_start + timedelta(minutes=30)  # Стандартная длительность
            
            # Форматируем для Google
            start_dt = event_start.isoformat()
            end_dt = event_end.isoformat()
            
            # Создаём описание
            description = f"Пациент: {patient_name}\n"
            description += f"Телефон: {phone}\n"
            if doctor:
                description += f"Врач: {doctor}\n"
            description += f"Возраст: {booking.get('age', '-')}\n"
            
            # Создаём событие
            event = {
                "summary": f"{service_name} — {patient_name}",
                "description": description,
                "start": {
                    "dateTime": start_dt,
                    "timeZone": "Asia/Almaty",  # Часовой пояс Казахстана
                },
                "end": {
                    "dateTime": end_dt,
                    "timeZone": "Asia/Almaty",
                },
                "reminders": {
                    "useDefault": False,
                    "overrides": [
                        {"method": "email", "minutes": 1440},  # За 1 день
                        {"method": "popup", "minutes": 60},     # За 1 час
                    ],
                },
                "attendees": [],  # Можно добавить email пациента
            }
            
            # Вставляем событие
            created_event = self.service.events().insert(
                calendarId=self.calendar_id,
                body=event,
                sendNotifications=False  # Можно включить для email-уведомлений
            ).execute()
            
            event_id = created_event.get("id")
            logger.info(f"✅ Событие создано: {event_id} — {patient_name} на {date_str} {time_str}")
            return event_id
            
        except HttpError as e:
            logger.error(f"❌ Ошибка Google Calendar API: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ Ошибка создания события: {e}")
            return None
    
    def delete_event(self, event_id: str) -> bool:
        """Удалить событие из Google Calendar."""
        if not self.service:
            return False
        
        try:
            self.service.events().delete(
                calendarId=self.calendar_id,
                eventId=event_id
            ).execute()
            logger.info(f"🗑️ Событие удалено: {event_id}")
            return True
        except HttpError as e:
            logger.error(f"❌ Ошибка удаления события: {e}")
            return False
    
    def list_upcoming(self, days: int = 7) -> List[Dict]:
        """Получить ближайшие события."""
        if not self.service:
            return []
        
        try:
            now = datetime.utcnow().isoformat() + "Z"
            future = (datetime.utcnow() + timedelta(days=days)).isoformat() + "Z"
            
            events_result = self.service.events().list(
                calendarId=self.calendar_id,
                timeMin=now,
                timeMax=future,
                maxResults=50,
                singleEvents=True,
                orderBy="startTime"
            ).execute()
            
            events = events_result.get("items", [])
            result = []
            for event in events:
                start = event["start"].get("dateTime", event["start"].get("date"))
                result.append({
                    "summary": event.get("summary", ""),
                    "start": start,
                    "description": event.get("description", ""),
                })
            
            logger.info(f"📅 Получено {len(result)} предстоящих событий")
            return result
            
        except HttpError as e:
            logger.error(f"❌ Ошибка получения событий: {e}")
            return []
    
    def test_connection(self) -> bool:
        """Проверить подключение к Google Calendar."""
        if not self.service:
            return False
        
        try:
            calendar = self.service.calendars().get(calendarId=self.calendar_id).execute()
            print(f"✅ Подключено к календарю: {calendar.get('summary', 'Primary')}")
            return True
        except HttpError as e:
            print(f"❌ Ошибка подключения: {e}")
            return False


# Глобальный экземпляр
_google_calendar = None

def get_google_calendar() -> GoogleCalendarIntegration:
    """Получить глобальный экземпляр Google Calendar."""
    global _google_calendar
    if _google_calendar is None:
        _google_calendar = GoogleCalendarIntegration()
    return _google_calendar
