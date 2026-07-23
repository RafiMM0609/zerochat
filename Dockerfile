FROM python:3.12-slim

# Copy uv binary from official astral-sh image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Copy dependency specifications
COPY pyproject.toml uv.lock README.md /app/

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy source code and static assets
COPY app /app/app
COPY static /app/static

# Environment paths
ENV PATH="/app/.venv/bin:$PATH"
ENV PORT=3000

# Expose internal port
EXPOSE 3000

# Start server using Uvicorn directly
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
