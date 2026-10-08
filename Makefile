# Common tasks. `make help` lists them.
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DATE    := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
IMAGE   ?= tetra-ts:local

.DEFAULT_GOAL := help
.PHONY: help install run build test cover lint image up down logs smoke clean vendor-three

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm ci --no-fund --no-audit

run: ## Run locally on :8000 with reload (no drain delay)
	npm run dev

build: ## Compile TypeScript to dist/
	npm run build

test: ## Unit tests (vitest)
	npm test

cover: ## Coverage report in coverage/ (fails under 90% of lines)
	npm run cover

lint: ## Type check and Prettier
	npm run lint

image: ## Build the container image ($(IMAGE))
	docker build --build-arg VERSION=$(VERSION) --build-arg COMMIT=$(COMMIT) --build-arg BUILD_DATE=$(DATE) -t $(IMAGE) .

up: ## Start the app, Prometheus and Grafana with Docker Compose
	VERSION=$(VERSION) COMMIT=$(COMMIT) docker compose up -d --build --wait app prometheus grafana
	@echo "app http://localhost:$${APP_PORT:-8000}  prometheus http://localhost:$${PROMETHEUS_PORT:-9090}  grafana http://localhost:$${GRAFANA_PORT:-3000}"

down: ## Stop the Compose stack
	docker compose --profile test down --remove-orphans

logs: ## Follow the app logs
	docker compose logs -f app

smoke: ## Contract test against the Compose stack
	docker compose --profile test run --rm smoke

vendor-three: ## Re-vendor three.js into web/vendor
	./scripts/vendor-three.sh

clean: ## Remove coverage and build output
	rm -rf coverage dist
