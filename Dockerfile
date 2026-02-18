FROM node:20-alpine

WORKDIR /usr/src/app

# Устанавливаем зависимости
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Копируем исходный код
COPY . .

ENV NODE_ENV=production

# Точка входа — стандартный npm start (index.js)
CMD ["npm", "start"]

