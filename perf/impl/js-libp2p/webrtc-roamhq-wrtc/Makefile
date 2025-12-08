DOCKER_IMAGE := node:22-slim
DOCKER_RUN := docker run --rm -v "$(shell pwd)":/usr/src/myapp -w /usr/src/myapp $(DOCKER_IMAGE)

all: perf

perf:
	npm install /tmp/js-libp2p-fork/packages/transport-webrtc /tmp/js-libp2p-fork/packages/libp2p
	npm install
	npm add -D tsx

clean:
	rm -rf node_modules

.PHONY: all clean perf
