#!/usr/bin/env python3
"""
Загрузка конфигурации и базы знаний из JSON-файлов.
Кэширует данные в памяти для производительности.
"""

import json
import os
from typing import Dict, List, Any, Optional

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


class DataStore:
    """Централизованное хранилище данных из JSON."""

    def __init__(self):
        self._services: Dict[str, Dict] = {}
        self._complexes: List[Dict] = []
        self._doctors: List[Dict] = []
        self._promotions: List[Dict] = []
        self._operator_keywords: List[str] = []
        self._clinic: Dict = {}
        self._booking_slots: Dict = {}
        self._symptom_map: Dict[str, Dict] = {}
        self._load()

    def _load(self):
        services_path = os.path.join(_DATA_DIR, "services.json")
        config_path = os.path.join(_DATA_DIR, "config.json")

        with open(services_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        for svc in data["services"]:
            self._services[svc["id"]] = svc
            for symptom in svc.get("symptoms", []):
                self._symptom_map[symptom] = svc

        for complex_item in data["complexes"]:
            service_names = [self._services[sid]["name"] for sid in complex_item["service_ids"] if sid in self._services]
            original_price = sum(self._services[sid]["price"] for sid in complex_item["service_ids"] if sid in self._services)
            discounted_price = round(original_price * (1 - complex_item["discount_percent"] / 100))
            self._complexes.append({
                **complex_item,
                "services": service_names,
                "service_ids": complex_item["service_ids"],
                "original_price": original_price,
                "discounted_price": discounted_price,
            })

        self._doctors = data.get("doctors", [])
        self._promotions = [p for p in data.get("promotions", []) if p.get("active", True)]

        # Загрузка config.json
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                self._clinic = cfg.get("clinic", {})
                self._operator_keywords = cfg.get("operator_keywords", self._operator_keywords)
                self._booking_slots = cfg.get("booking_slots", {})

        # Fallback operator keywords из services.json
        if not self._operator_keywords:
            self._operator_keywords = data.get("operator_keywords", [])

    @property
    def services(self) -> Dict[str, Dict]:
        return self._services

    @property
    def services_by_name(self) -> Dict[str, Dict]:
        return {svc["name"]: svc for svc in self._services.values()}

    @property
    def complexes(self) -> List[Dict]:
        return self._complexes

    @property
    def doctors(self) -> List[Dict]:
        return self._doctors

    @property
    def promotions(self) -> List[Dict]:
        return self._promotions

    @property
    def operator_keywords(self) -> List[str]:
        return self._operator_keywords

    @property
    def clinic(self) -> Dict:
        return self._clinic

    @property
    def booking_slots(self) -> Dict:
        return self._booking_slots

    @property
    def symptom_map(self) -> Dict[str, Dict]:
        return self._symptom_map

    def get_service_by_keyword(self, keyword: str) -> Optional[Dict]:
        """Найти услугу по ключевому слову. Возвращает только если есть уточнение."""
        keyword_lower = keyword.lower()
        # Сначала ищем по симптомам (более специфичные)
        for symptom, svc in self._symptom_map.items():
            if symptom in keyword_lower:
                return svc
        # Затем по ключевым словам (длиннее 2 символов)
        for svc in self._services.values():
            for kw in svc.get("keywords", []):
                if len(kw) >= 2 and kw in keyword_lower:
                    return svc
        return None

    def get_service_by_name(self, name: str) -> Optional[Dict]:
        return self._services_by_name.get(name)

    def find_complex_for_service(self, service: Dict) -> Optional[Dict]:
        """Найти комплекс, содержащий данную услугу."""
        for cx in self._complexes:
            if any(self._services[sid] == service for sid in cx["service_ids"] if sid in self._services):
                return cx
        return None

    def find_complex_by_service_name(self, service_name: str) -> Optional[Dict]:
        for cx in self._complexes:
            for sid in cx["service_ids"]:
                if sid in self._services and self._services[sid]["name"] == service_name:
                    return cx
        return None

    def detect_doctor(self, message: str) -> Optional[Dict]:
        msg_lower = message.lower().strip()
        for doc in self._doctors:
            name_lower = doc["name"].lower()
            if name_lower == msg_lower:
                return doc
            first_name = name_lower.split()[0] if name_lower else ""
            if first_name and first_name in msg_lower:
                return doc
            if len(msg_lower) >= 3 and msg_lower in name_lower:
                return doc
        return None

    def detect_symptom(self, message: str) -> Optional[Dict]:
        """Найти услугу по симптому. МРТ имеет приоритет над другими услугами."""
        msg_lower = message.lower()
        
        # Приоритетные симптомы для МРТ
        mrt_priorities = ["головная боль", "мигрень", "болит голова", "голова болит", 
                          "болит поясница", "спина болит", "боль в спине", "болит шея", "шея болит"]
        
        # Сначала проверяем приоритетные симптомы для МРТ
        for symptom in mrt_priorities:
            if symptom in msg_lower:
                if symptom in self._symptom_map:
                    svc = self._symptom_map[symptom]
                    if svc["type"] == "mrt":
                        return svc
        
        # Затем проверяем остальные симптомы
        for symptom, svc in self._symptom_map.items():
            if symptom in msg_lower:
                # Пропускаем не-MRT услуги если есть более подходящие MRT симптомы
                if svc["type"] != "mrt":
                    # Проверяем, нет ли более подходящего MRT симптома
                    has_mrt_symptom = any(s in msg_lower for s in mrt_priorities if s in self._symptom_map and self._symptom_map[s]["type"] == "mrt")
                    if has_mrt_symptom:
                        continue
                return svc
        return None

    def check_operator_transfer(self, message: str) -> bool:
        msg_lower = message.lower()
        return any(kw in msg_lower for kw in self._operator_keywords)


# Глобальный синглтон
_data_store = DataStore()


def get_services() -> Dict[str, Dict]:
    return _data_store.services


def get_complexes() -> List[Dict]:
    return _data_store.complexes


def get_doctors() -> List[Dict]:
    return _data_store.doctors


def get_promotions() -> List[Dict]:
    return _data_store.promotions


def get_clinic() -> Dict:
    return _data_store.clinic


def get_operator_keywords() -> List[str]:
    return _data_store.operator_keywords


def get_service_by_keyword(keyword: str) -> Optional[Dict]:
    return _data_store.get_service_by_keyword(keyword)


def find_complex_for_service(service: Dict) -> Optional[Dict]:
    return _data_store.find_complex_for_service(service)


def detect_doctor(message: str) -> Optional[Dict]:
    return _data_store.detect_doctor(message)


def detect_symptom(message: str) -> Optional[Dict]:
    return _data_store.detect_symptom(message)


def check_operator_transfer(message: str) -> bool:
    return _data_store.check_operator_transfer(message)


# Экспортируем для использования в bot_logic_v2
__all__ = [
    'get_services', 'get_complexes', 'get_doctors', 'get_promotions',
    'get_clinic', 'get_operator_keywords', 'get_service_by_keyword',
    'find_complex_for_service', 'detect_doctor', 'detect_symptom',
    'check_operator_transfer', '_data_store',
]
