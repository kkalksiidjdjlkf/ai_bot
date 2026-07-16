import re

with open('issai_service.py', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace(
"""            whisper_pipe_kz = pipeline(
                "automatic-speech-recognition",
                model=LOCAL_WHISPER_MODEL_KZ,
                device=device,
                torch_dtype=torch_dtype
            )""",
"""            whisper_pipe_kz = pipeline(
                "automatic-speech-recognition",
                model=LOCAL_WHISPER_MODEL_KZ,
                device=device,
                torch_dtype=torch_dtype,
                model_kwargs={"local_files_only": True}
            )"""
)

code = code.replace(
"""            whisper_pipe_ru = pipeline(
                "automatic-speech-recognition",
                model=LOCAL_WHISPER_MODEL_RU,
                device=device,
                torch_dtype=torch_dtype
            )""",
"""            whisper_pipe_ru = pipeline(
                "automatic-speech-recognition",
                model=LOCAL_WHISPER_MODEL_RU,
                device=device,
                torch_dtype=torch_dtype,
                model_kwargs={"local_files_only": True}
            )"""
)

with open('issai_service.py', 'w', encoding='utf-8') as f:
    f.write(code)

print("Success")
