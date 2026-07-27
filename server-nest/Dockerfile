# --- Stage 1: install dependencies -------------------------------------
# Separate from the build stage so `dist/` rebuilds don't reinstall/recompile
# native deps every time — and so the runtime stage can copy a
# fully-resolved node_modules instead of running npm ci a second time.
FROM node:20-alpine AS deps
WORKDIR /app

# bcrypt is a native addon (node-gyp) — Alpine ships neither a C++ toolchain
# nor Python by default, so `npm ci`/`npm install` fails compiling bcrypt's
# binding without these. openssl is needed later by Prisma's query engine,
# installed here too so the same apk cache layer covers both stages.
RUN apk add --no-cache python3 make g++ openssl

# package-lock.json* only matches if the file exists, so this works whether
# or not a lockfile has been committed yet.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      echo "Using npm ci (lockfile found)"; npm ci; \
    else \
      echo "No package-lock.json found — falling back to npm install. Commit a lockfile for reproducible builds."; \
      npm install; \
    fi

# --- Stage 2: build (compile TypeScript, generate Prisma client) --------
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

# --- Stage 3: production dependencies only -------------------------------
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

# --- Stage 4: runtime -----------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Prisma's query engine (linux-musl-openssl-3.0.x, see schema.prisma
# generator block) links against libssl at runtime — without this the
# container builds fine but crashes on the first Prisma query with
# "Unable to require libquery_engine..." / "error while loading shared
# libraries: libssl.so".
RUN apk add --no-cache openssl

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY --from=build /app/dist ./dist
# The Prisma client generated in the build stage lives inside node_modules/
# (.prisma/client) — re-generate against the production node_modules so its
# engine binary matches this stage exactly, rather than trusting a copy.
RUN npx prisma generate

# Documents the default local port; Railway injects its own PORT at runtime
# and main.ts reads process.env.PORT, so this doesn't need to match exactly.
EXPOSE 4000

CMD ["node", "dist/main"]
