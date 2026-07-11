FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Templates are expected to be mounted as volumes
# On first run, copy .example.json files if the real ones don't exist
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 5050

ENTRYPOINT ["./entrypoint.sh"]