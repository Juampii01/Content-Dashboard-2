import sys
from pathlib import Path

# Los tests importan los módulos del worker como en producción (`comunes`, `video`).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--slow", action="store_true", default=False, help="corre también las pruebas lentas (render completo de varios minutos)")


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: prueba lenta (render completo); se corre con --slow")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--slow"):
        return
    skip = pytest.mark.skip(reason="prueba lenta: pytest --slow")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)
