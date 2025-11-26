DOCKER_IMAGE := node:22-alpine
DOCKER_RUN := docker run --rm -v "$(shell pwd)":/usr/src/myapp -w /usr/src/myapp $(DOCKER_IMAGE)

all: perf

perf:
	@echo "Dependencies pre-installed via GitHub reference"

clean:
	rm -rf node_modules

.PHONY: all clean perf
