"""
Логика медицинского бота — рефакторинг:
- State machine вместо if/elif дерева
- Убрано дублирование детекции
- Конфликты времени
- Поддержка нескольких диалогов (session_id)
- Rate limiting
- Логирование
- Транслитерация (казахский с русской клавиатуры)
"""
import random
import logging
import time
import re
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple, List
from data import (
    get_services, get_complexes, get_doctors, get_promotions, get_clinic,
    get_operator_keywords, get_service_by_keyword, find_complex_for_service,
    detect_doctor, detect_symptom, check_operator_transfer,
)
from booking_store import _booking_store
from data import _data_store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("bot.log", encoding="utf-8"),
        logging.StreamHandler(),
    ]
)
logger = logging.getLogger(__name__)

from response_templates import (
    GREETINGS, PRICE_RESPONSES, COMPLEX_OFFERS, SYMPTOM_RESPONSES,
    NAME_REQUESTS, AGE_REQUESTS, PHONE_REQUESTS, DATE_REQUESTS,
    TIME_OFFERS, CONFIRMATION_REQUESTS, BOOKING_SUCCESS,
    ADDRESS_RESPONSES, SCHEDULE_RESPONSES, PHONE_INFO_RESPONSES,
    NO_DIAGNOSIS_RESPONSES, OPERATOR_TRANSFER, SOFT_SELL_PHRASES,
    get_random, format_price,
)

# ======================================================
# ТРАНСЛИТЕРАЦИЯ ФУНКЦИЯСЫ (Орыс пернетақтасынан қазақшаға)
# ======================================================

# Қазақ әріптеріне сәйкес орыс әріптерінің кестесі
# (Бұл кесте толық, бірақ ережелер негізгі түзету үшін жеткілікті)
RULES = [
    (r'([бвгджзйклмнпрстфхцчшщ])а', r'\1ә'),  # ба -> бә, жа -> жә
    (r'([бвгджзйклмнпрстфхцчшщ])о', r'\1ө'),
    (r'([бвгджзйклмнпрстфхцчшщ])у', r'\1ұ'),
    (r'([бвгджзйклмнпрстфхцчшщ])у([бвгджзйклмнпрстфхцчшщ])', r'\1ү\2'),
    (r'га', r'ға'),
    (r'го', r'ғо'),
    (r'гу', r'ғу'),
]

def fix_kazakh_transliteration(text: str) -> str:
    """Орыс пернетақтасымен жазылған қазақша мәтінді түзетеді.
    Применяется только если текст похож на казахский (содержит казахские слова/окончания).
    """
    # Проверяем, есть ли признаки казахского текста (типичные казахские окончания и слова)
    kazakh_patterns = [
        r'\bмын\b', r'\bмін\b', r'\bбыз\b', r'\bміз\b',  # мои окончания
        r'\bсың\b', r'\bсің\b',  # твои окончания
        r'\bды\b', r'\bді\b', r'\bты\b', r'\bті\b',  # падежные окончания
        r'\bға\b', r'\bге\b', r'\bқа\b', r'\bке\b',  # направление
        r'\bдан\b', r'\bден\b', r'\bтан\b', r'\bтен\b',  # исходный падеж
        r'\bмен\b', r'\bбен\b', r'\bпен\b',  # совместный падеж
        r'\bнда\b', r'\bнде\b',  # местный падеж
        r'\bлар\b', r'\bлер\b', r'\bдар\b', r'\bдер\b', r'\bтар\b', r'\bтер\b',  # множественное число
        r'\bшы\b', r'\bші\b', r'\bшылар\b', r'\bшілер\b',  # профессии
        r'\bлық\b', r'\bлік\b', r'\bтық\b', r'\bтік\b',  # суффиксы
        r'\bсыз\b', r'\bсіз\b',  # без чего-то
        'сәлем', 'қалай', 'рақмет', 'болады', 'жоқ', 'иә', 'қажет',
        'емес', 'керек', 'болды', 'айтыңыз', 'көмек', 'дәрігер',
    ]
    text_lower = text.lower()
    has_kazakh = any(re.search(p, text_lower) for p in kazakh_patterns)
    
    # Если нет признаков казахского, возвращаем как есть
    if not has_kazakh:
        return text
    
    # Применяем правила транслитерации
    for pattern, replacement in RULES:
        text = re.sub(pattern, replacement, text)
    return text

def detect_language(text: str) -> str:
    """Мәтін тілін анықтайды (қазақша/орысша)"""
    # Проверяем наличие казахских символов
    kazakh_chars = re.findall(r'[әғқңөұүһі]', text.lower())
    if kazakh_chars:
        return "kk"
    # Проверяем казахские слова
    kazakh_words = ['сәлем', 'қалай', 'рақмет', 'болады', 'жоқ', 'иә', 'қажет', 'емес', 'керек']
    if any(w in text.lower() for w in kazakh_words):
        return "kk"
    return "ru"

# ======================================================
# ПАРСИНГ ДАТЫ И ВРЕМЕНИ
# ======================================================

# Месяцы: русский и казахский
MONTH_NAMES_RU = {
    'январ': 1, 'феврал': 2, 'март': 3, 'апрел': 4,
    'мая': 5, 'май': 5, 'июн': 6, 'июл': 7, 'август': 8,
    'сентябр': 9, 'октябр': 10, 'ноябр': 11, 'декабр': 12,
}
MONTH_NAMES_KZ = {
    'қаңтар': 1, 'ақпан': 2, 'наурыз': 3, 'сәуір': 4, 'сауір': 4,
    'мамыр': 5, 'маусым': 6, 'шілде': 7, 'тамыз': 8,
    'қыркүйек': 9, 'қазан': 10, 'қараша': 11, 'желтоқсан': 12,
}

# Человекочитаемые названия месяцев для подтверждения
MONTH_DISPLAY = {
    1: 'января', 2: 'февраля', 3: 'марта', 4: 'апреля',
    5: 'мая', 6: 'июня', 7: 'июля', 8: 'августа',
    9: 'сентября', 10: 'октября', 11: 'ноября', 12: 'декабря',
}


def parse_time(text: str) -> Optional[str]:
    """
    Парсинг времени из текста. Возвращает 'HH:MM' или None.
    Поддерживает: '11:30', '11.30', '11 30', '11-30', '1130',
                  'в 11:30', 'на 11.30', '9:00', '9.00'
    """
    text = text.strip().lower()
    # Убираем предлоги
    text = re.sub(r'^(в|на|к)\s+', '', text)

    # HH:MM, HH.MM, HH-MM, HH MM
    m = re.search(r'(\d{1,2})[:\.\-\s](\d{2})\b', text)
    if m:
        h, mins = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mins <= 59:
            return f"{h:02d}:{mins:02d}"

    # Только час: '11', '9', 'в 11'
    m = re.match(r'^(\d{1,2})$', text)
    if m:
        h = int(m.group(1))
        if 7 <= h <= 20:
            return f"{h:02d}:00"

    return None


def parse_date(text: str) -> Optional[str]:
    """
    Парсинг даты из текста. Возвращает 'YYYY-MM-DD' или None.
    Поддерживает:
      - 'сегодня', 'завтра', 'послезавтра'
      - казахский: 'бүгін', 'ертең', 'бурсігүні'
      - '25 января', '25 қаңтар'
      - '25.01', '25/01', '25.01.2025'
      - '2025-01-25'
      - дни недели: 'понедельник', 'дүйсенбі' и т.д.
    """
    text = text.strip().lower()
    today = datetime.now()

    # Убираем предлоги
    text = re.sub(r'^(на|в|к|до)\s+', '', text)

    # --- Относительные даты: русский ---
    if text in ['сегодня', 'сёгодня']:
        return today.strftime('%Y-%m-%d')
    if text in ['завтра']:
        return (today + timedelta(days=1)).strftime('%Y-%m-%d')
    if text in ['послезавтра']:
        return (today + timedelta(days=2)).strftime('%Y-%m-%d')

    # --- Относительные даты: казахский ---
    if text in ['бүгін', 'бугін', 'bugín']:
        return today.strftime('%Y-%m-%d')
    if text in ['ертең', 'ертен', 'ертенге', 'ertең']:
        return (today + timedelta(days=1)).strftime('%Y-%m-%d')
    if text in ['бурсігүні', 'бүрсігүні', 'арғы күні']:
        return (today + timedelta(days=2)).strftime('%Y-%m-%d')

    # --- Дни недели: русский ---
    weekdays_ru = {
        'понедельник': 0, 'вторник': 1, 'среда': 2, 'среду': 2,
        'четверг': 3, 'пятница': 4, 'пятницу': 4,
        'суббота': 5, 'субботу': 5, 'воскресенье': 6,
    }
    if text in weekdays_ru:
        target_wd = weekdays_ru[text]
        current_wd = today.weekday()
        days_ahead = target_wd - current_wd
        if days_ahead <= 0:
            days_ahead += 7
        return (today + timedelta(days=days_ahead)).strftime('%Y-%m-%d')

    # --- Дни недели: казахский ---
    weekdays_kz = {
        'дүйсенбі': 0, 'дуйсенбі': 0, 'сейсенбі': 1, 'сәрсенбі': 2, 'сарсенбі': 2,
        'бейсенбі': 3, 'жұма': 4, 'жума': 4,
        'сенбі': 5, 'жексенбі': 6,
    }
    if text in weekdays_kz:
        target_wd = weekdays_kz[text]
        current_wd = today.weekday()
        days_ahead = target_wd - current_wd
        if days_ahead <= 0:
            days_ahead += 7
        return (today + timedelta(days=days_ahead)).strftime('%Y-%m-%d')

    # --- ISO формат: 2025-01-25 ---
    m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})$', text)
    if m:
        try:
            d = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return d.strftime('%Y-%m-%d')
        except ValueError:
            pass

    # --- DD.MM.YYYY или DD/MM/YYYY ---
    m = re.match(r'^(\d{1,2})[\.\/](\d{1,2})[\.\/](\d{4})$', text)
    if m:
        try:
            d = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            return d.strftime('%Y-%m-%d')
        except ValueError:
            pass

    # --- DD.MM или DD/MM (текущий год) ---
    m = re.match(r'^(\d{1,2})[\.\/](\d{1,2})$', text)
    if m:
        try:
            day, month = int(m.group(1)), int(m.group(2))
            year = today.year
            d = datetime(year, month, day)
            # Если дата уже прошла — берём следующий год
            if d.date() < today.date():
                d = datetime(year + 1, month, day)
            return d.strftime('%Y-%m-%d')
        except ValueError:
            pass

    # --- '25 января', '25 қаңтар', '3 марта' ---
    m = re.match(r'^(\d{1,2})\s+(\S+)', text)
    if m:
        day = int(m.group(1))
        month_word = m.group(2).lower()
        month_num = None

        # Русские месяцы (частичное совпадение)
        for prefix, num in MONTH_NAMES_RU.items():
            if month_word.startswith(prefix):
                month_num = num
                break

        # Казахские месяцы
        if not month_num:
            for kz_name, num in MONTH_NAMES_KZ.items():
                if month_word.startswith(kz_name):
                    month_num = num
                    break

        if month_num:
            try:
                year = today.year
                d = datetime(year, month_num, day)
                if d.date() < today.date():
                    d = datetime(year + 1, month_num, day)
                return d.strftime('%Y-%m-%d')
            except ValueError:
                pass

    return None


def parse_date_time(text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Парсит комбинированный ввод: 'завтра в 11.30', 'на 25 января в 10:00'.
    Возвращает (date_str, time_str) — каждый может быть None.
    """
    text = text.strip().lower()

    # Попробуем разделить по 'в' или 'на'
    # Паттерн: <дата> в <время>
    m = re.match(r'^(.+?)\s+(?:в|на|к)\s+(\d{1,2}[:\.\-\s]?\d{0,2})$', text)
    if m:
        date_part = m.group(1).strip()
        time_part = m.group(2).strip()
        parsed_date = parse_date(date_part)
        parsed_time = parse_time(time_part)
        if parsed_date and parsed_time:
            return parsed_date, parsed_time
        if parsed_date:
            return parsed_date, None

    # Попробуем найти время внутри текста
    time_match = re.search(r'(\d{1,2})[:\.](\d{2})', text)
    extracted_time = None
    if time_match:
        h, mins = int(time_match.group(1)), int(time_match.group(2))
        if 0 <= h <= 23 and 0 <= mins <= 59:
            extracted_time = f"{h:02d}:{mins:02d}"
            # Убираем время из текста чтобы парсить дату
            text_without_time = text[:time_match.start()] + text[time_match.end():]
            text_without_time = re.sub(r'\s*(в|на|к)\s*$', '', text_without_time).strip()
            text_without_time = re.sub(r'^\s*(в|на|к)\s*', '', text_without_time).strip()
            parsed_date = parse_date(text_without_time) if text_without_time else None
            if parsed_date:
                return parsed_date, extracted_time

    # Только дата
    parsed_date = parse_date(text)
    if parsed_date:
        return parsed_date, extracted_time

    # Только время
    parsed_time = parse_time(text)
    if parsed_time:
        return None, parsed_time

    return None, None


def format_date_human(date_str: str) -> str:
    """
    Преобразует 'YYYY-MM-DD' в человекочитаемый формат: '25 января 2025'.
    Если не удаётся распарсить — возвращает как есть.
    """
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d')
        today = datetime.now().date()
        if d.date() == today:
            return 'сегодня'
        if d.date() == today + timedelta(days=1):
            return 'завтра'
        month_name = MONTH_DISPLAY.get(d.month, '')
        return f"{d.day} {month_name} {d.year}"
    except (ValueError, TypeError):
        return date_str


# ======================================================
# ОСНОВНОЙ КЛАСС БОТА
# ======================================================

STATE_GREETING = "greeting"
STATE_COLLECTING_NAME = "collecting_name"
STATE_COLLECTING_AGE = "collecting_age"
STATE_COLLECTING_PHONE = "collecting_phone"
STATE_COLLECTING_DATE = "collecting_date"
STATE_COLLECTING_TIME = "collecting_time"
STATE_CONFIRMING = "confirming"

ALL_DATA_STATES = {
    STATE_COLLECTING_NAME, STATE_COLLECTING_AGE, STATE_COLLECTING_PHONE,
    STATE_COLLECTING_DATE, STATE_COLLECTING_TIME, STATE_CONFIRMING,
}

class MedicalBot:
    def __init__(self, session_id: str = "default"):
        self.session_id = session_id
        self.patient_data: Dict = {}
        self.current_step: str = STATE_GREETING
        self.appointment_data: Dict = {}
        self.has_offered_promo: bool = False
        self.last_service: Optional[str] = None
        self.selected_doctor: Optional[str] = None
        self._last_request_time: float = 0
        self._request_count: int = 0
        self._rate_limit_window: int = 60
        self._max_requests: int = 10
        logger.info(f"Bot initialized: session={session_id}")

    def reset(self):
        """Сброс состояния диалога."""
        self.patient_data = {}
        self.current_step = STATE_GREETING
        self.appointment_data = {}
        self.has_offered_promo = False
        self.last_service = None
        self.selected_doctor = None
        logger.info(f"Session {self.session_id}: dialog reset")

    def _check_rate_limit(self) -> Optional[str]:
        """Проверка rate limiting. Возвращает сообщение или None."""
        now = time.time()
        if now - self._last_request_time > self._rate_limit_window:
            self._request_count = 0
        self._last_request_time = now
        self._request_count += 1
        if self._request_count > self._max_requests:
            return "Подождите немного, пожалуйста. Обрабатываю ваш запрос."
        return None

    def _get_available_times(self, date_str: str) -> List[str]:
        """Получение доступного времени с учётом занятых слотов."""
        base_times = _data_store.booking_slots.get("base_times",
            ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"])
        min_slots = _data_store.booking_slots.get("min_slots", 4)
        max_slots = _data_store.booking_slots.get("max_slots", 6)
        booked = set()
        for b in _booking_store.get_all():
            if b["date"] == date_str and b["status"] == "confirmed":
                booked.add(b["time"])
        available = [t for t in base_times if t not in booked]
        count = random.randint(min_slots, min(max_slots, len(available)))
        count = min(count, len(available))
        return random.sample(available, max(count, 1)) if available else random.sample(base_times, min(3, len(base_times)))

    def _get_resume_message(self) -> str:
        """Сообщение для возврата к сбору данных."""
        resume_map = {
            STATE_COLLECTING_NAME: "Вернёмся к записи. Подскажите Ваше имя и фамилию.",
            STATE_COLLECTING_AGE: "Вернёмся к записи. Укажите, пожалуйста, возраст цифрами.",
            STATE_COLLECTING_PHONE: "Вернёмся к записи. Оставьте номер телефона для связи.",
            STATE_COLLECTING_DATE: "Вернёмся к записи. На какой день записать? Например: сегодня, завтра, 25 января.",
            STATE_COLLECTING_TIME: "Вернёмся к записи. Какое время из предложенных Вам подходит?",
            STATE_CONFIRMING: "Вернёмся к записи. Подтверждаете запись? (да/нет)",
        }
        return resume_map.get(self.current_step, "")

    def _handle_termination(self, message_lower: str) -> Optional[str]:
        """Обработка завершения диалога на любом этапе."""
        if any(p in message_lower for p in ["иди на", "пошёл на", "хуй", "пиздец", "нахуй", "отъебись"]):
            self.reset()
            return "Хорошо, всего доброго! Если понадобятся услуги — обращайтесь."
        if any(p in message_lower for p in ["нет не нужно", "прекратить", "закончить", "всё", "хватит", "не надо", "передумал", "спасибо не надо", "всё спасибо"]):
            self.reset()
            return "Понял, завершаю. Если решите записаться — обращайтесь в любое время!"
        if message_lower in ["спасибо", "благодарю", "спасибо большое"]:
            self.reset()
            return "Всегда рады помочь! Если понадобятся услуги — обращайтесь. Здоровья Вам!"
        if message_lower in ["нет", "не хочу", "отмена", "stop", "стоп"]:
            if self.current_step != STATE_GREETING:
                self.reset()
                return "Хорошо, отменил запись. Чем ещё могу помочь?"
            else:
                return "Хорошо, не буду настаивать. Если что — обращайтесь!"
        return None

    def _detect_service(self, message: str) -> Tuple[Optional[str], Optional[Dict]]:
        """Определение услуги по сообщению. Возвращает (key, data) или (None, None)."""
        message_lower = message.lower()
        
        # Исключаем запросы про врачей
        if any(p in message_lower for p in ["кто врач", "какие врач", "список врач", "наши врач", "врач", "доктор", "специалист"]):
            return None, None
        
        mrt_patterns = ["мрт головного", "мрт пояснич", "мрт шейн", "мрт брюш", "мрт спины", "мрт живота"]
        uzi_patterns = ["узи щитовид", "узи сосудов", "узи шеи", "узи бца"]
        has_specific_mrt = any(p in message_lower for p in mrt_patterns)
        has_specific_uzi = any(p in message_lower for p in uzi_patterns)

        if not has_specific_mrt and "мрт" in message_lower:
            has_other_kw = False
            for svc in _data_store.services.values():
                for kw in svc.get("keywords", []):
                    if len(kw) >= 5 and kw in message_lower:
                        has_other_kw = True
                        break
                if has_other_kw:
                    break
            if not has_other_kw:
                return "mrt_general", None

        if not has_specific_uzi and "узи" in message_lower:
            has_other_kw = False
            for svc in _data_store.services.values():
                for kw in svc.get("keywords", []):
                    if len(kw) >= 5 and kw in message_lower:
                        has_other_kw = True
                        break
                if has_other_kw:
                    break
            if not has_other_kw:
                return "uzi_general", None

        service = get_service_by_keyword(message)
        if service:
            return service["id"], service
        return None, None

    def process_message(self, message: str) -> str:
        """Обработка сообщения пациента с поддержкой транслитерации."""
        if not message or not message.strip():
            return "Извините, не понял Ваш вопрос. Попробуйте перефразировать."

        # 1. Транслитерация: орыс пернетақтасындағы қазақша мәтінді түзету
        fixed_message = fix_kazakh_transliteration(message.strip())
        message_lower = fixed_message.lower()

        # 2. Тілді анықтау (қазақша/орысша) — қажет болса кейін қолдануға болады
        lang = detect_language(fixed_message)

        # 3. Rate limiting
        rate_msg = self._check_rate_limit()
        if rate_msg:
            return rate_msg

        # 4. Аяқтау/тоқтату сөздерін өңдеу
        term = self._handle_termination(message_lower)
        if term:
            return term

        # 5. Операторға беру триггерлері
        if check_operator_transfer(fixed_message):
            return self._transfer_to_operator(fixed_message)

        # 6. Дәрігерді анықтау
        doctor = detect_doctor(fixed_message)
        if doctor:
            self.selected_doctor = doctor["name"]
            return (f"Отличный выбор! {doctor['name']} — {doctor['specialty']}, стаж {doctor['experience']}.\n\n"
                    f"Какое исследование хотите пройти? Например: МРТ головного мозга, УЗИ щитовидной железы.")

        # 7. Симптомдар бойынша анықтау
        symptom_service = detect_symptom(fixed_message)
        if symptom_service:
            return self._handle_symptom(fixed_message, symptom_service)

        # 8. Қызметті анықтау
        service_key, service_data = self._detect_service(fixed_message)

        if service_key == "mrt_general":
            clinic = get_clinic()
            services = _data_store.services
            return (
                "У нас есть несколько видов МРТ:\n"
                f"• МРТ головного мозга — {format_price(services['mrt_brain']['price'])} тг\n"
                f"• МРТ поясничного отдела — {format_price(services['mrt_lumbar']['price'])} тг\n"
                f"• МРТ шейного отдела — {format_price(services['mrt_cervical']['price'])} тг\n"
                f"• МРТ брюшной полости — {format_price(services['mrt_abdominal']['price'])} тг\n\n"
                "Какое исследование Вас интересует?"
            )

        if service_key == "uzi_general":
            services = _data_store.services
            return (
                "У нас есть несколько видов УЗИ:\n"
                f"• УЗИ щитовидной железы — {format_price(services['uzi_thyroid']['price'])} тг\n"
                f"• УЗИ сосудов шеи (БЦА) — {format_price(services['uzi_vessels']['price'])} тг\n\n"
                "Какое исследование Вас интересует?"
            )

        if service_data:
            return self._handle_service_inquiry(service_key, service_data, fixed_message)

        # 9. Егер диалог жазу кезеңінде болса
        if self.current_step != STATE_GREETING:
            return self._handle_booking_flow(fixed_message, message_lower)

        # 10. "Врачқа бару" және т.б.
        if any(p in message_lower for p in ["к врачу", "к максат", "к доктору", "к специалисту",
                                              "консультация врача", "посоветоваться с врачом",
                                              "узнать болезнь", "какая болезнь", "диагноз"]):
            return ("Понимаю Ваше беспокойство. Для консультации врача нужно сначала пройти обследование "
                    "(МРТ или УЗИ). По результатам врач сможет дать рекомендации.\n\n"
                    "Какое исследование хотите пройти? Или опишите симптомы — подскажу какое МРТ/УЗИ нужно.")

        # 11. Жазылымға келісім
        if message_lower in ["да", "хочу записаться", "запишите", "записаться", "ок", "ok"]:
            self.current_step = STATE_COLLECTING_NAME
            return "Отлично! Для записи подскажите, пожалуйста, Ваше имя и фамилию."

        # 12. Жалпы сұрақтар
        return self._handle_general_inquiry(fixed_message)

    def _handle_booking_flow(self, message: str, message_lower: str) -> str:
        """Обработка диалога в процессе записи."""
        question_words = ["что если", "а что", "а как", "а если", "узнать", "расскажите",
                          "объясните", "почему", "шейн", "голова", "колени", "живот",
                          "щитовид", "сосуды", "комплекс", "скидк", "выгодн"]
        if any(w in message_lower for w in question_words):
            response = self._handle_question_in_process(message)
            resume = self._get_resume_message()
            return f"{response}\n\n{resume}" if resume else response

        if message_lower in ["да", "хочу комплекс", "комплекс", "оформить комплекс"]:
            return self._handle_complex_confirmation()

        if self.current_step == STATE_COLLECTING_NAME:
            if message_lower in ["да", "ок", "ok", "yes", "хорошо", "ага"]:
                return "Подскажите Ваше имя и фамилию (например: Иван Петров)."
            if message.strip().isdigit() or any(m in message_lower for m in
                ["число", "июля", "июня", "января", "февраля", "марта", "апреля",
                 "мая", "августа", "сентября", "октября", "ноября", "декабря"]):
                return "Сначала нужно Ваше имя и фамилия. На какой день записать — спрошу потом."
            self.patient_data["name"] = message.strip()
            self.current_step = STATE_COLLECTING_AGE
            return get_random(AGE_REQUESTS)

        elif self.current_step == STATE_COLLECTING_AGE:
            try:
                age = int(message.strip())
                if 0 < age < 120:
                    self.patient_data["age"] = age
                    self.current_step = STATE_COLLECTING_PHONE
                    return get_random(PHONE_REQUESTS)
                return "Пожалуйста, укажите корректный возраст (0-120 лет)."
            except ValueError:
                return "Пожалуйста, укажите возраст цифрами."

        elif self.current_step == STATE_COLLECTING_PHONE:
            if any(c in message for c in ["+", "7", "8", "(", ")"]) or len(message.replace(" ", "")) >= 10:
                self.patient_data["phone"] = message.strip()
                self.current_step = STATE_COLLECTING_DATE
                return get_random(DATE_REQUESTS)
            return "Пожалуйста, укажите номер телефона (например: +7 777 123 45 67)."

        elif self.current_step == STATE_COLLECTING_DATE:
            # Пробуем парсить дату + время из одного сообщения
            parsed_date, parsed_time = parse_date_time(message)

            if parsed_date:
                self.appointment_data["date"] = parsed_date
                date_display = format_date_human(parsed_date)

                # Если время тоже указано — пропускаем шаг выбора времени
                if parsed_time:
                    self.appointment_data["time"] = parsed_time
                    self.current_step = STATE_CONFIRMING
                    return self._create_confirmation_message()

                # Только дата — предлагаем время
                times = self._get_available_times(parsed_date)
                times_str = ", ".join(sorted(times)[:5])
                self.current_step = STATE_COLLECTING_TIME
                return get_random(TIME_OFFERS).format(date=date_display, times=times_str)

            # Не удалось распознать дату — сохраняем как есть (fallback)
            self.appointment_data["date"] = message.strip()
            times = self._get_available_times(message.strip())
            times_str = ", ".join(sorted(times)[:5])
            self.current_step = STATE_COLLECTING_TIME
            return (f"Не смог точно определить дату, но записал «{message.strip()}».\n"
                    + get_random(TIME_OFFERS).format(date=message.strip(), times=times_str)
                    + "\n\n💡 Совет: для точной записи используйте формат «25 января» или «завтра».")

        elif self.current_step == STATE_COLLECTING_TIME:
            # Парсим время
            parsed_time = parse_time(message)
            if parsed_time:
                self.appointment_data["time"] = parsed_time
            else:
                # Fallback: сохраняем как есть
                self.appointment_data["time"] = message.strip()
            self.current_step = STATE_CONFIRMING
            return self._create_confirmation_message()

        elif self.current_step == STATE_CONFIRMING:
            if message_lower in ["да", "подтверждаю", "yes", "ок", "ok"]:
                return self._complete_booking()
            self.current_step = STATE_COLLECTING_DATE
            return "Хорошо, давайте выберем другую дату. Когда Вам удобно?"

        return "Что-то пошло не так. Начнём заново? Напишите 'да' или 'хочу записаться'."

    def _handle_complex_confirmation(self) -> str:
        """Подтверждение комплекса."""
        service_name = self.appointment_data.get("service", "")
        service = _data_store.services_by_name.get(service_name)
        if not service:
            return self._get_resume_message()
        complex_item = find_complex_for_service(service)
        if complex_item:
            self.appointment_data["service"] = (f"Комплекс \"{complex_item['name']}\" "
                f"({', '.join(complex_item['services'])})")
            return (f"Отлично! Записываю на комплекс \"{complex_item['name']}\" "
                    f"за {format_price(complex_item['discounted_price'])} тг "
                    f"вместо {format_price(complex_item['original_price'])} тг.\n\n"
                    f"{self._get_resume_message()}")
        return self._get_resume_message()

    def _handle_service_inquiry(self, service_id: str, service: Dict, message: str) -> str:
        """Обработка запроса об услуге."""
        self.last_service = service_id
        response = get_random(PRICE_RESPONSES).format(
            service=service["name"],
            price=format_price(service["price"]),
            duration=service["duration"],
        )
        complex_item = find_complex_for_service(service)
        if complex_item and random.random() < 0.8:
            response += get_random(COMPLEX_OFFERS).format(
                complex_name=complex_item["name"],
                services=" + ".join(complex_item["services"]),
                discount=complex_item["discount_percent"],
                price=format_price(complex_item["discounted_price"]),
                original=format_price(complex_item["original_price"]),
            )
            self.has_offered_promo = True
        if not self.has_offered_promo and random.random() < 0.5:
            response += "\n\n" + get_random(SOFT_SELL_PHRASES)
            self.has_offered_promo = True
        self.current_step = STATE_COLLECTING_NAME
        self.appointment_data["service"] = service["name"]
        return response

    def _handle_symptom(self, message: str, service: Dict) -> str:
        """Обработка жалобы с предложением услуги."""
        self.last_service = service["id"]
        response = get_random(SYMPTOM_RESPONSES).format(
            service=service["name"],
            price=format_price(service["price"]),
        )
        complex_item = find_complex_for_service(service)
        if complex_item and random.random() < 0.7:
            response += get_random(COMPLEX_OFFERS).format(
                complex_name=complex_item["name"],
                services=" + ".join(complex_item["services"]),
                discount=complex_item["discount_percent"],
                price=format_price(complex_item["discounted_price"]),
                original=format_price(complex_item["original_price"]),
            )
        self.current_step = STATE_COLLECTING_NAME
        self.appointment_data["service"] = service["name"]
        return response

    def _handle_question_in_process(self, message: str) -> str:
        """Умная обработка вопросов во время сбора данных — без дублирования."""
        service = get_service_by_keyword(message)
        if service:
            return (f"{service['name']} стоит {format_price(service['price'])} тенге. "
                    f"Исследование занимает {service['duration']}.")
        complex_item = find_complex_for_service({"id": "temp"}) if False else None
        if any(w in message.lower() for w in ["комплекс", "скидк", "выгодн"]):
            complexes = get_complexes()
            if complexes:
                cx = complexes[0]
                return (f"Комплекс «{cx['name']}» — это {', '.join(cx['services'])}. "
                        f"Обычная цена {format_price(cx['original_price'])} тг, "
                        f"со скидкой {cx['discount_percent']}% — {format_price(cx['discounted_price'])} тг.")

        return "Могу рассказать про любую услугу (МРТ головы, шеи, живота, коленей, УЗИ). Что именно Вас интересует?"

    def _handle_general_inquiry(self, message: str) -> str:
        """Обработка общих вопросов без перехода в поток записи."""
        message_lower = message.lower()
        clinic = get_clinic()

        if any(w in message_lower for w in ["адрес", "где находитесь", "как добраться", "где вы", "расположение", "метро", "район"]):
            return get_random(ADDRESS_RESPONSES).format(
                address=clinic["address"],
                landmarks=clinic["landmarks"],
                geo=clinic["geo_location"],
            )

        if any(w in message_lower for w in ["график", "режим работы", "когда работаете", "часы работы", "время работы"]):
            return get_random(SCHEDULE_RESPONSES).format(
                days=clinic["work_days"],
                start=clinic["work_hours"]["start"],
                end=clinic["work_hours"]["end"],
            )

        if any(w in message_lower for w in ["телефон", "контакт", "связаться", "позвонить", "номер"]):
            return get_random(PHONE_INFO_RESPONSES).format(
                phones=", ".join(clinic["phones"]),
                whatsapp=clinic["whatsapp"],
            )

        if any(w in message_lower for w in ["акция", "скидка", "специальное предложение", "выгодно"]):
            response = "🎁 Действующие акции:\n"
            for promo in get_promotions():
                response += f"• {promo['title']} — {promo['description']} (до {promo['valid_until']})\n"
            response += "\n" + get_random(SOFT_SELL_PHRASES)
            return response

        if any(w in message_lower for w in ["врач", "доктор", "специалист", "медик"]):
            if any(w in message_lower for w in ["консультация", "лечение назнач", "диагноз постав"]):
                return get_random(NO_DIAGNOSIS_RESPONSES)
            doctor = detect_doctor(message)
            if doctor:
                self.selected_doctor = doctor["name"]
                return (f"Отличный выбор! {doctor['name']} — {doctor['specialty']}, "
                        f"стаж {doctor['experience']}.\n\nКакое исследование хотите пройти?")
            doctors = get_doctors()
            response = "👨‍⚕️ Наши специалисты:\n"
            for doc in doctors:
                response += f"• {doc['name']} — {doc['specialty']}, стаж {doc['experience']}\n"
            response += "\nНапишите имя врача для записи или задайте вопрос."
            return response

        if any(w in message_lower for w in ["цена", "стоимость", "сколько стоит", "прайс"]):
            return "У нас есть МРТ и УЗИ исследования. Подскажите, какое направление Вас интересует?"

        if any(w in message_lower for w in ["записаться", "запись", "запишит"]):
            return "Конечно, помогу записаться! Какое исследование Вам нужно?"

        doctor = detect_doctor(message)
        if doctor:
            self.selected_doctor = doctor["name"]
            return (f"Отличный выбор! {doctor['name']} — {doctor['specialty']}, "
                    f"стаж {doctor['experience']}.\n\nКакое исследование хотите пройти?")

        if any(w in message_lower for w in ["привет", "здравствуй", "добрый", "hello", "hi"]):
            clinic = get_clinic()
            clinic_name = clinic.get("name", "Nomad Clinic")
            return random.choice(GREETINGS).format(clinic=clinic_name)

        if any(w in message_lower for w in ["спасибо", "благодарю", "пока", "до свидания"]):
            return "Всегда рады помочь! Если будут ещё вопросы — обращайтесь. Здоровья Вам!"

        return ("Извините, не совсем понял Ваш вопрос. Я могу помочь с записью на:\n\n"
                "• МРТ (головы, поясницы, шеи, живота)\n"
                "• УЗИ (щитовидки, сосудов шеи)\n"
                "• КТ / МСКТ\n"
                "• Рентген (X-ray)\n"
                "• Маммографию\n"
                "• ЭКГ и ЭЭГ\n\n"
                "Или задайте вопрос про адрес, график работы, цены.")

    def _create_confirmation_message(self) -> str:
        raw_date = self.appointment_data.get('date', '')
        display_date = format_date_human(raw_date)
        details = f"👤 {self.patient_data.get('name', '')}"
        if self.selected_doctor:
            details += f"\n👨‍⚕️ Врач: {self.selected_doctor}"
        details += (f"\n📋 {self.appointment_data.get('service', '')}\n"
                    f"📅 {display_date} в {self.appointment_data.get('time', '')}\n"
                    f"📞 {self.patient_data.get('phone', '')}")
        return get_random(CONFIRMATION_REQUESTS).format(details=details)

    def _complete_booking(self) -> str:
        """Завершение записи с проверкой конфликтов."""
        patient_name = self.patient_data.get("name", "Не указано")
        service_name = self.appointment_data.get("service", "Не указано")
        date = self.appointment_data.get("date", "")
        time_slot = self.appointment_data.get("time", "")
        phone = self.patient_data.get("phone", "")
        age = self.patient_data.get("age")
        doctor = self.selected_doctor

        booking_id = _booking_store.add(
            patient_name=patient_name,
            service_name=service_name,
            date=date,
            time=time_slot,
            phone=phone,
            age=age,
            doctor=doctor,
        )
        self.reset()
        if booking_id is None:
            return (f"К сожалению, на {date} в {time_slot} уже есть запись. "
                    "Пожалуйста, выберите другое время.")
        logger.info(f"Booking confirmed: id={booking_id}, patient={patient_name}, service={service_name}")
        return get_random(BOOKING_SUCCESS)

    def _transfer_to_operator(self, message: str) -> str:
        clinic = get_clinic()
        return get_random(OPERATOR_TRANSFER).format(phone=clinic["phones"][0])

    def get_greeting(self) -> str:
        clinic = get_clinic()
        clinic_name = clinic.get("name", "Nomad Clinic")
        return random.choice(GREETINGS).format(clinic=clinic_name)
    