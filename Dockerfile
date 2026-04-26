FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

COPY . .

RUN useradd -m -u 1000 notebot && \
    mkdir -p /app/data && \
    chown -R notebot:notebot /app

USER notebot

ENTRYPOINT ["python", "main.py"]
