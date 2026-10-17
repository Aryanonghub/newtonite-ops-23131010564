FROM node:22-alpine
WORKDIR /app

# Install deps first so Docker can cache this layer when only source code changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
