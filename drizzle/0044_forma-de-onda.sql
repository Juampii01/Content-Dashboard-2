-- IF NOT EXISTS: una base que ya tenía esta migración de la rama de la etapa 3 (antes de encadenarla después de 0043)
-- la vuelve a correr sin error.
ALTER TYPE "public"."job_type" ADD VALUE IF NOT EXISTS 'VIDEO_PEAKS';
