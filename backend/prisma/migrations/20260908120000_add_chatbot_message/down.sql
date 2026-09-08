-- Paired down migration, as this repository's migrate harness requires.
DROP TABLE IF EXISTS "ChatbotMessage";
DROP TYPE IF EXISTS "ChatbotMessageRole";
