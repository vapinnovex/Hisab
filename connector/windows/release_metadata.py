"""Collect public dependency notices for the standalone distribution; no runtime state."""

import importlib.metadata as metadata
import json
import shutil
import sys
from pathlib import Path


def collect(release):
    release = Path(release)
    notices = release / "third-party-notices"
    notices.mkdir(exist_ok=True)
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
    if python_license.is_file():
        shutil.copyfile(python_license, notices / "Python-LICENSE.txt")
    for directory in (Path(sys.base_prefix) / "tcl").glob("*"):
        license_path = directory / "license.terms"
        if license_path.is_file():
            shutil.copyfile(license_path, notices / (directory.name + "-license.terms"))
    dependencies = []
    for name in (
        "httpx",
        "httpcore",
        "h11",
        "anyio",
        "certifi",
        "idna",
        "jsonschema",
        "jsonschema-specifications",
        "referencing",
        "rpds-py",
        "attrs",
        "typing_extensions",
        "pywin32",
        "pyodbc",
        "pyinstaller",
    ):
        distribution = metadata.distribution(name)
        copied = []
        for entry in distribution.files or []:
            if any(word in entry.name.lower() for word in ("license", "copying", "notice")):
                source = Path(distribution.locate_file(entry))
                if source.is_file() and source.suffix.lower() not in {".py", ".pyc", ".pyd"}:
                    target = notices / (name + "-" + "-".join(entry.parts[-3:]))
                    shutil.copyfile(source, target)
                    copied.append(target.name)
        dependencies.append(
            {
                "name": name,
                "version": distribution.version,
                "license": distribution.metadata.get("License-Expression")
                or distribution.metadata.get("License"),
                "project_urls": distribution.metadata.get_all("Project-URL", []),
                "notice_files": copied,
            }
        )
    (release / "DEPENDENCIES.json").write_text(json.dumps(dependencies, indent=2), encoding="utf-8")


if __name__ == "__main__":
    collect(sys.argv[1])
