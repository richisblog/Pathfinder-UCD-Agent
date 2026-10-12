from pathfinder_ucd_modern.core.config import FLASK_DEBUG, WEB_HOST, WEB_PORT
from pathfinder_ucd_modern.web.app import create_app


def main():
    app = create_app()
    app.run(host=WEB_HOST, port=WEB_PORT, debug=FLASK_DEBUG)


if __name__ == "__main__":
    main()
