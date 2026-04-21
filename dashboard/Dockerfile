FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

FROM caddy:2-alpine
COPY --from=build /app/dist/dashboard/browser /srv
RUN printf ':4000 {\n  root * /srv\n  encode zstd gzip\n  try_files {path} /index.html\n  file_server\n}\n' > /etc/caddy/Caddyfile
EXPOSE 4000
