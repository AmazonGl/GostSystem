# ГОСТ Документатор — Руководство по установке

## требования к серверу

| параметр | минимум |
|---|---|---|
| ОС | Ubuntu 24.04 LTS |
| CPU | 4 ядра |
| RAM | 8 гб |
| Диск | 20 гб SSD|
| сеть | 100 мбит |

> без GPU ollama работает в cpu-режиме — генерация будет длится около 2-5 мин

---

## шаг 1 — готовим сервер

```bash
# обновляем систему
apt update && apt upgrade -y

# добавляем swap (важно если RAM меньше 16 гб)
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## Шаг 2 — Установка Docker

```bash
curl -fsSL https://get.docker.com | sh
apt install docker-compose-plugin -y

# проверяем
docker --version
docker compose version
```

---

## Шаг 3 — Установка Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

даём добро Ollama слушать на всех интерфейсах , это нужно для работы докера

```bash
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
EOF

systemctl daemon-reload
systemctl restart ollama
```
Установка сервиса языковой модели Ollama
скачиваем языковую модель:

```bash
ollama pull mistral:7b
```

---

## Шаг 4 — Настройка firewall

Docker использует подсеть 172.18.0.0/16 для связи контейнеров с хостом.
Нужно разрешить этот трафик:

```bash
# Узнаём подсеть Docker
docker network inspect bridge | grep Subnet

# Разрешаем трафик (обычно 172.17.0.0/16 и 172.18.0.0/16)
iptables -I INPUT -s 172.17.0.0/16 -j ACCEPT
iptables -I INPUT -s 172.18.0.0/16 -j ACCEPT

# Сохраняем правила
apt install iptables-persistent -y
netfilter-persistent save
```

---

## Шаг 5 — Установка проекта

```bash
# Распаковываем архив
unzip Project.zip
```

Создаём файл конфигурации:

```bash
cp .env.example .env
nano .env
```
---

## Шаг 6 — Запуск

```bash
docker compose up --build -d
```

Первый запуск занимает 5–10 минут (сборка образов).

Проверяем что всё запустилось:

```bash
docker compose ps
```

Все три контейнера должны быть в статусе `Up`:
- `gost_backend` — порт 8000
- `gost_frontend` — порт 3000
- `gost_db` — порт 5433

---

## Доступ к системе

| Адрес | Описание |
|---|---|
| `http://IP:3000` | Основной интерфейс |
| `http://IP:8000/docs` | Документация API (Swagger) |

---

## Управление системой

```bash
# Запустить
docker compose up -d

# Остановить
docker compose down

# Перезапустить отдельный сервис
docker compose restart backend

# Посмотреть логи
docker logs gost_backend --tail 50
docker logs gost_frontend --tail 50

# Обновить после изменений кода
docker compose up --build -d
```

---
