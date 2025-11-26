import os

from . import create_mizane_app

app = create_mizane_app()

if __name__ == "__main__":
    port = int(os.getenv("MIZANE_API_PORT", 5002))
    host = os.getenv("MIZANE_API_HOST", "127.0.0.1")
    app.run(host=host, port=port)
