FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json

RUN npm ci --workspace backend --include-workspace-root=false

COPY backend ./backend

WORKDIR /app/backend

RUN npm run build

EXPOSE 4000

CMD ["npm", "run", "start:docker"]
