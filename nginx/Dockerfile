# nginx/Dockerfile
FROM nginx:alpine

# Удаляем стандартные конфиги
RUN rm -rf /etc/nginx/conf.d/*

# Копируем ТОЛЬКО наш конфиг
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Копируем фронтенд
COPY frontend/ /usr/share/nginx/html/

# Проверка (опционально)
RUN ls -la /usr/share/nginx/html/

EXPOSE 80