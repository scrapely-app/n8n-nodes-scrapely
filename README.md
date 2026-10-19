# n8n-nodes-scrapely

[n8n](https://n8n.io) nodes for [Scrape.ly](https://scrape.ly): run Actors and saved tasks, read their results, and start workflows when a run finishes.

## Install

In n8n, go to **Settings → Community nodes → Install** and enter `n8n-nodes-scrapely`.

## Credentials

Create a **Scrapely API** credential and paste your API token from **Settings → API & Integrations** in the Scrape.ly dashboard. Leave **Base URL** as `https://api.scrape.ly`.

## Scrapely node

| Resource | Operation | What it does |
|---|---|---|
| Actor | Run | Starts a run with the input you give (JSON). |
| Actor | Get Last Run | Returns the most recent run of the Actor. |
| Task | Run | Starts a run of a saved task, optionally overriding parts of its input. |
| Run | Get | Returns a run by ID. |
| Dataset | Get Items | Returns items from a dataset, with limit and offset. |
| Key-Value Store | Get Record | Returns one record, for example `OUTPUT`. |

**Run** options:

- **Wait for Finish** (on by default): waits until the run has finished, up to **Max Wait** seconds.
- **Return Results** (on by default): outputs the run's dataset items, one n8n item each, instead of the run. A run that did not succeed stops the workflow with its status.
- **Options**: build, memory and timeout for the run.

The node can also be used as a tool by n8n AI agents.

## Scrapely Trigger

Starts the workflow when a run of an Actor or a task finishes. Pick the events: succeeded, failed, timed out or aborted. When the workflow is activated, the trigger registers a webhook in your Scrape.ly account, and removes it when the workflow is deactivated.

Turn on **Include Results** to get the run's dataset items instead of the event.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

## License

[MIT](LICENSE.md)
