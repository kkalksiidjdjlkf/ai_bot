#!/usr/bin/env python3
"""
Хранилище записей с сохранением в JSON.
Поддержка нескольких записей, проверка конфликтов времени.
"""

import json
import os
import uuid
from datetime import datetime
from typing import Dict, List, Optional

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_BOOKINGS_FILE = os.path.join(_DATA_DIR, "bookings.json")


class BookingStore:
    """Хранилище записей с файловой персистентностью."""

    def __init__(self):
        self._bookings: Dict[str, Dict] = {}
        self._load()

    def _load(self):
        if os.path.exists(_BOOKINGS_FILE):
            try:
                with open(_BOOKINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._bookings = {b["id"]: b for b in data}
            except (json.JSONDecodeError, KeyError):
                self._bookings = {}

    def _save(self):
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_BOOKINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(list(self._bookings.values()), f, ensure_ascii=False, indent=2)

    def add(self, patient_name: str, service_name: str, date: str, time: str,
            phone: str, age: Optional[int] = None, doctor: Optional[str] = None) -> Optional[str]:
        """
        Добавить запись. Возвращает ID или None при конфликте.
        """
        conflict = self._check_conflict(date, time)
        if conflict:
            return None

        booking_id = str(uuid.uuid4())[:8]
        booking = {
            "id": booking_id,
            "patient_name": patient_name,
            "service_name": service_name,
            "date": date,
            "time": time,
            "phone": phone,
            "age": age,
            "doctor": doctor,
            "created_at": datetime.now().isoformat(),
            "status": "confirmed",
        }
        self._bookings[booking_id] = booking
        self._save()
        return booking_id

    def _check_conflict(self, date: str, time: str) -> Optional[str]:
        """Проверить конфликт времени. Возвращает имя пациента при конфликте."""
        for b in self._bookings.values():
            if b["date"] == date and b["time"] == time and b["status"] == "confirmed":
                return b["patient_name"]
        return None

    def get_all(self) -> List[Dict]:
        return list(self._bookings.values())

    def get_by_id(self, booking_id: str) -> Optional[Dict]:
        return self._bookings.get(booking_id)

    def cancel(self, booking_id: str) -> bool:
        if booking_id in self._bookings:
            self._bookings[booking_id]["status"] = "cancelled"
            self._save()
            return True
        return False

    def get_stats(self) -> Dict:
        total = len(self._bookings)
        confirmed = sum(1 for b in self._bookings.values() if b["status"] == "confirmed")
        cancelled = sum(1 for b in self._bookings.values() if b["status"] == "cancelled")

        service_counts: Dict[str, int] = {}
        for b in self._bookings.values():
            if b["status"] == "confirmed":
                svc = b["service_name"]
                service_counts[svc] = service_counts.get(svc, 0) + 1

        return {
            "total": total,
            "confirmed": confirmed,
            "cancelled": cancelled,
            "by_service": service_counts,
        }

    def clear(self):
        self._bookings = {}
        self._save()


# Глобальный синглтон
_booking_store = BookingStore()
