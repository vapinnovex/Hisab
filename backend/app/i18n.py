"""Translate application copy only. IDs, enum values and user content stay unchanged."""

from pathlib import Path

LANGUAGES = {"en", "hi", "mr"}
CATALOG = {"en": {}, "hi": {}, "mr": {}}
for line in (
    Path(__file__).with_name("locales").joinpath("messages.tsv").read_text(encoding="utf-8").splitlines()
):
    source, hindi, marathi = line.split("|")
    CATALOG["hi"][source] = hindi
    CATALOG["mr"][source] = marathi


def negotiate(header):
    choices = []
    for index, item in enumerate(header.split(",")):
        parts = item.strip().split(";")
        code = parts[0].lower().split("-")[0]
        try:
            quality = float(next((p.strip()[2:] for p in parts[1:] if p.strip().startswith("q=")), "1"))
        except ValueError:
            continue
        if code in LANGUAGES and 0 < quality <= 1:
            choices.append((quality, -index, code))
    return max(choices)[2] if choices else "en"


def translate(source, language="en", **values):
    text = CATALOG.get(language, {}).get(source, source)
    for key, value in values.items():
        text = text.replace("{" + key + "}", str(value))
    return text


def message(request, source, **values):
    return translate(source, getattr(request.state, "language", "en"), **values)


def validation_message(request, error):
    language = getattr(request.state, "language", "en")
    raw = error["msg"]
    if language == "en":
        return raw
    source = raw.removeprefix("Value error, ")
    if source in CATALOG[language]:
        return translate(source, language)
    kind = error["type"]
    context = error.get("ctx", {})
    if kind == "missing":
        source = "Field required"
    elif "email" in raw.lower():
        source = "Enter a valid email address."
    elif kind in {"enum", "literal_error"}:
        source = "Use one of the allowed choices."
    elif kind == "string_too_short":
        return translate("Use at least {min} characters.", language, min=context["min_length"])
    elif kind == "string_too_long":
        return translate("Use no more than {max} characters.", language, max=context["max_length"])
    elif kind == "string_pattern_mismatch":
        source = "Use the required format."
    elif kind.startswith("date"):
        source = "Enter a valid date."
    elif kind.startswith(("int", "float", "decimal")) or kind in {
        "greater_than",
        "greater_than_equal",
        "less_than",
        "less_than_equal",
    }:
        source = "Enter a valid number."
    elif kind == "extra_forbidden":
        source = "Unexpected field."
    else:
        source = "Invalid value."
    return translate(source, language)
