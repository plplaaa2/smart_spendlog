# Build the HA app with reproducible dependencies; related: config.json, package-lock.json, run.sh.
FROM node:24.21.0-alpine3.23

ARG BUILD_VERSION=2.5.2
ARG BUILD_ARCH
LABEL io.hass.name="Smart Spendlog" \
      io.hass.description="Home Assistant notification-based account book" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.type="addon" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.source="https://github.com/plplaaa2/smart_spendlog"

# Working directory
WORKDIR /app

# Copy files
COPY . .

# Grant execute permission and handle line endings (Windows environment compatibility)
RUN chmod a+x run.sh && \
    sed -i 's/\r$//' run.sh

# Install build tools for sqlite3 node-gyp compilation if needed
RUN apk add --no-cache tzdata libstdc++ && \
    apk add --no-cache --virtual .build-deps python3 make g++

# Install dependencies
RUN npm ci --omit=dev

# Remove build tools to reduce size
RUN apk del .build-deps

ENTRYPOINT [ "./run.sh" ]
