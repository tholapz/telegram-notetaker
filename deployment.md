## STEP 12 — DEPLOYMENT ON ALIBABA SAS

# Build and push (run locally)
docker build -t <dockerhub-username>/telegram-notetaker:latest .
docker push <dockerhub-username>/telegram-notetaker:latest

# On Alibaba SAS
mkdir -p ~/telegram-notetaker
cd ~/telegram-notetaker
# Place docker-compose.yml and .env here
docker compose pull
docker compose up -d
docker compose logs -f