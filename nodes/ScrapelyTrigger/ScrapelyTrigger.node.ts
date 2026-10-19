import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { getDatasetItems, scrapelyRequest, searchActors, searchTasks, unwrap } from '../shared/GenericFunctions';

export class ScrapelyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Scrapely Trigger',
		name: 'scrapelyTrigger',
		icon: { light: 'file:../../icons/scrapely.svg', dark: 'file:../../icons/scrapely.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a Scrape.ly run finishes',
		defaults: { name: 'Scrapely Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'scrapelyApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Watch',
				name: 'watch',
				type: 'options',
				options: [
					{ name: 'Actor', value: 'actor', description: 'Runs of an Actor' },
					{ name: 'Task', value: 'task', description: 'Runs of a saved task' },
				],
				default: 'actor',
			},
			{
				displayName: 'Actor',
				name: 'actorId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: { show: { watch: ['actor'] } },
				modes: [
					{ displayName: 'From List', name: 'list', type: 'list', typeOptions: { searchListMethod: 'searchActors', searchable: true } },
					{ displayName: 'ID', name: 'id', type: 'string', placeholder: 'e.g. abc123' },
				],
			},
			{
				displayName: 'Task',
				name: 'taskId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: { show: { watch: ['task'] } },
				modes: [
					{ displayName: 'From List', name: 'list', type: 'list', typeOptions: { searchListMethod: 'searchTasks', searchable: true } },
					{ displayName: 'ID', name: 'id', type: 'string', placeholder: 'e.g. abc123' },
				],
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: [
					{ name: 'Run Aborted', value: 'ACTOR.RUN.ABORTED' },
					{ name: 'Run Failed', value: 'ACTOR.RUN.FAILED' },
					{ name: 'Run Succeeded', value: 'ACTOR.RUN.SUCCEEDED' },
					{ name: 'Run Timed Out', value: 'ACTOR.RUN.TIMED_OUT' },
				],
				default: ['ACTOR.RUN.SUCCEEDED'],
			},
			{
				displayName: 'Include Results',
				name: 'includeResults',
				type: 'boolean',
				default: false,
				description: 'Whether to output the run\'s dataset items (one per n8n item) instead of the event',
			},
			{
				displayName: 'Results Limit',
				name: 'resultsLimit',
				type: 'number',
				default: 1000,
				typeOptions: { minValue: 1 },
				displayOptions: { show: { includeResults: [true] } },
				description: 'Max number of items to return',
			},
		],
	};

	methods = {
		listSearch: { searchActors, searchTasks },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return false;
				try {
					await scrapelyRequest.call(this, 'GET', `/v2/webhooks/${encodeURIComponent(String(data.webhookId))}`);
					return true;
				} catch {
					delete data.webhookId;
					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const watch = this.getNodeParameter('watch') as string;
				const id = (
					watch === 'task'
						? this.getNodeParameter('taskId', '', { extractValue: true })
						: this.getNodeParameter('actorId', '', { extractValue: true })
				) as string;
				const body = {
					eventTypes: this.getNodeParameter('events') as string[],
					condition: watch === 'task' ? { actorTaskId: id } : { actorId: id },
					requestUrl: this.getNodeWebhookUrl('default'),
					description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`,
				};
				const created = unwrap(await scrapelyRequest.call(this, 'POST', '/v2/webhooks', { body }));
				if (!created?.id) return false;
				this.getWorkflowStaticData('node').webhookId = created.id;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return true;
				try {
					await scrapelyRequest.call(this, 'DELETE', `/v2/webhooks/${encodeURIComponent(String(data.webhookId))}`);
				} catch (error) {
					this.logger.warn(`Could not delete Scrape.ly webhook ${String(data.webhookId)}: ${(error as Error).message}`);
					return false;
				}
				delete data.webhookId;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as IDataObject;
		if (!this.getNodeParameter('includeResults', false)) {
			return { workflowData: [this.helpers.returnJsonArray(body)] };
		}
		const resource = (body.resource ?? {}) as IDataObject;
		const eventData = (body.eventData ?? {}) as IDataObject;
		const datasetId = (resource.defaultDatasetId ?? eventData.defaultDatasetId) as string | undefined;
		const items = datasetId
			? await getDatasetItems.call(this, datasetId, { limit: this.getNodeParameter('resultsLimit', 1000) as number, clean: true })
			: [];
		return { workflowData: [this.helpers.returnJsonArray(items)] };
	}
}
