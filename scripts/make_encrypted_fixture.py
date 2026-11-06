"""Creates tests/fixtures/encrypted.pdf (password: "secret") from tests/fixtures/sample.pdf.

Requires pypdf:  python -m pip install pypdf   (use a virtualenv)
Usage:           python scripts/make_encrypted_fixture.py
"""
from pathlib import Path

from pypdf import PdfReader, PdfWriter

fixtures = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
reader = PdfReader(fixtures / "sample.pdf")
writer = PdfWriter()
writer.append(reader)
writer.encrypt(user_password="secret", owner_password="owner-secret", algorithm="AES-256")
with open(fixtures / "encrypted.pdf", "wb") as f:
    writer.write(f)
print("Wrote", fixtures / "encrypted.pdf")
