# How to run

you can run using uv
```
uv run serve.py
```

# LightRAG Chat Monolith Backend

This is the backend API for the LightRAG Chat application, built with FastAPI and SQLite.

## Prerequisite: Installing UV

Make sure you have `uv` installed. If you don't have it yet, install it via:

```bash
# On Linux and macOS
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Setup & Running with UV

We use `uv` for python version management and virtual environment package installation.

### 1. Initialize Python Environment

We use a managed Python 3.12 version from `uv` to ensure that standard modules (like SSL support) are correctly compiled and present.

```bash
# Install the managed Python 3.12 interpreter
uv python install 3.12

# Create the virtual environment using the installed Python version
uv venv --python 3.12 --clear
```

### 2. Install/Sync Dependencies

Dependencies are defined in `pyproject.toml` and lockfile `uv.lock`. You can synchronize the virtual environment directly:

```bash
uv sync
```

This will automatically read all dependencies, resolve them, and install them into `.venv`.

### 3. Run the Monolith Server

To start the FastAPI backend server, run:

```bash
uv run serve.py
```

The application will start on the port specified in your `.env` file (defaults to `3000`).
