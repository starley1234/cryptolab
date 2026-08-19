# NanoTask — $TASK | Minimalist Escrow gateway
# Zero deps, Node 22 Alpine, ~30MB
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# copy minimal set
COPY package.json ./package.json
COPY backend ./backend
COPY contracts ./contracts
COPY sdk ./sdk
RUN mkdir -p data && addgroup -S nanotask && adduser -S nanotask -G nanotask && chown -R nanotask:nanotask /app
USER nanotask
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8788/healthz || exit 1
CMD ["node", "backend/server.js"]
