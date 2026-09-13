FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV PORT=3001
ENV DB_PATH=/data/suivi.db
EXPOSE 3001
CMD ["node", "server.js"]
