.PHONY: install dev deploy typecheck db-init

install:
	npm install

dev:
	npx wrangler dev

deploy:
	npx wrangler deploy

typecheck:
	npx tsc --noEmit

db-init:
	npx wrangler d1 execute telegram-notetaker --file=schema.sql

clean:
	rm -rf node_modules .wrangler
