FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir --default-timeout=1000 "dvc>=3,<4" "dvclive>=3,<4" \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["npm", "test"]
