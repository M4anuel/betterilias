"""Encode native assignment forms, including unselected file controls."""

from secrets import token_hex
from typing import Mapping, Sequence


def encode_assignment_form(values: Mapping[str, str], file_inputs: Sequence[str]) -> tuple[bytes, str]:
    """Match browser FormData's empty uploads (PHP UPLOAD_ERR_NO_FILE).

    HTTPX omits the filename parameter for a falsy filename. PHP consequently
    puts that part in $_POST instead of $_FILES, failing ILIAS file validation.
    An explicit filename="" is necessary even for optional, unchecked subforms.
    """
    boundary = token_hex(24)
    parts: list[bytes] = []

    def disposition(name: str) -> bytes:
        # HTML multipart header escaping; never allow names to inject headers.
        escaped = name.replace('\r', '%0D').replace('\n', '%0A').replace('"', '%22')
        return f'Content-Disposition: form-data; name="{escaped}"'.encode('utf-8')

    for name, value in values.items():
        # Native HTML form submission normalizes text line endings to CRLF.
        value = value.replace('\r\n', '\n').replace('\r', '\n').replace('\n', '\r\n')
        parts.extend((f'--{boundary}\r\n'.encode(), disposition(name),
                      b'\r\n\r\n', value.encode('utf-8'), b'\r\n'))
    for name in file_inputs:
        parts.extend((f'--{boundary}\r\n'.encode(), disposition(name),
                      b'; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n'))
    parts.append(f'--{boundary}--\r\n'.encode())
    return b''.join(parts), f'multipart/form-data; boundary={boundary}'
