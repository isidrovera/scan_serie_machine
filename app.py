# app.py
# -*- coding: utf-8 -*-

import os
import re
import base64
import logging
from datetime import datetime
import traceback

from dotenv import load_dotenv
load_dotenv()

import requests
from flask import (
    Flask, jsonify, Response, request, send_from_directory, redirect
)

from werkzeug.exceptions import HTTPException

from google import genai
from google.genai import types

# ----------------- Configuración básica -----------------

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")

logging.basicConfig(level=logging.INFO)
_logger = logging.getLogger(__name__)

# URL base de Odoo
ODOO_BASE_URL = os.environ.get(
    "ODOO_BASE_URL",
    "https://andessolutioncopiers.com"
)

# Ruta del endpoint JSON de Odoo
ODOO_CHECKIN_PATH = os.environ.get("ODOO_CHECKIN_PATH", "/sat/api/checkin")

# Timeout para la llamada a Odoo
ODOO_TIMEOUT = float(os.environ.get("ODOO_TIMEOUT", "10"))

# ----------------- CORS (para llamar desde Odoo -> Tunnel) -----------------
# Pon aquí tu dominio de Odoo. Puedes poner "*" para pruebas, pero mejor fijo.
CORS_ALLOW_ORIGIN = os.environ.get("CORS_ALLOW_ORIGIN", ODOO_BASE_URL)

# ----------------- Gemini OCR -----------------
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
_GEMINI_CLIENT = None


def get_gemini_client() -> genai.Client:
    global _GEMINI_CLIENT
    if _GEMINI_CLIENT is not None:
        return _GEMINI_CLIENT

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "No se encontró GEMINI_API_KEY ni GOOGLE_API_KEY en las variables de entorno. "
            "Configura tu API key antes de usar el OCR."
        )

    _logger.info("Inicializando cliente Gemini...")
    _GEMINI_CLIENT = genai.Client(api_key=api_key)
    return _GEMINI_CLIENT


def _decode_data_url(data_url: str):
    if not data_url:
        raise ValueError("Data URL vacío")

    mime_type = "image/jpeg"
    b64 = data_url

    if data_url.startswith("data:"):
        header, b64_part = data_url.split(",", 1)
        b64 = b64_part
        m = re.match(r"data:(.*?);base64", header)
        if m and m.group(1):
            mime_type = m.group(1)

    image_bytes = base64.b64decode(b64)
    return image_bytes, mime_type


def run_ocr(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    client = get_gemini_client()

    image_part = types.Part.from_bytes(
        data=image_bytes,
        mime_type=mime_type,
    )

    prompt = (
        "Lee todo el texto legible de esta imagen. "
        "Devuélvelo como un único bloque de texto plano, "
        "sin comentarios adicionales, sin explicaciones, "
        "sin traducir y sin añadir palabras que no estén en la imagen."
    )

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[image_part, prompt],
    )

    text = response.text or ""
    _logger.info(f"[Gemini OCR] Detectados {len(text)} chars: {text[:400]!r}")
    return text


def extract_serial_candidates(text: str):
    clean = (text or "").upper()
    base = re.sub(r"\s+", " ", clean)

    candidates = []

    def add_from_text(t: str, bonus: bool = False):
        t = re.sub(r"[^A-Z0-9\-\/ ]", " ", t)
        t = re.sub(r"\s+", " ", t)
        for s in re.findall(r"\b[A-Z0-9][A-Z0-9\-\/]{2,17}\b", t):
            if not re.search(r"\d", s):
                continue
            label = "BONUS" if bonus else "NORMAL"
            candidates.append((label, s))

    m = re.search(
        r"(NUMERO\s+DE\s+SERIE|N[ÚU]MERO\s+DE\s+SERIE|NO\.?\s+SERIE|N[°O]\s*SERIE)(.+)",
        base
    )
    if m:
        zone = m.group(2)[:80]
        add_from_text(zone, bonus=True)

    add_from_text(base, bonus=False)

    seen = set()
    unique = []
    for label, s in candidates:
        if s not in seen:
            seen.add(s)
            unique.append((label, s))

    if not unique:
        return [], None

    def score(label: str, s: str) -> float:
        length = len(s)
        digits = sum(ch.isdigit() for ch in s)
        letters = sum(ch.isalpha() for ch in s)
        dash_count = s.count("-") + s.count("/")
        balance_penalty = abs(digits - max(1, letters))
        short_penalty = 3 if length < 5 else 0
        long_penalty = 2 if length > 15 else 0
        dash_penalty = dash_count
        bonus = 5 if label == "BONUS" else 0
        return bonus + length - balance_penalty - dash_penalty - short_penalty - long_penalty

    unique.sort(key=lambda v: score(*v), reverse=True)
    best = unique[0][1]
    all_codes = [s for _, s in unique]
    return all_codes, best


def create_app():
    app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")

    # ---------- CORS headers ----------
    @app.after_request
    def add_cors_headers(resp):
        # Permitir llamadas desde Odoo (o desde donde pongas en CORS_ALLOW_ORIGIN)
        resp.headers["Access-Control-Allow-Origin"] = CORS_ALLOW_ORIGIN
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return resp

    # Preflight OPTIONS (importante en móvil/navegador)
    @app.route("/api/ocr", methods=["OPTIONS"])
    @app.route("/api/scan", methods=["OPTIONS"])
    @app.route("/health", methods=["OPTIONS"])
    def cors_preflight():
        return Response(status=204)

    # --------------- UI ----------------
    # ✅ Para que el dominio (/) no devuelva 404
    @app.get("/")
    def home():
        # Mantiene la misma lógica: sirve la UI de scanner
        return send_from_directory(STATIC_DIR, "scanner.html")

    @app.get("/scan")
    def scan_page():
        return send_from_directory(STATIC_DIR, "scanner.html")

    @app.get("/favicon.ico")
    def favicon():
        return Response(status=204)

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "time": datetime.utcnow().isoformat() + "Z"})

    # --------------- Helper: llamada a Odoo ----------------
    def call_odoo_checkin(payload):
        url = ODOO_BASE_URL.rstrip("/") + ODOO_CHECKIN_PATH
        headers = {"Content-Type": "application/json"}

        _logger.info("[FLASK] -> Odoo URL=%s payload=%s", url, payload)
        resp = requests.post(url, json=payload, headers=headers, timeout=ODOO_TIMEOUT)

        body_text = resp.text or ""
        _logger.info("[FLASK] <- Odoo status=%s ct=%s body[0:300]=%r",
                     resp.status_code, resp.headers.get("content-type"), body_text[:300])

        if resp.status_code >= 400:
            raise requests.exceptions.HTTPError(
                f"Odoo HTTP {resp.status_code}. Body[0:300]={body_text[:300]!r}"
            )

        try:
            data = resp.json()
        except Exception:
            raise ValueError(f"Odoo no devolvió JSON. body[0:300]={body_text[:300]!r}")

        return data

    # ✅ Manejo correcto: no convertir 404/405/etc en 500 "Error interno"
    @app.errorhandler(Exception)
    def handle_any_error(e):
        # Si es un error HTTP (404/405/etc.), devolverlo tal cual (sin trace)
        if isinstance(e, HTTPException):
            return jsonify({
                "ok": False,
                "message": e.name,
                "error": str(e),
            }), e.code

        _logger.exception("[FLASK] Unhandled error: %s", e)
        return jsonify({
            "ok": False,
            "message": "Error interno en Flask",
            "error": str(e),
            "trace": traceback.format_exc()[:4000],
        }), 500

    # --------------- API para lookup/confirm (proxy a Odoo) ----------------
    @app.post("/api/scan")
    def api_scan():
        try:
            data = request.get_json(force=True) or {}
        except Exception:
            data = {}

        value = (data.get("value") or "").strip()
        source = (data.get("source") or "unknown").strip()
        mode = (data.get("mode") or "lookup").strip().lower()
        status = (data.get("status") or "").strip().lower()
        observation = (data.get("observation") or "").strip()
        search_mode = (data.get("search_mode") or "").strip().lower()

        if not value:
            return jsonify({"ok": False, "message": "No se recibió valor a validar."}), 400

        odoo_payload = {
            "serial": value,
            "source": source,
            "raw_value": value,
            "action": "lookup" if mode == "lookup" else "confirm",
        }

        if mode == "lookup":
            if search_mode in ("exact", "partial"):
                odoo_payload["search_mode"] = search_mode
            else:
                odoo_payload["search_mode"] = "partial" if len(value) <= 4 else "exact"
        else:
            odoo_payload.update({"status": status, "observation": observation})

        try:
            odoo_res = call_odoo_checkin(odoo_payload)
        except requests.exceptions.RequestException as e:
            return jsonify({"ok": False, "message": f"Error al contactar Odoo: {e}"}), 502
        except ValueError:
            return jsonify({"ok": False, "message": "Respuesta no válida desde Odoo."}), 502

        return jsonify({"ok": True, "odoo": odoo_res})

    # --------------- API OCR ----------------
    @app.post("/api/ocr")
    def api_ocr():
        try:
            data = request.get_json(force=True) or {}
        except Exception:
            data = {}

        img_data_url = (data.get("image") or "").strip()
        if not img_data_url:
            return jsonify({"ok": False, "message": "No se recibió imagen para OCR."}), 400

        try:
            img_bytes, mime_type = _decode_data_url(img_data_url)
        except Exception:
            return jsonify({"ok": False, "message": "No se pudo decodificar la imagen."}), 400

        try:
            text_raw = run_ocr(img_bytes, mime_type=mime_type)
        except Exception:
            return jsonify({"ok": False, "message": "Error interno al procesar la imagen."}), 500

        text_norm = re.sub(r"\s+", " ", (text_raw or "")).strip()
        candidates, best = extract_serial_candidates(text_raw)

        return jsonify({
            "ok": True,
            "message": "OCR ejecutado correctamente.",
            "text": text_norm,
            "candidates": candidates,
            "best": best,
        })

    return app


if __name__ == "__main__":
    app = create_app()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", 5005))
    print(f"Open: http://127.0.0.1:{port}/")
    app.run(host=host, port=port, debug=True)
