FROM ghcr.io/ggml-org/llama.cpp:server
COPY model/start.sh /start.sh
RUN chmod +x /start.sh
HEALTHCHECK CMD curl -fsS "http://127.0.0.1:${PORT:-10000}/health" || exit 1
ENTRYPOINT ["/start.sh"]
