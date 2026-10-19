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
		// Show the API's own reason (e.g. "Webhook URL not allowed: …") instead of a generic HTTP message.
		const err = error as { response?: { data?: unknown; body?: unknown }; cause?: { response?: { data?: unknown } } };
		const body = (err.response?.data ?? err.response?.body ?? err.cause?.response?.data) as
			| { error?: { message?: string } }
			| undefined;
		const message = body?.error?.message;
		throw new NodeApiError(this.getNode(), error as JsonObject, message ? { message } : {});
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

const PAGE_SIZE = 100;

/** One page of a list endpoint, searched on the server, for a resource-locator list. */
async function searchPage(
	this: ILoadOptionsFunctions,
	path: string,
	filter: string | undefined,
	paginationToken: string | undefined,
	toItem: (row: IDataObject) => INodeListSearchItems,
): Promise<INodeListSearchResult> {
	const offset = Number(paginationToken) || 0;
	const qs: IDataObject = { limit: PAGE_SIZE, offset, desc: 1 };
	if (filter) qs.search = filter;
	const response = unwrap<IDataObject>(await scrapelyRequest.call(this, 'GET', path, { qs }));
	const rows = (response?.items as IDataObject[]) ?? [];
	const total = typeof response?.total === 'number' ? response.total : undefined;
	const next = offset + rows.length;
	const more = rows.length === PAGE_SIZE && (total === undefined || next < total);
	return { results: rows.map(toItem), paginationToken: more ? String(next) : undefined };
}

export async function searchActors(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return await searchPage.call(this, '/v2/actors', filter, paginationToken, (a) => ({
		name: a.username ? `${String(a.title || a.name)} (${String(a.username)}/${String(a.name)})` : String(a.title || a.name),
		value: String(a.id),
	}));
}

export async function searchTasks(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	return await searchPage.call(this, '/v2/actor-tasks', filter, paginationToken, (t) => ({
		name: String(t.title || t.name),
		value: String(t.id),
	}));
}
