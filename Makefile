# Build and run the project.
# The default target is to rebuild the TS source.

# TSC builds are slow, make no-op builds cheap.
SOURCES = $(shell find ./api-server/src -name '*.ts')

build: build-compiled
	@cat build-compiled

build-compiled: $(SOURCES)
	cd api-server && npm run build
	@date +"Sources compiled %Y-%m-%d %H:%M:%S" > build-compiled

image: build
# docker-compose handles tagging for us.
	docker-compose build api-server

.PHONY: up
up: build  # No 'image' because up --build does this anyway.
	docker-compose up --build --detach

.PHONY: down
down:
	docker-compose down

api-down: api-running
	docker-compose stop api-server
	@date +"API stopped %Y-%m-%d %H:%M:%S" > api-down

.PHONY: api-running
api-running:
	@test -z "$$(docker-compose top api-server)" && \
          date +"API running %Y-%m-%d %H:%M:%S" > api-running || true

api-rev: build-compiled api-down
	docker-compose up --build --detach api-server

# Where the virtualenv to run tests lives.
TEST_ENV = test.env
# Rename if needed, depending on your py2 / py3 setup.
VENV = virtualenv3
PIP = pip3
PY = python3
test: $(TEST_ENV)/requirements-installed test/test-api.py
	test.env/bin/python3 -m pytest test/test-api.py

$(TEST_ENV)/requirements-installed: $(TEST_ENV)/bin/$(PY) test/requirements.txt
	$(TEST_ENV)/bin/$(PIP) install -r test/requirements.txt
	@date +"API running %Y-%m-%d %H:%M:%S" > $(TEST_ENV)/requirements-installed

$(TEST_ENV)/bin/$(PY):
	$(VENV) $(TEST_ENV)
