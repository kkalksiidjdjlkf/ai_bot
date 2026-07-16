import requests
import base64
import os

with open("test_audio.ogg", "wb") as f:
    f.write(b"OggS" + b"\0" * 100) # Dummy ogg file

with open("test_audio.ogg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

for lang in ["ru", "kk"]:
    try:
        r = requests.post("http://127.0.0.1:8001/stt/recognize", json={
            "audio_base64": b64,
            "mime_type": "audio/ogg",
            "language": lang
        })
        print(f"{lang} response:", r.status_code, r.text)
    except Exception as e:
        print(f"Error for {lang}:", e)
