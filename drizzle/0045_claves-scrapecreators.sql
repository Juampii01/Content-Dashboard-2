-- Clave de ScrapeCreators del cliente (plan B para bajar links de Instagram y TikTok desde el worker).
ALTER TYPE "public"."service_provider" ADD VALUE IF NOT EXISTS 'SCRAPECREATORS';
