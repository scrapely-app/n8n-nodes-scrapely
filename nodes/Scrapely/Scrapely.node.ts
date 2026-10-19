import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	getDatasetItems,
	scrapelyRequest,
	searchActors,
	searchTasks,
	unwrap,
	waitForRun,
} from '../shared/GenericFunctions';

const runOptions = {
	displayName: 'Options',
	name: 'runOptions',
	type: 'collection' as const,
	placeholder: 'Add Option',
	default: {},
	displayOptions: { show: { operation: ['run'] } },
	options: [
		{
			displayName: 'Build',
			name: 'build',
			type: 'string' as const,
			default: '',
			description: 'Build tag or number to run, for example "latest". Empty uses the default build.',
		},
		{
			displayName: 'Memory (MB)',
			name: 'memory',
			type: 'number' as const,
			default: 0,
			description: 'Memory for the run. 0 uses the default.',
		},
		{
			displayName: 'Timeout (Seconds)',
			name: 'timeout',
			type: 'number' as const,
			default: 0,
			description: 'Stop the run after this many seconds. 0 uses the default.',
		},
	],
};

export class Scrapely implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scrapely',
		name: 'scrapely',
		icon: { light: 'file:../../icons/scrapely.svg', dark: 'file:../../icons/scrapely.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Run Scrape.ly Actors and tasks and read their results',
		defaults: { name: 'Scrapely' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'scrapelyApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Actor', value: 'actor' },
					{ name: 'Dataset', value: 'dataset' },
					{ name: 'Key-Value Store', value: 'keyValueStore' },
					{ name: 'Run', value: 'run' },
					{ name: 'Task', value: 'task' },
				],
				default: 'actor',
			},

			// ── Operations ──
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['actor'] } },
				options: [
					{ name: 'Run', value: 'run', action: 'Run an actor', description: 'Start a run of an Actor' },
					{ name: 'Get Last Run', value: 'getLastRun', action: 'Get the last run of an actor', description: 'Get the most recent run of an Actor' },
				],
				default: 'run',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['task'] } },
				options: [{ name: 'Run', value: 'run', action: 'Run a task', description: 'Start a run of a saved task' }],
				default: 'run',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['run'] } },
				options: [{ name: 'Get', value: 'get', action: 'Get a run', description: 'Get a run by ID' }],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['dataset'] } },
				options: [{ name: 'Get Items', value: 'getItems', action: 'Get dataset items', description: 'Get the items of a dataset' }],
				default: 'getItems',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['keyValueStore'] } },
				options: [{ name: 'Get Record', value: 'getRecord', action: 'Get a record', description: 'Get a record from a key-value store' }],
				default: 'getRecord',
			},

			// ── Actor / Task pickers ──
			{
				displayName: 'Actor',
				name: 'actorId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: { show: { resource: ['actor'] } },
				modes: [
					{ displayName: 'From List', name: 'list', type: 'list', typeOptions: { searchListMethod: 'searchActors', searchable: true } },
					{ displayName: 'ID', name: 'id', type: 'string', placeholder: 'e.g. username/actor-name or abc123' },
				],
			},
			{
				displayName: 'Task',
				name: 'taskId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: { show: { resource: ['task'] } },
				modes: [
					{ displayName: 'From List', name: 'list', type: 'list', typeOptions: { searchListMethod: 'searchTasks', searchable: true } },
					{ displayName: 'ID', name: 'id', type: 'string', placeholder: 'e.g. abc123' },
				],
			},

			// ── Run inputs ──
			{
				displayName: 'Input (JSON)',
				name: 'input',
				type: 'json',
				default: '{}',
				displayOptions: { show: { resource: ['actor'], operation: ['run'] } },
				description: 'The input for the Actor, as JSON',
			},
			{
				displayName: 'Input Override (JSON)',
				name: 'input',
				type: 'json',
				default: '{}',
				displayOptions: { show: { resource: ['task'], operation: ['run'] } },
				description: 'Fields that replace the task\'s saved input. {} uses the saved input.',
			},
			{
				displayName: 'Wait for Finish',
				name: 'waitForFinish',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['run'] } },
				description: 'Whether to wait until the run has finished before continuing',
			},
			{
				displayName: 'Max Wait (Seconds)',
				name: 'maxWait',
				type: 'number',
				default: 3600,
				typeOptions: { minValue: 1 },
				displayOptions: { show: { operation: ['run'], waitForFinish: [true] } },
				description: 'Fail if the run has not finished after this many seconds',
			},
			{
				displayName: 'Return Results',
				name: 'returnResults',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['run'], waitForFinish: [true] } },
				description: 'Whether to output the run\'s dataset items instead of the run itself',
			},
			{
				displayName: 'Results Limit',
				name: 'resultsLimit',
				type: 'number',
				default: 1000,
				typeOptions: { minValue: 1 },
				displayOptions: { show: { operation: ['run'], waitForFinish: [true], returnResults: [true] } },
				description: 'Max number of items to return',
			},
			runOptions,

			// ── Run ──
			{
				displayName: 'Run ID',
				name: 'runId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['run'] } },
			},

			// ── Dataset ──
			{
				displayName: 'Dataset ID',
				name: 'datasetId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['dataset'] } },
				description: 'The dataset ID, for example a run\'s defaultDatasetId',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				displayOptions: { show: { resource: ['dataset'] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Offset',
				name: 'offset',
				type: 'number',
				default: 0,
				displayOptions: { show: { resource: ['dataset'] } },
				description: 'Number of items to skip',
			},
			{
				displayName: 'Clean',
				name: 'clean',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['dataset'] } },
				description: 'Whether to skip empty items and fields starting with #',
			},

			// ── Key-value store ──
			{
				displayName: 'Store ID',
				name: 'storeId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['keyValueStore'] } },
				description: 'The key-value store ID, for example a run\'s defaultKeyValueStoreId',
			},
			{
				displayName: 'Key',
				name: 'recordKey',
				type: 'string',
				default: 'OUTPUT',
				required: true,
				displayOptions: { show: { resource: ['keyValueStore'] } },
			},
		],
	};

	methods = {
		listSearch: { searchActors, searchTasks },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let result: IDataObject | IDataObject[];

				if ((resource === 'actor' || resource === 'task') && operation === 'run') {
					result = await runAndMaybeWait.call(this, resource, i);
				} else if (resource === 'actor' && operation === 'getLastRun') {
					const actorId = this.getNodeParameter('actorId', i, '', { extractValue: true }) as string;
					result = unwrap<IDataObject>(await scrapelyRequest.call(this, 'GET', `/v2/actors/${encodeActorId(actorId)}/runs/last`));
				} else if (resource === 'run' && operation === 'get') {
					const runId = this.getNodeParameter('runId', i) as string;
					result = unwrap(await scrapelyRequest.call(this, 'GET', `/v2/actor-runs/${encodeURIComponent(runId)}`));
				} else if (resource === 'dataset' && operation === 'getItems') {
					result = await getDatasetItems.call(this, this.getNodeParameter('datasetId', i) as string, {
						limit: this.getNodeParameter('limit', i) as number,
						offset: this.getNodeParameter('offset', i) as number,
						clean: this.getNodeParameter('clean', i) as boolean,
					});
				} else if (resource === 'keyValueStore' && operation === 'getRecord') {
					const storeId = this.getNodeParameter('storeId', i) as string;
					const key = this.getNodeParameter('recordKey', i) as string;
					const record = await scrapelyRequest.call(
						this,
						'GET',
						`/v2/key-value-stores/${encodeURIComponent(storeId)}/records/${encodeURIComponent(key)}`,
					);
					result = record && typeof record === 'object' && !Array.isArray(record) ? (record as IDataObject) : { key, value: record as IDataObject[keyof IDataObject] };
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}" for "${resource}"`, { itemIndex: i });
				}

				const list = Array.isArray(result) ? result : [result];
				out.push(...list.map((json) => ({ json, pairedItem: { item: i } })));
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [out];
	}
}

/** `username/name` is sent as `username~name`, like the API expects in a path. */
function encodeActorId(id: string): string {
	return encodeURIComponent(id.trim().replace('/', '~'));
}

async function runAndMaybeWait(this: IExecuteFunctions, resource: 'actor' | 'task', i: number): Promise<IDataObject | IDataObject[]> {
	const raw = this.getNodeParameter('input', i, '{}') as string | IDataObject;
	let input: IDataObject;
	try {
		input = typeof raw === 'string' ? (raw.trim() ? JSON.parse(raw) : {}) : raw;
	} catch {
		throw new NodeOperationError(this.getNode(), 'The input is not valid JSON', { itemIndex: i });
	}
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new NodeOperationError(this.getNode(), 'The input must be a JSON object', { itemIndex: i });
	}

	const options = this.getNodeParameter('runOptions', i, {}) as { build?: string; memory?: number; timeout?: number };
	const qs: IDataObject = {};
	if (options.build) qs.build = options.build;
	if (options.memory) qs.memory = options.memory;
	if (options.timeout) qs.timeout = options.timeout;

	const path =
		resource === 'actor'
			? `/v2/actors/${encodeActorId(this.getNodeParameter('actorId', i, '', { extractValue: true }) as string)}/runs`
			: `/v2/actor-tasks/${encodeActorId(this.getNodeParameter('taskId', i, '', { extractValue: true }) as string)}/runs`;
	let run = unwrap(await scrapelyRequest.call(this, 'POST', path, { body: input, qs }));

	if (!this.getNodeParameter('waitForFinish', i, true)) return run;
	run = await waitForRun.call(this, run, this.getNodeParameter('maxWait', i, 3600) as number, i);

	if (!this.getNodeParameter('returnResults', i, true)) return run;
	if (run.status !== 'SUCCEEDED') {
		throw new NodeOperationError(this.getNode(), `Run ${String(run.id)} ended with status ${String(run.status)}`, {
			itemIndex: i,
			description: String(run.statusMessage ?? 'Open the run in Scrape.ly to see its log.'),
		});
	}
	if (!run.defaultDatasetId) return [];
	return await getDatasetItems.call(this, String(run.defaultDatasetId), {
		limit: this.getNodeParameter('resultsLimit', i, 1000) as number,
		clean: true,
	});
}
