# Pathfinder UCD Modern

## License / Usage

This repository is source-available for viewing, learning, review, and feedback
only. It is not open source.

Forks and pull requests are allowed only for proposing changes back to this
project. Commercial use, redistribution, public deployment by others, derivative
works, paid services, monetized products, and removal of attribution are not
permitted without prior written permission from the author.

Any permitted reference, discussion, review, or study must credit the original
author: j rz.

See [LICENSE](LICENSE) for the full terms.

Pathfinder UCD is a Flask-based UC Davis academic advising chat app. It answers
questions using local SQLite/text data and an OpenAI-compatible LLM provider
configured privately through environment variables.

## What Is Included

- Flask web app with local browser chat history
- Local SQLite-backed course/professor/major/calendar query services
- Local text-file context search for AP/IB/placement policy files
- Audit logs for user questions, tool calls, tool results, and final answers
- Deployment hardening for public Linux/Nginx environments

## What Is Not Included

- No API keys
- No runtime data under `data/`
- No prompt/private instruction notes
- No RateMyProfessors scraping or external data-collection pipeline

## Local Run

Set a private LLM provider in your environment:

```bash
set LLM_API_KEY=your_private_key
set LLM_BASE_URL=https://your-openai-compatible-endpoint.example
set LLM_MODEL=your-model-name
```

Then run from the parent directory:

```bash
python -m pathfinder_ucd_modern.scripts.run_web
```

Open:

```text
http://127.0.0.1:5050
```

Runtime data should be placed locally under:

```text
pathfinder_ucd_modern/data/
```

That folder is intentionally ignored by Git.

## Public Deployment

See:

```text
docs/BAOTA_DEPLOY.md
```

The public deployment path uses Gunicorn behind Nginx/BT Panel, keeps the app
bound to `127.0.0.1:5050`, and exposes only Nginx on `80/443`.
