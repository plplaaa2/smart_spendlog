FROM node:18-alpine

# Working directory
WORKDIR /app

# Copy files
COPY . .

# Grant execute permission and handle line endings (Windows environment compatibility)
RUN chmod a+x run.sh && \
    sed -i 's/\r$//' run.sh

# Install build tools for sqlite3 node-gyp compilation if needed
RUN apk add --no-cache python3 make g++ 

# Install dependencies
RUN npm install

# Remove build tools to reduce size
RUN apk del python3 make g++

ENTRYPOINT [ "./run.sh" ]
