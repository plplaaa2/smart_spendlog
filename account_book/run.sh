#!/bin/sh
# Forward termination signals to Node; related: Dockerfile, index.js.
set -eu
cd /app
exec node index.js
