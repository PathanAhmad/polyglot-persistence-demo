FROM node:20-slim

WORKDIR /app

# We install dependencies first so Docker can cache this layer.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# We copy the app code and the schema file the import/reset endpoint uses.
COPY backend ./backend
COPY db/mariadb/schema.sql ./db/schema.sql

EXPOSE 3000

CMD ["node", "backend/src/server.js"]

