# Deploys the proxy to anything that takes a container (Fly.io, Render, Railway).
# No dependencies and no build step — it is two small files of standard JavaScript.
FROM node:22-alpine
WORKDIR /app
COPY worker.js server.mjs ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
