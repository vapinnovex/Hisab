"""Bounded, serialized CPU inference. Images are never written to disk or logged."""

import base64
import hashlib
import io
import json
from pathlib import Path
from threading import Lock

import cv2
import numpy as np
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from PIL import Image

MODEL_VERSION = "yunet-2023mar+sface-2021dec:align-v1"
MODEL_HASHES = {
    "face_detection_yunet_2023mar.onnx": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    "face_recognition_sface_2021dec.onnx": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}


def cipher(settings):
    key = settings.face_encryption_key
    if not key and settings.app_env in {"test", "development"}:
        key = base64.urlsafe_b64encode(hashlib.sha256((settings.jwt_secret + ":faces").encode()).digest())
    try:
        return Fernet(key)
    except (ValueError, TypeError):
        raise HTTPException(
            503, "Face storage is not configured. Ask your administrator to set FACE_ENCRYPTION_KEY."
        )


def seal(settings, vectors):
    return cipher(settings).encrypt(json.dumps(vectors).encode()).decode()


def unseal(settings, value):
    try:
        return json.loads(cipher(settings).decrypt(value.encode()))
    except (InvalidToken, ValueError):
        raise HTTPException(503, "Face data cannot be read. Contact your administrator.")


def similarity(left, right):
    return float(np.dot(left, right))


def rank(vectors, profiles, settings):
    """Use the weakest frame's best reference match, so every frame must agree."""
    scores = []
    for member_id, profile in profiles.items():
        if profile.get("model") != MODEL_VERSION:
            continue
        refs = unseal(settings, profile["template"])
        score = min(max(similarity(v, r) for r in refs) for v in vectors)
        scores.append((score, member_id))
    return sorted(scores, reverse=True)


class FaceEngine:
    def __init__(self, settings):
        self.settings = settings
        self.lock = Lock()
        self.detector = None
        self.recognizer = None

    def _load(self):
        if self.detector is not None:
            return
        directory = (
            Path(self.settings.face_models_dir)
            if self.settings.face_models_dir
            else Path(__file__).resolve().parents[1] / "models"
        )
        for name, expected in MODEL_HASHES.items():
            path = directory / name
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise HTTPException(
                    503, "Face models are missing or have changed. Contact your administrator."
                )
        cv2.setNumThreads(1)
        try:
            detector = cv2.FaceDetectorYN.create(
                str(directory / "face_detection_yunet_2023mar.onnx"), "", (640, 480), 0.9
            )
            recognizer = cv2.FaceRecognizerSF.create(
                str(directory / "face_recognition_sface_2021dec.onnx"), ""
            )
        except cv2.error:
            raise HTTPException(503, "Face models could not be loaded. Contact your administrator.")
        self.detector, self.recognizer = detector, recognizer

    def ready(self):
        cipher(self.settings)
        if not self.lock.acquire(timeout=0.1):
            raise HTTPException(503, "Face station is busy. Try again shortly.")
        try:
            self._load()
        finally:
            self.lock.release()

    def extract(self, frames):
        if not self.lock.acquire(timeout=0.1):
            raise HTTPException(503, "Face station is busy. Try again shortly.")
        try:
            self._load()
            vectors = [self._extract(frame) for frame in frames]
            if any(similarity(vectors[0], v) < self.settings.face_match_threshold for v in vectors[1:]):
                raise HTTPException(422, "Samples do not agree. Keep one person in view and try again.")
            return vectors
        finally:
            self.lock.release()

    def _extract(self, frame):
        try:
            data = base64.b64decode(frame, validate=True)
            # Read dimensions before decoding pixel data (including compressed image bombs).
            with Image.open(io.BytesIO(data)) as image:
                if image.format != "JPEG" or not (160 <= image.width <= 1280 and 160 <= image.height <= 1280):
                    raise ValueError()
            image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError()
        except (ValueError, OSError, Image.DecompressionBombError):
            raise HTTPException(422, "Use a clear camera JPEG between 160 and 1280 pixels.")
        self.detector.setInputSize((image.shape[1], image.shape[0]))
        _, faces = self.detector.detect(image)
        if faces is None or len(faces) != 1:
            raise HTTPException(422, "Keep exactly one face in the camera and try again.")
        face = faces[0]
        x, y, width, height = [int(v) for v in face[:4]]
        if (
            min(width, height) < 90
            or x < 0
            or y < 0
            or x + width > image.shape[1]
            or y + height > image.shape[0]
        ):
            raise HTTPException(422, "Move closer and keep your whole face inside the camera.")
        crop = image[y : y + height, x : x + width]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if gray.mean() < 45 or gray.mean() > 220 or cv2.Laplacian(gray, cv2.CV_64F).var() < 35:
            raise HTTPException(422, "Improve the lighting and hold still for a clearer scan.")
        aligned = self.recognizer.alignCrop(image, face)
        feature = self.recognizer.feature(aligned).flatten()
        norm = np.linalg.norm(feature)
        if not np.isfinite(feature).all() or norm < 1e-8:
            raise HTTPException(422, "Could not read this face. Try again.")
        return (feature / norm).tolist()
