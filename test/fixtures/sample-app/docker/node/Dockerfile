FROM node:22-alpine

WORKDIR /app

# Dependencies are installed at build time, so a run needs no network (MIRAI unit 14).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

EXPOSE 8180

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8180"]
