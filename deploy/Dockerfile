FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Copy entrypoint
COPY deploy/entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 5050

ENTRYPOINT ["./entrypoint.sh"]