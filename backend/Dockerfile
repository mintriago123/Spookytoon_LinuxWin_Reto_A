FROM node:24.22.0-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 AWS_REGION=us-east-2 ROUTING_WORKERS=1
ENV DYNAMODB_TABLE_NAME=spookython-manta-state
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node backend/src ./src
COPY --chown=node:node backend/data ./data
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=256", "src/server.ts"]
