# Simulador de proveedores: compilacion en una etapa, imagen final solo con el JS compilado.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && rm -f dist/*.test.js dist/*.test.js.map

FROM node:22-alpine
ENV NODE_ENV=production PORT=4100
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:4100/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
