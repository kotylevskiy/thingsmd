#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
: "${THINGSMD_TEST_VAULT:?Set this to a fresh, marked disposable vault}"
: "${THINGSMD_DEBUG_URL:?Set this to the isolated Obsidian debugging URL}"
export THINGSMD_RECORDING_THEME="${THINGSMD_RECORDING_THEME:-light}"

node recordings/cover/capture-creation.mjs
node recordings/cover/capture-drag.mjs --tasks-only
node recordings/cover/capture-lists.mjs lists
node recordings/cover/capture-quick-capture.mjs
node recordings/cover/capture-settings.mjs finish global-capture calendar
node recordings/cover/capture-conversion.mjs --conversion-only
