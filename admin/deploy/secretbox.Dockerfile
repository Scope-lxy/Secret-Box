FROM node:22-alpine3.22

WORKDIR /app
COPY package.json package-lock.json ./
RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.aliyun.com/alpine|g' /etc/apk/repositories \
  && apk add --no-cache ffmpeg tzdata \
  && NODE_OPTIONS=--dns-result-order=ipv4first npm ci --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com \
  && npm cache clean --force
COPY --chown=node:node . .

ENV NODE_ENV=production
USER node

EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3101/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/index.js"]
