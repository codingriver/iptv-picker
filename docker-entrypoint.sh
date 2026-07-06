#!/bin/sh
set -e

case "$1" in
  picker)
    shift
    set -- node dist/iptv-picker-cli.js "$@"
    ;;
  source-sync|sync)
    shift
    set -- node dist/iptv-picker-source-sync-cli.js "$@"
    ;;
  tvbox-extract|tvbox)
    shift
    set -- node dist/iptv-picker-tvbox-extract-cli.js "$@"
    ;;
  node|npm|npx|sh|bash|ffmpeg|ffprobe)
    ;;
  -*|"")
    set -- node dist/iptv-picker-cli.js "$@"
    ;;
esac

exec "$@"
