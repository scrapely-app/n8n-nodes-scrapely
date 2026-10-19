import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

type Context = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

/** Runs that have stopped and will not change any more. */
export const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'];

/** The server answers a waitForFinish request after at most this many seconds. */
const WAIT_PER_REQUEST_SECS = 60;

export async function scrapelyRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: unknown; qs?: IDataObject; returnFullResponse?: boolean } = {},
): Promise<unknown> {
	const credentials = await this.getCredentials('scrapelyApi');
	const baseUrl = String(credentials.baseUrl || 'https://api.scrape.ly').replace(/\/+$/, '');
	const request: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		qs: options.qs,
		json: true,
		headers: { 'User-Agent': 'n8n-nodes-scrapely' },
	};
	if (options.body !== undefined) request.body = options.body as IDataObject;
	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'scrapelyApi', request);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/** The `data` field of a `{ data: … }` response. */
export function unwrap<T = IDataObject>(response: unknown): T {
	if (response && typeof response === 'object' && 'data' in (response as IDataObject)) {
		return (response as IDataObject).data as T;
	}
	return response as T;
}

/** Wait until a run has finished, polling with the server-side waitForFinish. */
export async function waitForRun(
	this: IExecuteFunctions,
	run: IDataObject,
	maxWaitSecs: number,
	itemIndex: number,
): Promise<IDataObject> {
	const started = Date.now();
	let current = run;
	while (!TERMINAL_STATUSES.includes(String(current.status))) {
		const elapsed = (Date.now() - started) / 1000;
		if (elapsed >= maxWaitSecs) {
			throw new NodeOperationError(
				this.getNode(),
				`Run ${String(current.id)} is still ${String(current.status)} after ${maxWaitSecs} seconds`,
				{ itemIndex, description: 'Increase "Max Wait" or turn off "Wait for Finish".' },
			);
		}
		const wait = Math.max(1, Math.min(WAIT_PER_REQUEST_SECS, Math.ceil(maxWaitSecs - elapsed)));
		const before = Date.now();
		current = unwrap(
			await scrapelyRequest.call(this, 'GET', `/v2/actor-runs/${encodeURIComponent(String(current.id))}`, {
				qs: { waitForFinish: wait },
			}),
		);
		// A server that answers early without a finished run: don't spin.
		if (!TERMINAL_STATUSES.includes(String(current.status)) && Date.now() - before < 1000) await sleep(1000);
	}
	return current;
}

/** Up to `limit` dataset items. */
export async function getDatasetItems(
	this: IExecuteFunctions | IWebhookFunctions,
	datasetId: string,
	qs: IDataObject,
): Promise<IDataObject[]> {
	const response = await scrapelyRequest.call(this, 'GET', `/v2/datasets/${encodeURIComponent(datasetId)}/items`, {
		qs: { format: 'json', ...qs },
	});
	const items = Array.isArray(response) ? response : unwrap<unknown>(response);
	const list = Array.isArray(items) ? items : ((items as IDataObject)?.items as unknown[]) ?? [];
	return list.map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? (item as IDataObject) : { value: item as IDataObject[keyof IDataObject] }));
}

function matches(filter: string | undefined, ...values: unknown[]): boolean {
	if (!filter) return true;
	const f = filter.toLowerCase();
	return values.some((v) => typeof v === 'string' && v.toLowerCase().includes(f));
}

export async function searchActors(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const response = unwrap<IDataObject>(await scrapelyRequest.call(this, 'GET', '/v2/actors', { qs: { limit: 1000, desc: 1 } }));
	const items = ((response?.items as IDataObject[]) ?? []).filter((a) => matches(filter, a.name, a.title, a.username));
	const results: INodeListSearchItems[] = items.map((a) => ({
		name: a.username ? `${String(a.title || a.name)} (${String(a.username)}/${String(a.name)})` : String(a.title || a.name),
		value: String(a.id),
	}));
	return { results };
}

export async function searchTasks(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
	const response = unwrap<IDataObject>(await scrapelyRequest.call(this, 'GET', '/v2/actor-tasks', { qs: { limit: 1000, desc: 1 } }));
	const items = ((response?.items as IDataObject[]) ?? []).filter((t) => matches(filter, t.name, t.title));
	return { results: items.map((t) => ({ name: String(t.title || t.name), value: String(t.id) })) };
}
