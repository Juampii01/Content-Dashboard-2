import sys
from pathlib import Path

# Los tests importan los módulos del worker como en producción (`comunes`, `video`).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
