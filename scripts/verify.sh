#!/bin/sh
# verify.sh: installs the version from npm in a clean container and checks it's the one

. "$(dirname "$0")/lib.sh"

docker run --rm node:22-alpine sh -c "mkdir /opt/consumer && cd /opt/consumer && npm init -y > /dev/null && \
npm install --no-audit --no-fund $(package)@$(version) && \
node --input-type=module -e \"import * as r from '$(package)'; import '$(package)/mock'; if (!r.Model) process.exit(1); console.log('installed', '$(package)', '$(version)', Object.keys(r).length, 'exports')\""
