"""Errores del worker.

`JobError` lleva el mensaje para la persona (en español, con qué hacer) y si conviene reintentar.
Cualquier otra excepción se reintenta con un mensaje genérico; el detalle técnico va solo al log.
"""

from __future__ import annotations


class JobError(Exception):
    def __init__(self, user_message: str, *, retry: bool = True, detail: str = "") -> None:
        super().__init__(detail or user_message)
        self.user_message = user_message
        self.retry = retry
        self.detail = detail


class Cancelled(Exception):
    """El trabajo dejó de ser nuestro (se canceló, se borró el proyecto o otro worker tomó el lease)."""


class Shutdown(Exception):
    """El sistema pidió apagar el worker (SIGTERM): el trabajo vuelve a la cola sin contar el intento."""
